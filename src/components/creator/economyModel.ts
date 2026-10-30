import { ECONOMY_DEFAULTS, parseEconomyParams, type EconomyParams } from '@/lib/economyRules';
import { LEAGUES } from '@/social/texts';
import type { EconomyVersion } from '@/social/types';

/**
 * PARÁMETROS DE LA ECONOMÍA EN EL PANEL DEL CREADOR (funciones puras)
 * - Los de la app viven en ECONOMY_DEFAULTS (también el reparto de las ligas: cuántos suben, cuántos se quedan y el
 *   premio de quien está solo, para que la app pueda explicarlo). Los que solo usa el servidor (tope de bonos, tamaño
 *   del grupo y tabla de premios) no están ahí y `parseEconomyParams` los descarta, así que se validan y se unen aquí.
 * - El formulario trabaja con texto (una entrada por campo) y se convierte a parámetros al guardar.
 */

export type LeagueSlug = (typeof LEAGUES)[number]['slug'];
export const LEAGUE_SLUGS = LEAGUES.map((l) => l.slug) as LeagueSlug[];
/** Puestos con premio: 1.º, 2.º, 3.º y 4.º–10.º */
export const PRIZE_PLACES = ['1.º', '2.º', '3.º', '4.º–10.º'] as const;

export type PrizeTable = Record<LeagueSlug, number[]>;

/** Valores iniciales del servidor (los mismos que siembra 0002_social.sql) */
export const SERVER_ECONOMY_DEFAULTS = {
  bonusDailyCap: 500,
  leagueGroupSize: 30,
  leaguePrizes: {
    bronze: [150, 100, 70, 25],
    silver: [200, 135, 95, 35],
    gold: [260, 175, 120, 45],
    platinum: [330, 220, 155, 55],
    diamond: [400, 270, 190, 70],
  } as PrizeTable,
};

export type FullEconomyParams = EconomyParams & typeof SERVER_ECONOMY_DEFAULTS;

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/** Tabla de premios válida (lo que falte o no sea número se completa con los valores iniciales) */
export function parsePrizes(raw: unknown): PrizeTable {
  const out = structuredClone(SERVER_ECONOMY_DEFAULTS.leaguePrizes);
  if (!raw || typeof raw !== 'object') return out;
  for (const slug of LEAGUE_SLUGS) {
    const row = (raw as Record<string, unknown>)[slug];
    if (!Array.isArray(row)) continue;
    out[slug] = out[slug].map((d, i) => num(row[i], 0, 100000) ?? d);
  }
  return out;
}

/** Parámetros completos (app + servidor) a partir de lo guardado en `economy_config.params` */
export function mergeEconomyParams(raw: Record<string, unknown> | null | undefined): FullEconomyParams {
  const r = raw ?? {};
  const d = SERVER_ECONOMY_DEFAULTS;
  return {
    ...parseEconomyParams(r),
    bonusDailyCap: num(r.bonusDailyCap, 0, 1_000_000) ?? d.bonusDailyCap,
    leagueGroupSize: num(r.leagueGroupSize, 2, 1000) ?? d.leagueGroupSize,
    leaguePrizes: parsePrizes(r.leaguePrizes),
  };
}

/** Versión vigente: la última publicada cuya fecha ya llegó (mismo criterio que `economy_params()` del servidor) */
export function currentVersion(versions: EconomyVersion[], now = Date.now()): EconomyVersion | null {
  const live = versions
    .filter((v) => (v.status ?? 'published') === 'published' && v.effective_from && Date.parse(v.effective_from) <= now)
    .sort((a, b) => Date.parse(b.effective_from!) - Date.parse(a.effective_from!) || b.version - a.version);
  return live[0] ?? null;
}

/* ---------------- Formulario ---------------- */

export interface FieldDef {
  /** Ruta dentro de los parámetros: «coinDailyCap», «chipMax.action» */
  key: string;
  label: string;
  hint?: string;
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface FieldGroup {
  id: string;
  title: string;
  sub?: string;
  fields: FieldDef[];
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    id: 'coins',
    title: 'Monedas',
    sub: 'Las monedas son siempre enteras: los resultados se redondean al entero más cercano',
    fields: [
      { key: 'coinDailyCap', label: 'Tope diario de monedas', min: 0, integer: true },
      { key: 'chipMax.action', label: 'Chip máximo · acción', min: 1, max: 1000, integer: true },
      { key: 'chipMax.quantity', label: 'Chip máximo · cantidad', min: 1, max: 1000, integer: true },
      { key: 'timeCoinsMin', label: 'Monedas mínimas · tiempo', min: 0, integer: true },
      { key: 'timeCoinsMax', label: 'Monedas máximas · tiempo', min: 0, integer: true },
      { key: 'bonusDailyCap', label: 'Tope diario de bonos', hint: 'Solo en el servidor (logros, ánimos…)', min: 0, integer: true },
    ],
  },
  {
    id: 'xp',
    title: 'XP',
    sub: 'La XP también es entera: «XP por minuto» puede llevar decimales, pero cada registro se redondea',
    fields: [
      { key: 'actionXp', label: 'XP por acción', min: 0, integer: true },
      { key: 'timeXpPerMinute', label: 'XP por minuto', hint: '1,5 × 45 min = 67,5 → 68 XP', min: 0 },
      { key: 'timeXpMax', label: 'XP máxima · tiempo', min: 0, integer: true },
      { key: 'timeXpMinMinutes', label: 'Minutos mínimos para dar XP', min: 0 },
      { key: 'quantityXpMax', label: 'XP máxima · cantidad', min: 0, integer: true },
      { key: 'xpHabitsPerDay', label: 'Hábitos que suman XP al día', min: 1, integer: true },
      { key: 'xpBaseDailyCap', label: 'Tope diario de XP base', min: 0, integer: true },
    ],
  },
  {
    id: 'streak',
    title: 'Racha y bono',
    fields: [
      { key: 'streakBonusPerDay', label: 'Bono por día de racha', hint: '0.01 = +1 % por día', min: 0, max: 1 },
      { key: 'streakBonusMaxDays', label: 'Días máximos del bono', min: 0, integer: true },
      { key: 'perfectDayBonus', label: 'XP del día perfecto', min: 0, integer: true },
      { key: 'perfectDayMinHabits', label: 'Hábitos mínimos del día perfecto', min: 1, integer: true },
    ],
  },
  {
    id: 'freeze',
    title: 'Protector de racha',
    sub: 'Precio = factor × ritmo diario, entre el mínimo y el máximo',
    fields: [
      { key: 'freezePriceFactor', label: 'Factor de precio', min: 0 },
      { key: 'freezePriceMin', label: 'Precio mínimo', min: 0, integer: true },
      { key: 'freezePriceMax', label: 'Precio máximo', min: 0, integer: true },
      { key: 'freezeMaxPerMonth', label: 'Compras al mes', min: 0, integer: true },
    ],
  },
  {
    id: 'boost',
    title: 'Multiplicador de XP',
    fields: [
      { key: 'boostMultiplier', label: 'Multiplicador', min: 1, max: 10 },
      { key: 'boostHours', label: 'Duración (h)', min: 1 },
      { key: 'boostCooldownHours', label: 'Espera entre compras (h)', min: 0 },
      { key: 'boostMaxPerMonth', label: 'Compras al mes', min: 0, integer: true },
      { key: 'boostPriceFactor', label: 'Factor de precio', min: 0 },
      { key: 'boostPriceMin', label: 'Precio mínimo', min: 0, integer: true },
      { key: 'boostPriceMax', label: 'Precio máximo', min: 0, integer: true },
    ],
  },
  {
    id: 'rhythm',
    title: 'Ritmo',
    fields: [
      { key: 'rhythmDays', label: 'Días para el ritmo', min: 1, integer: true },
      { key: 'rhythmMinActiveDays', label: 'Días activos mínimos', min: 0, integer: true },
      { key: 'maxSessionMinutes', label: 'Tope de una sesión (min)', min: 1 },
    ],
  },
  {
    id: 'leagues',
    title: 'Ligas',
    sub:
      'Al cerrar la semana, en cada grupo suben de liga los primeros, los siguientes se quedan y el resto baja. ' +
      'Si alguien está solo en su grupo no sube ni baja: recibe el premio de participación. ' +
      'Los premios no cuentan para el tope diario de monedas.',
    fields: [
      { key: 'leaguePromoteCount', label: 'Suben de liga', hint: 'Los N primeros del grupo', min: 0, max: 1000, integer: true },
      { key: 'leagueStayCount', label: 'Se quedan', hint: 'Los N siguientes; el resto baja', min: 0, max: 1000, integer: true },
      { key: 'leagueSoloPrize', label: 'Premio si estás solo', hint: 'Monedas de participación (sin ascenso ni descenso)', min: 0, max: 100000, integer: true },
      { key: 'leagueGroupSize', label: 'Personas por grupo', min: 2, max: 1000, integer: true },
    ],
  },
];

export const prizeKey = (slug: LeagueSlug, i: number) => `leaguePrizes.${slug}.${i}`;

const getPath = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), o);

/** Texto de cada campo del formulario a partir de unos parámetros */
export function toFormText(p: FullEconomyParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of FIELD_GROUPS) for (const f of g.fields) out[f.key] = String(getPath(p, f.key) ?? '');
  for (const slug of LEAGUE_SLUGS) p.leaguePrizes[slug].forEach((v, i) => (out[prizeKey(slug, i)] = String(v)));
  return out;
}

const ALL_FIELDS: FieldDef[] = [
  ...FIELD_GROUPS.flatMap((g) => g.fields),
  ...LEAGUE_SLUGS.flatMap((slug) => PRIZE_PLACES.map((_, i) => ({ key: prizeKey(slug, i), label: 'Premio', min: 0, max: 100000, integer: true }))),
];

/**
 * Convierte el formulario en parámetros. `extra` son las claves que el formulario no conoce (se conservan tal cual).
 * Devuelve los errores por campo; con errores no se debe guardar.
 */
export function fromFormText(text: Record<string, string>, extra: Record<string, unknown> = {}): { params: Record<string, unknown>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const params: Record<string, unknown> = structuredClone(extra);
  for (const f of ALL_FIELDS) {
    const raw = (text[f.key] ?? '').trim().replace(',', '.');
    const v = raw === '' ? NaN : Number(raw);
    const lo = f.min ?? 0;
    const hi = f.max ?? 1_000_000;
    if (!Number.isFinite(v)) errors[f.key] = 'Escribe un número';
    else if (v < lo || v > hi) errors[f.key] = `Entre ${lo} y ${hi}`;
    else if (f.integer && !Number.isInteger(v)) errors[f.key] = 'Número entero';
    const value = Number.isFinite(v) ? v : raw;
    const [a, b, c] = f.key.split('.');
    const obj = (k: string) => ({ ...((params[k] as Record<string, unknown> | undefined) ?? {}) });
    if (b === undefined) params[a] = value;
    else if (c === undefined) params[a] = { ...obj(a), [b]: value };
    else {
      const table = obj(a);
      const row = [...((table[b] as unknown[] | undefined) ?? [])];
      row[Number(c)] = value;
      params[a] = { ...table, [b]: row };
    }
  }
  // Mínimos por debajo de los máximos
  const pairs: [string, string][] = [
    ['timeCoinsMin', 'timeCoinsMax'],
    ['freezePriceMin', 'freezePriceMax'],
    ['boostPriceMin', 'boostPriceMax'],
  ];
  for (const [lo, hi] of pairs) {
    // Se comparan los valores ya leídos (con «,» decimal incluida), no el texto
    if (!errors[lo] && !errors[hi] && (params[lo] as number) > (params[hi] as number)) errors[lo] = 'No puede ser mayor que el máximo';
  }
  return { params, errors };
}

/** Claves de unos parámetros que el formulario no edita (se conservan al guardar) */
export function extraKeys(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const known = new Set([...Object.keys(ECONOMY_DEFAULTS), ...Object.keys(SERVER_ECONOMY_DEFAULTS)]);
  return Object.fromEntries(Object.entries(raw ?? {}).filter(([k]) => !known.has(k)));
}
