import type { AccountKeys } from '@/crypto/keys';
import { deleteUserDb, deviceGet, openUserDb, requestPersistentStorage, type UserDb } from '@/db/localDb';
import { applyRemoteKeys, attachPersistence, detachPersistence, flushNow, hydrateFromDb, onLocalChange } from '@/db/persistence';
import { importLegacyData, type LegacyMode } from '@/db/legacyImport';
import { createEmptyData } from '@/data/seed';
import { clearLegacyLocalData, readLegacyLocalData, useStore } from '@/store/useStore';
import { initSecrets, useSecrets } from '@/store/useSecrets';
import { useSession, type SessionUser } from '@/store/useSession';
import { migrateLegacy, syncOnce, type SyncResult } from '@/sync/engine';
import { supabaseRemote, UntrustedDeviceError, type Remote } from '@/sync/remote';
import { clearLocalSession, isSupabaseConfigured, supabase } from '@/sync/supabase';
import { forgetAccountState, loadAccountState, storeAccountState, type SignedIn } from './account';
import { deviceToken } from './device';

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
const UNTRUSTED_NOTICE = 'Por seguridad, verifica este dispositivo: inicia sesión y te enviaremos un código al correo.';

interface Active {
  user: SessionUser;
  /** Claves de la cuenta de antes: hasta convertir sus datos cifrados a legibles */
  legacy?: AccountKeys;
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
  const state = user ? await loadAccountState(user.id) : undefined;
  if (!user || !state) {
    session().set({ status: 'signedOut' });
    return;
  }

  const db = openUserDb(user.id);
  await hydrateFromDb(db);
  start({ user, legacy: state.legacy, db });
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

  // Sin una primera descarga correcta no se entra: subir los valores por defecto de un dispositivo
  // vacío pisaría los datos reales de la cuenta
  const remote = supabaseRemote(supabase(), deviceToken);
  const firstSync = async () => {
    if (signed.legacyKeys) await convertLegacy(db, remote, signed.legacyKeys);
    else await syncOnce(db, remote);
    // Datos cifrados de antes que ya no se pueden abrir (recuperación sin la contraseña anterior)
    if (signed.discardLegacy) await finishLegacy();
  };
  try {
    await firstSync();
  } catch {
    try {
      await firstSync();
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
  // Se guarda solo ahora: si la app se cerró antes (elección de datos), al volver se pide iniciar sesión otra vez.
  // Las claves antiguas ya no hacen falta: la conversión terminó en la primera descarga.
  await storeAccountState(signed.user.id, {});
  await hydrateFromDb(db);
  start({ user: signed.user, db });
  session().set({ status: 'ready', user: signed.user, firstRun, legacyAccountHasData: undefined });
  void syncNow();
}

/* ---------------- Sincronización ---------------- */

function start({ user, legacy, db }: Pick<Active, 'user' | 'legacy' | 'db'>) {
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
    legacy,
    db,
    remote: supabaseRemote(supabase(), deviceToken),
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
    let result: SyncResult;
    if (a.legacy) {
      // Este dispositivo guardaba las claves de antes: convierte los datos cifrados que queden en la nube
      result = await convertLegacy(a.db, a.remote, a.legacy);
      a.legacy = undefined;
      await storeAccountState(a.user.id, {});
    } else {
      result = await syncOnce(a.db, a.remote);
    }
    if (active !== a) return;
    await applyRemoteKeys(result.appliedKeys);
    session().set({
      sync: 'idle',
      lastSyncedAt: Date.now(),
      syncError: result.unreadable ? `${result.unreadable} registros antiguos de la nube no se pudieron leer` : undefined,
    });
  } catch (err) {
    if (err instanceof UntrustedDeviceError) {
      // El dispositivo dejó de estar verificado (p. ej. la cuenta se recuperó desde otro): hay que volver a entrar
      if (active === a) await lockOut(UNTRUSTED_NOTICE);
      return;
    }
    const raw = err instanceof Error ? err.message : String(err);
    const message = /failed to fetch|network|load failed/i.test(raw) ? 'No se pudo conectar con el servidor. Se reintentará solo.' : raw;
    session().set({ sync: navigator.onLine ? 'error' : 'offline', syncError: message });
  }
}

/** Cambios locales que aún no llegaron a la nube */
export async function pendingChanges(): Promise<number> {
  return active ? active.db.records.where('dirty').equals(1).count() : 0;
}

/** Convierte los datos cifrados de una cuenta de antes y borra lo cifrado en el servidor */
async function convertLegacy(db: UserDb, remote: Remote, legacy: AccountKeys): Promise<SyncResult> {
  const result = await migrateLegacy(db, remote, legacy);
  await finishLegacy();
  return result;
}

async function finishLegacy() {
  const { error } = await supabase().rpc('finish_plaintext_migration', { device: await deviceToken() });
  if (error) throw new Error(error.message);
}

/**
 * La sesión dejó de ser válida sin que el usuario la cerrara: se vuelve a la pantalla de acceso.
 * Se olvida la sesión. La base local solo se borra si no tiene cambios
 * sin subir (si los tiene, se subirán al volver a entrar con esta cuenta).
 */
async function lockOut(notice: string) {
  const a = active;
  signingOut = true;
  try {
    stopActive();
    await clearLocalSession();
    if (a) {
      await forgetAccountState(a.user.id);
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
 * Cierra la sesión en este dispositivo y borra sus datos locales (siguen en la nube).
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
      await forgetAccountState(a.user.id);
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
      await forgetAccountState(a.user.id);
      await deleteUserDb(a.user.id);
    }
    useSecrets.getState().forgetAll();
    useStore.setState(createEmptyData());
    session().set({ status: 'signedOut', user: null, sync: 'idle', lastSyncedAt: undefined, notice: 'Tu cuenta y tus datos se eliminaron.' });
  } finally {
    signingOut = false;
  }
}

export const activeUser = () => active?.user ?? null;
