import { useEffect } from 'react';
import { deviceDelete, deviceGet, deviceSet } from '@/db/localDb';
import { isDemoActive } from '@/data/seed';
import { todayKey } from '@/lib/dates';
import { refreshAppAi } from '@/lib/appAi';
import { applyEconomyVersions } from '@/lib/economyRules';
import { defaultAvatarPath, effectivePreset, textHash } from '@/lib/defaultAvatars';
import { useStore } from '@/store/useStore';
import { useSession, type SessionUser } from '@/store/useSession';
import { isSupabaseConfigured } from '@/sync/supabase';
import { avatarBlobFrom, syncPublicAvatar } from '@/components/profile/publicProfile';
import * as api from './api';
import { baselineFrom, hasDeviceData, publicHabitRows, publishableDays, walletMoves } from './publish';
import { ALIAS_RE } from './texts';
import { initialSocial, useSocial } from './useSocial';
import type { NotificationRow, ProfileRow } from './types';

/**
 * CICLO DE LA CAPA PÚBLICA EN ESTE DISPOSITIVO
 * Con sesión: pide el estado (rol, veto, perfil) y aplica la economía vigente. Todo perfil es público: si aún no existe,
 * se crea solo (al terminar la bienvenida) con el nombre, el alias opcional y la foto. Después publica ayer y hoy cuando
 * cambian los datos (con espera), sincroniza el saldo, mantiene al día el nombre y la foto del perfil y escucha las
 * notificaciones en tiempo real.
 * - Nada se escribe en el servidor hasta que termina la primera sincronización de la sesión: antes, un dispositivo
 *   desfasado o vacío publicaría cifras viejas (o reclamaría ceros como punto de partida).
 * - Con datos de demostración (`settings.demoMode` o los ids de la demo) no se publica nada: ni días, ni saldo, ni
 *   hábitos, ni punto de partida. Las cifras públicas se quedan como estaban.
 * - Cuando los datos cambian por completo (`settings.dataResetAt`: empezar de cero, quitar la demostración, importar), se
 *   reinicia lo publicado en el servidor (una sola vez por cambio, aunque llegue desde varios dispositivos) y se vuelve a
 *   calcular con los datos nuevos.
 */

const PUBLISH_DEBOUNCE_MS = 4_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;
/** Si crear el perfil falla (sin conexión), se reintenta como mucho cada 5 minutos */
const CREATE_RETRY_MS = 5 * 60_000;
/** Si subir la foto falla, se reintenta como mucho cada 5 minutos */
const AVATAR_RETRY_MS = 5 * 60_000;
/** Un dispositivo que nunca atendió un cambio completo de datos solo atiende los de los últimos 2 días (ver resetPending) */
const UNHANDLED_RESET_MAX_AGE_MS = 2 * 86_400_000;

interface Running {
  uid: string;
  stop: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  lastDays: string;
  lastHabits: string;
  habitKeys: Set<string> | null;
  unsubscribeRealtime: (() => void) | null;
  /** Publicación en curso de esta sesión y si hubo cambios mientras tanto (se vuelve a publicar al terminar) */
  publishing: Promise<void> | null;
  again: boolean;
  /** El estado del servidor se leyó bien al menos una vez: sin eso no se sabe si ya hay perfil y no se crea ninguno */
  statusLoaded: boolean;
  /** Último intento fallido de crear el perfil (ms) */
  createFailedAt: number;
  /** La sesión empezó con la bienvenida (cuenta nueva): ya vio la nota de privacidad y no hace falta otro aviso */
  newcomer: boolean;
  /** Cambios del perfil (nombre, alias pendiente) que fallaron: no se repiten hasta que cambien */
  identityFailed: string;
  /** Foto (firma) o ruta por defecto que no se pudo publicar y cuándo: se reintenta pasado un rato */
  avatarFailed: { sig: string; at: number } | null;
  /**
   * El servidor no dejó reiniciar el progreso (límite diario): en esta sesión no se publica nada, porque se mezclarían
   * las cifras de los datos de antes con las de los nuevos
   */
  resetBlocked: boolean;
  /** El servidor no tiene la capa pública al día (migración 0003 sin aplicar): en esta sesión no se reintenta nada */
  layerMissing: boolean;
}

let running: Running | null = null;

type NoticeListener = (n: NotificationRow) => void;
const listeners = new Set<NoticeListener>();

/** La interfaz escucha aquí los avisos nuevos (toasts, celebraciones) */
export function onSocialNotice(fn: NoticeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const kv = (uid: string, name: string) => `social:${name}:${uid}`;

/** ¿El servidor aún no tiene la migración? (la función o la columna no existen: «… in the schema cache») */
const isMissingServerLayer = (err: unknown) => /Could not find the|schema cache|does not exist/i.test(String((err as Error)?.message ?? err));

/** El servidor rechazó el alias (ocupado, reservado o con formato no válido): sus mensajes nombran el alias */
const isAliasProblem = (err: unknown) => /alias/i.test(String((err as Error)?.message ?? err));

/** Se alcanzó el límite diario de reinicios del progreso (`54000`) */
const isRateLimited = (err: unknown) =>
  (err instanceof api.SocialError && err.code === '54000') || /reinicios del progreso/i.test(String((err as Error)?.message ?? err));

/** Nombre visible en la comunidad (el de la bienvenida o Ajustes) */
const publicName = (name: string | undefined) => (name ?? '').trim().slice(0, 40) || 'Persona';

/** Alias elegido sin perfil (bienvenida o Ajustes sin servidor), si tiene un formato válido */
const pendingAliasOf = (a: string | undefined) => (a && ALIAS_RE.test(a) ? a : null);

const clearPendingAlias = () => {
  if (useStore.getState().settings.pendingAlias !== undefined) useStore.getState().updateSettings({ pendingAlias: undefined });
};

/** La primera sincronización de la sesión terminó: los datos del dispositivo ya son los de la cuenta */
const firstSyncDone = () => useSession.getState().lastSyncedAt !== undefined;

/** El servidor no tiene la capa pública al día: se oculta en esta sesión y no se reintenta (cada intento subía la foto) */
function markLayerMissing(r: Running, err: unknown) {
  if (running !== r) return;
  r.layerMissing = true;
  useSocial.getState().set({ available: false });
  console.warn('[Social] El servidor no tiene la capa pública al día (falta aplicar 0003_perfiles_ligas.sql):', (err as Error)?.message ?? err);
}

/* ---------------- Foto publicada ---------------- */

/** Firma corta de una foto (tamaño + huella): basta para saber si cambió sin guardar la foto otra vez */
export const avatarSignature = (dataUrl: string) => `${dataUrl.length}:${textHash(dataUrl).toString(36)}`;

/** Recuerda en este dispositivo qué foto propia quedó publicada (o que se publicó la foto por defecto) */
export async function rememberPublishedAvatar(uid: string, dataUrl: string | undefined): Promise<void> {
  if (dataUrl) await deviceSet(kv(uid, 'avatar'), avatarSignature(dataUrl));
  else await deviceDelete(kv(uid, 'avatar'));
}

/* ---------------- Estado ---------------- */

export async function refreshSocialStatus(): Promise<void> {
  const r = running;
  if (!r) return;
  // Qué IA incluye la app (claves del creador): si las quita, los avisos vuelven sin reinstalar nada
  void refreshAppAi().catch(() => undefined);
  try {
    const s = await api.getStatus();
    if (running !== r || !s) return;
    r.statusLoaded = true;
    useSocial.getState().set({
      phase: 'ready',
      available: !r.layerMissing,
      isAdmin: s.is_admin,
      ban: s.ban,
      profile: s.profile,
      baselineAt: s.baseline_at,
      serverBalance: Number(s.balance),
      unread: Number(s.unread),
      error: undefined,
    });
    void deviceSet(kv(r.uid, 'admin'), s.is_admin);
    if (s.profile) ensureRealtime(r);
  } catch (err) {
    if (running !== r) return;
    if (isMissingServerLayer(err)) useSocial.getState().set({ phase: 'ready', available: false });
    else useSocial.getState().set({ phase: useSocial.getState().profile ? 'ready' : 'error', error: (err as Error).message });
  }
}

/**
 * Día desde el que rige una versión: el de Colombia de su `effective_from` (el servidor la publica a las 00:00 de ese día
 * y topa cada día con la versión de ese día). Con el día local del instante, en husos al oeste de Colombia la versión
 * empezaría un día antes que en el servidor.
 */
export const economyVersionDay = (from: string) => new Date(Date.parse(from) - 5 * 3_600_000).toISOString().slice(0, 10);

async function loadEconomy(uid: string) {
  try {
    const list = await api.getEconomyVersions();
    const local = list.map((v) => ({ from: economyVersionDay(v.from), params: v.params }));
    applyEconomyVersions(local, todayKey());
    void deviceSet(kv(uid, 'economy'), local);
  } catch {
    /* sin conexión: se queda con la última versión guardada */
  }
}

export async function loadCatalog(): Promise<void> {
  const r = running;
  if (!r) return;
  try {
    const [catalog, inventory] = await Promise.all([api.getCatalog(), api.getInventory(r.uid)]);
    if (running === r) useSocial.getState().set({ catalog, inventory });
  } catch {
    /* se reintenta en el próximo ciclo */
  }
}

/* ---------------- Perfil ---------------- */

/**
 * Todo perfil es público: si el servidor no tiene el tuyo, se crea con el nombre, el alias (si eligiste uno y está
 * libre) y la foto de la bienvenida (la subida o la por defecto). Espera a que termine la bienvenida para no crearlo
 * vacío. Si el alias ya estaba en uso, el perfil se crea sin alias y se avisa para elegir otro en Ajustes.
 * Nunca lanza: si falla, se reintenta más tarde (salvo que al servidor le falte la migración: entonces no se reintenta).
 */
async function ensureProfile(r: Running): Promise<void> {
  const st = useSocial.getState();
  if (running !== r || !r.statusLoaded || r.layerMissing || !st.available || st.ban || st.profile) return;
  if (useSession.getState().firstRun || Date.now() - r.createFailedAt < CREATE_RETRY_MS) return;

  const settings = useStore.getState().settings;
  const wanted = pendingAliasOf(settings.pendingAlias);
  const displayName = publicName(settings.userName);
  let uploaded: string | null = null;
  try {
    if (settings.avatarDataUrl) {
      try {
        uploaded = await api.uploadAvatar(r.uid, await avatarBlobFrom(settings.avatarDataUrl));
      } catch (err) {
        // Se crea con la foto por defecto: la propia se vuelve a intentar sola en el siguiente ciclo (syncAvatar)
        console.warn('[Social] No se pudo subir tu foto al crear el perfil:', (err as Error).message);
      }
    }
    const avatarPath = uploaded ?? defaultAvatarPath(effectivePreset(settings.avatarPreset, r.uid));

    let alias = wanted;
    if (alias && (await api.aliasTaken(alias).catch(() => false))) alias = null;
    let row: ProfileRow;
    try {
      row = await api.createProfile(r.uid, { display_name: displayName, alias, avatar_path: avatarPath });
    } catch (err) {
      // Lo ocuparon mientras tanto o el servidor no lo acepta: se crea sin alias
      if (!alias || !isAliasProblem(err)) throw err;
      alias = null;
      row = await api.createProfile(r.uid, { display_name: displayName, alias: null, avatar_path: avatarPath });
    }
    if (running !== r) return;
    if (uploaded) void rememberPublishedAvatar(r.uid, settings.avatarDataUrl).catch(() => undefined);
    // Quien ya usaba la app no vio la nota de privacidad de la bienvenida: se le avisa una vez de qué se ve
    useSocial.getState().set({ profile: row, aliasConflict: wanted && !alias ? wanted : null, profileAutoCreated: !r.newcomer });
    clearPendingAlias();
    r.createFailedAt = 0;
    await refreshSocialStatus();
    void loadCatalog();
  } catch (err) {
    if (uploaded) void api.removeAvatarFiles([uploaded]).catch(() => undefined);
    if (running !== r) return;
    if (isMissingServerLayer(err)) return markLayerMissing(r, err);
    r.createFailedAt = Date.now();
    console.warn('[Social] No se pudo crear tu perfil público:', (err as Error).message);
    // Quizá ya existía (otro dispositivo lo creó a la vez) o hay un veto: se vuelve a preguntar
    await refreshSocialStatus();
  }
}

/**
 * Mantiene el perfil al día con los ajustes: el nombre visible y un alias que se eligió sin perfil (queda en
 * `pendingAlias`). La foto la mantiene syncAvatar. Nunca lanza: lo que falle se reintenta cuando cambie.
 */
async function syncIdentity(r: Running): Promise<void> {
  const { profile } = useSocial.getState();
  if (!profile) return;
  const s = useStore.getState().settings;
  const patch: api.ProfilePatch = {};
  const name = publicName(s.userName);
  if (profile.display_name !== name) patch.display_name = name;
  const pending = pendingAliasOf(s.pendingAlias);
  if (pending && pending !== profile.alias) patch.alias = pending;
  else if (s.pendingAlias !== undefined) clearPendingAlias();
  if (!Object.keys(patch).length) return;

  const sig = JSON.stringify(patch);
  if (sig === r.identityFailed) return;
  try {
    let row: ProfileRow = profile;
    try {
      row = await api.updateProfile(r.uid, patch);
    } catch (err) {
      if (!patch.alias || !isAliasProblem(err)) throw err;
      // El alias pendiente ya no estaba libre: se guarda lo demás y se avisa
      const rest: api.ProfilePatch = { ...patch };
      delete rest.alias;
      if (Object.keys(rest).length) row = await api.updateProfile(r.uid, rest);
      if (running === r) useSocial.getState().set({ aliasConflict: patch.alias });
    }
    if (running !== r) return;
    useSocial.getState().set({ profile: row });
    if (patch.alias) clearPendingAlias();
    r.identityFailed = '';
  } catch (err) {
    if (running !== r) return;
    if (isMissingServerLayer(err)) return markLayerMissing(r, err);
    r.identityFailed = sig;
    if (err instanceof api.SocialError && err.banned) void refreshSocialStatus();
    else console.warn('[Social] No se pudo actualizar tu perfil público:', (err as Error).message);
  }
}

/**
 * Mantiene la foto del perfil al día aunque cambiara sin perfil cargado (sin conexión, con un veto, un fallo al subir):
 * - Con foto propia: si no es la que este dispositivo dejó publicada (se recuerda su firma), se sube y se borra la anterior.
 * - Sin foto propia: el perfil muestra la foto por defecto que se ve en la app y se borra la que quedó subida.
 * Un perfil al que el creador le quitó la foto (queda sin ninguna) no la recupera sola: solo se sube una foto distinta.
 * Nunca lanza: lo que falle se reintenta pasado un rato.
 */
async function syncAvatar(r: Running): Promise<void> {
  const { profile } = useSocial.getState();
  if (!profile) return;
  const s = useStore.getState().settings;
  const photo = s.avatarDataUrl;
  const target = photo ? avatarSignature(photo) : defaultAvatarPath(effectivePreset(s.avatarPreset, r.uid));
  if (r.avatarFailed?.sig === target && Date.now() - r.avatarFailed.at < AVATAR_RETRY_MS) return;
  if (photo) {
    const published = await deviceGet<string>(kv(r.uid, 'avatar'));
    if (running !== r || published === target) return;
    // Sin ninguna foto (ni por defecto) solo queda si el creador la quitó (admin_clear_avatar): esa foto no se vuelve a
    // subir sola desde ningún dispositivo; se da por atendida y solo se sube una foto distinta
    if (profile.avatar_path === null) {
      await rememberPublishedAvatar(r.uid, photo).catch(() => undefined);
      return;
    }
  } else if (profile.avatar_path === target) {
    return;
  }
  try {
    await syncPublicAvatar(photo);
    if (running === r) r.avatarFailed = null;
  } catch (err) {
    if (running !== r) return;
    if (isMissingServerLayer(err)) return markLayerMissing(r, err);
    r.avatarFailed = { sig: target, at: Date.now() };
    if (err instanceof api.SocialError && err.banned) void refreshSocialStatus();
    else console.warn('[Social] No se pudo actualizar tu foto pública:', (err as Error).message);
  }
}

/* ---------------- Datos que cambian por completo ---------------- */

/**
 * ¿Hay que atender aquí el cambio completo de datos `at` (`settings.dataResetAt`)? Sí si es posterior al último atendido
 * en este dispositivo: el servidor decide si de verdad reinicia (lo hace una sola vez por cambio). En un dispositivo que
 * nunca atendió ninguno (recién instalado), solo si es de los últimos 2 días: uno más viejo ya lo atendió el dispositivo
 * donde ocurrió (o la versión anterior de la app, que no lo anotaba en el servidor) y reiniciar ahora borraría sin motivo
 * el historial publicado desde entonces.
 */
export function resetPending(at: string | undefined, handled: string | undefined, now = Date.now()): boolean {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return false;
  if (handled) {
    const h = Date.parse(handled);
    return Number.isNaN(h) || t > h;
  }
  return now - t < UNHANDLED_RESET_MAX_AGE_MS;
}

/**
 * Empezar de cero, quitar la demostración o importar una copia (aquí o en otro dispositivo: `dataResetAt` viaja con los
 * ajustes). Lo publicado ya no corresponde a los datos: se pide al servidor que lo reinicie (`reset_my_progress` con la
 * hora del cambio: si otro dispositivo ya lo atendió, no hace nada), se olvida lo recordado en este dispositivo y la
 * siguiente publicación vuelve a reclamar el punto de partida con los datos nuevos.
 * Si el servidor no deja reiniciar (límite diario), en esta sesión no se publica nada y se avisa (`resetLimited`).
 */
async function handleDataReset(r: Running): Promise<void> {
  const at = useStore.getState().settings.dataResetAt;
  if (!at) return;
  const key = kv(r.uid, 'resetAt');
  const handled = await deviceGet<string>(key);
  if (running !== r || !resetPending(at, handled)) return;
  try {
    await api.resetMyProgress(at);
  } catch (err) {
    if (running !== r) return;
    if (isRateLimited(err)) {
      r.resetBlocked = true;
      useSocial.getState().set({ resetLimited: true });
      return;
    }
    if (isMissingServerLayer(err)) return markLayerMissing(r, err);
    throw err;
  }
  if (running !== r) return;
  await Promise.all([deviceDelete(kv(r.uid, 'sent')), deviceDelete(kv(r.uid, 'ledger'))]);
  r.lastDays = '';
  r.lastHabits = '';
  r.habitKeys = null;
  await deviceSet(key, at);
  // Sin punto de partida (baselineAt null): la próxima publicación lo reclama con los datos nuevos
  await refreshSocialStatus();
}

/* ---------------- Publicar ---------------- */

async function doPublish(r: Running): Promise<void> {
  // Si la sesión cambió (cerrar sesión, otra cuenta) se deja de tocar el store y el estado: serían de otra persona
  const stale = () => running !== r;
  // Sin el estado del servidor (p. ej. sin conexión al arrancar) no se sabe si ya hay perfil: se pide antes de nada
  if (!r.statusLoaded) {
    await refreshSocialStatus();
    if (stale() || !r.statusLoaded) return;
  }
  // Hasta la primera sincronización de la sesión los datos pueden ser viejos o no estar: no se escribe nada
  if (!firstSyncDone() || r.layerMissing) return;
  let st = useSocial.getState();
  if (!st.available || st.ban) return;
  if (!st.profile) {
    await ensureProfile(r);
    st = useSocial.getState();
    if (stale() || !st.profile) return;
  }
  await syncIdentity(r);
  if (stale()) return;
  await syncAvatar(r);
  if (stale()) return;
  await handleDataReset(r);
  if (stale() || r.resetBlocked || r.layerMissing) return;

  // Los datos de esta pasada se leen una sola vez (todas las cifras salen de la misma foto)...
  const data = useStore.getState();
  const resetAt = data.settings.dataResetAt;
  // Con datos de demostración no se publica nada (el perfil y los logros muestran las cifras del dispositivo)
  if (isDemoActive(data)) return;
  // ...y justo antes de cada escritura se comprueba que siguen valiendo: misma sesión, sin demostración cargada y sin un
  // cambio completo de datos durante la espera (la siguiente pasada lo atiende y publica los datos nuevos)
  const blocked = () => {
    if (stale() || r.resetBlocked) return true;
    const now = useStore.getState();
    return isDemoActive(now) || now.settings.dataResetAt !== resetAt;
  };

  st = useSocial.getState();
  if (!st.profile || st.ban) return;
  const today = todayKey();
  let baselineAt = st.baselineAt;
  if (!baselineAt) {
    // Sin hábitos ni registros no se reclama (se fijarían ceros para siempre): se reclamará cuando los haya
    if (!hasDeviceData(data) || blocked()) return;
    await api.claimBaseline(baselineFrom(data, today));
    await refreshSocialStatus();
    if (stale()) return;
    baselineAt = useSocial.getState().baselineAt;
    if (!baselineAt) return;
  }

  // Ayer y hoy (el servidor aplica los topes)
  const rows = publishableDays(data, today);
  const sig = JSON.stringify(rows);
  if (sig !== r.lastDays) {
    if (blocked()) return;
    const res = await api.publishDays(rows);
    if (stale()) return;
    r.lastDays = sig;
    useSocial.getState().set({ serverBalance: Number(res.balance) });
  }

  // Gastos y extras del dispositivo
  const sent = new Set((await deviceGet<string[]>(kv(r.uid, 'sent'))) ?? []);
  if (stale()) return;
  const { spends, bonuses } = walletMoves(data, baselineAt, sent);
  if (spends.length || bonuses.length) {
    if (blocked()) return;
    const res = await api.syncWallet(spends, bonuses);
    for (const m of [...spends, ...bonuses]) sent.add(m.id);
    await deviceSet(kv(r.uid, 'sent'), [...sent].slice(-3000));
    if (stale()) return;
    useSocial.getState().set({ serverBalance: Number(res.balance) });
  }

  // Premios, compras y ajustes que nacieron en el servidor (se reflejan en los datos del dispositivo)
  let cursor = (await deviceGet<number>(kv(r.uid, 'ledger'))) ?? 0;
  if (stale()) return;
  const entries = await api.myLedger(cursor);
  if (blocked()) return;
  if (entries.length) {
    useStore.getState().mergeServerLedger(entries);
    cursor = Math.max(cursor, ...entries.map((e) => Number(e.id)));
    await deviceSet(kv(r.uid, 'ledger'), cursor);
    if (stale()) return;
  }

  // Hábitos visibles
  const habitRows = publicHabitRows(data, today, r.uid);
  const habitSig = JSON.stringify(habitRows);
  if (habitSig !== r.lastHabits) {
    r.habitKeys ??= new Set(await api.myPublicHabitKeys(r.uid));
    if (blocked()) return;
    const keep = new Set(habitRows.map((h) => h.habit_key));
    const gone = [...r.habitKeys].filter((k) => !keep.has(k));
    await api.deletePublicHabits(r.uid, gone);
    if (stale()) return;
    // Lo borrado ya no está, aunque se corte aquí: la siguiente pasada sube el resto
    r.habitKeys = new Set([...r.habitKeys].filter((k) => keep.has(k)));
    if (blocked()) return;
    await api.upsertPublicHabits(habitRows);
    if (stale()) return;
    r.habitKeys = keep;
    r.lastHabits = habitSig;
  }
  if (running === r) useSocial.getState().set({ lastPublishedAt: Date.now() });
}

/**
 * Publica ya (y crea el perfil si aún no existe). Si hay una publicación en curso, se espera a esa y se repite al
 * terminar (pudo empezar antes de los últimos cambios). Los errores de red se reintentan en el siguiente ciclo
 */
export function publishNow(): Promise<void> {
  const r = running;
  if (!r) return Promise.resolve();
  if (r.publishing) {
    r.again = true;
    return r.publishing;
  }
  r.again = false;
  r.publishing = doPublish(r)
    .catch((err) => {
      if (running !== r) return;
      if (err instanceof api.SocialError && err.banned) void refreshSocialStatus();
      else console.warn('[Social] No se pudo publicar:', (err as Error).message);
    })
    .finally(() => {
      r.publishing = null;
      if (r.again && running === r) schedulePublish(r);
    });
  return r.publishing;
}

function schedulePublish(r: Running) {
  if (r.timer) clearTimeout(r.timer);
  r.timer = setTimeout(() => {
    r.timer = null;
    void publishNow();
  }, PUBLISH_DEBOUNCE_MS);
}

/* ---------------- Tiempo real ---------------- */

function ensureRealtime(r: Running) {
  if (r.unsubscribeRealtime) return;
  try {
    r.unsubscribeRealtime = api.subscribeNotifications(r.uid, (n) => {
      if (running !== r) return;
      useSocial.getState().set({ unread: useSocial.getState().unread + 1 });
      // Premios y compras: se reflejan en el saldo del dispositivo
      if (['achievement', 'league_result', 'admin_coins', 'podium'].includes(n.kind)) schedulePublish(r);
      if (n.kind === 'ban' || n.kind === 'warning') void refreshSocialStatus();
      listeners.forEach((fn) => fn(n));
    });
  } catch (err) {
    console.warn('[Social] Sin avisos en tiempo real:', err);
  }
}

/* ---------------- Arranque y parada ---------------- */

export function startSocial(user: SessionUser) {
  if (!isSupabaseConfigured || running?.uid === user.id) return;
  stopSocial();
  const r: Running = {
    uid: user.id,
    timer: null,
    lastDays: '',
    lastHabits: '',
    habitKeys: null,
    unsubscribeRealtime: null,
    publishing: null,
    again: false,
    statusLoaded: false,
    createFailedAt: 0,
    newcomer: useSession.getState().firstRun,
    identityFailed: '',
    avatarFailed: null,
    resetBlocked: false,
    layerMissing: false,
    stop: () => undefined,
  };
  running = r;
  useSocial.getState().set({ ...initialSocial, phase: 'loading' });

  // Lo recordado en el dispositivo primero (funciona sin conexión)
  void (async () => {
    const [admin, economy] = await Promise.all([
      deviceGet<boolean>(kv(r.uid, 'admin')),
      deviceGet<{ from: string; params: Record<string, unknown> }[]>(kv(r.uid, 'economy')),
    ]);
    if (running !== r) return;
    if (admin) useSocial.getState().set({ isAdmin: true });
    if (economy?.length) applyEconomyVersions(economy, todayKey());
    await Promise.all([refreshSocialStatus(), loadEconomy(r.uid)]);
    if (running !== r) return;
    // Con perfil, el catálogo primero (para dibujar lo equipado); sin perfil, publishNow lo crea y carga el catálogo
    if (useSocial.getState().profile) await loadCatalog();
    await publishNow();
  })();

  // Cambios en los datos que influyen en lo publicado o en el perfil
  const unsubscribeStore = useStore.subscribe((s, prev) => {
    const a = s.settings;
    const b = prev.settings;
    if (
      s.logs !== prev.logs || s.habits !== prev.habits || s.redemptions !== prev.redemptions || s.pointEvents !== prev.pointEvents ||
      s.xpBoosts !== prev.xpBoosts || s.streakFreezes !== prev.streakFreezes ||
      (a !== b &&
        (a.userName !== b.userName || a.avatarPreset !== b.avatarPreset || a.avatarDataUrl !== b.avatarDataUrl || a.pendingAlias !== b.pendingAlias ||
          a.demoMode !== b.demoMode || a.dataResetAt !== b.dataResetAt))
    ) {
      schedulePublish(r);
    }
  });
  const unsubscribeSession = useSession.subscribe((s, prev) => {
    // Al terminar la bienvenida ya hay nombre, alias y foto: se crea el perfil
    if (prev.firstRun && !s.firstRun) schedulePublish(r);
    // Terminó la primera sincronización de la sesión: ya se puede publicar con los datos al día
    if (prev.lastSyncedAt === undefined && s.lastSyncedAt !== undefined) schedulePublish(r);
  });
  const interval = setInterval(() => {
    void refreshSocialStatus().then(() => publishNow());
  }, REFRESH_INTERVAL_MS);
  const onOnline = () => schedulePublish(r);
  const onVisible = () => {
    if (document.visibilityState === 'visible') schedulePublish(r);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);

  r.stop = () => {
    unsubscribeStore();
    unsubscribeSession();
    clearInterval(interval);
    if (r.timer) clearTimeout(r.timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    r.unsubscribeRealtime?.();
  };
}

export function stopSocial() {
  running?.stop();
  running = null;
  useSocial.getState().set({ ...initialSocial });
}

/** Arranca y para la capa pública con la sesión (se monta una vez, en el Shell) */
export function useSocialRuntime() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    startSocial(user);
    return () => stopSocial();
  }, [status, user]);
}

/** Id de la persona con sesión (para las llamadas que lo necesitan) */
export const myUserId = () => useSession.getState().user?.id ?? null;
