import type { AppData, DateKey, HabitLog, Settings, XpBoost } from '@/types';
import { addDaysKey, todayKey, toKey } from './dates';
import { doneCountByDate, getDayStreakStatus, isDoneLog } from './metrics';
import {
  ECONOMY, boostPrice, dayCoins, dayXp, economyRevision, freezePrice, logBaseXp, paramsFor, rewardEquivalence, round1,
  type RewardEquivalence,
} from './economyRules';

/**
 * ECONOMÍA SOBRE EL HISTORIAL
 * Saldo de monedas, XP total y por día, ritmo del usuario y estado de las compras fijas (protector y multiplicador).
 * Todo se deriva de los registros: desmarcar un hábito resta solo sus monedas y su XP.
 *
 * Las reglas nuevas (tope de 200 monedas al día, hábitos nuevos sin XP, marcar como mucho 1 día atrás) rigen desde
 * `settings.economyStartDate`: el historial anterior se conserva tal cual, así que el saldo de nadie cambia al actualizar.
 */

export type EconomyData = Pick<AppData, 'habits' | 'logs' | 'pointEvents' | 'redemptions' | 'streakFreezes'> & {
  xpBoosts?: XpBoost[];
  settings: Pick<Settings, 'minimumRatio' | 'economyStartDate'>;
};

export interface EconomyDay {
  coins: number;
  xp: number;
}

export interface EconomySummary {
  /** Monedas de los hábitos (con el tope diario desde que rige la economía nueva) */
  fromLogs: number;
  /** Monedas extra (retos, logros, recuperación…) */
  bonus: number;
  earned: number;
  spent: number;
  balance: number;
  /** XP de por vida (nunca se gasta) */
  xpTotal: number;
  days: Map<DateKey, EconomyDay>;
}

export const FREEZE_REWARD_ID = 'rw-streak-freeze';
export const BOOST_REWARD_ID = 'rw-xp-boost';

/** Días entre dos claves de fecha (b - a) */
const daysBetween = (a: DateKey, b: DateKey) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

/** ¿El registro se marcó más de 1 día después de su fecha? (solo se puede marcar hasta ayer) */
export const isBackdated = (date: DateKey, loggedAtIso: string | Date = new Date()) =>
  daysBetween(date, toKey(new Date(loggedAtIso))) > 1;

export const isBoostActiveAt = (boosts: XpBoost[] | undefined, at: string | number) => {
  const t = typeof at === 'number' ? at : Date.parse(at);
  return (boosts ?? []).some((b) => t >= Date.parse(b.startedAt) && t < Date.parse(b.endsAt));
};

/** Racha (días seguidos contando ese día) para cada fecha desde la primera actividad hasta `to` */
function streakSeries(data: EconomyData, to: DateKey, doneIdx: Map<DateKey, number>): Map<DateKey, number> {
  const out = new Map<DateKey, number>();
  let first: DateKey | null = null;
  for (const l of Object.values(data.logs)) if (!first || l.date < first) first = l.date;
  for (const h of data.habits) {
    const s = h.startDate || h.createdAt;
    if (!first || s < first) first = s;
  }
  if (!first) return out;
  let streak = 0;
  for (let d = first; d <= to; d = addDaysKey(d, 1)) {
    const st = getDayStreakStatus(data, d, doneIdx);
    if (st.hasStreak) streak++;
    else if (st.scheduledCount > 0) streak = 0;
    out.set(d, streak);
  }
  return out;
}

/* Caché: el store es inmutable, así que mientras no cambien estas referencias el resultado es el mismo */
let cacheKey: unknown[] = [];
let cacheValue: EconomySummary | null = null;

export function economySummary(data: EconomyData, ref: DateKey = todayKey()): EconomySummary {
  const key = [data.habits, data.logs, data.pointEvents, data.redemptions, data.streakFreezes, data.xpBoosts, data.settings.minimumRatio, data.settings.economyStartDate, ref, economyRevision];
  if (cacheValue && key.length === cacheKey.length && key.every((v, i) => v === cacheKey[i])) return cacheValue;

  // Sin fecha (cuenta nueva aún sin migrar) rigen las reglas nuevas, igual que al registrar en el store
  const start = data.settings.economyStartDate ?? '0000-01-01';
  const ratio = data.settings.minimumRatio;
  const habits = new Map(data.habits.map((h) => [h.id, h]));
  const byDate = new Map<DateKey, HabitLog[]>();
  let lastDate: DateKey = ref;
  for (const l of Object.values(data.logs)) {
    if (!isDoneLog(l)) continue;
    (byDate.get(l.date) ?? byDate.set(l.date, []).get(l.date)!).push(l);
    if (l.date > lastDate) lastDate = l.date;
  }
  const doneIdx = doneCountByDate(data.logs);
  const streaks = streakSeries(data, lastDate, doneIdx);
  const frozen = new Set(data.streakFreezes ?? []);

  const days = new Map<DateKey, EconomyDay>();
  let fromLogs = 0;
  let xpTotal = 0;
  for (const [date, logs] of byDate) {
    const newRules = date >= start;
    // Cada día con los parámetros que regían ese día (el creador puede cambiarlos con fecha)
    const p = paramsFor(date);
    logs.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
    const sumCoins = logs.reduce((s, l) => s + (l.points || 0), 0);
    const coins = newRules ? dayCoins(sumCoins, p) : sumCoins;

    const entries = logs.map((l) => {
      const h = habits.get(l.habitId);
      // Reglas anti-trampa (desde que rige la economía nueva): un hábito no da XP el día que se crea,
      // ni un registro marcado más de 1 día tarde
      const blocked = newRules && ((h && h.createdAt === date) || isBackdated(date, l.loggedAt));
      // Hábito ya eliminado: se conserva la XP que dio (como acción directa)
      const xp = blocked ? 0 : h ? logBaseXp(h, l.status, l, ratio, p) : logBaseXp({ kind: 'action', points: l.points }, l.status, l, ratio, p);
      return { xp, boosted: isBoostActiveAt(data.xpBoosts, l.loggedAt) };
    });
    const status = getDayStreakStatus(data, date, doneIdx);
    const xp = dayXp(
      {
        entries,
        streak: streaks.get(date) ?? 0,
        perfect: status.isSuperStreak && status.scheduledCount >= p.perfectDayMinHabits,
        frozen: frozen.has(date),
      },
      p,
    );
    days.set(date, { coins, xp });
    fromLogs += coins;
    xpTotal += xp;
  }

  const bonus = (data.pointEvents ?? []).reduce((a, e) => a + e.amount, 0);
  const spent = (data.redemptions ?? []).reduce((a, r) => a + r.cost, 0);
  const earned = round1(fromLogs + bonus);
  const value: EconomySummary = {
    fromLogs: round1(fromLogs),
    bonus,
    earned,
    spent,
    balance: Math.max(0, round1(earned - spent)),
    xpTotal: round1(xpTotal),
    days,
  };
  cacheKey = key;
  cacheValue = value;
  return value;
}

/** Ritmo: promedio de monedas diarias de los 14 días anteriores a hoy y cuántos tuvieron actividad */
export function coinRhythm(data: EconomyData, ref: DateKey = todayKey()) {
  const { days } = economySummary(data, ref);
  let sum = 0;
  let active = 0;
  for (let i = 1; i <= ECONOMY.rhythmDays; i++) {
    const c = days.get(addDaysKey(ref, -i))?.coins ?? 0;
    sum += c;
    if (c > 0) active++;
  }
  return { avg: round1(sum / ECONOMY.rhythmDays), activeDays: active };
}

const sameMonth = (iso: string, now: Date) => {
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
};

export interface FreezeOffer {
  price: number;
  /** Compras de este mes / máximo */
  boughtThisMonth: number;
  maxPerMonth: number;
  /** Motivo por el que no se puede comprar ahora (null = se puede, si hay saldo) */
  blocked: 'owned' | 'month-limit' | null;
}

export function freezeOffer(data: EconomyData & Pick<AppData, 'hasStreakFreeze'>, now = new Date()): FreezeOffer {
  const boughtThisMonth = (data.redemptions ?? []).filter((r) => r.rewardId === FREEZE_REWARD_ID && sameMonth(r.date, now)).length;
  return {
    price: freezePrice(coinRhythm(data, toKey(now)).avg),
    boughtThisMonth,
    maxPerMonth: ECONOMY.freezeMaxPerMonth,
    blocked: data.hasStreakFreeze ? 'owned' : boughtThisMonth >= ECONOMY.freezeMaxPerMonth ? 'month-limit' : null,
  };
}

export interface BoostOffer {
  price: number;
  /** Multiplicador en curso (si lo hay) */
  active: XpBoost | null;
  /** ms epoch desde el que se puede volver a comprar (espera de 24 h desde la última activación) */
  availableAt: number | null;
  boughtThisMonth: number;
  maxPerMonth: number;
  blocked: 'active' | 'cooldown' | 'month-limit' | null;
}

export function boostOffer(data: EconomyData, now = Date.now()): BoostOffer {
  const boosts = [...(data.xpBoosts ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const active = boosts.find((b) => now >= Date.parse(b.startedAt) && now < Date.parse(b.endsAt)) ?? null;
  const last = boosts[boosts.length - 1];
  const availableAt = last ? Date.parse(last.startedAt) + ECONOMY.boostCooldownHours * 3_600_000 : null;
  const nowDate = new Date(now);
  const boughtThisMonth = boosts.filter((b) => sameMonth(b.startedAt, nowDate)).length;
  const blocked = active
    ? 'active'
    : availableAt && now < availableAt
      ? 'cooldown'
      : boughtThisMonth >= ECONOMY.boostMaxPerMonth
        ? 'month-limit'
        : null;
  return {
    price: boostPrice(coinRhythm(data, toKey(nowDate)).avg),
    active,
    availableAt: blocked === 'cooldown' ? availableAt : null,
    boughtThisMonth,
    maxPerMonth: ECONOMY.boostMaxPerMonth,
    blocked,
  };
}

/** Equivalencia en días de un premio propio según el ritmo actual */
export function rewardDays(data: EconomyData, price: number, ref: DateKey = todayKey()): RewardEquivalence {
  const { avg, activeDays } = coinRhythm(data, ref);
  return rewardEquivalence(price, avg, activeDays);
}
