import React from 'react';
import {
  Check,
  Sprout,
  X,
  CircleDashed,
  Pause,
  BatteryWarning,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  BatteryCharging,
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
 * registro de hábitos, nivel de energía y ánimo de sesión. Evita mezclar emojis con iconos.
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

/* ---------- Energía (1-5): una pila que se va cargando ---------- */
const ENERGY_ICONS: Record<Level5, LucideIcon> = {
  1: BatteryWarning,
  2: BatteryLow,
  3: BatteryMedium,
  4: BatteryFull,
  5: BatteryCharging,
};

export const ENERGY_COLORS: Record<Level5, string> = {
  1: '#f87171',
  2: '#fb923c',
  3: '#fbbf24',
  4: '#a3e635',
  5: '#34d399',
};

export const EnergyIcon: React.FC<{ level: Level5; size?: number; colored?: boolean }> = ({ level, size = 20, colored = true }) => {
  const Icon = ENERGY_ICONS[level] ?? BatteryMedium;
  return <Icon size={size} color={colored ? ENERGY_COLORS[level] : undefined} aria-hidden="true" />;
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
  return <Icon size={size} color={colored ? ENERGY_COLORS[level] : undefined} aria-hidden="true" />;
};
