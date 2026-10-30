import React from 'react';
import {
  Check,
  Sprout,
  X,
  CircleDashed,
  Pause,
  FaceExpressionless,
  FaceSlightlyFrowning,
  FaceNeutral,
  FaceSlightlySmiling,
  FaceGrinning,
  type LucideIcon,
} from 'lucide-react';
import type { HabitLog, Level5 } from '@/types';

/**
 * ICONOGRAFÍA COMÚN
 * Un solo set de iconos (lucide) para los estados que se repiten por toda la app:
 * registro de hábitos y ánimo de sesión. Evita mezclar emojis con iconos.
 */

type LogStatus = HabitLog['status'] | 'paused';

const STATUS_ICONS: Record<LogStatus, LucideIcon> = {
  full: Check,
  minimum: Sprout,
  missed: X,
  partial: CircleDashed,
  paused: Pause,
};

/** Color semántico de cada estado (tokens de global.css) */
export const STATUS_COLORS: Record<LogStatus, string> = {
  full: 'var(--success)',
  minimum: 'var(--minimum)',
  missed: 'var(--danger)',
  partial: 'var(--minimum)',
  paused: 'var(--warning)',
};

export const StatusIcon: React.FC<{ status: LogStatus; size?: number; color?: string; strokeWidth?: number; className?: string }> = ({
  status,
  size = 14,
  color,
  strokeWidth = 2.4,
  className,
}) => {
  const Icon = STATUS_ICONS[status];
  return <Icon size={size} color={color} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
};

/** Icono + texto en línea, alineados (para badges, títulos y leyendas) */
export const StatusLabel: React.FC<{ status: LogStatus; children: React.ReactNode; colored?: boolean; size?: number }> = ({
  status,
  children,
  colored = true,
  size = 13,
}) => (
  <span className="icon-label" style={colored ? { color: STATUS_COLORS[status] } : undefined}>
    <StatusIcon status={status} size={size} />
    {children}
  </span>
);

/** Insignia única de «hábito en pausa» (antes cada vista tenía su propia versión con emoji) */
export const PausedBadge: React.FC<{ label?: string }> = ({ label = 'Pausado' }) => (
  <span className="badge paused-badge">
    <Pause size={10} strokeWidth={3} aria-hidden="true" /> {label}
  </span>
);

/* ---------- Escala 1-5: de rojo (bajo) a verde (alto) ----------
   Tokens del tema: en oscuro #f87171 · #fb923c · #fbbf24 · #a3e635 · #34d399; en claro, sus tonos legibles */
export const LEVEL_COLORS: Record<Level5, string> = {
  1: 'var(--danger)',
  2: 'var(--streak)',
  3: 'var(--warning)',
  4: 'var(--lime)',
  5: 'var(--success)',
};

/* ---------- Ánimo de una sesión (1-5) ---------- */
const MOOD_ICONS: Record<Level5, LucideIcon> = {
  1: FaceExpressionless,
  2: FaceSlightlyFrowning,
  3: FaceNeutral,
  4: FaceSlightlySmiling,
  5: FaceGrinning,
};

export const MoodIcon: React.FC<{ level: Level5; size?: number; colored?: boolean }> = ({ level, size = 20, colored = true }) => {
  const Icon = MOOD_ICONS[level] ?? FaceNeutral;
  return <Icon size={size} color={colored ? LEVEL_COLORS[level] : undefined} aria-hidden="true" />;
};

/** Icono de línea del coach (cara con cinta deportiva) al estilo lucide, para la navegación */
export const CoachIcon: React.FC<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }> = ({ size = 24, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <circle cx="12" cy="13" r="8.5" />
    <path d="M4.3 10.4c4.8-2.4 10.6-2.4 15.4 0" />
    <path d="M10 4.6c.9-1.7 3.6-1.9 4.6-.2" />
    <path d="M9.3 13.2v.6M14.7 13.2v.6" />
    <path d="M9.4 16.4c1.5 1.2 3.7 1.2 5.2 0" />
  </svg>
);
