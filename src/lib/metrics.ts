import type { AppData, DateKey, Goal, Habit, HabitLog, Session } from '@/types';
import { addDaysKey, diffDays, rangeKeys, todayKey, weekdayIndex } from './dates';
import { logCoins } from './economyRules';

/**
 * MÉTRICAS BASE (puras, sin React). Todas reciben `data` (AppData o un subconjunto).
 * Convenciones:
 *  - Un día "pendiente" es HOY sin registro: no cuenta en contra (aún hay tiempo).
 *  - Valor de un registro: full = 1, minimum = settings.minimumRatio (0.4), missed/sin registro = 0.
 *  - El mínimo SÍ mantiene la racha (continuidad) pero vale menos en consistencia/progreso.
 */

type D = Pick<AppData, 'logs' | 'settings'>;

export const logKey = (date: DateKey, habitId: string) => `${date}|${habitId}`;

export const getLog = (data: Pick<AppData, 'logs'>, habitId: string, date: DateKey): HabitLog | undefined =>
  data.logs[logKey(date, habitId)];

export const isDoneLog = (l?: HabitLog) => !!l && (l.status === 'full' || l.status === 'minimum');

export function logValue(l: HabitLog | undefined, minimumRatio: number): number {
  if (!l) return 0;
  return l.status === 'full' ? 1 : l.status === 'minimum' ? minimumRatio : 0;
}

/** ¿El hábito estuvo o está en pausa en una fecha dada? */
export function isHabitPausedOnDate(h: Habit, date: DateKey): boolean {
  if (h.status === 'paused' && h.pausedAt && date >= h.pausedAt) return true;
  if (h.pausedIntervals && h.pausedIntervals.length > 0) {
    for (const interval of h.pausedIntervals) {
      if (interval.end) {
        // Intervalo cerrado: estuvo en pausa entre start y estrictamente antes de end
        if (date >= interval.start && date < interval.end) {
          return true;
        }
      } else {
        // Intervalo abierto (actualmente en pausa)
        if (date >= interval.start) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Primer día en que cuenta el hábito (fecha de inicio configurada o, si no hay, fecha de creación) */
export const habitStart = (h: Habit): DateKey => h.startDate || h.createdAt;

/** ¿El hábito está activo en una fecha dada? Respeta fecha de inicio, fin, archivado y pausas pasadas/presentes. */
export function isHabitActiveOnDate(h: Habit, date: DateKey): boolean {
  if (isHabitPausedOnDate(h, date)) return false;
  if (h.status === 'archived' && date >= (h.archivedAt ?? '0000-00-00')) return false;
  const start = habitStart(h);
  if (start && date < start) return false;
  if (h.endDate && date > h.endDate) return false;
  return true;
}

/** ¿El hábito está programado ese día? Respeta fechas de inicio/fin y días de la semana. */
export function isScheduled(h: Habit, date: DateKey): boolean {
  if (!isHabitActiveOnDate(h, date)) return false;
  return h.days.includes(weekdayIndex(date));
}

export const activeHabits = (data: Pick<AppData, 'habits'>, ref = todayKey()) =>
  data.habits.filter((h) => isHabitActiveOnDate(h, ref));

/**
 * Monedas de marcar un hábito con ese estado (reglas por tipo: ver lib/economyRules).
 * Sin minutos ni cantidad, «completo» vale la meta entera y «mínimo» la versión mínima.
 */
export const pointsFor = (h: Habit, status: HabitLog['status'], minimumRatio: number, progress?: Pick<HabitLog, 'minutes' | 'quantity'>) =>
  logCoins(h, status, progress, minimumRatio);

/* ---------------- Nueva Lógica de Racha y Súper Racha ---------------- */

export interface DayStreakInfo {
  hasStreak: boolean;
  isSuperStreak: boolean;
  isFrozen: boolean;
  completedCount: number;
  scheduledCount: number;
}

type StreakData = Pick<AppData, 'habits' | 'logs'> & { streakFreezes?: DateKey[] };

/** Índice fecha → nº de registros hechos (full/mínimo). Evita recorrer todos los logs por cada día. */
export function doneCountByDate(logs: AppData['logs']): Map<DateKey, number> {
  const idx = new Map<DateKey, number>();
  for (const l of Object.values(logs)) {
    if (isDoneLog(l)) idx.set(l.date, (idx.get(l.date) ?? 0) + 1);
  }
  return idx;
}

/** Estado de racha para un día específico (al menos 1 hábito = racha; todos los programados = súper racha; o día congelado) */
export function getDayStreakStatus(data: StreakData, date: DateKey, doneIdx?: Map<DateKey, number>): DayStreakInfo {
  const scheduled = data.habits.filter((h) => isScheduled(h, date));
  const done = scheduled.filter((h) => isDoneLog(getLog(data, h.id, date)));
  const allDone = doneIdx ? doneIdx.get(date) ?? 0 : Object.values(data.logs).filter((l) => l.date === date && isDoneLog(l)).length;
  const completedCount = Math.max(done.length, allDone);
  const scheduledCount = scheduled.length;
  const isFrozen = Boolean(data.streakFreezes && data.streakFreezes.includes(date));
  const hasStreak = completedCount >= 1 || isFrozen;
  const isSuperStreak = !isFrozen && scheduledCount > 0 && done.length === scheduledCount;
  return { hasStreak, isSuperStreak, isFrozen, completedCount, scheduledCount };
}

/** Fecha más antigua con hábitos o registros: límite para recorrer rachas hacia atrás */
function earliestActivity(data: StreakData): DateKey | null {
  let min: DateKey | null = null;
  for (const h of data.habits) {
    const s = habitStart(h);
    if (!min || s < min) min = s;
  }
  for (const l of Object.values(data.logs)) {
    if (!min || l.date < min) min = l.date;
  }
  return min;
}

/**
 * Días consecutivos con racha que terminan en `from` (incluido), hacia atrás.
 * Los días sin hábitos programados y sin registros (p. ej. fines de semana) no suman ni rompen la racha.
 */
export function streakEndingAt(data: StreakData, from: DateKey, doneIdx = doneCountByDate(data.logs)): number {
  const earliest = earliestActivity(data);
  if (!earliest) return 0;
  let streak = 0;
  let d = from;
  while (d >= earliest) {
    const st = getDayStreakStatus(data, d, doneIdx);
    if (st.hasStreak) streak++;
    else if (st.scheduledCount > 0) break;
    d = addDaysKey(d, -1);
  }
  return streak;
}

/** Último día anterior a `before` que cuenta para la racha (tiene algo programado, registros o está congelado) */
export function previousCountedDay(data: StreakData, before: DateKey, doneIdx = doneCountByDate(data.logs)): DateKey | null {
  const earliest = earliestActivity(data);
  if (!earliest) return null;
  let d = addDaysKey(before, -1);
  while (d >= earliest) {
    const st = getDayStreakStatus(data, d, doneIdx);
    if (st.hasStreak || st.scheduledCount > 0) return d;
    d = addDaysKey(d, -1);
  }
  return null;
}

export interface GlobalStreakResult {
  streak: number;
  isSuperStreak: boolean;
  isFrozen: boolean;
  todayHasStreak: boolean;
  todayIsSuper: boolean;
  todayIsFrozen: boolean;
  todayCompletedCount: number;
  todayScheduledCount: number;
}

/**
 * Racha global consecutiva:
 * - Para sumar día de racha: al menos 1 hábito completado ese día, o día congelado por protector de racha.
 * - Los días sin nada programado ni registrado se saltan (no rompen la racha).
 * - Súper racha: todos los hábitos programados de ese día completados (llama morada).
 * - Racha congelada (azul): si el día activo está protegido por el protector de racha.
 */
export function calculateGlobalStreak(
  data: StreakData & { hasStreakFreeze?: boolean },
  ref = todayKey()
): GlobalStreakResult {
  const doneIdx = doneCountByDate(data.logs);
  const todayStatus = getDayStreakStatus(data, ref, doneIdx);

  // Si hoy aún no se completa ninguno, la racha previa sigue viva hasta ayer
  const streak = streakEndingAt(data, todayStatus.hasStreak ? ref : addDaysKey(ref, -1), doneIdx);

  const prevDay = streak > 0 ? previousCountedDay(data, ref, doneIdx) : null;
  const prevDayStatus = prevDay ? getDayStreakStatus(data, prevDay, doneIdx) : null;

  // Súper racha activa si hoy se completaron todos, o si hoy no hay registros pero el último día fue súper racha
  const isSuperStreak = todayStatus.hasStreak
    ? todayStatus.isSuperStreak
    : (prevDayStatus?.isSuperStreak ?? false);

  // Racha azul congelada si hoy es congelado, o si hoy aún no hay registros pero el último día fue protegido por hielo
  const isFrozen = todayStatus.hasStreak
    ? todayStatus.isFrozen
    : (prevDayStatus?.isFrozen ?? false);

  return {
    streak,
    isSuperStreak,
    isFrozen,
    todayHasStreak: todayStatus.hasStreak,
    todayIsSuper: todayStatus.isSuperStreak,
    todayIsFrozen: todayStatus.isFrozen,
    todayCompletedCount: todayStatus.completedCount,
    todayScheduledCount: todayStatus.scheduledCount,
  };
}

/* ---------------- Por hábito ---------------- */

export interface HabitDay {
  date: DateKey;
  scheduled: boolean;
  log?: HabitLog;
  value: number;
  /** hoy sin registro */
  pending: boolean;
}

export function habitDays(data: D, h: Habit, from: DateKey, to: DateKey, ref = todayKey()): HabitDay[] {
  return rangeKeys(from, to).map((date) => {
    const log = getLog(data, h.id, date);
    return {
      date,
      scheduled: isScheduled(h, date),
      log,
      value: logValue(log, data.settings.minimumRatio),
      pending: date === ref && !log,
    };
  });
}

/**
 * Consistencia ponderada en una ventana [from, to]: Σ valor / días programados.
 * Los días no programados con registro cuentan como extra (suman, pero el resultado se limita a 1).
 * Devuelve null si no hubo días programados.
 */
export function habitScore(data: D, h: Habit, from: DateKey, to: DateKey, ref = todayKey()): number | null {
  let sched = 0, sum = 0;
  for (const d of habitDays(data, h, from, to > ref ? ref : to, ref)) {
    if (d.pending) continue;
    if (d.scheduled) { sched++; sum += d.value; }
    else if (d.value > 0) sum += d.value * 0.5;
  }
  return sched ? Math.min(1, sum / sched) : null;
}

/** Consistencia de los últimos `days` días (por defecto 30) */
export function consistency(data: D, h: Habit, days = 30, ref = todayKey()): number | null {
  return habitScore(data, h, addDaysKey(ref, -(days - 1)), ref, ref);
}

/** Tasa de cumplimiento sin ponderar (full o mínimo cuentan como hecho) */
export function completionRate(data: D, h: Habit, from: DateKey, to: DateKey, ref = todayKey()): number | null {
  let sched = 0, done = 0;
  for (const d of habitDays(data, h, from, to > ref ? ref : to, ref)) {
    if (!d.scheduled || d.pending) continue;
    sched++;
    if (isDoneLog(d.log)) done++;
  }
  return sched ? done / sched : null;
}

/** Racha actual: días programados consecutivos hechos (mínimo cuenta). Hoy pendiente no rompe. */
export function currentStreak(data: D, h: Habit, ref = todayKey()): number {
  let n = 0;
  let d = ref;
  const start = habitStart(h);
  // Sin tope de días: recorre hasta el inicio del hábito
  while (d >= start) {
    if (isScheduled(h, d)) {
      const l = getLog(data, h.id, d);
      if (isDoneLog(l)) n++;
      else if (!(d === ref && !l)) break;
    }
    d = addDaysKey(d, -1);
  }
  return n;
}

export function bestStreak(data: D, h: Habit, ref = todayKey()): number {
  let best = 0, cur = 0;
  for (const d of rangeKeys(habitStart(h), ref)) {
    if (!isScheduled(h, d)) continue;
    const l = getLog(data, h.id, d);
    if (isDoneLog(l)) { cur++; best = Math.max(best, cur); }
    else if (!(d === ref && !l)) cur = 0;
  }
  return best;
}

export interface RecoveryEvent {
  /** Primer día programado fallado tras una racha */
  failedOn: DateKey;
  /** Día en que volvió a hacerlo */
  returnedOn: DateKey;
  /** Días calendario entre la falla y el regreso */
  days: number;
}

export interface RecoveryStats {
  events: RecoveryEvent[];
  average: number | null;
  best: number | null;
  last: RecoveryEvent | null;
  /** Si actualmente está en una interrupción: desde cuándo */
  ongoing: { since: DateKey; days: number } | null;
}

/** Recuperación: cuánto tarda en volver tras romper una racha. Volver es una métrica positiva. */
export function recoveryStats(data: D, h: Habit, ref = todayKey()): RecoveryStats {
  const events: RecoveryEvent[] = [];
  let hadStreak = false;
  let brokeOn: DateKey | null = null;
  for (const d of rangeKeys(habitStart(h), ref)) {
    if (!isScheduled(h, d)) continue;
    const l = getLog(data, h.id, d);
    if (isDoneLog(l)) {
      if (brokeOn) {
        events.push({ failedOn: brokeOn, returnedOn: d, days: diffDays(brokeOn, d) });
        brokeOn = null;
      }
      hadStreak = true;
    } else if (!(d === ref && !l)) {
      if (hadStreak && !brokeOn) brokeOn = d;
    }
  }
  const ds = events.map((e) => e.days);
  return {
    events,
    average: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null,
    best: ds.length ? Math.min(...ds) : null,
    last: events[events.length - 1] ?? null,
    ongoing: brokeOn ? { since: brokeOn, days: diffDays(brokeOn, ref) } : null,
  };
}

export function lastActivity(data: Pick<AppData, 'logs'>, habitId: string): DateKey | null {
  let last: DateKey | null = null;
  for (const l of Object.values(data.logs)) {
    if (l.habitId === habitId && isDoneLog(l) && (!last || l.date > last)) last = l.date;
  }
  return last;
}

/* ---------------- Objetivos ---------------- */

export interface WeightedHabit {
  habit: Habit;
  /** peso configurado (0-100) */
  rawWeight: number;
  /** peso normalizado (suma 1) */
  weight: number;
}

/** Hábitos del objetivo con pesos normalizados. Si todos pesan 0, se reparte por igual. */
export function goalHabits(data: Pick<AppData, 'habits'>, goalId: string, includeInactive = true): WeightedHabit[] {
  const list = data.habits
    .filter((h) => (includeInactive || h.status === 'active'))
    .map((h) => ({ habit: h, rawWeight: h.goals.find((g) => g.goalId === goalId)?.weight ?? -1 }))
    .filter((x) => x.rawWeight >= 0);
  const total = list.reduce((a, x) => a + x.rawWeight, 0);
  return list.map((x) => ({ ...x, weight: total > 0 ? x.rawWeight / total : 1 / list.length }));
}

/**
 * Progreso del objetivo (0-1), ponderado por el peso de cada hábito.
 *  - Con fecha objetivo: progreso ACUMULADO = valor logrado / valor esperado hasta la fecha objetivo.
 *  - Sin fecha objetivo: consistencia ponderada de los últimos 30 días (refleja el ritmo actual).
 *  - Completado = 100%.
 */
export function goalProgress(data: Pick<AppData, 'habits' | 'logs' | 'settings'>, goal: Goal, ref = todayKey()): number {
  if (goal.status === 'completed') return 1;
  const hs = goalHabits(data, goal.id);
  if (!hs.length) return 0;
  if (goal.targetDate) {
    let p = 0;
    for (const { habit, weight } of hs) {
      const start = habitStart(habit) > goal.startDate ? habitStart(habit) : goal.startDate;
      let expected = 0, achieved = 0;
      for (const d of rangeKeys(start, goal.targetDate)) {
        if (!isScheduled(habit, d)) continue;
        expected++;
        if (d <= ref) achieved += logValue(getLog(data, habit.id, d), data.settings.minimumRatio);
      }
      p += weight * (expected ? Math.min(1, achieved / expected) : 0);
    }
    return Math.min(1, p);
  }
  let p = 0, wsum = 0;
  for (const { habit, weight } of hs) {
    const s = habitScore(data, habit, addDaysKey(ref, -29), ref, ref);
    if (s == null) continue;
    p += weight * s;
    wsum += weight;
  }
  return wsum ? p / wsum : 0;
}

/** Progreso del objetivo al cierre de cada una de las últimas `weeks` semanas */
export function goalProgressHistory(data: Pick<AppData, 'habits' | 'logs' | 'settings'>, goal: Goal, weeks = 8, ref = todayKey()) {
  const out: { weekEnd: DateKey; progress: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = addDaysKey(ref, -7 * i);
    if (end < goal.startDate) continue;
    out.push({ weekEnd: end, progress: goalProgress(data, { ...goal, status: goal.status === 'completed' ? 'active' : goal.status }, end) });
  }
  return out;
}

/* ---------------- Días / periodos ---------------- */

export interface DaySummary {
  date: DateKey;
  scheduled: Habit[];
  full: Habit[];
  minimum: Habit[];
  missed: Habit[];
  pending: Habit[];
  sessions: Session[];
  minutes: number;
  /** 0-1 consistencia ponderada del día (null si no había nada programado) */
  value: number | null;
}

export function daySummary(data: AppData, date: DateKey, ref = todayKey()): DaySummary {
  const ratio = data.settings.minimumRatio;
  const s: DaySummary = { date, scheduled: [], full: [], minimum: [], missed: [], pending: [], sessions: [], minutes: 0, value: null };
  let sum = 0;
  for (const h of data.habits) {
    const l = getLog(data, h.id, date);
    const sch = isScheduled(h, date);
    if (sch) s.scheduled.push(h);
    if (l?.status === 'full') s.full.push(h);
    else if (l?.status === 'minimum') s.minimum.push(h);
    else if (sch && date < ref) s.missed.push(h);
    else if (sch) s.pending.push(h);
    if (sch) sum += logValue(l, ratio);
  }
  s.sessions = data.sessions.filter((x) => x.date === date);
  s.minutes = s.sessions.reduce((a, x) => a + x.durationSec / 60, 0);
  s.value = s.scheduled.length ? Math.min(1, sum / s.scheduled.length) : null;
  return s;
}

/** Consistencia ponderada de un conjunto de hábitos en [from, to] (ignora hoy pendiente) */
export function periodConsistency(data: D & Pick<AppData, 'habits'>, from: DateKey, to: DateKey, habits?: Habit[], ref = todayKey()): number | null {
  let sched = 0, sum = 0;
  for (const h of habits ?? data.habits) {
    for (const d of habitDays(data, h, from, to > ref ? ref : to, ref)) {
      if (!d.scheduled || d.pending) continue;
      sched++;
      sum += d.value;
    }
  }
  return sched ? sum / sched : null;
}

export interface WeekSummary {
  weekStart: DateKey;
  consistency: number | null;
  scheduled: number;
  done: number;
  full: number;
  minimum: number;
  sessions: number;
  minutes: number;
  points: number;
  perHabit: { habit: Habit; score: number | null; done: number; scheduled: number }[];
}

export function weekSummary(data: AppData, weekStart: DateKey, ref = todayKey()): WeekSummary {
  const end = addDaysKey(weekStart, 6);
  const days = rangeKeys(weekStart, end);
  const res: WeekSummary = { weekStart, consistency: periodConsistency(data, weekStart, end, undefined, ref), scheduled: 0, done: 0, full: 0, minimum: 0, sessions: 0, minutes: 0, points: 0, perHabit: [] };
  for (const h of data.habits) {
    let done = 0, sched = 0;
    for (const d of days) {
      const l = getLog(data, h.id, d);
      if (isScheduled(h, d)) sched++;
      if (isDoneLog(l)) done++;
      if (l?.status === 'full') res.full++;
      if (l?.status === 'minimum') res.minimum++;
      // Monedas siempre enteras (registros antiguos podían guardar decimales)
      if (l) res.points += Math.round(l.points || 0);
    }
    res.scheduled += sched;
    res.done += Math.min(done, sched);
    if (sched || done) res.perHabit.push({ habit: h, score: habitScore(data, h, weekStart, end, ref), done, scheduled: sched });
  }
  const ses = data.sessions.filter((s) => s.date >= weekStart && s.date <= end);
  res.sessions = ses.length;
  res.minutes = ses.reduce((a, s) => a + s.durationSec / 60, 0);
  return res;
}

/* ---------------- Niveles ---------------- */
// El saldo de monedas y la XP se calculan en lib/economy.ts (economySummary)

/** Nivel según la XP de por vida (la XP nunca se gasta). Cada nivel pide 75 XP más que el anterior. */
export function levelFromXp(xp: number) {
  let level = 1, need = 150, acc = 0;
  while (xp >= acc + need) { acc += need; level++; need = 150 + (level - 1) * 75; }
  return { level, xpInLevel: xp - acc, xpForNext: need, progress: (xp - acc) / need };
}

/** Minutos registrados (sesiones) de un hábito en [from, to] */
export function habitMinutes(data: Pick<AppData, 'sessions'>, habitId: string, from: DateKey, to: DateKey) {
  return data.sessions.filter((s) => s.habitId === habitId && s.date >= from && s.date <= to).reduce((a, s) => a + s.durationSec / 60, 0);
}

export const pct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);
