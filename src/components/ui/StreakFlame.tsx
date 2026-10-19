import React, { useId } from 'react';

interface StreakFlameProps {
  days: number;
  size?: number;
  isSuperStreak?: boolean;
  isFrozen?: boolean;
  /** false: forma estática del nivel (útil en listas largas). Por defecto se anima. */
  animated?: boolean;
}

export type FlameTier =
  | 'dormant'
  | 'spark'
  | 'small'
  | 'lively'
  | 'intense'
  | 'searing'
  | 'blaze'
  | 'legendary'
  | 'mythic';

export interface FlameLevel {
  tier: FlameTier;
  /** Días de racha desde los que se alcanza el nivel */
  minDays: number;
  name: string;
}

/** Niveles de la llama. Los cortes coinciden con los hitos de la tarjeta de racha del tablero. */
export const FLAME_LEVELS: readonly FlameLevel[] = [
  { tier: 'dormant', minDays: 0, name: 'Brasa apagada' },
  { tier: 'spark', minDays: 1, name: 'Chispa' },
  { tier: 'small', minDays: 3, name: 'Llama pequeña' },
  { tier: 'lively', minDays: 7, name: 'Llama viva' },
  { tier: 'intense', minDays: 14, name: 'Fuego intenso' },
  { tier: 'searing', minDays: 30, name: 'Fuego abrasador' },
  { tier: 'blaze', minDays: 50, name: 'Llamarada' },
  { tier: 'legendary', minDays: 100, name: 'Fuego legendario' },
  { tier: 'mythic', minDays: 365, name: 'Fénix mítico' },
];

export function getFlameLevel(days: number): FlameLevel {
  for (let i = FLAME_LEVELS.length - 1; i > 0; i--) {
    if (days >= FLAME_LEVELS[i].minDays) return FLAME_LEVELS[i];
  }
  return FLAME_LEVELS[0];
}

export function getFlameTier(days: number): FlameTier {
  return getFlameLevel(days).tier;
}

/* ---------- Paletas ---------- */

interface Palette {
  /** Llama exterior: base y puntas */
  o1: string;
  o2: string;
  /** Llama interior: base y puntas */
  i1: string;
  i2: string;
  core: string;
  /** Halo, en «r, g, b» */
  glow: string;
  ember: string;
  /** Anillo, rayos y destellos */
  accent: string;
}

/** Racha normal: siempre en gama cálida (ámbar → naranja → rojo → oro al blanco vivo) */
const WARM: Record<FlameTier, Palette> = {
  dormant: { o1: '#52525b', o2: '#3f3f46', i1: '#71717a', i2: '#52525b', core: '#a1a1aa', glow: '113, 113, 122', ember: '#f97316', accent: '#71717a' },
  spark: { o1: '#fbbf24', o2: '#f59e0b', i1: '#fef3c7', i2: '#fcd34d', core: '#ffffff', glow: '251, 191, 36', ember: '#fde68a', accent: '#fde68a' },
  small: { o1: '#f59e0b', o2: '#ea580c', i1: '#fde68a', i2: '#fbbf24', core: '#fffbeb', glow: '245, 158, 11', ember: '#fcd34d', accent: '#fcd34d' },
  lively: { o1: '#f97316', o2: '#dc2626', i1: '#fcd34d', i2: '#fb923c', core: '#fffbeb', glow: '249, 115, 22', ember: '#fdba74', accent: '#fdba74' },
  intense: { o1: '#ef4444', o2: '#991b1b', i1: '#fde047', i2: '#f97316', core: '#fefce8', glow: '239, 68, 68', ember: '#fcd34d', accent: '#fca5a5' },
  searing: { o1: '#dc2626', o2: '#7f1d1d', i1: '#fff7ed', i2: '#fb923c', core: '#ffffff', glow: '249, 115, 22', ember: '#fed7aa', accent: '#fdba74' },
  blaze: { o1: '#f97316', o2: '#b91c1c', i1: '#ffffff', i2: '#fde047', core: '#ffffff', glow: '251, 146, 60', ember: '#fde68a', accent: '#fbbf24' },
  legendary: { o1: '#fbbf24', o2: '#c2410c', i1: '#ffffff', i2: '#fde68a', core: '#ffffff', glow: '251, 191, 36', ember: '#fde68a', accent: '#fcd34d' },
  mythic: { o1: '#fde68a', o2: '#ea580c', i1: '#ffffff', i2: '#fef3c7', core: '#ffffff', glow: '249, 115, 22', ember: '#fde68a', accent: '#fbbf24' },
};

/** Súper racha: la misma forma del nivel, de violeta a azul eléctrico */
const SUPER: Record<FlameTier, Palette> = {
  ...WARM,
  spark: { o1: '#c084fc', o2: '#a855f7', i1: '#f3e8ff', i2: '#d8b4fe', core: '#ffffff', glow: '192, 132, 252', ember: '#e9d5ff', accent: '#e9d5ff' },
  small: { o1: '#a855f7', o2: '#7e22ce', i1: '#f3e8ff', i2: '#c084fc', core: '#ffffff', glow: '168, 85, 247', ember: '#e9d5ff', accent: '#e9d5ff' },
  lively: { o1: '#8b5cf6', o2: '#5b21b6', i1: '#f5f3ff', i2: '#c4b5fd', core: '#ffffff', glow: '139, 92, 246', ember: '#ddd6fe', accent: '#ddd6fe' },
  intense: { o1: '#7c3aed', o2: '#3b0764', i1: '#e0e7ff', i2: '#a78bfa', core: '#ffffff', glow: '124, 58, 237', ember: '#c7d2fe', accent: '#c7d2fe' },
  searing: { o1: '#6366f1', o2: '#312e81', i1: '#e0f2fe', i2: '#818cf8', core: '#ffffff', glow: '99, 102, 241', ember: '#bae6fd', accent: '#a5b4fc' },
  blaze: { o1: '#3b82f6', o2: '#1e3a8a', i1: '#ffffff', i2: '#93c5fd', core: '#ffffff', glow: '59, 130, 246', ember: '#bfdbfe', accent: '#c4b5fd' },
  legendary: { o1: '#a78bfa', o2: '#4338ca', i1: '#ffffff', i2: '#c7d2fe', core: '#ffffff', glow: '139, 92, 246', ember: '#a5f3fc', accent: '#67e8f9' },
  mythic: { o1: '#e0e7ff', o2: '#6366f1', i1: '#ffffff', i2: '#e0f2fe', core: '#ffffff', glow: '99, 102, 241', ember: '#a5f3fc', accent: '#67e8f9' },
};

/** Racha protegida: llama congelada (no parpadea) */
const ICE: Palette = { o1: '#38bdf8', o2: '#0369a1', i1: '#f0f9ff', i2: '#7dd3fc', core: '#ffffff', glow: '56, 189, 248', ember: '#e0f2fe', accent: '#bae6fd' };

/** Alas del fénix: base, centro y puntas */
const WING_COLORS = {
  warm: ['#991b1b', '#f97316', '#fde68a'],
  super: ['#3730a3', '#8b5cf6', '#67e8f9'],
  ice: ['#075985', '#38bdf8', '#e0f2fe'],
};

/* ---------- Formas (viewBox 48 × 48, base de la llama en y ≈ 44) ---------- */

/** Llama pequeña de dos crestas */
const MINI = {
  outer: 'M25.5 21C27.5 25.5 31.5 28.5 31.5 34.5C31.5 39 28.2 42.5 24 42.5C19.8 42.5 16.5 39 16.5 35C16.5 32 17.4 29.6 18.5 27.5C19.3 29.6 20.4 30.8 21.7 31.3C21.8 27.3 23.3 24 25.5 21Z',
  inner: 'M25 29C26.2 31.5 29 33.3 29 36.8C29 39.2 26.8 41 24 41C21.2 41 19 39.2 19 36.8C19 35.2 19.6 34 20.3 33C20.9 34.2 21.7 34.9 22.6 35.1C22.7 32.8 23.6 30.8 25 29Z',
  core: 'M24 35C24.8 36.3 26.2 37.1 26.2 38.6C26.2 39.7 25.2 40.5 24 40.5C22.8 40.5 21.8 39.7 21.8 38.6C21.8 37.3 23.3 36.4 24 35Z',
};

/** Lengua principal + lengua lateral */
const TWIN = {
  outer: 'M25 7C27.5 14 35 19 35 30C35 38.5 30 44 24 44C17.5 44 13 39 13 32.5C13 27 14.5 22.5 15.5 19C17.5 23 19 25 21 25.5C20.5 18.5 22.5 12.5 25 7Z',
  inner: 'M25 19C26.5 23.5 31 26.5 31 33C31 38.5 28 41.5 24 41.5C20 41.5 17 38.5 17 34.5C17 31.5 18 29.5 19 28C20 30 21.3 31 22.5 31.2C22.4 26.5 23.4 22.5 25 19Z',
  core: 'M24 29.5C25.4 32 27.6 33.8 27.6 36.6C27.6 38.8 26 40.3 24 40.3C22 40.3 20.4 38.8 20.4 36.8C20.4 34 23 32.5 24 29.5Z',
};

/** Tres lenguas */
const TRIPLE = {
  outer: 'M24 5C26 10 28.5 13.5 29.5 18C31 16.5 32.8 14.5 34 12.5C35.8 17 37 22 37 29C37 38 31.5 44 24 44C16.5 44 11 38 11 30C11 24.5 12.8 19.5 14.5 15C15.5 18.5 17 21 18.8 22.3C19 15.5 21.5 10 24 5Z',
  inner: 'M24 15C25.5 19.5 27 22 27.8 25C28.8 24 29.8 22.8 30.6 21.5C32 24.5 33 28 33 32C33 38 29 42 24 42C19 42 15 38 15 32.5C15 29.5 16 27 17.3 25C18 27 19.2 28.4 20.5 29C20.6 24 22.2 19 24 15Z',
  core: 'M24 27C25.6 30 28.5 32.5 28.5 36C28.5 38.6 26.5 40.5 24 40.5C21.5 40.5 19.5 38.6 19.5 36C19.5 32.5 22.4 30 24 27Z',
};

/** Cuatro lenguas */
const FOUR = {
  outer: 'M26 4C27.8 8.5 29.6 12 30.2 16C31.6 14.4 33.2 12.6 34.5 10.5C36.5 15 37.5 20.5 37.5 28C37.5 37.5 31.5 44 24 44C16.5 44 10.5 38 10.5 30C10.5 25 11.3 20.8 12.6 17C13.8 19.2 15 20.6 16.5 21.4C16.5 17 17.4 12.8 19 9C20.2 12.4 21.2 14.6 22.4 16C22.6 11.5 24 7.5 26 4Z',
  inner: TRIPLE.inner,
  core: 'M24 25.5C25.8 29 29 31.5 29 35.5C29 38.5 26.8 40.8 24 40.8C21.2 40.8 19 38.5 19 35.5C19 31.5 22.2 29 24 25.5Z',
};

/** Cinco lenguas */
const CROWN = {
  outer: 'M24 3C25.8 7.5 27.5 10.5 28.5 14C29.5 12.5 30.8 10.6 31.5 8.5C33.5 12 34.5 15 34.6 18.5C35.5 18 36.4 17.6 37.2 17C38.3 20.5 39 24.5 39 29C39 38 32.5 44.5 24 44.5C15.5 44.5 9 38 9 29.5C9 25.5 10 21.5 11.5 18C12.6 19 13.6 19.8 14.6 20.3C14.8 16.3 15.8 13 17 10C18 13 19 15 20 16C20.4 11 22 6.8 24 3Z',
  inner: TRIPLE.inner,
  core: 'M24 24C26 28 30 30.5 30 35C30 38.4 27.4 41 24 41C20.6 41 18 38.4 18 35C18 30.5 22 28 24 24Z',
};

/** Lenguas sueltas que flotan sobre el fuego legendario */
const WISPS = [
  'M13 6C14.5 8.5 16 9.8 16 11.8C16 13.3 14.8 14.4 13.4 14.4C12 14.4 11 13.3 11 12C11 10 12.6 8.8 13 6Z',
  'M35 3.5C36.3 5.8 37.6 6.9 37.6 8.7C37.6 10.1 36.5 11.1 35.2 11.1C33.9 11.1 32.9 10.1 32.9 8.8C32.9 7 34.5 6 35 3.5Z',
];

/** Ala izquierda del fénix (la derecha es su reflejo) */
const WING = 'M22.5 41.5C15 41.5 8 37.5 3.5 28C6.5 29.6 9.3 30.1 11.6 29.7C7.8 26.6 5.3 21.8 4.8 16C8.3 20 11.6 21.8 14.3 22.3C12.6 18.6 12 14.6 12.6 10.5C15.8 16.6 19.6 21.7 23 25.5Z';

const BOLT = 'M25.6 26.5L20.8 34.6H24L22.6 40.8L27.4 32.6H24.2Z';

interface Shape {
  outer: string;
  inner: string;
  core: string;
  /** Escala de la llama alrededor de su base */
  scale: number;
  dur: number;
  amp: number;
  halo: { r: number; cy: number; a: number };
  embers: number;
  ring?: boolean;
  rays?: boolean;
  wisps?: boolean;
  wings?: boolean;
  spark?: boolean;
}

const SHAPES: Record<Exclude<FlameTier, 'dormant'>, Shape> = {
  spark: { ...MINI, scale: 1.12, dur: 1.6, amp: 0.05, halo: { r: 13, cy: 35, a: 0.4 }, embers: 0, spark: true },
  small: { ...TWIN, scale: 0.84, dur: 1.4, amp: 0.06, halo: { r: 16, cy: 32, a: 0.38 }, embers: 1 },
  lively: { ...TRIPLE, scale: 0.92, dur: 1.2, amp: 0.07, halo: { r: 19, cy: 30, a: 0.42 }, embers: 2 },
  intense: { ...FOUR, scale: 1, dur: 1, amp: 0.08, halo: { r: 21, cy: 28, a: 0.5 }, embers: 3 },
  searing: { ...FOUR, scale: 1.06, dur: 0.95, amp: 0.085, halo: { r: 24, cy: 27, a: 0.72 }, embers: 4 },
  blaze: { ...CROWN, scale: 1, dur: 0.85, amp: 0.09, halo: { r: 24, cy: 26, a: 0.75 }, embers: 5, ring: true },
  legendary: { ...CROWN, scale: 1, dur: 0.8, amp: 0.095, halo: { r: 24, cy: 25, a: 0.85 }, embers: 6, ring: true, rays: true, wisps: true },
  mythic: { ...CROWN, scale: 0.84, dur: 0.8, amp: 0.1, halo: { r: 24, cy: 26, a: 0.9 }, embers: 7, ring: true, rays: true, wings: true },
};

/** Brasas que suben (el orden importa: los niveles bajos usan las primeras) */
const EMBERS = [
  { x: 29, y: 22, r: 1.1, d: 1.7, dl: 0, dx: 2 },
  { x: 18, y: 25, r: 1, d: 1.9, dl: 0.6, dx: -2 },
  { x: 24, y: 12, r: 0.9, d: 1.4, dl: 1, dx: 1 },
  { x: 34, y: 28, r: 1, d: 2.1, dl: 0.3, dx: 3 },
  { x: 13, y: 30, r: 1, d: 1.8, dl: 1.3, dx: -3 },
  { x: 19, y: 11, r: 0.8, d: 1.5, dl: 0.8, dx: -1 },
  { x: 31, y: 9, r: 0.9, d: 1.6, dl: 1.6, dx: 2 },
];

/** Destello de cuatro puntas */
const star = (cx: number, cy: number, r: number) => {
  const k = r * 0.2;
  return `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`;
};

const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4 + Math.PI / 8;
  const r1 = 18;
  const r2 = i % 2 ? 21.5 : 23.5;
  const f = (n: number) => Math.round(n * 100) / 100;
  return { x1: f(24 + Math.cos(a) * r1), y1: f(25 + Math.sin(a) * r1), x2: f(24 + Math.cos(a) * r2), y2: f(25 + Math.sin(a) * r2) };
});

const aboutBase = (s: number) => (s === 1 ? undefined : `translate(24 44) scale(${s}) translate(-24 -44)`);

/**
 * Llama de racha: cambia de forma, color y efectos según los días.
 * Solo SVG + animaciones CSS de transform/opacity (sin filtros de desenfoque), para que
 * aguante muchas llamas a la vez. Con movimiento reducido queda la forma estática del nivel.
 */
export const StreakFlame: React.FC<StreakFlameProps> = ({
  days,
  size = 48,
  isSuperStreak = false,
  isFrozen = false,
  animated = true,
}) => {
  const uid = `sf${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const level = getFlameLevel(days);
  const { tier } = level;
  const lit = tier !== 'dormant';
  const frozen = isFrozen && lit;
  const isSuper = isSuperStreak && lit && !frozen;
  const pal = frozen ? ICE : isSuper ? SUPER[tier] : WARM[tier];
  const wing = frozen ? WING_COLORS.ice : isSuper ? WING_COLORS.super : WING_COLORS.warm;
  const moving = animated && !frozen;
  // A tamaño de icono, partículas y trazos más gruesos para que se lean (y menos nodos animados)
  const small = size < 32;

  const dayText = `${days} ${days === 1 ? 'día' : 'días'}`;
  const label = lit
    ? `${level.name}: racha de ${dayText}${isSuper ? ' (súper racha)' : ''}${frozen ? ' (protegida con escudo)' : ''}`
    : 'Brasa apagada: sin racha activa';

  const className = [
    'streak-flame',
    `sf-${tier}`,
    isSuper && 'is-super',
    frozen && 'is-frozen',
    moving && 'is-animated',
  ]
    .filter(Boolean)
    .join(' ');

  const ids = { o: `${uid}o`, i: `${uid}i`, h: `${uid}h`, w: `${uid}w`, c: `${uid}c` };

  if (!lit) {
    return (
      <div className={className} style={{ width: size, height: size }} role="img" aria-label={label} title={label}>
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={ids.c} x1="24" y1="44" x2="24" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#3f3f46" />
              <stop offset="1" stopColor="#71717a" />
            </linearGradient>
          </defs>
          {/* Humo */}
          <path
            className="sf-smoke"
            d="M24 30.5C21.5 27.5 26.5 25 24 21.5C22.6 19.5 24.4 17.6 25.6 16.6"
            stroke="#a1a1aa"
            strokeWidth={small ? 2.4 : 1.4}
            strokeLinecap="round"
            opacity="0.55"
          />
          {/* Carbón */}
          <path
            d="M11 41.5C11 37 15 34.5 19.5 35C21 32.3 26 31.8 28.6 34C32.8 33 37 36.2 37 40.3C37 42.4 35.4 43.6 33.4 43.6H14.2C12.2 43.6 11 42.9 11 41.5Z"
            fill={`url(#${ids.c})`}
          />
          {/* Grietas con un resto de brasa */}
          <path
            className="sf-cinder"
            d="M17.5 40L20.5 38.2L22.8 40.2M26.5 37L29 39.2L32 38.4"
            stroke="#f97316"
            strokeWidth={small ? 1.8 : 1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  const shape = SHAPES[tier as Exclude<FlameTier, 'dormant'>];
  const emberCount = Math.min(shape.embers, small ? 3 : shape.embers);
  const ringWidth = small ? 2.6 : 1.6;

  return (
    <div
      className={className}
      style={
        {
          width: size,
          height: size,
          '--sf-dur': `${shape.dur}s`,
          '--sf-amp': shape.amp,
        } as React.CSSProperties
      }
      role="img"
      aria-label={label}
      title={label}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={ids.o} x1="24" y1="44" x2="24" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0.15" stopColor={pal.o1} />
            <stop offset="1" stopColor={pal.o2} />
          </linearGradient>
          <linearGradient id={ids.i} x1="24" y1="42" x2="24" y2="14" gradientUnits="userSpaceOnUse">
            <stop offset="0.2" stopColor={pal.i1} />
            <stop offset="1" stopColor={pal.i2} />
          </linearGradient>
          <radialGradient id={ids.h} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={`rgb(${pal.glow})`} stopOpacity={shape.halo.a} />
            <stop offset="0.55" stopColor={`rgb(${pal.glow})`} stopOpacity={shape.halo.a * 0.35} />
            <stop offset="1" stopColor={`rgb(${pal.glow})`} stopOpacity="0" />
          </radialGradient>
          {shape.wings && (
            <linearGradient id={ids.w} x1="22" y1="42" x2="7" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={wing[0]} />
              <stop offset="0.5" stopColor={wing[1]} />
              <stop offset="1" stopColor={wing[2]} />
            </linearGradient>
          )}
        </defs>

        {/* Halo (degradado radial: sin blur) */}
        <circle className="sf-halo" cx="24" cy={shape.halo.cy} r={shape.halo.r} fill={`url(#${ids.h})`} />

        {/* Rayos de energía */}
        {shape.rays && (
          <g className="sf-rays" stroke={pal.accent} strokeWidth={small ? 2.2 : 1.3} strokeLinecap="round" opacity="0.6">
            {RAYS.map((r, i) => (
              <line key={i} {...r} />
            ))}
          </g>
        )}

        {/* Mitad trasera del anillo */}
        {shape.ring && (
          <path
            className="sf-ring"
            d="M7 41.5A17 4.5 0 0 1 41 41.5"
            stroke={pal.accent}
            strokeWidth={ringWidth}
            strokeLinecap="round"
            opacity="0.45"
          />
        )}

        {/* Alas del fénix */}
        {shape.wings && (
          <g>
            <path className="sf-wing" d={WING} fill={`url(#${ids.w})`} />
            <g transform="translate(48 0) scale(-1 1)">
              <path className="sf-wing" d={WING} fill={`url(#${ids.w})`} />
            </g>
          </g>
        )}

        {/* Cuerpo de la llama */}
        <g transform={aboutBase(shape.scale)}>
          <path className="sf-outer" d={shape.outer} fill={`url(#${ids.o})`} />
          <path className="sf-inner" d={shape.inner} fill={`url(#${ids.i})`} />
          <path className="sf-core" d={shape.core} fill={pal.core} />
          {shape.wings && <path d={BOLT} fill={frozen ? pal.accent : '#f59e0b'} stroke="#fff7ed" strokeWidth="0.6" strokeLinejoin="round" />}
        </g>

        {/* Lenguas sueltas */}
        {shape.wisps &&
          WISPS.map((d, i) => <path key={i} className={`sf-wisp sf-wisp-${i + 1}`} d={d} fill={pal.o1} />)}

        {/* Mitad delantera del anillo */}
        {shape.ring && (
          <path
            className="sf-ring"
            d="M7 41.5A17 4.5 0 0 0 41 41.5"
            stroke={pal.accent}
            strokeWidth={ringWidth}
            strokeLinecap="round"
          />
        )}

        {/* Brasas que suben */}
        {EMBERS.slice(0, emberCount).map((e, i) => (
          <circle
            key={i}
            className="sf-ember"
            cx={e.x}
            cy={e.y}
            r={small ? e.r * 1.7 : e.r}
            fill={pal.ember}
            style={
              {
                '--d': `${e.d}s`,
                '--dl': `${e.dl}s`,
                '--dx': `${e.dx}px`,
              } as React.CSSProperties
            }
          />
        ))}

        {/* Chispa del primer nivel */}
        {shape.spark && (
          <>
            <path className="sf-twinkle" d={star(34, 22, small ? 5.5 : 4.5)} fill={pal.accent} />
            <path className="sf-twinkle sf-twinkle-2" d={star(14.5, 27, small ? 3 : 2.3)} fill={pal.accent} />
          </>
        )}

        {/* Corona de destellos del fénix */}
        {shape.wings && (
          <>
            <path className="sf-twinkle" d={star(24, 4, small ? 4 : 3.2)} fill="#fff7ed" />
            <path className="sf-twinkle sf-twinkle-2" d={star(14, 7.5, 2)} fill={pal.accent} />
            <path className="sf-twinkle sf-twinkle-3" d={star(34, 7.5, 2)} fill={pal.accent} />
          </>
        )}

        {/* Destellos de súper racha */}
        {isSuper && !shape.spark && !shape.wings && (
          <>
            <path className="sf-twinkle" d={star(40, 13, small ? 4.5 : 3.6)} fill="#fdf4ff" />
            <path className="sf-twinkle sf-twinkle-2" d={star(8, 22, small ? 3.2 : 2.5)} fill={pal.accent} />
          </>
        )}

        {/* Escudo de racha: copo vectorial */}
        {frozen && (
          <g transform="translate(36 38)" stroke="#e0f2fe" strokeWidth={small ? 2 : 1.3} strokeLinecap="round">
            <circle r="6.5" fill="#0c4a6e" stroke="none" opacity="0.85" />
            <line x1="0" y1="-4.6" x2="0" y2="4.6" />
            <line x1="-4" y1="-2.3" x2="4" y2="2.3" />
            <line x1="-4" y1="2.3" x2="4" y2="-2.3" />
          </g>
        )}
      </svg>
    </div>
  );
};
