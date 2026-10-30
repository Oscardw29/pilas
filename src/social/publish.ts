import type { AppData, DateKey } from '@/types';
import { addDaysKey, toKey } from '@/lib/dates';
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
    xp: econ?.xp ?? 0,
    coins: econ?.coins ?? 0,
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

/**
 * Punto de partida al crear el perfil: el historial hasta anteayer (ayer y hoy se publican como días normales).
 * Las monedas son el saldo actual menos lo que se publicará con ayer y hoy, así el saldo del servidor coincide.
 */
export function baselineFrom(data: Data, today: DateKey) {
  const yesterday = addDaysKey(today, -1);
  const before = addDaysKey(today, -2);
  const econ = economySummary(data, today);
  const t = econ.days.get(today);
  const y = econ.days.get(yesterday);
  const streak = streakEndingAt(data, before);
  return {
    streak,
    best: Math.max(streak, bestStreakUntil(data, before)),
    xp: Math.max(0, Math.round((econ.xpTotal - (t?.xp ?? 0) - (y?.xp ?? 0)) * 10) / 10),
    coins: Math.max(0, Math.round((econ.balance - (t?.coins ?? 0) - (y?.coins ?? 0)) * 10) / 10),
    done: Object.values(data.logs).filter((l) => isDoneLog(l) && l.date < yesterday).length,
  };
}

/** Hábitos marcados como visibles, con su cumplimiento de las últimas 5 semanas */
export function publicHabitRows(data: Pick<AppData, 'habits' | 'logs'>, today: DateKey, userId: string) {
  const visible = data.habits.filter((h) => h.publicVisible && h.status !== 'archived');
  return visible.map((h, i) => {
    const days: Record<string, { s: string; m?: number; q?: number }> = {};
    for (let k = 0; k < 35; k++) {
      const d = addDaysKey(today, -k);
      const l = getLog(data, h.id, d);
      if (l) {
        const e: { s: string; m?: number; q?: number } = { s: l.status };
        if (l.minutes) e.m = Math.round(l.minutes);
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
    .map((r) => ({ id: r.id, amount: r.cost, note: r.name.slice(0, 200), day: toKey(new Date(r.date)) }));
  const bonuses: WalletMove[] = data.pointEvents
    .filter((p) => !p.id.startsWith('srv-') && after(p.at) && p.amount > 0 && !sent.has(p.id))
    .map((p) => ({ id: p.id, amount: p.amount, note: p.reason.slice(0, 200), day: toKey(new Date(p.at)) }));
  return { spends: spends.slice(0, 200), bonuses: bonuses.slice(0, 200) };
}
