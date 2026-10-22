import type { AccountKeys } from '@/crypto/keys';
import { deleteUserDb, deviceGet, openUserDb, requestPersistentStorage, type UserDb } from '@/db/localDb';
import { attachPersistence, detachPersistence, flushNow, hydrateFromDb, onLocalChange, reloadFromDb } from '@/db/persistence';
import { importLegacyData, type LegacyMode } from '@/db/legacyImport';
import { createEmptyData } from '@/data/seed';
import { clearLegacyLocalData, readLegacyLocalData, useStore } from '@/store/useStore';
import { initSecrets, useSecrets } from '@/store/useSecrets';
import { useSession, type SessionUser } from '@/store/useSession';
import { syncOnce } from '@/sync/engine';
import { supabaseRemote, type Remote } from '@/sync/remote';
import { isSupabaseConfigured, supabase } from '@/sync/supabase';
import { forgetAccountKeys, loadAccountKeys, type SignedIn } from './account';

/**
 * CICLO DE VIDA DE LA CUENTA EN ESTE DISPOSITIVO
 * arranque → (sesión guardada + claves) → base local → app lista → sincronización periódica
 *
 * La app funciona sin conexión: con una sesión guardada se abre aunque no haya internet,
 * y los cambios se suben cuando vuelve la conexión.
 */

const SYNC_DEBOUNCE_MS = 3_000;
const SYNC_INTERVAL_MS = 120_000;
const SIGN_OUT_SYNC_TIMEOUT_MS = 8_000;

interface Active {
  user: SessionUser;
  keys: AccountKeys;
  db: UserDb;
  remote: Remote;
  stop: () => void;
}

let active: Active | null = null;
let signingOut = false;
/** Datos antiguos de este navegador esperando que el usuario elija qué hacer con ellos */
let pendingLegacy: { signed: SignedIn; db: UserDb } | null = null;

const session = () => useSession.getState();

/* ---------------- Arranque ---------------- */

export async function boot(): Promise<void> {
  await initSecrets().catch((err) => console.warn('[Arranque] Claves API:', err));
  void requestPersistentStorage();

  if (!isSupabaseConfigured) {
    session().set({ status: 'unconfigured' });
    return;
  }

  const sb = supabase();
  sb.auth.onAuthStateChange((event) => {
    // La sesión caducó o se revocó en el servidor: se vuelve a pedir la contraseña (los datos locales se conservan)
    if (event === 'SIGNED_OUT' && !signingOut && active) {
      stopActive();
      useStore.setState(createEmptyData());
      session().set({ status: 'signedOut', user: null });
    }
  });

  const user = await storedUser();
  const keys = user ? await loadAccountKeys(user.id) : undefined;
  if (!user || !keys) {
    session().set({ status: 'signedOut' });
    return;
  }

  const db = openUserDb(user.id);
  await hydrateFromDb(db);
  start({ user, keys, db });
  session().set({ status: 'ready', user, firstRun: false });
  void syncNow();
}

/**
 * Usuario de la sesión guardada. Sin conexión `getSession` puede no poder renovar el token:
 * en ese caso se usa la copia guardada para abrir la app igualmente (se renovará al volver la red).
 */
async function storedUser(): Promise<SessionUser | null> {
  try {
    const { data } = await supabase().auth.getSession();
    if (data.session?.user) return { id: data.session.user.id, email: data.session.user.email ?? '' };
  } catch {
    /* sin red: se mira la copia local */
  }
  try {
    const raw = await deviceGet<string>('auth:pilas-auth');
    const parsed = raw ? (JSON.parse(raw) as { user?: { id?: string; email?: string } }) : null;
    if (parsed?.user?.id) return { id: parsed.user.id, email: parsed.user.email ?? '' };
  } catch {
    /* sin sesión guardada */
  }
  return null;
}

/* ---------------- Entrar a la cuenta (tras iniciar sesión o registrarse) ---------------- */

export async function enterAccount(signed: SignedIn): Promise<void> {
  session().set({ status: 'loading' });
  const db = openUserDb(signed.user.id);
  const remote = supabaseRemote(supabase());

  try {
    await syncOnce(db, signed.keys, remote);
  } catch (err) {
    console.warn('[Sync] Primera descarga fallida:', err);
  }

  const hasData = (await db.records.filter((r) => !r.deleted).count()) > 0;
  const legacy = readLegacyLocalData();
  if (legacy && !hasData) {
    await importLegacyData(db, legacy, 'replace');
    clearLegacyLocalData();
    return finishEnter(signed, db, false);
  }
  if (legacy && hasData) {
    // Hay datos en la cuenta y también en este navegador: decide el usuario (ver LegacyChoice)
    pendingLegacy = { signed, db };
    session().set({ status: 'legacyChoice', user: signed.user });
    return;
  }
  return finishEnter(signed, db, !hasData);
}

/** Respuesta a «¿qué hago con los datos de este dispositivo?» */
export async function resolveLegacy(choice: LegacyMode | 'discard'): Promise<void> {
  if (!pendingLegacy) return;
  const { signed, db } = pendingLegacy;
  pendingLegacy = null;
  const legacy = readLegacyLocalData();
  if (legacy && choice !== 'discard') await importLegacyData(db, legacy, choice);
  clearLegacyLocalData();
  await finishEnter(signed, db, false);
}

async function finishEnter(signed: SignedIn, db: UserDb, firstRun: boolean) {
  await hydrateFromDb(db);
  start({ user: signed.user, keys: signed.keys, db });
  session().set({ status: 'ready', user: signed.user, firstRun });
  void syncNow();
}

/* ---------------- Sincronización ---------------- */

function start({ user, keys, db }: Pick<Active, 'user' | 'keys' | 'db'>) {
  stopActive();
  attachPersistence(db);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const offChange = onLocalChange(() => {
    session().set({ sync: navigator.onLine ? 'pending' : 'offline' });
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void syncNow(), SYNC_DEBOUNCE_MS);
  });
  const onOnline = () => void syncNow();
  const onOffline = () => session().set({ sync: 'offline' });
  const onVisible = () => document.visibilityState === 'visible' && void syncNow();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => void syncNow(), SYNC_INTERVAL_MS);

  active = {
    user,
    keys,
    db,
    remote: supabaseRemote(supabase()),
    stop: () => {
      offChange();
      if (debounce) clearTimeout(debounce);
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      detachPersistence();
    },
  };
}

function stopActive() {
  active?.stop();
  active = null;
}

let running: Promise<void> | null = null;
let again = false;

/** Sube lo pendiente y baja lo nuevo. Si ya hay una sincronización en curso, se encadena otra. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncPass();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

async function syncPass() {
  const a = active;
  if (!a) return;
  if (!navigator.onLine) {
    session().set({ sync: 'offline' });
    return;
  }
  session().set({ sync: 'syncing', syncError: undefined });
  try {
    await flushNow();
    const result = await syncOnce(a.db, a.keys, a.remote);
    if (active !== a) return;
    if (result.applied > 0) await reloadFromDb();
    session().set({
      sync: 'idle',
      lastSyncedAt: Date.now(),
      syncError: result.undecryptable ? `${result.undecryptable} registros de la nube no se pudieron descifrar` : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session().set({ sync: navigator.onLine ? 'error' : 'offline', syncError: message });
  }
}

/** Cambios locales que aún no llegaron a la nube */
export async function pendingChanges(): Promise<number> {
  return active ? active.db.records.where('dirty').equals(1).count() : 0;
}

/* ---------------- Cerrar sesión ---------------- */

/**
 * Cierra la sesión en este dispositivo y borra sus datos locales (siguen en la nube, cifrados).
 * `forgetApiKeys`: borrar también las claves API de este dispositivo (recomendado en equipos compartidos).
 */
export async function signOut({ forgetApiKeys }: { forgetApiKeys: boolean }): Promise<void> {
  const a = active;
  signingOut = true;
  try {
    if (a && navigator.onLine) {
      // Último intento de subir lo pendiente, sin bloquear demasiado si la red va lenta
      await Promise.race([syncNow(), new Promise((r) => setTimeout(r, SIGN_OUT_SYNC_TIMEOUT_MS))]);
    }
    stopActive();
    pendingLegacy = null;
    await supabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (a) {
      await forgetAccountKeys(a.user.id);
      await deleteUserDb(a.user.id);
    }
    if (forgetApiKeys) useSecrets.getState().forgetAll();
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined, syncError: undefined });
  } finally {
    signingOut = false;
  }
}

/** Tras eliminar la cuenta en el servidor: limpia todo lo local */
export async function afterAccountDeleted(): Promise<void> {
  const a = active;
  signingOut = true;
  try {
    stopActive();
    await supabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (a) {
      await forgetAccountKeys(a.user.id);
      await deleteUserDb(a.user.id);
    }
    useSecrets.getState().forgetAll();
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined });
  } finally {
    signingOut = false;
  }
}

/**
 * Tras recuperar la cuenta sin código (datos de la nube restablecidos): la base local sigue con los
 * datos de este dispositivo; se marcan todos como pendientes para volver a subirlos con la clave nueva.
 */
export async function markAllDirty(db: UserDb): Promise<void> {
  const all = await db.records.toArray();
  await db.records.bulkPut(all.map((r) => ({ ...r, dirty: 1 as const })));
  await db.meta.delete('sync:cursor');
}

/** Entrar tras «recuperar sin código»: lo que quede en este dispositivo se vuelve a subir con la clave nueva */
export async function enterAfterCloudReset(signed: SignedIn): Promise<void> {
  await markAllDirty(openUserDb(signed.user.id));
  await enterAccount(signed);
}

export const activeUser = () => active?.user ?? null;
