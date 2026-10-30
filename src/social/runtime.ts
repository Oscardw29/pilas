import { useEffect } from 'react';
import { deviceGet, deviceSet } from '@/db/localDb';
import { todayKey } from '@/lib/dates';
import { applyEconomyVersions } from '@/lib/economyRules';
import { useStore } from '@/store/useStore';
import { useSession, type SessionUser } from '@/store/useSession';
import { isSupabaseConfigured } from '@/sync/supabase';
import * as api from './api';
import { baselineFrom, publicHabitRows, publishableDays, walletMoves } from './publish';
import { initialSocial, useSocial } from './useSocial';
import type { NotificationRow } from './types';

/**
 * CICLO DE LA CAPA PÚBLICA EN ESTE DISPOSITIVO
 * Con sesión: pide el estado (rol, veto, perfil), aplica la economía vigente y, si hay perfil público, publica
 * ayer y hoy cuando cambian los datos (con espera), sincroniza el saldo y escucha las notificaciones en tiempo real.
 * Sin perfil público no se envía nada: publicar es una decisión explícita de la persona.
 */

const PUBLISH_DEBOUNCE_MS = 4_000;
const REFRESH_INTERVAL_MS = 5 * 60_000;

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

/** ¿El servidor aún no tiene la migración 0002? (la función no existe) */
const isMissingServerLayer = (err: unknown) => /Could not find the function|schema cache|does not exist/i.test(String((err as Error)?.message ?? err));

/* ---------------- Estado ---------------- */

export async function refreshSocialStatus(): Promise<void> {
  const r = running;
  if (!r) return;
  try {
    const s = await api.getStatus();
    if (running !== r || !s) return;
    useSocial.getState().set({
      phase: 'ready',
      available: true,
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

/* ---------------- Publicar ---------------- */

async function doPublish(r: Running): Promise<void> {
  // Si la sesión cambió (cerrar sesión, otra cuenta) se deja de tocar el store y el estado: serían de otra persona
  const stale = () => running !== r;
  const st = useSocial.getState();
  if (stale() || !st.available || !st.profile || st.ban) return;
  const today = todayKey();
  let baselineAt = st.baselineAt;
  if (!baselineAt) {
    await api.claimBaseline(baselineFrom(useStore.getState(), today));
    await refreshSocialStatus();
    if (stale()) return;
    baselineAt = useSocial.getState().baselineAt;
    if (!baselineAt) return;
  }
  const data = useStore.getState();

  // Ayer y hoy (el servidor aplica los topes)
  const rows = publishableDays(data, today);
  const sig = JSON.stringify(rows);
  if (sig !== r.lastDays) {
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
    const res = await api.syncWallet(spends, bonuses);
    for (const m of [...spends, ...bonuses]) sent.add(m.id);
    await deviceSet(kv(r.uid, 'sent'), [...sent].slice(-3000));
    if (stale()) return;
    useSocial.getState().set({ serverBalance: Number(res.balance) });
  }

  // Premios, compras y ajustes que nacieron en el servidor
  let cursor = (await deviceGet<number>(kv(r.uid, 'ledger'))) ?? 0;
  if (stale()) return;
  const entries = await api.myLedger(cursor);
  if (stale()) return;
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
    if (stale()) return;
    const keep = new Set(habitRows.map((h) => h.habit_key));
    const gone = [...r.habitKeys].filter((k) => !keep.has(k));
    await api.deletePublicHabits(r.uid, gone);
    await api.upsertPublicHabits(habitRows);
    r.habitKeys = keep;
    r.lastHabits = habitSig;
  }
  if (running === r) useSocial.getState().set({ lastPublishedAt: Date.now() });
}

/**
 * Publica ya. Si hay una publicación en curso, se espera a esa y se repite al terminar (pudo empezar antes de los
 * últimos cambios). Los errores de red se reintentan en el siguiente ciclo
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
    if (useSocial.getState().profile) {
      await loadCatalog();
      await publishNow();
    } else {
      void loadCatalog();
    }
  })();

  // Cambios en los datos que influyen en lo publicado
  const unsubscribeStore = useStore.subscribe((s, prev) => {
    if (
      s.logs !== prev.logs || s.habits !== prev.habits || s.redemptions !== prev.redemptions || s.pointEvents !== prev.pointEvents ||
      s.xpBoosts !== prev.xpBoosts || s.streakFreezes !== prev.streakFreezes
    ) {
      schedulePublish(r);
    }
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
