import type { Habit, HabitKind, HabitLog, LogStatus } from '@/types';

/**
 * REGLAS DE XP Y MONEDAS (funciones puras, sin estado)
 * Fuente: documento «Reglas de XP y monedas – App de hábitos» (claude.ai/artifact/VbBsiP8dHq4rGL3arvqhph).
 * - Monedas: se ganan con los hábitos y se gastan en la tienda.
 * - XP: la calcula la app, nunca se gasta; mide el progreso (nivel) y, más adelante, el ranking.
 * Todos los valores viven en ECONOMY_DEFAULTS. El panel del creador publica versiones con fecha (tabla `economy_config`):
 * cada día se calcula con la versión que regía ese día, así cambiar un valor nunca reescribe el pasado.
 */
export const ECONOMY_DEFAULTS = {
  /* Monedas */
  coinDailyCap: 200,
  /** Valor máximo del chip por tipo (los de tiempo los calcula la app) */
  chipMax: { action: 30, quantity: 40 } as Record<Exclude<HabitKind, 'time'>, number>,
  timeCoinsMin: 10,
  timeCoinsMax: 50,
  /* XP */
  actionXp: 24,
  timeXpPerMinute: 1.5,
  timeXpMax: 90,
  /** Minutos mínimos de un hábito de tiempo para que dé XP */
  timeXpMinMinutes: 5,
  quantityXpMax: 45,
  /** Solo los primeros N hábitos del día suman XP */
  xpHabitsPerDay: 8,
  xpBaseDailyCap: 800,
  streakBonusPerDay: 0.01,
  streakBonusMaxDays: 30,
  perfectDayBonus: 30,
  perfectDayMinHabits: 2,
  /** Tope de una sesión de tiempo (min) */
  maxSessionMinutes: 180,
  /* Protector de racha (precio dinámico) */
  freezePriceFactor: 2,
  freezePriceMin: 100,
  freezePriceMax: 600,
  freezeMaxPerMonth: 7,
  /* Multiplicador de XP */
  boostMultiplier: 1.5,
  boostHours: 12,
  /** Espera desde la activación del anterior */
  boostCooldownHours: 24,
  boostMaxPerMonth: 4,
  boostPriceFactor: 2,
  boostPriceMin: 100,
  boostPriceMax: 600,
  /* Ritmo del usuario */
  rhythmDays: 14,
  rhythmMinActiveDays: 3,
};

export type EconomyParams = typeof ECONOMY_DEFAULTS;

/** Parámetros vigentes hoy (precios, límites de compra). Se actualiza en su sitio al llegar una versión nueva */
export const ECONOMY: EconomyParams = structuredClone(ECONOMY_DEFAULTS);

interface EconomyVersion {
  from: string;
  params: EconomyParams;
}
let versions: EconomyVersion[] = [];
/** Cambia con cada versión aplicada (invalida las cachés que dependen de los parámetros) */
export let economyRevision = 0;

/** Solo números finitos dentro de un rango razonable; lo demás se ignora (un borrador mal escrito no rompe la app) */
export function parseEconomyParams(raw: Record<string, unknown>): EconomyParams {
  const out = structuredClone(ECONOMY_DEFAULTS);
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!(k in out)) continue;
    const key = k as keyof EconomyParams;
    if (key === 'chipMax') {
      if (v && typeof v === 'object') {
        for (const kind of ['action', 'quantity'] as const) {
          const n = (v as Record<string, unknown>)[kind];
          if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1000) out.chipMax[kind] = n;
        }
      }
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000) (out[key] as number) = v;
  }
  return out;
}

/** Parámetros que regían un día */
export function paramsFor(date: string): EconomyParams {
  let p: EconomyParams = ECONOMY_DEFAULTS;
  for (const v of versions) {
    if (v.from <= date) p = v.params;
    else break;
  }
  return p;
}

/** Versiones publicadas por el creador (`from`: día local desde el que rige). Sin versiones rigen los valores por defecto */
export function applyEconomyVersions(list: { from: string; params: Record<string, unknown> }[], today: string) {
  versions = list
    .map((v) => ({ from: v.from, params: parseEconomyParams(v.params) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  Object.assign(ECONOMY, structuredClone(paramsFor(today)));
  economyRevision++;
}

/** Chips que se pueden elegir según el tipo de hábito (los de tiempo no tienen chip) */
export const COIN_CHIPS: Record<Exclude<HabitKind, 'time'>, number[]> = {
  action: [10, 20, 30],
  quantity: [10, 20, 30, 40],
};

/** Criterio de esfuerzo de cada chip, para que nadie elija el más alto por costumbre */
export const CHIP_HINTS: Record<number, string> = {
  10: 'Menos de 10 min o muy fácil',
  20: 'Unos 15 a 20 min',
  30: 'Unos 30 min',
  40: 'Cerca de 1 hora',
};

export const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const habitKind = (h: Pick<Habit, 'kind'>): HabitKind => h.kind ?? 'action';

/** Monedas de un hábito de tiempo con meta de T minutos: min(50, max(10, 5 + T/2)) */
export const timeHabitCoins = (targetMinutes: number) =>
  round1(clamp(5 + targetMinutes / 2, ECONOMY.timeCoinsMin, ECONOMY.timeCoinsMax));

/** Monedas por cumplir el hábito completo (el «valor» que se muestra en su tarjeta) */
export function habitCoinValue(h: Pick<Habit, 'kind' | 'points' | 'targetMinutes'>): number {
  const kind = habitKind(h);
  if (kind === 'time') return timeHabitCoins(h.targetMinutes || 25);
  return Math.min(h.points || 10, ECONOMY.chipMax[kind]);
}

type Progress = Pick<HabitLog, 'minutes' | 'quantity'> | undefined;
type HabitForRules = Pick<Habit, 'kind' | 'points' | 'targetMinutes' | 'minimumMinutes' | 'targetQuantity' | 'minimumQuantity'>;

/**
 * Fracción de la meta cumplida (0-1). Si el registro no trae minutos o cantidad (marcado a mano),
 * «completo» cuenta como la meta entera y «mínimo» como la versión mínima.
 */
export function progressRatio(h: HabitForRules, status: LogStatus, progress: Progress, minimumRatio: number, p: EconomyParams = ECONOMY): number {
  if (status !== 'full' && status !== 'minimum') return 0;
  const kind = habitKind(h);
  if (kind === 'time') {
    const T = h.targetMinutes || 25;
    const fallback = status === 'full' ? T : h.minimumMinutes || T * minimumRatio;
    const t = Math.min(progress?.minutes ?? fallback, p.maxSessionMinutes);
    return Math.min(t / T, 1);
  }
  if (kind === 'quantity') {
    const Q = h.targetQuantity || 1;
    const fallback = status === 'full' ? Q : h.minimumQuantity || Q * minimumRatio;
    const q = progress?.quantity ?? fallback;
    return Math.min(Math.max(q, 0) / Q, 1);
  }
  return status === 'full' ? 1 : minimumRatio;
}

/** Minutos efectivos de un registro de tiempo (para la XP) */
function effectiveMinutes(h: HabitForRules, status: LogStatus, progress: Progress, minimumRatio: number, p: EconomyParams) {
  const T = h.targetMinutes || 25;
  const fallback = status === 'full' ? T : status === 'minimum' ? h.minimumMinutes || T * minimumRatio : 0;
  return Math.min(progress?.minutes ?? fallback, p.maxSessionMinutes);
}

/** Monedas que da un registro: valor del hábito × parte cumplida (0 si es parcial o no hecho) */
export function logCoins(h: HabitForRules, status: LogStatus, progress: Progress, minimumRatio: number): number {
  if (status !== 'full' && status !== 'minimum') return 0;
  return round1(habitCoinValue(h) * progressRatio(h, status, progress, minimumRatio));
}

/**
 * XP base de un registro (antes de topes, racha y bono):
 * acción directa 24 · tiempo 1,5 por minuto (desde 5 min, máx. 90) · cantidad 45 × avance.
 */
export function logBaseXp(h: HabitForRules, status: LogStatus, progress: Progress, minimumRatio: number, p: EconomyParams = ECONOMY): number {
  if (status !== 'full' && status !== 'minimum') return 0;
  const kind = habitKind(h);
  if (kind === 'time') {
    const t = effectiveMinutes(h, status, progress, minimumRatio, p);
    return t < p.timeXpMinMinutes ? 0 : round1(Math.min(p.timeXpMax, p.timeXpPerMinute * t));
  }
  if (kind === 'quantity') return round1(p.quantityXpMax * progressRatio(h, status, progress, minimumRatio, p));
  return round1(status === 'full' ? p.actionXp : p.actionXp * minimumRatio);
}

export interface DayXpInput {
  /** XP base de cada hábito cumplido, en el orden en que se marcaron, y si se marcó con el multiplicador activo */
  entries: { xp: number; boosted: boolean }[];
  /** Días de racha contando este día */
  streak: number;
  /** Todos los hábitos programados cumplidos (y al menos 2) */
  perfect: boolean;
  /** Día salvado por el protector de racha: 0 XP */
  frozen?: boolean;
}

/**
 * XP del día: solo los primeros 8 hábitos, tope de 800 de base (1200 si hubo multiplicador),
 * × (1 + min(racha, 30)/100) + 30 si fue un día perfecto.
 */
export function dayXp({ entries, streak, perfect, frozen }: DayXpInput, p: EconomyParams = ECONOMY): number {
  if (frozen) return 0;
  const counted = entries.slice(0, p.xpHabitsPerDay);
  const anyBoost = counted.some((e) => e.boosted);
  const base = counted.reduce((sum, e) => sum + e.xp * (e.boosted ? p.boostMultiplier : 1), 0);
  const cap = p.xpBaseDailyCap * (anyBoost ? p.boostMultiplier : 1);
  const streakBonus = 1 + Math.min(Math.max(streak, 0), p.streakBonusMaxDays) * p.streakBonusPerDay;
  return round1(Math.min(base, cap) * streakBonus + (perfect ? p.perfectDayBonus : 0));
}

/** Tope de XP de un día (con o sin multiplicador): lo mismo que acepta el servidor */
export const dayXpCap = (boosted: boolean, p: EconomyParams = ECONOMY) =>
  round1(p.xpBaseDailyCap * (boosted ? p.boostMultiplier : 1) * (1 + p.streakBonusMaxDays * p.streakBonusPerDay) + p.perfectDayBonus);

/** Monedas del día con el tope diario */
export const dayCoins = (sumOfLogs: number, p: EconomyParams = ECONOMY) => round1(Math.min(sumOfLogs, p.coinDailyCap));

/* ---------------- Precios dinámicos y equivalencias ---------------- */

/** Protector de racha: unos 2 días de esfuerzo al ritmo del usuario, entre 100 y 600 */
export const freezePrice = (avgDailyCoins: number) =>
  Math.round(clamp(ECONOMY.freezePriceFactor * avgDailyCoins, ECONOMY.freezePriceMin, ECONOMY.freezePriceMax));

/** Multiplicador 1.5× de XP (12 h): mismo criterio de precio */
export const boostPrice = (avgDailyCoins: number) =>
  Math.round(clamp(ECONOMY.boostPriceFactor * avgDailyCoins, ECONOMY.boostPriceMin, ECONOMY.boostPriceMax));

export type RewardEquivalence =
  | { kind: 'no-history' }
  | { kind: 'ok' | 'too-easy' | 'too-far'; days: number };

/** «Este premio equivale a N días de tu ritmo actual» (N = P / ḡ), con avisos suaves */
export function rewardEquivalence(price: number, avgDailyCoins: number, activeDays: number): RewardEquivalence {
  if (activeDays < ECONOMY.rhythmMinActiveDays || avgDailyCoins <= 0) return { kind: 'no-history' };
  const days = round1(price / avgDailyCoins);
  return { kind: days < 1 ? 'too-easy' : days > 60 ? 'too-far' : 'ok', days };
}
