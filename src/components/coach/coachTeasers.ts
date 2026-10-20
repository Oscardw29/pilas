import { useStore } from '@/store/useStore';
import { isScheduled, getLog, isDoneLog, calculateGlobalStreak } from '@/lib/metrics';
import { todayKey } from '@/lib/dates';

/**
 * AVISOS DEL COACH
 * Mensajes cortos que despiertan curiosidad junto al botón del coach («tengo que decirte algo…»).
 * Al tocarlos se abre su página con la pregunta lista, para que cumpla lo que prometió.
 * Frecuencia contenida: como mucho uno cada 2 horas y 4 al día, y nunca justo después de visitarle.
 */

export interface CoachTeaserMsg {
  text: string;
  /** Pregunta que se envía al abrir la página del coach desde el aviso */
  prompt: string;
}

export const TEASER_EVENT = 'constancia:coach-teaser';

const STORAGE_KEY = 'constancia_coach_teasers';
const MIN_GAP_MS = 2 * 60 * 60 * 1000;
const AFTER_VISIT_MS = 45 * 60 * 1000;
const MAX_PER_DAY = 4;

interface TeaserLog {
  day: string;
  count: number;
  lastAt: number;
  visitedAt: number;
  lastIdx: number;
}

function readLog(): TeaserLog {
  const empty: TeaserLog = { day: todayKey(), count: 0, lastAt: 0, visitedAt: 0, lastIdx: -1 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const log = { ...empty, ...(JSON.parse(raw) as Partial<TeaserLog>) };
    return log.day === todayKey() ? log : { ...log, day: todayKey(), count: 0 };
  } catch {
    return empty;
  }
}

function writeLog(log: TeaserLog) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* almacenamiento no disponible: el aviso simplemente puede repetirse */
  }
}

/** Al entrar a la página del coach ya no hace falta llamarle la atención durante un rato */
export function markCoachVisited() {
  writeLog({ ...readLog(), visitedAt: Date.now() });
}

export function canShowTeaser(now = Date.now()): boolean {
  const log = readLog();
  return log.count < MAX_PER_DAY && now - log.lastAt > MIN_GAP_MS && now - log.visitedAt > AFTER_VISIT_MS;
}

/** Muestra un aviso ya (prueba desde Ajustes) */
export function triggerCoachTeaser() {
  window.dispatchEvent(new CustomEvent(TEASER_EVENT));
}

const GENERIC: CoachTeaserMsg[] = [
  { text: 'Psst… tengo que decirte algo 👀', prompt: '¿Qué querías decirme? Cuéntame tu observación más importante sobre mis hábitos.' },
  { text: 'Mira esto que encontré en tus datos…', prompt: '¿Qué encontraste en mis datos? Muéstrame el hallazgo más interesante.' },
  { text: 'Creo que descubrí tu mejor hora del día ⏰', prompt: 'Según mis datos, ¿cuál es mi mejor hora del día para cumplir mis hábitos?' },
  { text: 'Tengo una idea que te va a gustar 💡', prompt: '¿Cuál es esa idea? Propónme una mejora concreta para esta semana.' },
  { text: '¿Tienes un minuto? Vi algo curioso…', prompt: '¿Qué viste de curioso en mis registros?' },
  { text: 'Ya sé por qué te cuesta ese hábito…', prompt: '¿Por qué crees que me cuesta mi hábito más difícil? Analiza mis fallos y dime qué cambiar.' },
  { text: 'Hice cuentas y… tienes que ver esto 📊', prompt: 'Resume mi progreso reciente con números y dime qué destaca.' },
];

/** Elige un aviso: primero los que dependen del día del usuario, si no uno genérico distinto al anterior */
export function pickTeaser(): CoachTeaserMsg {
  const state = useStore.getState();
  const today = todayKey();
  const hour = new Date().getHours();
  const log = readLog();
  const options: CoachTeaserMsg[] = [];

  try {
    const pending = (state.habits || []).filter(
      (h) => h.status === 'active' && isScheduled(h, today) && !isDoneLog(getLog(state, h.id, today)),
    );
    if (pending.length > 0 && hour >= 17) {
      options.push({
        text: '¡Oye! Todavía puedes salvar el día. ¿Te cuento cómo?',
        prompt: `Me quedan ${pending.length} hábitos pendientes hoy. ¿Cómo los completo con la energía que me queda?`,
      });
    }
    const streak = calculateGlobalStreak(state, today).streak;
    if (streak >= 3) {
      options.push({
        text: `Tu racha de ${streak} días esconde un patrón… 👀`,
        prompt: `Llevo ${streak} días de racha. ¿Qué patrón ves y cómo la protejo esta semana?`,
      });
    }
  } catch {
    /* sin datos suficientes: avisos genéricos */
  }

  if (options.length && Math.random() < 0.6) return options[Math.floor(Math.random() * options.length)];

  let idx = Math.floor(Math.random() * GENERIC.length);
  if (idx === log.lastIdx) idx = (idx + 1) % GENERIC.length;
  writeLog({ ...log, lastIdx: idx });
  return GENERIC[idx];
}

export function recordTeaserShown() {
  const log = readLog();
  writeLog({ ...log, count: log.count + 1, lastAt: Date.now() });
}
