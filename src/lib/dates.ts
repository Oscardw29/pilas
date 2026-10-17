import type { DateKey } from '@/types';

/** Utilidades de fecha. Semanas empiezan en lunes. Índice de día: 0 = lunes … 6 = domingo. */

export const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
export const DAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const DAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k: DateKey): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const todayKey = (): DateKey => toKey(new Date());

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export const addDaysKey = (k: DateKey, n: number): DateKey => toKey(addDays(fromKey(k), n));

/** 0 = lunes … 6 = domingo */
export const weekdayIndex = (d: Date | DateKey): number =>
  ((typeof d === 'string' ? fromKey(d) : d).getDay() + 6) % 7;

export function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - weekdayIndex(r));
  return r;
}

export const startOfWeekKey = (k: DateKey): DateKey => toKey(startOfWeek(fromKey(k)));

export const weekDays = (start: Date): Date[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** Días (claves) en el rango [from, to] inclusivo */
export function rangeKeys(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  let d = fromKey(from);
  const end = fromKey(to);
  while (d <= end) {
    out.push(toKey(d));
    d = addDays(d, 1);
  }
  return out;
}

/** Diferencia en días calendario b - a */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 864e5);
}

/** Número de semana ISO */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
}

export function formatRange(start: Date): string {
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth())
    return `${start.getDate()} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  return `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

/** "Lunes, 5 de octubre" */
export function longDate(d: Date | DateKey): string {
  const x = typeof d === 'string' ? fromKey(d) : d;
  const s = `${DAY_LONG[weekdayIndex(x)]}, ${x.getDate()} de ${MONTHS[x.getMonth()]}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "5 oct" */
export function shortDate(d: Date | DateKey): string {
  const x = typeof d === 'string' ? fromKey(d) : d;
  return `${x.getDate()} ${MONTHS_SHORT[x.getMonth()]}`;
}

export function timeHM(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 95 → "1h 35m", 40 → "40 min" */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** segundos → "32:17" o "1:02:05" */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}

/** "Hace 2 días", "Hoy", "Ayer" */
export function relativeDay(k: DateKey, ref: DateKey = todayKey()): string {
  const n = diffDays(k, ref);
  if (n === 0) return 'Hoy';
  if (n === 1) return 'Ayer';
  if (n < 0) return `En ${-n} días`;
  return `Hace ${n} días`;
}

export function hourOf(iso: string): number {
  return new Date(iso).getHours();
}
