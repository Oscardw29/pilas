import type { Habit, HabitLog } from '@/types';
import { dayCoins, dayXp, dayXpCap, logBaseXp, progressRatio, toInt, type EconomyParams } from '@/lib/economyRules';

/**
 * SIMULACIÓN DE LA ECONOMÍA (panel del creador, funciones puras)
 * Recalcula los ejemplos del documento de reglas (los mismos de tests/economy.test.ts) con unos parámetros dados,
 * para comparar la versión vigente con el borrador antes de publicarlo.
 * Las monedas y los precios se calculan aquí con `p` explícito: las funciones de la app usan los parámetros vigentes.
 * Monedas y XP en enteros, con el mismo redondeo que la app (economyRules).
 */

const RATIO = 0.4;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const action = (points: number, id = `a${points}`): Habit => ({ id, kind: 'action', points }) as Habit;
const time = (targetMinutes: number): Habit => ({ id: `t${targetMinutes}`, kind: 'time', points: 0, targetMinutes }) as Habit;
const qty = (points: number, targetQuantity: number): Habit => ({ id: `q${points}`, kind: 'quantity', points, targetQuantity }) as Habit;

interface Item {
  h: Habit;
  status?: HabitLog['status'];
  minutes?: number;
  quantity?: number;
}

export interface SimExample {
  id: string;
  label: string;
  detail: string;
  items: Item[];
  streak: number;
  perfect: boolean;
  boosted?: boolean;
}

export const SIM_EXAMPLES: SimExample[] = [
  {
    id: 'casual',
    label: 'Ej. 1 · Casual',
    detail: '3 hábitos, racha de 3, día perfecto',
    items: [{ h: action(10) }, { h: time(10), minutes: 10 }, { h: qty(20, 8), quantity: 8 }],
    streak: 3,
    perfect: true,
  },
  {
    id: 'steady',
    label: 'Ej. 2 · Constante',
    detail: '5 hábitos, racha de 15, día perfecto',
    items: [{ h: time(60), minutes: 60 }, { h: time(45), minutes: 45 }, { h: qty(30, 10), quantity: 10 }, { h: action(10) }, { h: action(10, 'a10b') }],
    streak: 15,
    perfect: true,
  },
  {
    id: 'weak',
    label: 'Ej. 3 · Día flojo',
    detail: 'Versiones mínimas, racha de 15',
    items: [{ h: time(60), status: 'minimum', minutes: 30 }, { h: qty(30, 10), status: 'minimum', quantity: 5 }, { h: action(10) }, { h: action(10, 'x') }],
    streak: 15,
    perfect: false,
  },
  {
    id: 'abuse',
    label: 'Ej. 4 · Abuso',
    detail: '25 acciones a +30, sin racha',
    items: Array.from({ length: 25 }, (_, i) => ({ h: action(30, `abuse${i}`) })),
    streak: 0,
    perfect: false,
  },
  {
    id: 'steady-boost',
    label: 'Ej. 2 con multiplicador',
    detail: 'El constante con el multiplicador activo',
    items: [{ h: time(60), minutes: 60 }, { h: time(45), minutes: 45 }, { h: qty(30, 10), quantity: 10 }, { h: action(10) }, { h: action(10, 'a10b') }],
    streak: 15,
    perfect: true,
    boosted: true,
  },
];

/** Valor en monedas de un hábito completo con los parámetros `p` (como `habitCoinValue`) */
export function coinValueWith(h: Habit, p: EconomyParams): number {
  if (h.kind === 'time') return toInt(clamp(5 + (h.targetMinutes || 25) / 2, p.timeCoinsMin, p.timeCoinsMax));
  const kind = h.kind === 'quantity' ? 'quantity' : 'action';
  return toInt(Math.min(h.points || 10, p.chipMax[kind]));
}

/** Monedas de un registro con los parámetros `p` (como `logCoins`) */
export function logCoinsWith(i: Item, p: EconomyParams): number {
  const status = i.status ?? 'full';
  if (status !== 'full' && status !== 'minimum') return 0;
  return toInt(coinValueWith(i.h, p) * progressRatio(i.h, status, i, RATIO, p));
}

export function simulateExample(ex: SimExample, p: EconomyParams): { coins: number; xp: number } {
  const coins = ex.items.reduce((s, i) => s + logCoinsWith(i, p), 0);
  const entries = ex.items.map((i) => ({ xp: logBaseXp(i.h, i.status ?? 'full', i, RATIO, p), boosted: Boolean(ex.boosted) }));
  return { coins: dayCoins(coins, p), xp: dayXp({ entries, streak: ex.streak, perfect: ex.perfect }, p) };
}

export const priceWith = (kind: 'freeze' | 'boost', avgDailyCoins: number, p: EconomyParams) =>
  kind === 'freeze'
    ? toInt(clamp(p.freezePriceFactor * avgDailyCoins, p.freezePriceMin, p.freezePriceMax))
    : toInt(clamp(p.boostPriceFactor * avgDailyCoins, p.boostPriceMin, p.boostPriceMax));

/** Ritmos (monedas al día) con los que se muestran los precios dinámicos */
export const SIM_RHYTHMS = [20, 80, 250];

/** Tamaño de grupo con el que se explica el reparto de la liga si los parámetros no lo traen */
export const SIM_GROUP_SIZE = 30;

/** Parámetros de la simulación: los de la app y, si los hay, los del servidor (tamaño del grupo de liga) */
export type SimParams = EconomyParams & { leagueGroupSize?: number };

/**
 * Reparto de un grupo de liga lleno al cerrar la semana: suben los N primeros, los N siguientes se quedan y el resto baja.
 * Si suben + se quedan pasan del tamaño del grupo, nadie baja.
 */
export function leagueSplit(p: SimParams) {
  const size = Math.max(1, Math.round(p.leagueGroupSize ?? SIM_GROUP_SIZE));
  const up = Math.min(Math.max(0, p.leaguePromoteCount), size);
  const stay = Math.min(Math.max(0, p.leagueStayCount), size - up);
  return { size, up, stay, down: size - up - stay };
}

export interface SimRow {
  id: string;
  group: 'Ejemplos' | 'Topes' | 'Precios' | 'Ligas';
  label: string;
  detail?: string;
  unit: 'monedas' | 'XP' | 'personas';
  before: number;
  after: number;
}

/** Tabla antes / después: ejemplos del documento, topes diarios de XP, precios dinámicos y reparto de las ligas */
export function compareEconomies(before: SimParams, after: SimParams): SimRow[] {
  const rows: SimRow[] = [];
  for (const ex of SIM_EXAMPLES) {
    const a = simulateExample(ex, before);
    const b = simulateExample(ex, after);
    rows.push({ id: `${ex.id}-coins`, group: 'Ejemplos', label: ex.label, detail: ex.detail, unit: 'monedas', before: a.coins, after: b.coins });
    rows.push({ id: `${ex.id}-xp`, group: 'Ejemplos', label: ex.label, detail: ex.detail, unit: 'XP', before: a.xp, after: b.xp });
  }
  rows.push({ id: 'cap', group: 'Topes', label: 'XP máxima del día', unit: 'XP', before: dayXpCap(false, before), after: dayXpCap(false, after) });
  rows.push({ id: 'cap-boost', group: 'Topes', label: 'XP máxima con multiplicador', unit: 'XP', before: dayXpCap(true, before), after: dayXpCap(true, after) });
  for (const kind of ['freeze', 'boost'] as const) {
    for (const r of SIM_RHYTHMS) {
      rows.push({
        id: `${kind}-${r}`,
        group: 'Precios',
        label: kind === 'freeze' ? 'Protector de racha' : 'Multiplicador',
        detail: `Ritmo de ${r} monedas/día`,
        unit: 'monedas',
        before: priceWith(kind, r, before),
        after: priceWith(kind, r, after),
      });
    }
  }
  const lb = leagueSplit(before);
  const la = leagueSplit(after);
  const groupDetail = `Grupo lleno de ${lb.size === la.size ? la.size : `${lb.size} → ${la.size}`} personas`;
  rows.push({ id: 'league-up', group: 'Ligas', label: 'Suben de liga', detail: groupDetail, unit: 'personas', before: lb.up, after: la.up });
  rows.push({ id: 'league-stay', group: 'Ligas', label: 'Se quedan', detail: groupDetail, unit: 'personas', before: lb.stay, after: la.stay });
  rows.push({ id: 'league-down', group: 'Ligas', label: 'Bajan de liga', detail: groupDetail, unit: 'personas', before: lb.down, after: la.down });
  rows.push({
    id: 'league-solo',
    group: 'Ligas',
    label: 'Solo en el grupo',
    detail: 'Premio de participación; no sube ni baja',
    unit: 'monedas',
    before: toInt(before.leagueSoloPrize),
    after: toInt(after.leagueSoloPrize),
  });
  return rows;
}
