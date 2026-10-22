import type { AccountKeys } from '@/crypto/keys';
import { deleteUserDb, deviceGet, metaGet, metaSet, openUserDb, requestPersistentStorage, type UserDb } from '@/db/localDb';
import { applyRemoteKeys, attachPersistence, detachPersistence, flushNow, hydrateFromDb, onLocalChange } from '@/db/persistence';
import { importLegacyData, type LegacyMode } from '@/db/legacyImport';
import { createEmptyData } from '@/data/seed';
import { clearLegacyLocalData, readLegacyLocalData, useStore } from '@/store/useStore';
import { initSecrets, useSecrets } from '@/store/useSecrets';
import { useSession, type SessionUser } from '@/store/useSession';
import { syncOnce } from '@/sync/engine';
import { supabaseRemote, type Remote } from '@/sync/remote';
import { clearLocalSession, isSupabaseConfigured, supabase } from '@/sync/supabase';
import { currentKeyId, forgetAccountKeys, loadAccountKeys, storeAccountKeys, type SignedIn } from './account';

/**
 * CICLO DE VIDA DE LA CUENTA EN ESTE DISPOSITIVO
 * arranque → (sesión guardada + claves) → base local → app lista → sincronización periódica
 *
 * La app funciona sin conexión: con una sesión guardada se abre aunque no haya internet,
 * y los cambios se suben cuando vuelve la conexión.
 */

const SYNC_DEBOUNCE_MS = 3_000;
const SYNC_INTERVAL_MS = 120_000;
const SIGN_OUT_SYNC_TIMEOUT_MS = 5_000;
const GET_SESSION_TIMEOUT_MS = 3_000;
const KEY_ID_META = 'account:keyId';

interface Active {
  user: SessionUser;
  keys: AccountKeys;
  keyId: string;
  db: UserDb;
  remote: Remote;
  stop: () => void;
}

let active: Active | null = null;
let signingOut = false;
/** Datos antiguos de este navegador esperando que el usuario elija qué hacer con ellos */
let pendingLegacy: { signed: SignedIn; db: UserDb; accountHadData: boolean } | null = null;

const session = () => useSession.getState();

/* ---------------- Arranque ---------------- */

let booting: Promise<void> | null = null;

/** Arranque (idempotente: React en modo estricto monta dos veces en desarrollo) */
export function boot(): Promise<void> {
  booting ??= doBoot().catch((err) => {
    console.error('[Arranque]', err);
    session().set({ status: 'signedOut' });
  });
  return booting;
}

async function doBoot(): Promise<void> {
  await initSecrets().catch((err) => console.warn('[Arranque] Claves API:', err));
  void requestPersistentStorage();

  if (!isSupabaseConfigured) {
    session().set({ status: 'unconfigured' });
    return;
  }

  const sb = supabase();
  sb.auth.onAuthStateChange((event) => {
    // La sesión caducó o se revocó en el servidor (p. ej. se cambió la contraseña en otro dispositivo)
    if (event === 'SIGNED_OUT' && !signingOut && active) {
      void lockOut('Tu sesión se cerró. Vuelve a iniciar sesión para seguir sincronizando.');
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
  start({ user, keys, keyId: keys.keyId, db });
  session().set({ status: 'ready', user, firstRun: false });
  void syncNow();
}

/**
 * Usuario de la sesión guardada. Sin conexión `getSession` puede no poder renovar el token:
 * en ese caso se usa la copia guardada para abrir la app igualmente (se renovará al volver la red).
 */
async function storedUser(): Promise<SessionUser | null> {
  try {
    // Con el token caducado y sin red, getSession reintenta la renovación durante mucho tiempo:
    // no se espera más de unos segundos para abrir la app
    const result = await Promise.race([
      supabase().auth.getSession(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GET_SESSION_TIMEOUT_MS)),
    ]);
    const user = result?.data.session?.user;
    if (user) return { id: user.id, email: user.email ?? '' };
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

/**
 * Descarga los datos de la cuenta y abre la app. Mientras tanto la pantalla de acceso sigue visible
 * (con su indicador de espera) para poder mostrar un error si algo falla.
 */
export async function enterAccount(signed: SignedIn): Promise<void> {
  session().set({ notice: undefined });
  const db = openUserDb(signed.user.id);

  // Este dispositivo tenía datos cifrados con otra clave (la cuenta se restableció): se vuelven a subir
  const previousKeyId = await metaGet<string>(db, KEY_ID_META);
  if (previousKeyId && previousKeyId !== signed.keyId) await markAllDirty(db);

  // Sin una primera descarga correcta no se entra: subir los valores por defecto de un dispositivo
  // vacío pisaría los datos reales de la cuenta
  const remote = supabaseRemote(supabase());
  try {
    await syncOnce(db, signed.keys, remote);
  } catch {
    try {
      await syncOnce(db, signed.keys, remote);
    } catch (err) {
      console.warn('[Sync] Primera descarga fallida:', err);
      throw new Error('No se pudieron descargar tus datos. Revisa la conexión e inténtalo de nuevo.');
    }
  }

  const accountHadData = (await db.records.filter((r) => !r.deleted).count()) > 0;
  if (readLegacyLocalData()) {
    // Hay datos de antes de las cuentas en este dispositivo: siempre decide el usuario (pueden ser de otra persona)
    pendingLegacy = { signed, db, accountHadData };
    session().set({ status: 'legacyChoice', user: signed.user, legacyAccountHasData: accountHadData });
    return;
  }
  await finishEnter(signed, db, !accountHadData);
}

/** Respuesta a «¿qué hago con los datos de este dispositivo?» */
export async function resolveLegacy(choice: LegacyMode | 'discard'): Promise<void> {
  if (!pendingLegacy) return;
  const { signed, db, accountHadData } = pendingLegacy;
  pendingLegacy = null;
  const legacy = readLegacyLocalData();
  if (legacy && choice !== 'discard') await importLegacyData(db, legacy, choice);
  clearLegacyLocalData();
  await finishEnter(signed, db, !accountHadData && choice === 'discard');
}

async function finishEnter(signed: SignedIn, db: UserDb, firstRun: boolean) {
  // Las claves se guardan solo ahora: si la app se cerró antes (código de recuperación, elección de
  // datos), al volver se pide iniciar sesión otra vez y se repite el paso
  await storeAccountKeys(signed.user.id, { ...signed.keys, keyId: signed.keyId });
  await metaSet(db, KEY_ID_META, signed.keyId);
  await hydrateFromDb(db);
  start({ user: signed.user, keys: signed.keys, keyId: signed.keyId, db });
  session().set({ status: 'ready', user: signed.user, firstRun, legacyAccountHasData: undefined });
  void syncNow();
}

/* ---------------- Sincronización ---------------- */

function start({ user, keys, keyId, db }: Pick<Active, 'user' | 'keys' | 'keyId' | 'db'>) {
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
    keyId,
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
    // Si otro dispositivo restableció la cuenta (nueva clave), no se sube nada con la clave vieja
    const keyId = await currentKeyId(supabase(), a.user.id);
    if (active !== a) return;
    if (keyId !== a.keyId) {
      await lockOut('Tu cuenta se restableció desde otro dispositivo. Vuelve a iniciar sesión para seguir sincronizando.');
      return;
    }
    await flushNow();
    const result = await syncOnce(a.db, a.keys, a.remote);
    if (active !== a) return;
    await applyRemoteKeys(result.appliedKeys);
    session().set({
      sync: 'idle',
      lastSyncedAt: Date.now(),
      syncError: result.undecryptable ? `${result.undecryptable} registros de la nube no se pudieron descifrar` : undefined,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = /failed to fetch|network|load failed/i.test(raw) ? 'No se pudo conectar con el servidor. Se reintentará solo.' : raw;
    session().set({ sync: navigator.onLine ? 'error' : 'offline', syncError: message });
  }
}

/** Cambios locales que aún no llegaron a la nube */
export async function pendingChanges(): Promise<number> {
  return active ? active.db.records.where('dirty').equals(1).count() : 0;
}

/**
 * La sesión dejó de ser válida sin que el usuario la cerrara: se vuelve a la pantalla de acceso.
 * Se olvidan las claves de cifrado y la sesión. La base local solo se borra si no tiene cambios
 * sin subir (si los tiene, se subirán al volver a entrar con esta cuenta).
 */
async function lockOut(notice: string) {
  const a = active;
  signingOut = true;
  try {
    stopActive();
    await clearLocalSession();
    if (a) {
      await forgetAccountKeys(a.user.id);
      const pending = await a.db.records.where('dirty').equals(1).count().catch(() => 0);
      if (pending === 0) await deleteUserDb(a.user.id);
    }
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined, syncError: undefined, notice });
  } finally {
    signingOut = false;
  }
}

/* ---------------- Cerrar sesión ---------------- */

/**
 * Cierra la sesión en este dispositivo y borra sus datos locales (siguen en la nube, cifrados).
 * - `forgetApiKeys`: borrar también las claves API de este dispositivo (recomendado en equipos compartidos).
 * - Si tras intentar subirlos quedan cambios pendientes, no se cierra sin `force` y se devuelve cuántos son.
 */
export async function signOut({ forgetApiKeys, force = false }: { forgetApiKeys: boolean; force?: boolean }): Promise<{ pending: number }> {
  const a = active;
  if (a && navigator.onLine) {
    // Último intento de subir lo pendiente, sin bloquear demasiado si la red va lenta
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, SIGN_OUT_SYNC_TIMEOUT_MS))]);
  }
  if (a) await flushNow();
  const pending = await pendingChanges();
  if (pending > 0 && !force) return { pending };

  signingOut = true;
  try {
    stopActive();
    pendingLegacy = null;
    await clearLocalSession();
    if (a) {
      await forgetAccountKeys(a.user.id);
      await deleteUserDb(a.user.id);
    }
    if (forgetApiKeys) useSecrets.getState().forgetAll();
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined, syncError: undefined, notice: undefined });
  } finally {
    signingOut = false;
  }
  return { pending: 0 };
}

/** Tras eliminar la cuenta en el servidor: limpia todo lo local */
export async function afterAccountDeleted(): Promise<void> {
  const a = active;
  signingOut = true;
  try {
    stopActive();
    await clearLocalSession();
    if (a) {
      await forgetAccountKeys(a.user.id);
      await deleteUserDb(a.user.id);
    }
    useSecrets.getState().forgetAll();
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined, notice: 'Tu cuenta y tus datos se eliminaron.' });
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
