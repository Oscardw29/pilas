import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type {
  AbandonmentCheckin, AiConversation, AppData, Challenge, DateKey, EnergyEntry, Experiment, FailReason, Goal, Habit,
  HabitRelation, HabitReviewEntry, ID, Level5, LogStatus, PointEvent, RecommendationFeedback, Reward, Secrets, Session,
  SessionStatus, Settings, WeeklyReview,
} from '@/types';
import { doneCountByDate, getDayStreakStatus, logKey, pointsFor, pointsSummary, previousCountedDay } from '@/lib/metrics';
import { todayKey, toKey } from '@/lib/dates';
import { createDemoData, createEmptyData, defaultSettings } from '@/data/seed';
import { LEGACY_SECRET_FIELDS, useSecrets } from '@/store/useSecrets';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const nowISO = () => new Date().toISOString();

export interface FinishTimerInput {
  mood?: Level5;
  difficulty?: Level5;
  note?: string;
  /** Si se omite se deduce de la duración vs objetivo/mínimo */
  status?: SessionStatus;
  experimentId?: ID;
  variantId?: ID;
}

export interface Actions {
  /* Objetivos */
  addGoal: (g: Omit<Goal, 'id' | 'createdAt'>) => Goal;
  updateGoal: (id: ID, patch: Partial<Goal>) => void;
  deleteGoal: (id: ID) => void;

  /* Hábitos */
  addHabit: (h: Omit<Habit, 'id' | 'createdAt'> & { createdAt?: DateKey }) => Habit;
  updateHabit: (id: ID, patch: Partial<Habit>) => void;
  /** Pausa (status paused + pausedAt hoy) o reactiva */
  setHabitStatus: (id: ID, status: Habit['status']) => void;
  /** Elimina el hábito y sus relaciones. Los puntos ya ganados se conservan. */
  deleteHabit: (id: ID) => void;

  /* Registro diario */
  logHabit: (habitId: ID, date: DateKey, status: LogStatus, extra?: { failReason?: FailReason; failNote?: string; minutes?: number; quantity?: number }) => void;
  clearLog: (habitId: ID, date: DateKey) => void;

  /* Temporizador / sesiones */
  isTimerModalOpen: boolean;
  setTimerModalOpen: (open: boolean) => void;
  startTimer: (habitId: ID, energy?: Level5) => void;
  startCustomTimer: (params: { title: string; description?: string; icon: string; minutes: number }) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  cancelTimer: () => void;
  /** Termina, crea la sesión y registra el hábito del día (sin degradar un 'full' existente) */
  finishTimer: (input?: FinishTimerInput) => Session | null;
  addSession: (s: Omit<Session, 'id'>) => Session;
  updateSession: (id: ID, patch: Partial<Session>) => void;
  deleteSession: (id: ID) => void;

  /* Energía */
  addEnergy: (level: Level5, note?: string) => EnergyEntry;

  /* Retos */
  addChallenge: (c: Omit<Challenge, 'id' | 'createdAt' | 'checkins' | 'status'>) => Challenge;
  updateChallenge: (id: ID, patch: Partial<Challenge>) => void;
  deleteChallenge: (id: ID) => void;
  toggleChallengeCheckin: (id: ID, date: DateKey) => void;

  /* Experimentos */
  addExperiment: (e: Omit<Experiment, 'id' | 'createdAt'>) => Experiment;
  updateExperiment: (id: ID, patch: Partial<Experiment>) => void;
  deleteExperiment: (id: ID) => void;

  /* Dependencias */
  addRelation: (r: Omit<HabitRelation, 'id'>) => HabitRelation;
  deleteRelation: (id: ID) => void;

  /* Revisiones / check-ins */
  saveWeeklyReview: (r: Omit<WeeklyReview, 'id' | 'createdAt'>) => void;
  addCheckin: (c: Omit<AbandonmentCheckin, 'id' | 'at'>) => void;
  addHabitReview: (r: Omit<HabitReviewEntry, 'id' | 'at'>) => void;

  /* Gamificación */
  addReward: (r: Omit<Reward, 'id'>) => Reward;
  updateReward: (id: ID, patch: Partial<Reward>) => void;
  deleteReward: (id: ID) => void;
  /** false si no alcanza el saldo */
  redeem: (rewardId: ID) => boolean;
  /** Comprar protector de racha permanente (150 pts) */
  buyStreakFreeze: (cost?: number) => boolean;
  /**
   * Consume automáticamente el protector si el último día que contaba rompió la racha y el anterior la tenía.
   * Devuelve la fecha protegida o null si no hizo falta.
   */
  applyStreakFreeze: (ref?: DateKey) => DateKey | null;
  addPointEvent: (e: Omit<PointEvent, 'id' | 'at'>) => void;
  unlockAchievement: (id: string) => void;

  /* Insights / recomendaciones */
  setRecommendationFeedback: (id: string, status: RecommendationFeedback['status']) => void;
  dismissInsight: (id: string) => void;

  /* IA */
  createConversation: (title: string) => string;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string) => void;
  setConversationMessages: (id: string, messages: any[]) => void;

  /* Ajustes / datos */
  updateSettings: (patch: Partial<Settings>) => void;
  resetDemo: () => void;
  resetEmpty: () => void;
  /** Reemplaza todo con datos importados (ya validados) */
  importData: (d: AppData) => void;
}

export type Store = AppData & Actions;

const DATA_KEYS: (keyof AppData)[] = [
  'version', 'goals', 'habits', 'logs', 'sessions', 'activeTimer', 'energy', 'challenges', 'experiments', 'relations',
  'weeklyReviews', 'checkins', 'habitReviews', 'rewards', 'redemptions', 'pointEvents', 'achievements',
  'recommendationFeedback', 'dismissedInsights', 'conversations', 'activeConversationId', 'settings', 'hasStreakFreeze', 'streakFreezes',
];

const STORE_VERSION = 3;

/** true si en este navegador aún no había datos guardados (primer uso): se muestra la bienvenida */
export const isFirstRun = (() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('constancia-v2') === null;
  } catch {
    return false;
  }
})();

/** Minutos que valen como versión mínima de un hábito de tiempo */
export function minimumMinutesFor(h: Habit, minimumRatio: number): number {
  const target = h.targetMinutes || 25;
  return h.minimumMinutes && h.minimumMinutes > 0 ? h.minimumMinutes : Math.max(1, Math.round(target * minimumRatio));
}

/** Ajustes del dispositivo que sobreviven a reinicios e importaciones */
function preservedSettings(st: Settings): Partial<Settings> {
  return {
    geminiModel: st.geminiModel,
    backupModel: st.backupModel,
    aiPlatform: st.aiPlatform,
    soundEnabled: st.soundEnabled,
    soundVolume: st.soundVolume,
  };
}

/** Claves de `base` que `override` no define (o deja vacías) */
function pickMissing<T extends object>(base: Partial<T>, override: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(base) as (keyof T)[]) {
    if (override[k] === undefined || (override[k] as unknown) === '') out[k] = base[k];
  }
  return out;
}

/** Ajustes del asistente de voz, ya retirado */
const REMOVED_SETTINGS = ['ttsPlatform', 'ttsModel', 'ttsVoiceId'];

/** Quita cualquier clave de API (y ajustes retirados) que venga dentro de settings (versiones antiguas o respaldos) */
function stripSecrets(st: Partial<Settings>): Partial<Settings> {
  const out: Record<string, unknown> = { ...st };
  for (const k of [...LEGACY_SECRET_FIELDS, ...REMOVED_SETTINGS]) delete out[k];
  return out as Partial<Settings>;
}

/** Ajustes completos: valores por defecto + guardados (incluye el objeto anidado de notificaciones) */
function mergeSettings(st?: Partial<Settings>): Settings {
  const def = defaultSettings();
  const clean = stripSecrets(st ?? {});
  return { ...def, ...clean, notifications: { ...def.notifications!, ...(clean.notifications ?? {}) } };
}

/**
 * Migraciones del estado persistido o importado. Nunca reemplaza los datos del usuario por la demo.
 * `adoptSecrets`: mover claves antiguas al almacén de secretos (solo para el estado local, no para importaciones).
 */
function migrateData(state: any, version: number, adoptSecrets: boolean): any {
  if (!state || typeof state !== 'object') return createEmptyData();

  if (Array.isArray(state.habits)) {
    state.habits = state.habits.map((h: any) => {
      let habit = h;
      if (!habit.kind) {
        if (habit.name?.toLowerCase().includes('agua') || habit.targetQuantity) {
          habit = { ...habit, kind: 'quantity', targetQuantity: habit.targetQuantity ?? 2000, quantityUnit: habit.quantityUnit ?? 'ml' };
        } else if (habit.name?.toLowerCase().includes('dormir') || (!habit.targetMinutes && !habit.targetQuantity)) {
          habit = { ...habit, kind: 'action' };
        } else {
          habit = { ...habit, kind: 'time' };
        }
      }
      // Pausas antiguas guardadas solo con pausedAt → intervalo abierto
      if (habit.status === 'paused' && habit.pausedAt && !(habit.pausedIntervals ?? []).some((iv: any) => !iv.end)) {
        habit = { ...habit, pausedIntervals: [...(habit.pausedIntervals ?? []), { start: habit.pausedAt }] };
      }
      return habit;
    });
  }
  if (state.hasStreakFreeze === undefined) state.hasStreakFreeze = false;
  if (!Array.isArray(state.streakFreezes)) state.streakFreezes = [];

  if (!Array.isArray(state.conversations) || state.conversations.length === 0) {
    state.conversations = [
      {
        id: 'conv-main',
        title: 'Conversación principal',
        createdAt: nowISO(),
        updatedAt: nowISO(),
        messages: Array.isArray(state.aiMessages) ? state.aiMessages : [],
      },
    ];
    state.activeConversationId = 'conv-main';
  }
  if (!state.activeConversationId || !state.conversations.some((c: any) => c.id === state.activeConversationId)) {
    state.activeConversationId = state.conversations[0].id;
  }
  delete state.aiMessages;

  if (state.settings && typeof state.settings === 'object') {
    // v3: las claves de API salen de settings y pasan al almacén de secretos
    if (adoptSecrets && version < 3) {
      const legacy: Record<string, string> = {};
      for (const k of LEGACY_SECRET_FIELDS) {
        if (typeof state.settings[k] === 'string') legacy[k] = state.settings[k];
      }
      useSecrets.getState().importLegacy(legacy);
    }
    state.settings = stripSecrets(state.settings);
    if (!state.settings.geminiModel || state.settings.geminiModel === 'gemini-3.8-flash') {
      state.settings.geminiModel = 'gemini-3.5-flash-lite';
    }
  }
  state.version = STORE_VERSION;
  return state;
}

let storageErrorNotified = false;
/** localStorage que no rompe las acciones del store si se llena la cuota o no está disponible */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      console.error('[Store] No se pudo guardar el estado:', err);
      if (!storageErrorNotified && typeof window !== 'undefined') {
        storageErrorNotified = true;
        window.dispatchEvent(new CustomEvent('constancia:storage-error'));
      }
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* noop */
    }
  },
};

/** Extrae solo los datos (sin acciones) del store */
export function selectData(s: Store): AppData {
  const out: Partial<AppData> = {};
  for (const k of DATA_KEYS) (out as Record<string, unknown>)[k] = s[k];
  return out as AppData;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...createDemoData(),

      /* Objetivos */
      addGoal: (g) => {
        const goal: Goal = { ...g, id: uid(), createdAt: nowISO() };
        set((s) => ({ goals: [...s.goals, goal] }));
        return goal;
      },
      updateGoal: (id, patch) =>
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === id ? { ...g, ...patch, completedAt: patch.status === 'completed' && g.status !== 'completed' ? nowISO() : patch.status && patch.status !== 'completed' ? undefined : g.completedAt } : g),
        })),
      deleteGoal: (id) =>
        set((s) => ({
          goals: s.goals.filter((g) => g.id !== id),
          habits: s.habits.map((h) => ({ ...h, goals: h.goals.filter((l) => l.goalId !== id) })),
        })),

      /* Hábitos */
      addHabit: (h) => {
        const habit: Habit = { ...h, id: uid(), createdAt: h.createdAt ?? todayKey() };
        set((s) => ({ habits: [...s.habits, habit] }));
        return habit;
      },
      updateHabit: (id, patch) => set((s) => ({ habits: s.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)) })),
      setHabitStatus: (id, status) =>
        set((s) => {
          const today = todayKey();
          const nextLogs = { ...s.logs };
          // Al reactivar solo se limpia un "no realizado" de hoy; los avances y completados se conservan
          if (status === 'active' && nextLogs[logKey(today, id)]?.status === 'missed') {
            delete nextLogs[logKey(today, id)];
          }
          return {
            logs: nextLogs,
            habits: s.habits.map((h) => {
              if (h.id !== id) return h;
              const intervals = (h.pausedIntervals ?? []).map((iv) => ({ ...iv }));
              const last = intervals[intervals.length - 1];
              if (status === 'paused') {
                if (!last || last.end) intervals.push({ start: today });
                return { ...h, status, pausedAt: h.pausedAt ?? today, pausedIntervals: intervals, archivedAt: undefined };
              }
              if (status === 'archived') {
                return { ...h, status, archivedAt: today };
              }
              // Reactivar: cerrar la pausa abierta (o la heredada que solo tenía pausedAt)
              if (last && !last.end) {
                intervals[intervals.length - 1] = { ...last, end: today };
              } else if (h.status === 'paused' && h.pausedAt) {
                intervals.push({ start: h.pausedAt, end: today });
              }
              return { ...h, status, pausedAt: undefined, pausedIntervals: intervals, archivedAt: undefined };
            }),
          };
        }),
      deleteHabit: (id) =>
        set((s) => ({
          habits: s.habits.filter((h) => h.id !== id),
          relations: s.relations.filter((r) => r.fromId !== id && r.toId !== id),
          activeTimer: s.activeTimer?.habitId === id ? null : s.activeTimer,
        })),

      /* Registro diario */
      logHabit: (habitId, date, status, extra) => {
        const s = get();
        const h = s.habits.find((x) => x.id === habitId);
        if (!h) return;
        const prev = s.logs[logKey(date, habitId)];
        set({
          logs: {
            ...s.logs,
            [logKey(date, habitId)]: {
              habitId, date, status,
              points: pointsFor(h, status, s.settings.minimumRatio),
              failReason: status === 'missed' ? extra?.failReason : undefined,
              failNote: status === 'missed' ? extra?.failNote : undefined,
              minutes: extra?.minutes !== undefined ? extra.minutes : prev?.minutes,
              quantity: extra?.quantity !== undefined ? extra.quantity : prev?.quantity,
              loggedAt: nowISO(),
            },
          },
        });
      },
      clearLog: (habitId, date) =>
        set((s) => {
          const logs = { ...s.logs };
          delete logs[logKey(date, habitId)];
          return { logs };
        }),

      /* Temporizador */
      isTimerModalOpen: false,
      setTimerModalOpen: (open) => set({ isTimerModalOpen: open }),
      startTimer: (habitId, energy) => set({ activeTimer: { habitId, startedAt: nowISO(), pausedMs: 0, energy }, isTimerModalOpen: true }),
      startCustomTimer: (params) =>
        set({
          activeTimer: {
            startedAt: nowISO(),
            pausedMs: 0,
            isCustom: true,
            customTitle: params.title,
            customDescription: params.description,
            customIcon: params.icon,
            customMinutes: params.minutes,
          },
          isTimerModalOpen: true,
        }),
      pauseTimer: () => set((s) => (s.activeTimer && !s.activeTimer.pausedAt ? { activeTimer: { ...s.activeTimer, pausedAt: nowISO() } } : {})),
      resumeTimer: () =>
        set((s) => {
          const t = s.activeTimer;
          if (!t?.pausedAt) return {};
          return { activeTimer: { ...t, pausedMs: t.pausedMs + (Date.now() - new Date(t.pausedAt).getTime()), pausedAt: undefined } };
        }),
      cancelTimer: () => set({ activeTimer: null, isTimerModalOpen: false }),
      finishTimer: (input = {}) => {
        const s = get();
        const t = s.activeTimer;
        if (!t) return null;

        // Si es un temporizador de un solo uso o no tiene habitId, finaliza sin crear hábitos ni alterar la app
        if (t.isCustom || !t.habitId) {
          set({ activeTimer: null, isTimerModalOpen: false });
          return null;
        }

        const habitId = t.habitId;
        const h = s.habits.find((x) => x.id === habitId);
        const end = Date.now();
        const pausedNow = t.pausedAt ? end - new Date(t.pausedAt).getTime() : 0;
        const durationSec = Math.max(0, Math.round((end - new Date(t.startedAt).getTime() - t.pausedMs - pausedNow) / 1000));
        const targetSec = h?.targetMinutes ? h.targetMinutes * 60 : undefined;
        const minSec = h ? minimumMinutesFor(h, s.settings.minimumRatio) * 60 : undefined;
        let status: SessionStatus = input.status ?? 'completed';
        if (!input.status && targetSec) {
          if (durationSec >= targetSec * 0.9) status = 'completed';
          else if (minSec && durationSec >= minSec) status = 'minimum';
          else status = 'abandoned';
        }
        const date = toKey(new Date(t.startedAt));
        const session: Session = {
          id: uid(), habitId, date, startedAt: t.startedAt, endedAt: new Date(end).toISOString(),
          durationSec, targetSec, status, energy: t.energy, mood: input.mood, difficulty: input.difficulty, note: input.note,
          experimentId: input.experimentId, variantId: input.variantId,
        };
        set({ sessions: [...s.sessions, session], activeTimer: null, isTimerModalOpen: false });
        if (h) {
          const prev = s.logs[logKey(date, h.id)];
          const totalDayMin = Math.round(((prev?.minutes || 0) * 60 + durationSec) / 60);
          const targetMin = h.targetMinutes || 25;
          const minMin = minimumMinutesFor(h, s.settings.minimumRatio);
          // El crédito depende del tiempo real acumulado en el día, nunca de la etiqueta de la sesión:
          // por debajo del mínimo solo se guarda el avance (sin puntos ni racha) y nunca se degrada un registro previo.
          let logStatus: LogStatus = totalDayMin >= targetMin ? 'full' : totalDayMin >= minMin ? 'minimum' : 'partial';
          if (prev?.status === 'full' || (prev?.status === 'minimum' && logStatus === 'partial')) logStatus = prev.status;
          if (totalDayMin > 0 || prev) get().logHabit(h.id, date, logStatus, { minutes: totalDayMin });
        }
        return session;
      },
      addSession: (x) => {
        const session = { ...x, id: uid() };
        set((s) => ({ sessions: [...s.sessions, session] }));
        return session;
      },
      updateSession: (id, patch) => set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),

      /* Energía */
      addEnergy: (level, note) => {
        const e: EnergyEntry = { id: uid(), date: todayKey(), at: nowISO(), level, note };
        set((s) => ({ energy: [...s.energy, e] }));
        return e;
      },

      /* Retos */
      addChallenge: (c) => {
        const ch: Challenge = { ...c, id: uid(), createdAt: nowISO(), checkins: [], status: 'active' };
        set((s) => ({ challenges: [...s.challenges, ch] }));
        return ch;
      },
      updateChallenge: (id, patch) => set((s) => ({ challenges: s.challenges.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      deleteChallenge: (id) => set((s) => ({ challenges: s.challenges.filter((c) => c.id !== id) })),
      toggleChallengeCheckin: (id, date) =>
        set((s) => ({
          challenges: s.challenges.map((c) =>
            c.id !== id ? c : { ...c, checkins: c.checkins.includes(date) ? c.checkins.filter((d) => d !== date) : [...c.checkins, date].sort() }),
        })),

      /* Experimentos */
      addExperiment: (e) => {
        const ex: Experiment = { ...e, id: uid(), createdAt: nowISO() };
        set((s) => ({ experiments: [...s.experiments, ex] }));
        return ex;
      },
      updateExperiment: (id, patch) => set((s) => ({ experiments: s.experiments.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      deleteExperiment: (id) => set((s) => ({ experiments: s.experiments.filter((e) => e.id !== id) })),

      /* Dependencias */
      addRelation: (r) => {
        const rel = { ...r, id: uid() };
        set((s) => ({ relations: [...s.relations, rel] }));
        return rel;
      },
      deleteRelation: (id) => set((s) => ({ relations: s.relations.filter((r) => r.id !== id) })),

      /* Revisiones */
      saveWeeklyReview: (r) =>
        set((s) => ({
          weeklyReviews: [...s.weeklyReviews.filter((w) => w.weekStart !== r.weekStart), { ...r, id: uid(), createdAt: nowISO() }],
        })),
      addCheckin: (c) => set((s) => ({ checkins: [...s.checkins, { ...c, id: uid(), at: nowISO() }] })),
      addHabitReview: (r) => set((s) => ({ habitReviews: [...s.habitReviews, { ...r, id: uid(), at: nowISO() }] })),

      /* Gamificación */
      addReward: (r) => {
        const rw = { ...r, id: uid() };
        set((s) => ({ rewards: [...s.rewards, rw] }));
        return rw;
      },
      updateReward: (id, patch) => set((s) => ({ rewards: s.rewards.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      deleteReward: (id) => set((s) => ({ rewards: s.rewards.filter((r) => r.id !== id) })),
      redeem: (rewardId) => {
        const s = get();
        const r = s.rewards.find((x) => x.id === rewardId);
        if (!r || pointsSummary(s).balance < r.cost) return false;
        set({ redemptions: [{ id: uid(), rewardId, name: r.name, icon: r.icon, cost: r.cost, date: nowISO() }, ...s.redemptions] });
        return true;
      },
      buyStreakFreeze: (cost = 150) => {
        const s = get();
        if (s.hasStreakFreeze) return false;
        if (pointsSummary(s).balance < cost) return false;
        set({
          hasStreakFreeze: true,
          redemptions: [
            {
              id: uid(),
              rewardId: 'rw-streak-freeze',
              name: 'Protector de racha (1 día)',
              icon: '❄️',
              cost,
              date: nowISO(),
            },
            ...s.redemptions,
          ],
        });
        return true;
      },
      applyStreakFreeze: (ref = todayKey()) => {
        const s = get();
        if (!s.hasStreakFreeze) return null;
        const doneIdx = doneCountByDate(s.logs);
        // Último día que contaba antes de hoy (se saltan los días sin nada programado)
        const broken = previousCountedDay(s, ref, doneIdx);
        if (!broken || getDayStreakStatus(s, broken, doneIdx).hasStreak) return null;
        // Solo protege un día suelto: el día anterior que contaba debe tener racha
        const before = previousCountedDay(s, broken, doneIdx);
        if (!before || !getDayStreakStatus(s, before, doneIdx).hasStreak) return null;
        set({
          hasStreakFreeze: false,
          streakFreezes: [...(s.streakFreezes || []).filter((d) => d !== broken), broken],
        });
        return broken;
      },
      addPointEvent: (e) => set((s) => ({ pointEvents: [...s.pointEvents, { ...e, id: uid(), at: nowISO() }] })),
      unlockAchievement: (id) => set((s) => (s.achievements[id] ? {} : { achievements: { ...s.achievements, [id]: nowISO() } })),

      /* Insights */
      setRecommendationFeedback: (id, status) =>
        set((s) => ({ recommendationFeedback: { ...s.recommendationFeedback, [id]: { status, at: nowISO() } } })),
      dismissInsight: (id) => set((s) => ({ dismissedInsights: { ...s.dismissedInsights, [id]: nowISO() } })),

      /* IA */
      createConversation: (title) => {
        const id = uid();
        const newConv: AiConversation = {
          id,
          title: title.trim() || 'Nueva conversación',
          createdAt: nowISO(),
          updatedAt: nowISO(),
          messages: [],
        };
        set((s) => ({
          conversations: [newConv, ...(s.conversations || [])],
          activeConversationId: id,
        }));
        return id;
      },
      renameConversation: (id, title) =>
        set((s) => ({
          conversations: (s.conversations || []).map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title, updatedAt: nowISO() } : c
          ),
        })),
      deleteConversation: (id) => {
        const s = get();
        const remaining = (s.conversations || []).filter((c) => c.id !== id);
        let nextActive = s.activeConversationId;
        if (s.activeConversationId === id) {
          if (remaining.length > 0) {
            nextActive = remaining[0].id;
          } else {
            const fresh: AiConversation = {
              id: uid(),
              title: 'Conversación principal',
              createdAt: nowISO(),
              updatedAt: nowISO(),
              messages: [],
            };
            remaining.push(fresh);
            nextActive = fresh.id;
          }
        }
        set({
          conversations: remaining,
          activeConversationId: nextActive,
        });
      },
      setActiveConversation: (id) => {
        const s = get();
        const conv = (s.conversations || []).find((c) => c.id === id);
        if (conv) set({ activeConversationId: id });
      },
      setConversationMessages: (id, messages) =>
        set((s) => {
          const convs = (s.conversations || []).map((c) =>
            c.id === id ? { ...c, messages, updatedAt: nowISO() } : c
          );
          return { conversations: convs };
        }),

      /* Ajustes / datos */
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetDemo: () =>
        set((s) => {
          const demo = createDemoData();
          return {
            ...demo,
            conversations: s.conversations,
            activeConversationId: s.activeConversationId,
            settings: { ...demo.settings, ...preservedSettings(s.settings) },
          };
        }),
      resetEmpty: () =>
        set((s) => {
          const empty = createEmptyData();
          return {
            ...empty,
            conversations: s.conversations,
            activeConversationId: s.activeConversationId,
            settings: { ...empty.settings, ...preservedSettings(s.settings) },
          };
        }),
      importData: (d) =>
        set((s) => {
          const migrated = migrateData({ ...d }, typeof d.version === 'number' ? d.version : 0, false);
          const imported: Partial<Settings> = migrated.settings ?? {};
          const hasConvs = Array.isArray(d.conversations) && d.conversations.length > 0;
          return {
            ...createEmptyData(),
            ...migrated,
            // Un temporizador en curso de otro dispositivo/momento no tiene sentido al restaurar
            activeTimer: null,
            conversations: hasConvs ? migrated.conversations : s.conversations,
            activeConversationId: hasConvs ? migrated.activeConversationId : s.activeConversationId,
            settings: mergeSettings({ ...imported, ...pickMissing(preservedSettings(s.settings), imported) }),
          };
        }),
    }),
    {
      name: 'constancia-v2',
      version: STORE_VERSION,
      storage: createJSONStorage(() => safeLocalStorage),
      migrate: (persisted: any, version: number) => migrateData(persisted ?? {}, version, true),
      // Fusión profunda de settings: las claves nuevas reciben su valor por defecto en lugar de quedar undefined
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppData>;
        return { ...current, ...p, settings: mergeSettings(p.settings) };
      },
      partialize: (s) => selectData(s),
    },
  ),
);

/**
 * Hook de conveniencia para leer solo los datos (para pasar a funciones de métricas).
 * Comparación superficial: no re-renderiza por cambios de UI (p. ej. abrir el modal del temporizador)
 * y devuelve la misma referencia mientras ningún dato cambie, así los useMemo([data]) funcionan.
 */
export const useData = (): AppData => useStore(useShallow(selectData));
