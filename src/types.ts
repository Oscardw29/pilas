/**
 * MODELO DE DOMINIO — contrato compartido por toda la app.
 * Fechas de día: DateKey 'YYYY-MM-DD' (hora local). Instantes: ISO string.
 * Días de la semana: 0 = lunes ... 6 = domingo.
 */

export type ID = string;
export type DateKey = string;
export type ISODate = string;
export type Level5 = 1 | 2 | 3 | 4 | 5;

/** 1 = baja, 2 = media, 3 = alta */
export type Priority = 1 | 2 | 3;

/* ---------------- Objetivos ---------------- */
export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface Goal {
  id: ID;
  name: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  startDate: DateKey;
  /** Opcional. Si existe, el progreso es acumulado hacia esa fecha. */
  targetDate?: DateKey;
  status: GoalStatus;
  priority: Priority;
  createdAt: ISODate;
  completedAt?: ISODate;
}

/* ---------------- Hábitos ---------------- */
export type HabitStatus = 'active' | 'paused' | 'archived';
export type HabitKind = 'time' | 'action' | 'quantity';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

export interface PauseInterval {
  start: DateKey;
  end?: DateKey;
}

/** Relación hábito → objetivo con peso (0-100) dentro del objetivo. Se normaliza al calcular. */
export interface HabitGoalLink {
  goalId: ID;
  weight: number;
}

export interface Habit {
  id: ID;
  name: string;
  category?: string;
  icon: string;
  color: string;
  description?: string;
  status: HabitStatus;
  /** Tipo de hábito: tiempo (minutos), acción directa (sí/no) o cantidad (repeticiones/unidades) */
  kind?: HabitKind;
  /** Días programados (0 = lunes) */
  days: number[];
  /** Puntos al completar el objetivo completo: 10, 20, 30, 40, 50 */
  points: number;
  priority: Priority;
  /** Duración objetivo en minutos (para hábito de tiempo) */
  targetMinutes?: number;
  /** Duración de la versión mínima en minutos */
  minimumMinutes?: number;
  /** Cantidad objetivo (para hábito de cantidad) */
  targetQuantity?: number;
  /** Cantidad mínima para la racha (default 40% del target) */
  minimumQuantity?: number;
  /** Unidad de medida (ej. reps, cm, m, km, ft, mg, g, kg, lb, ml, L, gal) */
  quantityUnit?: string;
  /** Descripción textual del objetivo / mínimo para hábitos sin duración (ej. "20 páginas" / "1 página") */
  targetLabel?: string;
  minimumLabel?: string;
  preferredTime: TimeOfDay;
  /** Hora programada del día para enviar notificación (formato 'HH:mm', ej. '08:30') */
  reminderTime?: string;
  goals: HabitGoalLink[];
  createdAt: DateKey;
  startDate?: DateKey;
  endDate?: DateKey;
  pausedAt?: DateKey;
  pausedIntervals?: PauseInterval[];
  /** Día en que se archivó (desde ese día deja de contar) */
  archivedAt?: DateKey;
  /** Si el hábito nació de un reto */
  fromChallengeId?: ID;
}

/* ---------------- Registro diario ---------------- */
/**
 * full = objetivo completo, minimum = versión mínima, missed = no realizado (con razón opcional),
 * partial = avance registrado que aún no llega al mínimo (no suma puntos ni racha).
 */
export type LogStatus = 'full' | 'minimum' | 'missed' | 'partial';

export type FailReason =
  | 'forgot'
  | 'no_time'
  | 'no_energy'
  | 'distracted'
  | 'too_hard'
  | 'not_interested'
  | 'other';

export interface HabitLog {
  habitId: ID;
  date: DateKey;
  status: LogStatus;
  /** Puntos otorgados en el momento del registro (0 si missed) */
  points: number;
  failReason?: FailReason;
  failNote?: string;
  /** Minutos totales realizados ese día (suma de sesiones o manual) */
  minutes?: number;
  /** Cantidad acumulada realizada ese día (para hábitos de cantidad) */
  quantity?: number;
  loggedAt: ISODate;
}

/* ---------------- Sesiones / temporizador ---------------- */
export type SessionStatus = 'completed' | 'minimum' | 'abandoned';

export interface Session {
  id: ID;
  habitId: ID;
  date: DateKey;
  startedAt: ISODate;
  endedAt: ISODate;
  /** Tiempo real activo (sin pausas) */
  durationSec: number;
  targetSec?: number;
  status: SessionStatus;
  /** ¿Cómo fue? 1 😫 … 5 🔥 */
  mood?: Level5;
  /** Dificultad percibida 1-5 */
  difficulty?: Level5;
  /** Energía registrada antes de empezar */
  energy?: Level5;
  note?: string;
  experimentId?: ID;
  variantId?: ID;
}

export interface ActiveTimer {
  habitId?: ID;
  startedAt: ISODate;
  /** ms acumulados en pausa */
  pausedMs: number;
  /** Si está en pausa, desde cuándo */
  pausedAt?: ISODate;
  energy?: Level5;
  /** Temporizador personalizado de un solo uso (sin hábito asociado) */
  isCustom?: boolean;
  customTitle?: string;
  customDescription?: string;
  customIcon?: string;
  customMinutes?: number;
}

/* ---------------- Energía ---------------- */
export interface EnergyEntry {
  id: ID;
  date: DateKey;
  at: ISODate;
  level: Level5;
  note?: string;
}

/* ---------------- Retos ---------------- */
export type ChallengeStatus = 'active' | 'completed' | 'failed' | 'cancelled';

export interface Challenge {
  id: ID;
  name: string;
  icon: string;
  description: string;
  /** Qué se mide, ej. "Días levantándome antes de las 7:00" */
  metric: string;
  startDate: DateKey;
  durationDays: number;
  /** Días mínimos cumplidos para considerarlo exitoso */
  successDays: number;
  /** Condiciones de éxito en texto libre */
  conditions?: string;
  rewardPoints: number;
  rewardText?: string;
  checkins: DateKey[];
  status: ChallengeStatus;
  finishedAt?: ISODate;
  convertedHabitId?: ID;
  createdAt: ISODate;
}

/* ---------------- Experimentos ---------------- */
export type ExperimentType =
  | 'schedule'
  | 'duration'
  | 'frequency'
  | 'version'
  | 'order'
  | 'routine'
  | 'method'
  | 'breaks';

export type ExperimentStatus = 'planned' | 'running' | 'finished' | 'cancelled';

/** Una fase/variante: días [startDay, endDay] (1-indexados, inclusivos) desde startDate */
export interface ExperimentVariant {
  id: ID;
  label: string;
  description?: string;
  startDay: number;
  endDay: number;
}

export interface Experiment {
  id: ID;
  name: string;
  hypothesis: string;
  type: ExperimentType;
  habitId?: ID;
  startDate: DateKey;
  durationDays: number;
  variants: ExperimentVariant[];
  status: ExperimentStatus;
  conclusion?: string;
  winnerVariantId?: ID;
  createdAt: ISODate;
}

/* ---------------- Dependencias ---------------- */
export type RelationType = 'before' | 'after' | 'facilitates' | 'depends_on' | 'blocks';

export interface HabitRelation {
  id: ID;
  fromId: ID;
  toId: ID;
  type: RelationType;
  note?: string;
}

/* ---------------- Revisión semanal / check-ins ---------------- */
export interface WeeklyReview {
  id: ID;
  weekStart: DateKey;
  createdAt: ISODate;
  /** ¿Qué quieres cambiar? */
  changes: string;
  notes?: string;
  /** Snapshot de métricas al guardar */
  consistency: number;
}

export type CheckinAnswer = 'tired' | 'too_much_work' | 'not_interested' | 'needs_change' | 'all_good';

/** Respuesta a la detección de abandono */
export interface AbandonmentCheckin {
  id: ID;
  at: ISODate;
  answer: CheckinAnswer;
  habitId?: ID;
}

export type HabitReviewDecision = 'keep' | 'pause' | 'modify' | 'delete';

export interface HabitReviewEntry {
  id: ID;
  at: ISODate;
  habitId: ID;
  decision: HabitReviewDecision;
}

/* ---------------- Gamificación ---------------- */
export interface Reward {
  id: ID;
  name: string;
  icon: string;
  cost: number;
}

export interface Redemption {
  id: ID;
  rewardId: ID;
  name: string;
  icon: string;
  cost: number;
  date: ISODate;
}

/** Puntos extra fuera de los registros de hábitos (retos, logros, recuperación…) */
export interface PointEvent {
  id: ID;
  at: ISODate;
  amount: number;
  reason: string;
  source: 'challenge' | 'achievement' | 'recovery' | 'experiment' | 'review' | 'other';
  refId?: ID;
}

/* ---------------- Insights / recomendaciones ---------------- */
export type InsightKind =
  | 'schedule'
  | 'duration'
  | 'weekday'
  | 'correlation'
  | 'energy'
  | 'failure'
  | 'trend'
  | 'goal'
  | 'load';

export interface Insight {
  /** Estable entre renders (p. ej. `schedule:<habitId>`) para poder recordar feedback */
  id: string;
  kind: InsightKind;
  title: string;
  detail: string;
  habitId?: ID;
  goalId?: ID;
  /** 0-1: qué tan confiable es (según cantidad de datos) */
  confidence: number;
  tone: 'positive' | 'neutral' | 'attention';
  /** Datos numéricos opcionales para visualizar */
  data?: Record<string, number | string>;
}

export type DecisionCategory = 'do' | 'change' | 'keep' | 'remove' | 'experiment';

export interface RecommendationAction {
  label: string;
  /** Acción concreta que la UI sabe ejecutar */
  type:
    | 'reduce_target'
    | 'pause_habit'
    | 'change_time'
    | 'start_experiment'
    | 'use_minimum'
    | 'archive_habit'
    | 'focus_goal'
    | 'open';
  habitId?: ID;
  goalId?: ID;
  payload?: Record<string, unknown>;
}

export interface Recommendation {
  id: string;
  category: DecisionCategory;
  title: string;
  reason: string;
  habitId?: ID;
  goalId?: ID;
  priority: number;
  actions: RecommendationAction[];
}

export interface RecommendationFeedback {
  status: 'applied' | 'ignored';
  at: ISODate;
}

/* ---------------- IA ---------------- */
export interface AiMessage {
  id: ID;
  role: 'user' | 'model';
  text: string;
  at: ISODate;
  /** Historial de versiones del mensaje para navegación < 1/2 > */
  versions?: string[];
  activeVersionIndex?: number;
}

export interface AiConversation {
  id: ID;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  messages: any[];
}

/* ---------------- Ajustes ---------------- */
export type AiPlatform = 'gemini' | 'openai' | 'groq' | 'openrouter';

export interface Settings {
  userName: string;
  /** Fracción del valor/puntos que vale el mínimo (0.4 = 40%) */
  minimumRatio: number;
  /** Máximo recomendado de hábitos activos antes de sugerir revisión */
  maxActiveHabits: number;
  maxActiveGoals: number;
  /** Plataforma de IA seleccionada */
  aiPlatform?: AiPlatform;
  /** Modelo principal de IA (ej. Gemini 3.5 Flash Lite) */
  geminiModel: string;
  /** Modelo de respaldo por si el principal falla (ej. Gemini 3.1 Flash) */
  backupModel?: string;

  /** Efectos de sonido en la interfaz */
  soundEnabled?: boolean;
  /** Volumen de efectos de sonido (0 a 1) */
  soundVolume?: number;
  lastHabitReviewAt?: DateKey;
  /** Preguntar razón al marcar un hábito como no realizado */
  askFailReason: boolean;
  /** Configuración de notificaciones reales del sistema (Windows y Móviles) */
  notifications?: NotificationSettings;
}

/**
 * Claves de API. Se guardan FUERA del estado general (ver store/useSecrets.ts) para que
 * nunca viajen en los respaldos exportados y puedan cifrarse con una contraseña local.
 */
export interface Secrets {
  /** Clave de la plataforma de IA configurada (Gemini u otra) */
  geminiApiKey: string;
}

export interface NotificationSettings {
  enabled: boolean;
  habitReminders: boolean;
  streakReminder: boolean;
  streakReminderTime: string; // ej. '20:30'
  coachReminder: boolean;
  coachReminderTime: string; // ej. '16:30'
  morningReminder: boolean;
  morningReminderTime: string; // ej. '08:00'
  middayReminder: boolean;
  middayReminderTime: string; // ej. '13:30'
  nightReminder: boolean;
  nightReminderTime: string; // ej. '22:00'
}

/* ---------------- Estado persistido ---------------- */
export interface AppData {
  version: number;
  goals: Goal[];
  habits: Habit[];
  /** key = `${date}|${habitId}` (ver logKey) */
  logs: Record<string, HabitLog>;
  sessions: Session[];
  activeTimer: ActiveTimer | null;
  energy: EnergyEntry[];
  challenges: Challenge[];
  experiments: Experiment[];
  relations: HabitRelation[];
  weeklyReviews: WeeklyReview[];
  checkins: AbandonmentCheckin[];
  habitReviews: HabitReviewEntry[];
  rewards: Reward[];
  redemptions: Redemption[];
  pointEvents: PointEvent[];
  /** id de logro → fecha de desbloqueo */
  achievements: Record<string, ISODate>;
  recommendationFeedback: Record<string, RecommendationFeedback>;
  /** id de insight → descartado */
  dismissedInsights: Record<string, ISODate>;
  /** Múltiples conversaciones del Coach IA */
  conversations?: AiConversation[];
  activeConversationId?: string;
  settings: Settings;
  /** Protector de racha permanente (Escudo de hielo): activo en inventario (máx 1) */
  hasStreakFreeze?: boolean;
  /** Fechas en que el protector de racha fue consumido para salvar la racha */
  streakFreezes?: DateKey[];
}
