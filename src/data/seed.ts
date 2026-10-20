import type {
  AppData, Challenge, EnergyEntry, Experiment, FailReason, Goal, Habit, HabitLog, HabitRelation, Level5, PointEvent,
  Redemption, Reward, Session, Settings, WeeklyReview,
} from '@/types';
import { addDaysKey, fromKey, todayKey, weekdayIndex } from '@/lib/dates';

export const defaultSettings = (): Settings => ({
  userName: '',
  minimumRatio: 0.4,
  maxActiveHabits: 8,
  maxActiveGoals: 3,
  aiPlatform: 'gemini',
  geminiModel: 'gemini-3.5-flash-lite',
  backupModel: 'gemini-3.1-flash',
  soundEnabled: true,
  soundVolume: 0.6,
  askFailReason: true,
  notifications: {
    enabled: true,
    habitReminders: true,
    streakReminder: true,
    streakReminderTime: '20:30',
    coachReminder: true,
    coachReminderTime: '16:30',
    morningReminder: true,
    morningReminderTime: '08:00',
    middayReminder: true,
    middayReminderTime: '13:30',
    nightReminder: true,
    nightReminderTime: '22:00',
  },
});

export function createEmptyData(): AppData {
  return {
    version: 3,
    goals: [], habits: [], logs: {}, sessions: [], activeTimer: null, energy: [], challenges: [], experiments: [],
    relations: [], weeklyReviews: [], checkins: [], habitReviews: [], rewards: [], redemptions: [], pointEvents: [],
    achievements: {}, recommendationFeedback: {}, dismissedInsights: {},
    conversations: [],
    activeConversationId: undefined,
    settings: defaultSettings(),
    hasStreakFreeze: false,
    streakFreezes: [],
  };
}

/** PRNG determinista */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (dateKey: string, h: number, m: number) => {
  const d = fromKey(dateKey);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const clamp5 = (n: number) => Math.max(1, Math.min(5, Math.round(n))) as Level5;

/**
 * Datos de demostración (~9 semanas) con patrones detectables:
 *  - Dormir temprano → más ejercicio al día siguiente.
 *  - Lunes: menos ejercicio.
 *  - C# rinde mejor entre 16-19 h que de noche (y un experimento lo confirma).
 *  - Sesiones largas (Crear proyectos, 90 min) se abandonan más.
 *  - Energía alta → sesiones más largas.
 *  - "Practicar Python" cae fuerte las últimas 2 semanas; "Leer documentación" tiene baja consistencia.
 *  - Razones de falla dominadas por falta de energía / tiempo.
 */
export function createDemoData(): AppData {
  const rnd = mulberry32(20261005);
  const T = todayKey();
  const DAYS = 63;
  const start = addDaysKey(T, -DAYS);
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  const WEEKDAYS = [0, 1, 2, 3, 4];

  const goals: Goal[] = [
    { id: 'g-prog', name: 'Aprender programación', description: 'Ser capaz de construir aplicaciones completas en C# y Python.', category: 'Aprendizaje', icon: '💻', color: '#8b5cf6', startDate: start, targetDate: addDaysKey(T, 40), status: 'active', priority: 3, createdAt: iso(start, 9, 0) },
    { id: 'g-health', name: 'Mejorar mi salud', description: 'Dormir mejor, moverme más y tener más energía durante el día.', category: 'Salud', icon: '💪', color: '#34d399', startDate: start, status: 'active', priority: 3, createdAt: iso(start, 9, 5) },
    { id: 'g-mind', name: 'Bienestar mental', description: 'Reducir el estrés y tener momentos de calma cada día.', category: 'Bienestar', icon: '🧘', color: '#2dd4bf', startDate: start, status: 'active', priority: 2, createdAt: iso(start, 9, 10) },
    { id: 'g-guitar', name: 'Aprender guitarra', description: 'Tocar 5 canciones completas.', category: 'Creatividad', icon: '🎸', color: '#f97316', startDate: start, status: 'paused', priority: 1, createdAt: iso(start, 9, 15) },
  ];

  const H = (h: Partial<Habit> & Pick<Habit, 'id' | 'name' | 'icon' | 'color' | 'days' | 'points' | 'priority' | 'preferredTime' | 'goals'>): Habit => ({ status: 'active', createdAt: start, ...h });
  const habits: Habit[] = [
    H({ id: 'h-csharp', name: 'Estudiar C#', icon: '💻', color: '#8b5cf6', days: WEEKDAYS, points: 25, priority: 3, kind: 'time', targetMinutes: 60, minimumMinutes: 15, preferredTime: 'afternoon', reminderTime: '16:00', goals: [{ goalId: 'g-prog', weight: 40 }] }),
    H({ id: 'h-projects', name: 'Crear proyectos', icon: '🛠️', color: '#f472b6', days: [2, 5, 6], points: 30, priority: 2, kind: 'time', targetMinutes: 90, minimumMinutes: 20, preferredTime: 'afternoon', reminderTime: '17:30', goals: [{ goalId: 'g-prog', weight: 35 }] }),
    H({ id: 'h-python', name: 'Practicar Python', icon: '🐍', color: '#fbbf24', days: [0, 2, 4], points: 15, priority: 2, kind: 'time', targetMinutes: 30, minimumMinutes: 10, preferredTime: 'evening', reminderTime: '19:00', goals: [{ goalId: 'g-prog', weight: 15 }] }),
    H({ id: 'h-docs', name: 'Leer documentación', icon: '📖', color: '#60a5fa', days: [1, 3, 5], points: 10, priority: 1, kind: 'time', targetMinutes: 20, minimumMinutes: 5, preferredTime: 'evening', reminderTime: '20:00', goals: [{ goalId: 'g-prog', weight: 10 }] }),
    H({ id: 'h-exercise', name: 'Hacer ejercicio', icon: '🏃', color: '#34d399', days: [0, 2, 4, 5], points: 20, priority: 3, kind: 'time', targetMinutes: 45, minimumMinutes: 10, preferredTime: 'morning', reminderTime: '07:30', goals: [{ goalId: 'g-health', weight: 45 }] }),
    H({ id: 'h-sleep', name: 'Dormir temprano', icon: '😴', color: '#a78bfa', days: ALL, points: 10, priority: 3, kind: 'action', targetLabel: 'Acostarme antes de las 23:00', minimumLabel: 'Antes de las 00:00', preferredTime: 'evening', reminderTime: '22:30', goals: [{ goalId: 'g-health', weight: 35 }, { goalId: 'g-mind', weight: 20 }] }),
    H({ id: 'h-water', name: 'Tomar 2 L de agua', icon: '💧', color: '#22d3ee', days: ALL, points: 5, priority: 1, kind: 'quantity', targetQuantity: 2000, minimumQuantity: 1000, quantityUnit: 'ml', targetLabel: '2000 ml', minimumLabel: '1000 ml', preferredTime: 'any', reminderTime: '11:00', goals: [{ goalId: 'g-health', weight: 20 }] }),
    H({ id: 'h-meditate', name: 'Meditar', icon: '🧘', color: '#2dd4bf', days: ALL, points: 10, priority: 2, kind: 'time', targetMinutes: 15, minimumMinutes: 5, preferredTime: 'morning', reminderTime: '08:00', goals: [{ goalId: 'g-mind', weight: 45 }] }),
    H({ id: 'h-read', name: 'Leer 20 minutos', icon: '📚', color: '#fb7185', days: ALL, points: 10, priority: 2, kind: 'time', targetMinutes: 20, minimumMinutes: 5, preferredTime: 'evening', reminderTime: '21:00', goals: [{ goalId: 'g-mind', weight: 35 }] }),
    H({ id: 'h-guitar', name: 'Practicar guitarra', icon: '🎸', color: '#f97316', days: [1, 3, 6], points: 15, priority: 1, kind: 'time', targetMinutes: 30, minimumMinutes: 10, preferredTime: 'evening', reminderTime: '18:30', goals: [{ goalId: 'g-guitar', weight: 100 }], status: 'paused', pausedAt: addDaysKey(T, -20), pausedIntervals: [{ start: addDaysKey(T, -20) }] }),
  ];

  const expStart = addDaysKey(T, -35);
  const exp2Start = addDaysKey(T, -6);
  const experiments: Experiment[] = [
    {
      id: 'x-schedule', name: 'Encontrar mi mejor horario para estudiar C#', hypothesis: 'Estudiar por la tarde me permite sesiones más largas y con menos esfuerzo que de noche.',
      type: 'schedule', habitId: 'h-csharp', startDate: expStart, durationDays: 14,
      variants: [{ id: 'v-4pm', label: '4:00 PM', startDay: 1, endDay: 7 }, { id: 'v-8pm', label: '8:00 PM', startDay: 8, endDay: 14 }],
      status: 'finished', winnerVariantId: 'v-4pm', conclusion: 'El horario de 4 PM funcionó mejor: más sesiones completas, más duración y menos dificultad.', createdAt: iso(expStart, 8, 0),
    },
    {
      id: 'x-pomodoro', name: 'Pomodoro vs. bloque continuo en proyectos', hypothesis: 'Trabajar en bloques de 25/5 reduce el abandono de las sesiones largas.',
      type: 'method', habitId: 'h-projects', startDate: exp2Start, durationDays: 14,
      variants: [{ id: 'v-pomo', label: 'Pomodoro 25/5', startDay: 1, endDay: 7 }, { id: 'v-block', label: 'Bloque continuo', startDay: 8, endDay: 14 }],
      status: 'running', createdAt: iso(exp2Start, 8, 0),
    },
  ];

  const logs: Record<string, HabitLog> = {};
  const sessions: Session[] = [];
  const energy: EnergyEntry[] = [];
  let sid = 0;

  const reasonsDefault: [FailReason, number][] = [['no_energy', 40], ['no_time', 28], ['distracted', 18], ['forgot', 9], ['other', 5]];
  const reasonsExercise: [FailReason, number][] = [['no_time', 50], ['no_energy', 30], ['distracted', 10], ['forgot', 10]];
  const pick = (list: [FailReason, number][]): FailReason => {
    const total = list.reduce((a, [, w]) => a + w, 0);
    let r = rnd() * total;
    for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
    return list[0][0];
  };

  let sleptEarlyPrev = rnd() < 0.6;
  for (let i = DAYS; i >= 1; i--) {
    const d = addDaysKey(T, -i);
    const wd = weekdayIndex(d);
    const en = clamp5(2.5 + (sleptEarlyPrev ? 1 : 0) + rnd() * 1.6 - (wd === 0 ? 0.6 : 0));
    energy.push({ id: `e-${i}`, date: d, at: iso(d, 8, Math.floor(rnd() * 50)), level: en });
    let sleptEarly = false;

    for (const h of habits) {
      if (!h.days.includes(wd)) continue;
      if (h.pausedAt && d >= h.pausedAt) continue;

      let p = ({ 'h-csharp': 0.86, 'h-projects': 0.62, 'h-python': 0.78, 'h-docs': 0.35, 'h-sleep': 0.66, 'h-water': 0.82, 'h-meditate': 0.72, 'h-read': 0.7, 'h-guitar': 0.5 } as Record<string, number>)[h.id] ?? 0.6;
      if (h.id === 'h-exercise') p = sleptEarlyPrev ? 0.88 : 0.38;
      if (h.id === 'h-exercise' && wd === 0) p *= 0.5;
      if (h.id === 'h-python' && i <= 14) p = 0.18;
      if (h.id === 'h-meditate' && wd >= 5) p *= 0.7;
      if (en <= 2) p *= 0.8;

      // Hora de la sesión
      let hour = h.preferredTime === 'morning' ? 7 + Math.floor(rnd() * 2) : h.preferredTime === 'afternoon' ? 16 + Math.floor(rnd() * 3) : 20 + Math.floor(rnd() * 2);
      let expId: string | undefined, varId: string | undefined;
      if (h.id === 'h-csharp') {
        hour = rnd() < 0.6 ? 16 + Math.floor(rnd() * 3) : 20 + Math.floor(rnd() * 2);
        const dayN = Math.round((fromKey(d).getTime() - fromKey(expStart).getTime()) / 864e5) + 1;
        if (dayN >= 1 && dayN <= 14) { expId = 'x-schedule'; varId = dayN <= 7 ? 'v-4pm' : 'v-8pm'; hour = dayN <= 7 ? 16 : 20; }
        if (hour >= 20) p *= 0.72;
      }
      if (h.id === 'h-projects') {
        const dayN = Math.round((fromKey(d).getTime() - fromKey(exp2Start).getTime()) / 864e5) + 1;
        if (dayN >= 1 && dayN <= 14) { expId = 'x-pomodoro'; varId = dayN <= 7 ? 'v-pomo' : 'v-block'; }
      }

      const r = rnd();
      if (r < p) {
        const minimum = (en <= 2 && rnd() < 0.5) || rnd() < 0.1 || (h.id === 'h-csharp' && hour >= 20 && rnd() < 0.35);
        const status = minimum ? 'minimum' : 'full';
        let minutes: number | undefined;
        if (h.targetMinutes) {
          const target = h.targetMinutes;
          const energyFactor = 0.75 + en * 0.08;
          const dur = minimum ? (h.minimumMinutes ?? 10) * (1 + rnd()) : target * Math.max(0.9, energyFactor * (0.95 + rnd() * 0.2));
          minutes = Math.round(dur);
          const startMin = Math.floor(rnd() * 40);
          const startedAt = iso(d, hour, startMin);
          const night = hour >= 20;
          sessions.push({
            id: `s-${++sid}`, habitId: h.id, date: d, startedAt, endedAt: new Date(new Date(startedAt).getTime() + dur * 60000).toISOString(),
            durationSec: Math.round(dur * 60), targetSec: target * 60, status: minimum ? 'minimum' : 'completed',
            energy: en, mood: clamp5(en + (night ? -1 : 0.5) + (rnd() - 0.5)), difficulty: clamp5(2 + (night ? 1.3 : 0) + (en <= 2 ? 1 : 0) + (target >= 90 ? 0.8 : 0) + (rnd() - 0.5)),
            experimentId: expId, variantId: varId,
          });
        }
        logs[`${d}|${h.id}`] = { habitId: h.id, date: d, status, points: status === 'full' ? h.points : Math.max(1, Math.round(h.points * 0.4)), minutes, loggedAt: iso(d, Math.min(23, hour + 1), 0) };
        if (h.id === 'h-sleep' && status === 'full') sleptEarly = true;
      } else {
        // Sesiones abandonadas (más en las largas y de noche)
        if (h.targetMinutes && ((h.targetMinutes >= 90 && rnd() < 0.45) || (h.id === 'h-csharp' && hour >= 20 && rnd() < 0.4))) {
          const dur = h.targetMinutes * (0.15 + rnd() * 0.25);
          const startedAt = iso(d, hour, Math.floor(rnd() * 30));
          sessions.push({
            id: `s-${++sid}`, habitId: h.id, date: d, startedAt, endedAt: new Date(new Date(startedAt).getTime() + dur * 60000).toISOString(),
            durationSec: Math.round(dur * 60), targetSec: h.targetMinutes * 60, status: 'abandoned', energy: en,
            mood: clamp5(en - 1.5), difficulty: clamp5(4 + rnd()), experimentId: expId, variantId: varId,
          });
        }
        if (rnd() < 0.68) {
          logs[`${d}|${h.id}`] = {
            habitId: h.id, date: d, status: 'missed', points: 0,
            failReason: h.id === 'h-exercise' ? pick(reasonsExercise) : h.id === 'h-python' && i <= 14 ? (rnd() < 0.6 ? 'not_interested' : 'no_time') : pick(reasonsDefault),
            loggedAt: iso(d, 22, 30),
          };
        }
      }
    }
    sleptEarlyPrev = sleptEarly;
  }

  // Retos
  const chStart = addDaysKey(T, -19);
  const ch2Start = addDaysKey(T, -61);
  const challenges: Challenge[] = [
    {
      id: 'c-early', name: 'Levantarme temprano', icon: '🌅', description: 'Levantarme antes de las 7:00 durante 30 días.', metric: 'Días levantándome antes de las 7:00',
      startDate: chStart, durationDays: 30, successDays: 25, conditions: 'Despertar y salir de la cama antes de las 7:00.', rewardPoints: 300, rewardText: 'Desayuno especial fuera',
      checkins: Array.from({ length: 19 }, (_, k) => addDaysKey(chStart, k)).filter((_, k) => ![4, 11, 15].includes(k)), status: 'active', createdAt: iso(chStart, 7, 0),
    },
    {
      id: 'c-noscreens', name: 'Sin redes antes de dormir', icon: '📵', description: 'Nada de redes sociales la última hora antes de dormir.', metric: 'Noches sin redes',
      startDate: ch2Start, durationDays: 21, successDays: 18, rewardPoints: 150, rewardText: 'Comprar un libro',
      checkins: Array.from({ length: 21 }, (_, k) => addDaysKey(ch2Start, k)).filter((_, k) => ![3, 9].includes(k)), status: 'completed', finishedAt: iso(addDaysKey(ch2Start, 21), 9, 0), createdAt: iso(ch2Start, 7, 0),
    },
  ];

  const pointEvents: PointEvent[] = [
    { id: 'pe-1', at: iso(addDaysKey(ch2Start, 21), 9, 0), amount: 150, reason: 'Reto completado: Sin redes antes de dormir', source: 'challenge', refId: 'c-noscreens' },
  ];

  const relations: HabitRelation[] = [
    { id: 'r-1', fromId: 'h-sleep', toId: 'h-exercise', type: 'facilitates', note: 'Si duermo temprano tengo energía para entrenar en la mañana.' },
    { id: 'r-2', fromId: 'h-meditate', toId: 'h-csharp', type: 'before' },
    { id: 'r-3', fromId: 'h-csharp', toId: 'h-projects', type: 'facilitates' },
    { id: 'r-4', fromId: 'h-docs', toId: 'h-csharp', type: 'facilitates' },
    { id: 'r-5', fromId: 'h-exercise', toId: 'h-csharp', type: 'before' },
  ];

  const rewards: Reward[] = [
    { id: 'rw-game', name: 'Jugar 2 horas', icon: '🎮', cost: 300 },
    { id: 'rw-movie', name: 'Noche de película', icon: '🎬', cost: 250 },
    { id: 'rw-coffee', name: 'Café especial', icon: '☕', cost: 120 },
    { id: 'rw-food', name: 'Pedir mi comida favorita', icon: '🍕', cost: 500 },
    { id: 'rw-buy', name: 'Comprarme algo que me guste', icon: '🛍️', cost: 1500 },
    { id: 'rw-free', name: 'Día libre sin culpa', icon: '🏖️', cost: 2500 },
  ];
  const redeem = (id: string, ago: number): Redemption => {
    const r = rewards.find((x) => x.id === id)!;
    return { id: `rd-${id}-${ago}`, rewardId: r.id, name: r.name, icon: r.icon, cost: r.cost, date: iso(addDaysKey(T, -ago), 20, 0) };
  };
  const redemptions: Redemption[] = [
    redeem('rw-game', 3),
    redeem('rw-coffee', 8),
    redeem('rw-movie', 16),
    redeem('rw-food', 28),
    redeem('rw-coffee', 42),
  ];

  const lastWeek = addDaysKey(T, -7 - weekdayIndex(T));
  const weeklyReviews: WeeklyReview[] = [
    { id: 'wr-1', weekStart: addDaysKey(lastWeek, -7), createdAt: iso(addDaysKey(lastWeek, -1), 19, 0), changes: 'Mover C# a la tarde, de noche me cuesta mucho.', consistency: 0.71 },
    { id: 'wr-2', weekStart: lastWeek, createdAt: iso(addDaysKey(lastWeek, 6), 19, 0), changes: 'Usar la versión mínima de ejercicio cuando no duerma bien.', consistency: 0.68 },
  ];

  return {
    ...createEmptyData(),
    goals, habits, logs, sessions, energy, challenges, experiments, relations, weeklyReviews, rewards, redemptions, pointEvents,
    settings: { ...defaultSettings(), userName: '', lastHabitReviewAt: addDaysKey(T, -40) },
  };
}
