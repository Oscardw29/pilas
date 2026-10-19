import type { ExperimentType, ExperimentVariant, Habit, HabitKind, Priority, RelationType, TimeOfDay } from '@/types';
import { useStore } from '@/store/useStore';
import { DAY_SHORT, todayKey } from './dates';

/**
 * ACCIONES PROPUESTAS POR EL COACH IA
 * El modelo devuelve JSON libre: aquí se valida y se aplica SOLO una lista blanca de campos con tipos correctos,
 * para que una respuesta malformada (o manipulada) no pueda sobrescribir ids, estados u otros datos internos.
 */

export type CoachActionType =
  | 'create_habit'
  | 'update_habit'
  | 'delete_habit'
  | 'create_experiment'
  | 'create_connection'
  | 'create_reward';

export interface ParsedAction {
  action: CoachActionType;
  data: Record<string, unknown>;
}

export interface CoachActionResult {
  ok: boolean;
  message: string;
}

const ACTIONS = new Set<CoachActionType>([
  'create_habit', 'update_habit', 'delete_habit', 'create_experiment', 'create_connection', 'create_reward',
]);
const TIMES_OF_DAY = new Set<TimeOfDay>(['morning', 'afternoon', 'evening', 'any']);
const KINDS = new Set<HabitKind>(['time', 'action', 'quantity']);
const RELATION_TYPES = new Set<RelationType>(['before', 'after', 'facilitates', 'depends_on', 'blocks']);
const EXPERIMENT_TYPES = new Set<ExperimentType>(['schedule', 'duration', 'frequency', 'version', 'order', 'routine', 'method', 'breaks']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const str = (v: unknown, max = 80): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
};
const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const oneOf = <T extends string>(set: Set<T>, v: unknown): T | undefined => (typeof v === 'string' && set.has(v as T) ? (v as T) : undefined);
const days = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const list = [...new Set(v.map((d) => int(d, 0, 6)).filter((d): d is number => d !== undefined))].sort();
  return list.length ? list : undefined;
};
const priority = (v: unknown): Priority | undefined => int(v, 1, 3) as Priority | undefined;

/** Convierte el JSON del bloque ```action en una acción conocida o null */
export function parseCoachAction(raw: unknown): ParsedAction | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { action, data } = raw as { action?: unknown; data?: unknown };
  if (typeof action !== 'string' || !ACTIONS.has(action as CoachActionType)) return null;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  return { action: action as CoachActionType, data: data as Record<string, unknown> };
}

/** Busca un hábito por id o por nombre EXACTO (sin distinguir mayúsculas). Nunca por coincidencia parcial. */
function findHabit(habits: Habit[], id: unknown, name: unknown): Habit | undefined {
  const wantedId = str(id, 64);
  const wantedName = str(name)?.toLowerCase();
  if (wantedId) {
    const byId = habits.find((h) => h.id === wantedId);
    if (byId) return byId;
  }
  if (!wantedName) return undefined;
  return habits.find((h) => h.name.trim().toLowerCase() === wantedName);
}

/** Campos del hábito que el coach puede modificar */
function habitPatch(raw: unknown): Partial<Habit> {
  if (typeof raw !== 'object' || raw === null) return {};
  const p = raw as Record<string, unknown>;
  const patch: Partial<Habit> = {};
  const name = str(p.name);
  if (name) patch.name = name;
  const icon = str(p.icon, 8);
  if (icon) patch.icon = icon;
  const color = str(p.color, 7);
  if (color && HEX_COLOR.test(color)) patch.color = color;
  const target = int(p.targetMinutes, 1, 600);
  if (target !== undefined) patch.targetMinutes = target;
  const min = int(p.minimumMinutes, 1, 600);
  if (min !== undefined) patch.minimumMinutes = min;
  const time = oneOf(TIMES_OF_DAY, p.preferredTime);
  if (time) patch.preferredTime = time;
  const d = days(p.days);
  if (d) patch.days = d;
  const points = int(p.points, 5, 100);
  if (points !== undefined) patch.points = points;
  const prio = priority(p.priority);
  if (prio) patch.priority = prio;
  const reminder = str(p.reminderTime, 5);
  if (reminder && HHMM.test(reminder)) patch.reminderTime = reminder;
  // El mínimo nunca puede superar al objetivo
  if (patch.minimumMinutes && patch.targetMinutes && patch.minimumMinutes > patch.targetMinutes) {
    patch.minimumMinutes = patch.targetMinutes;
  }
  return patch;
}

function experimentVariants(raw: unknown, durationDays: number): ExperimentVariant[] {
  const fallback: ExperimentVariant[] = [
    { id: 'v1', label: 'Fase 1', startDay: 1, endDay: Math.ceil(durationDays / 2) },
    { id: 'v2', label: 'Fase 2', startDay: Math.ceil(durationDays / 2) + 1, endDay: durationDays },
  ];
  if (!Array.isArray(raw)) return fallback;
  const list: ExperimentVariant[] = [];
  raw.slice(0, 4).forEach((v, i) => {
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    const label = str(o.label, 60);
    const startDay = int(o.startDay, 1, durationDays);
    const endDay = int(o.endDay, 1, durationDays);
    if (!label || startDay === undefined || endDay === undefined || endDay < startDay) return;
    list.push({ id: `v${i + 1}`, label, startDay, endDay, description: str(o.description, 200) });
  });
  return list.length >= 2 ? list : fallback;
}

const TIME_LABELS: Record<TimeOfDay, string> = { morning: 'Mañana', afternoon: 'Tarde', evening: 'Noche', any: 'Cualquier momento' };
const RELATION_LABELS: Record<RelationType, string> = {
  before: 'va antes de',
  after: 'va después de',
  facilitates: 'facilita',
  depends_on: 'depende de',
  blocks: 'bloquea',
};
const EXPERIMENT_LABELS: Record<ExperimentType, string> = {
  schedule: 'Horario',
  duration: 'Duración',
  frequency: 'Frecuencia',
  version: 'Versión',
  order: 'Orden',
  routine: 'Rutina',
  method: 'Método',
  breaks: 'Descansos',
};

function daysLabel(list: number[]): string {
  if (list.length === 7) return 'Todos los días';
  if (list.join() === '0,1,2,3,4') return 'Lunes a viernes';
  if (list.join() === '5,6') return 'Fines de semana';
  return list.map((d) => DAY_SHORT[d]).join(', ');
}

export interface CoachActionSummary {
  /** Título corto de la tarjeta («Crear hábito») */
  title: string;
  /** Nombre del elemento afectado */
  subject: string;
  tone: 'create' | 'update' | 'delete';
  /** Detalles legibles, nunca JSON */
  details: { label: string; value: string }[];
}

/** Resumen legible de una acción propuesta, con los mismos datos validados que se aplicarían */
export function describeCoachAction(action: ParsedAction): CoachActionSummary {
  const d = action.data;
  const habitDetails = (p: Partial<Habit>) => {
    const out: { label: string; value: string }[] = [];
    if (p.name) out.push({ label: 'Nombre', value: p.name });
    if (p.targetMinutes) out.push({ label: 'Meta diaria', value: `${p.targetMinutes} min` });
    if (p.minimumMinutes) out.push({ label: 'Mínimo', value: `${p.minimumMinutes} min` });
    if (p.preferredTime) out.push({ label: 'Horario', value: TIME_LABELS[p.preferredTime] });
    if (p.days) out.push({ label: 'Días', value: daysLabel(p.days) });
    if (p.reminderTime) out.push({ label: 'Recordatorio', value: p.reminderTime });
    if (p.points) out.push({ label: 'Puntos', value: String(p.points) });
    if (p.priority) out.push({ label: 'Prioridad', value: p.priority === 3 ? 'Alta' : p.priority === 2 ? 'Media' : 'Baja' });
    return out;
  };

  switch (action.action) {
    case 'create_habit': {
      const patch = habitPatch(d);
      const name = str(d.name) ?? 'Hábito nuevo';
      return {
        title: 'Crear hábito',
        subject: `${patch.icon ?? '🎯'} ${name}`,
        tone: 'create',
        details: habitDetails({ ...patch, name: undefined }),
      };
    }
    case 'update_habit': {
      const patch = habitPatch(d.patch);
      const details = habitDetails(patch);
      return {
        title: 'Modificar hábito',
        subject: str(d.habitName) ?? 'Hábito',
        tone: 'update',
        details: details.length ? details : [{ label: 'Cambios', value: 'Sin cambios reconocibles' }],
      };
    }
    case 'delete_habit':
      return {
        title: 'Eliminar hábito',
        subject: str(d.habitName) ?? 'Hábito',
        tone: 'delete',
        details: [{ label: 'Efecto', value: 'Se quita de tu lista de hábitos' }],
      };
    case 'create_experiment': {
      const durationDays = int(d.durationDays, 2, 90) ?? 14;
      const type = oneOf(EXPERIMENT_TYPES, d.type) ?? 'schedule';
      const details = [
        { label: 'Duración', value: `${durationDays} días` },
        { label: 'Tipo', value: EXPERIMENT_LABELS[type] },
      ];
      const hypothesis = str(d.hypothesis, 300);
      if (hypothesis) details.push({ label: 'Hipótesis', value: hypothesis });
      return { title: 'Iniciar experimento', subject: str(d.name, 100) ?? 'Experimento', tone: 'create', details };
    }
    case 'create_connection': {
      const type = oneOf(RELATION_TYPES, d.type) ?? 'before';
      const details = [{ label: 'Relación', value: `${str(d.fromHabitName) ?? '?'} ${RELATION_LABELS[type]} ${str(d.toHabitName) ?? '?'}` }];
      const note = str(d.note, 200);
      if (note) details.push({ label: 'Nota', value: note });
      return { title: 'Conectar hábitos', subject: `${str(d.fromHabitName) ?? '?'} → ${str(d.toHabitName) ?? '?'}`, tone: 'create', details };
    }
    case 'create_reward':
      return {
        title: 'Crear recompensa',
        subject: `${str(d.icon, 8) ?? '🎁'} ${str(d.name) ?? 'Recompensa'}`,
        tone: 'create',
        details: [{ label: 'Costo', value: `${int(d.cost, 10, 100_000) ?? 100} puntos` }],
      };
  }
}

/** Aplica una acción validada sobre el store. Devuelve el mensaje para el usuario. */
export function executeCoachAction(action: ParsedAction): CoachActionResult {
  const store = useStore.getState();
  const d = action.data;

  switch (action.action) {
    case 'create_habit': {
      const name = str(d.name);
      if (!name) return { ok: false, message: 'La sugerencia no incluye un nombre de hábito válido' };
      const patch = habitPatch(d);
      const kind = oneOf(KINDS, d.kind) ?? (patch.targetMinutes ? 'time' : 'action');
      const habit = store.addHabit({
        name,
        icon: patch.icon ?? '🎯',
        color: patch.color ?? '#8b5cf6',
        kind,
        days: patch.days ?? [0, 1, 2, 3, 4, 5, 6],
        points: patch.points ?? 20,
        priority: patch.priority ?? 2,
        preferredTime: patch.preferredTime ?? 'any',
        targetMinutes: kind === 'time' ? patch.targetMinutes ?? 25 : undefined,
        minimumMinutes: kind === 'time' ? patch.minimumMinutes : undefined,
        reminderTime: patch.reminderTime,
        goals: [],
        status: 'active',
      });
      return { ok: true, message: `Hábito «${habit.name}» creado con éxito` };
    }

    case 'update_habit': {
      const target = findHabit(store.habits, d.habitId, d.habitName);
      if (!target) return { ok: false, message: 'No se encontró el hábito para actualizar' };
      const patch = habitPatch(d.patch);
      if (Object.keys(patch).length === 0) return { ok: false, message: 'La sugerencia no contiene cambios válidos' };
      store.updateHabit(target.id, patch);
      return { ok: true, message: `Hábito «${target.name}» actualizado` };
    }

    case 'delete_habit': {
      const target = findHabit(store.habits, d.habitId, d.habitName);
      if (!target) return { ok: false, message: 'No se encontró el hábito para eliminar' };
      store.deleteHabit(target.id);
      return { ok: true, message: `Hábito «${target.name}» eliminado` };
    }

    case 'create_experiment': {
      const name = str(d.name, 100);
      if (!name) return { ok: false, message: 'La sugerencia no incluye un nombre de experimento válido' };
      const durationDays = int(d.durationDays, 2, 90) ?? 14;
      const habit = findHabit(store.habits, d.habitId, d.habitName);
      store.addExperiment({
        name,
        hypothesis: str(d.hypothesis, 300) ?? 'Validar cambios en la rutina',
        type: oneOf(EXPERIMENT_TYPES, d.type) ?? 'schedule',
        habitId: habit?.id,
        startDate: todayKey(),
        durationDays,
        variants: experimentVariants(d.variants, durationDays),
        status: 'running',
      });
      return { ok: true, message: `Experimento «${name}» iniciado con éxito` };
    }

    case 'create_connection': {
      const from = findHabit(store.habits, d.fromHabitId, d.fromHabitName);
      const to = findHabit(store.habits, d.toHabitId, d.toHabitName);
      if (!from || !to) return { ok: false, message: 'No se pudieron identificar ambos hábitos para conectarlos' };
      if (from.id === to.id) return { ok: false, message: 'Un hábito no puede conectarse consigo mismo' };
      store.addRelation({ fromId: from.id, toId: to.id, type: oneOf(RELATION_TYPES, d.type) ?? 'before', note: str(d.note, 200) });
      return { ok: true, message: `Conexión entre «${from.name}» y «${to.name}» creada` };
    }

    case 'create_reward': {
      const name = str(d.name);
      if (!name) return { ok: false, message: 'La sugerencia no incluye un nombre de recompensa válido' };
      store.addReward({ name, icon: str(d.icon, 8) ?? '🎁', cost: int(d.cost, 10, 100_000) ?? 100 });
      return { ok: true, message: `Recompensa «${name}» creada con éxito` };
    }
  }
}
