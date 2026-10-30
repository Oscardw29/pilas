import type { AppData, DateKey } from '@/types';
import { addDaysKey, startOfWeekKey, toKey } from '@/lib/dates';
import { economySummary, isBoostActiveAt } from '@/lib/economy';
import {
  calculateGlobalStreak, doneCountByDate, getDayStreakStatus, getLog, habitStart, isDoneLog, isScheduled, streakEndingAt,
} from '@/lib/metrics';
import type { DayRow } from './types';
import type { WalletMove } from './api';

/**
 * QUÉ SE PUBLICA (funciones puras sobre los datos del dispositivo)
 * Solo cifras: XP, monedas, % de cumplimiento, racha y, de los hábitos marcados como visibles, su cumplimiento por día.
 * El servidor vuelve a aplicar los topes: lo de aquí es lo que la app calcula, no lo que el servidor acepta sin más.
 */

type Data = Pick<
  AppData,
  'habits' | 'logs' | 'pointEvents' | 'redemptions' | 'streakFreezes' | 'xpBoosts' | 'settings' | 'hasStreakFreeze'
>;

/** Un día tal como se publica (hoy: la racha «viva», que sigue hasta ayer si hoy aún no se marcó nada) */
export function dayRow(data: Data, day: DateKey, today: DateKey): DayRow {
  const econ = economySummary(data, today).days.get(day);
  const doneIdx = doneCountByDate(data.logs);
  const st = getDayStreakStatus(data, day, doneIdx);
  const scheduled = data.habits.filter((h) => isScheduled(h, day));
  const doneScheduled = scheduled.filter((h) => isDoneLog(getLog(data, h.id, day))).length;
  const streak = day === today ? calculateGlobalStreak(data, today).streak : streakEndingAt(data, day, doneIdx);
  const boosted = Object.values(data.logs).some((l) => l.date === day && isDoneLog(l) && isBoostActiveAt(data.xpBoosts, l.loggedAt));
  return {
    day,
    // XP y monedas siempre enteros
    xp: Math.round(econ?.xp ?? 0),
    coins: Math.round(econ?.coins ?? 0),
    completion: scheduled.length ? Math.round((Math.min(1, doneScheduled / scheduled.length)) * 1000) / 1000 : null,
    done: Math.min(st.completedCount, 100),
    scheduled: Math.min(scheduled.length, 100),
    perfect: st.isSuperStreak,
    streak,
    boosted,
  };
}

/** Ayer y hoy: lo único que el servidor deja publicar */
export const publishableDays = (data: Data, today: DateKey): DayRow[] => [dayRow(data, addDaysKey(today, -1), today), dayRow(data, today, today)];

/** Récord de racha global hasta un día (incluido) */
export function bestStreakUntil(data: Data, to: DateKey): number {
  const doneIdx = doneCountByDate(data.logs);
  let first: DateKey | null = null;
  for (const l of Object.values(data.logs)) if (!first || l.date < first) first = l.date;
  for (const h of data.habits) {
    const s = habitStart(h);
    if (!first || s < first) first = s;
  }
  if (!first) return 0;
  let streak = 0;
  let best = 0;
  for (let d = first; d <= to; d = addDaysKey(d, 1)) {
    const st = getDayStreakStatus(data, d, doneIdx);
    if (st.hasStreak) streak++;
    else if (st.scheduledCount > 0) streak = 0;
    if (streak > best) best = streak;
  }
  return best;
}

/** Lo que nació en el servidor (premios de liga y logros, compras de la tienda, ajustes del creador) */
const fromServer = (id: string) => id.startsWith('srv-');

/**
 * ¿El dispositivo tiene datos propios (hábitos o registros)? Sin ellos no se reclama el punto de partida: un dispositivo
 * vacío (cuenta nueva, recién empezado de cero) fijaría ceros para siempre. Se reclama cuando haya datos (así importar una
 * copia en una cuenta nueva aún usa el margen del primer reclamo).
 */
export const hasDeviceData = (data: Pick<AppData, 'habits' | 'logs'>) => data.habits.length > 0 || Object.keys(data.logs).length > 0;

/**
 * Punto de partida al crear el perfil (o al recalcularlo tras cambiar los datos por completo): el historial hasta
 * anteayer (ayer y hoy se publican como días normales). Las monedas son el saldo del dispositivo menos lo que se
 * publicará con ayer y hoy y sin lo que nació en el servidor (`srv-`): eso ya lo tiene el servidor en su historial y
 * contarlo aquí lo sumaría dos veces. Así el saldo del servidor coincide con el del dispositivo. Siempre enteros.
 */
export function baselineFrom(data: Data, today: DateKey) {
  const yesterday = addDaysKey(today, -1);
  const before = addDaysKey(today, -2);
  const econ = economySummary(data, today);
  const t = econ.days.get(today);
  const y = econ.days.get(yesterday);
  const streak = streakEndingAt(data, before);
  const bonus = data.pointEvents.reduce((a, p) => a + (fromServer(p.id) ? 0 : p.amount), 0);
  const spent = data.redemptions.reduce((a, r) => a + (fromServer(r.id) ? 0 : r.cost), 0);
  const ownBalance = econ.fromLogs + bonus - spent;
  return {
    streak,
    best: Math.max(streak, bestStreakUntil(data, before)),
    xp: Math.max(0, Math.round(econ.xpTotal - (t?.xp ?? 0) - (y?.xp ?? 0))),
    coins: Math.max(0, Math.round(ownBalance - (t?.coins ?? 0) - (y?.coins ?? 0))),
    done: Object.values(data.logs).filter((l) => isDoneLog(l) && l.date < yesterday).length,
  };
}

/** Días de cada hábito visible que se publican: las últimas 8 semanas (el perfil deja recorrerlas) */
export const PUBLIC_HABIT_DAYS = 56;

/** Hábitos marcados como visibles, con su cumplimiento de las últimas 8 semanas */
export function publicHabitRows(data: Pick<AppData, 'habits' | 'logs'>, today: DateKey, userId: string) {
  const visible = data.habits.filter((h) => h.publicVisible && h.status !== 'archived');
  return visible.map((h, i) => {
    const days: Record<string, { s: string; m?: number; q?: number }> = {};
    for (let k = 0; k < PUBLIC_HABIT_DAYS; k++) {
      const d = addDaysKey(today, -k);
      const l = getLog(data, h.id, d);
      if (l) {
        const e: { s: string; m?: number; q?: number } = { s: l.status };
        if (l.minutes) e.m = Math.round(l.minutes);
        // La cantidad es una medida (1,5 L, 2,5 km), no XP ni monedas: conserva un decimal
        if (l.quantity) e.q = Math.round(l.quantity * 10) / 10;
        days[d] = e;
      } else if (d < today && isScheduled(h, d)) {
        days[d] = { s: 'missed' };
      }
    }
    return {
      user_id: userId,
      habit_key: h.id.slice(0, 64),
      name: h.name.slice(0, 60),
      icon: (h.icon || '').slice(0, 16),
      kind: h.kind ?? 'action',
      unit: h.kind === 'quantity' ? (h.quantityUnit ?? null)?.slice(0, 16) ?? null : h.kind === 'time' ? 'min' : null,
      target: h.kind === 'time' ? (h.targetMinutes ?? null) : h.kind === 'quantity' ? (h.targetQuantity ?? null) : null,
      position: i,
      days,
    };
  });
}

/**
 * Movimientos del dispositivo que el servidor aún no conoce: gastos (premios propios, protector) y extras (retos,
 * revisiones…) desde que existe el perfil. Lo que nació en el servidor (`srv-`) no se reenvía.
 */
export function walletMoves(data: Pick<AppData, 'redemptions' | 'pointEvents'>, since: string, sent: Set<string>) {
  // Por instante y no por texto: el servidor puede devolver la fecha con otro huso («…-05:00» frente a «…Z»)
  const from = Date.parse(since);
  const after = (iso: string) => !(Date.parse(iso) < from);
  const spends: WalletMove[] = data.redemptions
    .filter((r) => !r.id.startsWith('srv-') && after(r.date) && r.cost > 0 && !sent.has(r.id))
    .map((r) => ({ id: r.id, amount: Math.round(r.cost), note: r.name.slice(0, 200), day: toKey(new Date(r.date)) }));
  const bonuses: WalletMove[] = data.pointEvents
    .filter((p) => !p.id.startsWith('srv-') && after(p.at) && p.amount > 0 && !sent.has(p.id))
    .map((p) => ({ id: p.id, amount: Math.round(p.amount), note: p.reason.slice(0, 200), day: toKey(new Date(p.at)) }));
  return { spends: spends.slice(0, 200), bonuses: bonuses.slice(0, 200) };
}

/**
 * CIFRAS LOCALES (modo demostración)
 * Con datos de demostración nada se publica: el perfil propio y los logros muestran lo que calcula el dispositivo,
 * con las mismas reglas que el servidor (racha vigente y récord, XP total, hábitos cumplidos, monedas gastadas,
 * semanas perfectas y la XP de cada día de una semana).
 */
export interface LocalPreviewStats {
  currentStreak: number;
  bestStreak: number;
  xpTotal: number;
  habitsDone: number;
  coinsSpent: number;
  perfectWeeks: number;
  /** Lunes de la semana pedida y la XP de cada día */
  weekStart: DateKey;
  week: { day: DateKey; xp: number; completion: number | null }[];
  /** Primer lunes con datos */
  firstWeek: DateKey;
}

export function localPreviewStats(data: Data, today: DateKey, weekOf: DateKey = today): LocalPreviewStats {
  const econ = economySummary(data, today);
  const doneIdx = doneCountByDate(data.logs);
  const currentStreak = calculateGlobalStreak(data, today).streak;
  const bestStreak = Math.max(currentStreak, bestStreakUntil(data, today));

  let first: DateKey = today;
  for (const l of Object.values(data.logs)) if (l.date < first) first = l.date;
  for (const h of data.habits) {
    const s = habitStart(h);
    if (s < first) first = s;
  }
  const firstWeek = startOfWeekKey(first);

  const completionOf = (day: DateKey) => {
    const scheduled = data.habits.filter((h) => isScheduled(h, day));
    if (!scheduled.length) return null;
    const done = scheduled.filter((h) => isDoneLog(getLog(data, h.id, day))).length;
    return Math.round(Math.min(1, done / scheduled.length) * 1000) / 1000;
  };

  // Semana perfecta (igual que el servidor): los 7 días con todo lo programado cumplido y algo programado
  let perfectWeeks = 0;
  const thisWeek = startOfWeekKey(today);
  for (let wk = firstWeek; wk < thisWeek; wk = addDaysKey(wk, 7)) {
    let scheduled = 0;
    let ok = true;
    for (let i = 0; i < 7 && ok; i++) {
      const st = getDayStreakStatus(data, addDaysKey(wk, i), doneIdx);
      scheduled += st.scheduledCount;
      if (st.scheduledCount > 0 && !st.isSuperStreak) ok = false;
    }
    if (ok && scheduled > 0) perfectWeeks++;
  }

  const weekStart = startOfWeekKey(weekOf);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysKey(weekStart, i);
    return { day, xp: day > today ? 0 : Math.round(econ.days.get(day)?.xp ?? 0), completion: day > today ? null : completionOf(day) };
  });

  return {
    currentStreak,
    bestStreak,
    xpTotal: Math.round(econ.xpTotal),
    habitsDone: Object.values(data.logs).filter((l) => isDoneLog(l) && l.date <= today).length,
    coinsSpent: Math.round(data.redemptions.reduce((s, r) => s + (r.cost > 0 ? r.cost : 0), 0)),
    perfectWeeks,
    weekStart,
    week,
    firstWeek,
  };
}
