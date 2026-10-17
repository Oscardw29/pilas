import type { AppData, Habit, Level5, Recommendation } from '@/types';
import { diffDays, hourOf, todayKey, weekdayIndex } from './dates';
import { consistency, getLog, habitStart, isDoneLog, lastActivity } from './metrics';

/**
 * SISTEMA DE RECOMENDACIONES Y DECISIONES (Puntos 5, 18, 19)
 */

export interface WhatToDoInput {
  availableMinutes: number; // Ej. 15, 30, 45, 60, 90
  currentEnergy: Level5; // 1 😫 ... 5 🔥
  currentHour?: number;
}

export interface RecommendedActionItem {
  habit: Habit;
  mode: 'full' | 'minimum';
  estimatedMinutes: number;
  reason: string;
  score: number;
}

export interface WhatToDoResult {
  message: string;
  items: RecommendedActionItem[];
  totalMinutes: number;
}

/**
 * "¿Qué debería hacer ahora?" (Punto 5)
 * Analiza hábitos pendientes para hoy o hábitos atrasados, prioridades,
 * tiempo disponible, energía actual, duración estimada y última realización.
 */
export function recommendWhatToDo(data: AppData, input: WhatToDoInput, ref = todayKey()): WhatToDoResult {
  const currentHour = input.currentHour ?? new Date().getHours();
  const timeOfDay = currentHour < 12 ? 'morning' : currentHour < 18 ? 'afternoon' : 'evening';
  const activeHabits = data.habits.filter((h) => h.status === 'active');
  const todayWd = weekdayIndex(ref);

  // Calificar cada hábito disponible
  interface Candidate {
    habit: Habit;
    mode: 'full' | 'minimum';
    duration: number;
    score: number;
    reason: string;
  }

  const candidates: Candidate[] = [];

  for (const h of activeHabits) {
    const todayLog = getLog(data, h.id, ref);
    if (isDoneLog(todayLog)) continue; // Ya realizado hoy

    const scheduledToday = h.days.includes(todayWd);
    const lastDone = lastActivity(data, h.id);
    const daysSinceLast = lastDone ? diffDays(lastDone, ref) : 10;

    // Si la energía es baja (1-2), sugerir versión mínima preferentemente
    const preferMinimum = input.currentEnergy <= 2 || (h.targetMinutes ?? 30) > input.availableMinutes;
    const mode: 'full' | 'minimum' = preferMinimum && h.minimumMinutes ? 'minimum' : 'full';
    const duration = mode === 'full' ? (h.targetMinutes ?? 25) : (h.minimumMinutes ?? 10);

    // Si no entra ni el mínimo en el tiempo disponible, no cabe
    if (duration > input.availableMinutes) continue;

    let score = 0;
    const reasons: string[] = [];

    // Prioridad del hábito (1: +10, 2: +20, 3: +35)
    score += h.priority * 15;
    if (h.priority === 3) reasons.push('Tiene prioridad alta');

    // Programado hoy (+30)
    if (scheduledToday) {
      score += 30;
      reasons.push('Está programado para hoy');
    }

    // Atraso (+10 por cada día sin hacerlo)
    if (daysSinceLast >= 2) {
      score += Math.min(40, daysSinceLast * 12);
      reasons.push(`Llevas ${daysSinceLast} días sin realizarlo`);
    }

    // Coincidencia horaria (+20)
    if (h.preferredTime === timeOfDay || h.preferredTime === 'any') {
      score += 20;
    }

    // Ajuste por energía
    if (input.currentEnergy <= 2 && mode === 'minimum') {
      score += 25;
      reasons.push('Versión mínima ideal para tu nivel de energía actual');
    } else if (input.currentEnergy >= 4 && mode === 'full') {
      score += 15;
      reasons.push('Aprovecha tu energía alta para la sesión completa');
    }

    // Relación con objetivos de alta prioridad
    const topGoalLink = h.goals.some((g) => {
      const goal = data.goals.find((gl) => gl.id === g.goalId);
      return goal && goal.priority === 3 && goal.status === 'active';
    });
    if (topGoalLink) {
      score += 15;
      reasons.push('Contribuye a un objetivo prioritario');
    }

    candidates.push({
      habit: h,
      mode,
      duration,
      score,
      reason: reasons.slice(0, 2).join(' y ') + '.',
    });
  }

  // Ordenar de mayor a menor puntuación y armar el plan dentro del tiempo disponible
  candidates.sort((a, b) => b.score - a.score);

  const selected: RecommendedActionItem[] = [];
  let remainingTime = input.availableMinutes;

  for (const c of candidates) {
    if (c.duration <= remainingTime) {
      selected.push({
        habit: c.habit,
        mode: c.mode,
        estimatedMinutes: c.duration,
        reason: c.reason,
        score: c.score,
      });
      remainingTime -= c.duration;
    }
    if (remainingTime < 5 || selected.length >= 3) break;
  }

  const totalMin = selected.reduce((a, s) => a + s.estimatedMinutes, 0);

  let message = `Tienes aproximadamente ${input.availableMinutes} minutos.`;
  if (input.currentEnergy <= 2) {
    message += ' Como tu energía está baja, te recomendamos versiones mínimas para no perder el ritmo.';
  } else if (input.currentEnergy >= 4) {
    message += ' Con tu energía alta hoy es un gran momento para avanzar con hábitos de alta prioridad.';
  }

  return {
    message,
    items: selected,
    totalMinutes: totalMin,
  };
}

/**
 * SISTEMA DE DECISIONES (Punto 19)
 * Genera recomendaciones clasificadas en:
 *  - Qué hacer (acción inmediata)
 *  - Qué cambiar (ajustar duración, horarios, mínimos)
 *  - Qué mantener (lo que está funcionando excelente)
 *  - Qué eliminar / pausar (hábitos o metas que sobran o restan foco)
 *  - Qué experimentar (pruebas A/B de horarios, métodos o descansos)
 */
export function generateDecisionSystem(data: AppData, ref = todayKey()): Recommendation[] {
  const recs: Recommendation[] = [];
  const activeHabits = data.habits.filter((h) => h.status === 'active');
  const sessions = data.sessions;

  /* --- 1. QUÉ CAMBIAR: Falla recurrente por tiempo --- */
  const failLogs = Object.values(data.logs).filter((l) => l.status === 'missed');
  const timeFailures = failLogs.filter((l) => l.failReason === 'no_time');
  if (timeFailures.length >= 5) {
    // Buscar hábito con más fallos por tiempo
    const counts: Record<string, number> = {};
    timeFailures.forEach((l) => { counts[l.habitId] = (counts[l.habitId] || 0) + 1; });
    const [topHId, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
    const targetH = activeHabits.find((h) => h.id === topHId);

    if (targetH && (targetH.targetMinutes ?? 0) >= 30) {
      recs.push({
        id: `rec-change-reduce-time-${targetH.id}`,
        category: 'change',
        title: `Reducir duración de «${targetH.name}» de ${targetH.targetMinutes} a ${Math.round(targetH.targetMinutes! * 0.6)} min`,
        reason: `Has indicado falta de tiempo ${count} veces en las últimas semanas. Un objetivo más compacto facilitará la constancia.`,
        habitId: targetH.id,
        priority: 85,
        actions: [
          {
            label: 'Reducir duración',
            type: 'reduce_target',
            habitId: targetH.id,
            payload: { newMinutes: Math.round(targetH.targetMinutes! * 0.6) },
          },
        ],
      });
    }
  }

  /* --- 2. QUÉ CAMBIAR: Hábito nocturno con dificultad --- */
  const csharp = activeHabits.find((h) => h.preferredTime === 'evening' && (h.targetMinutes ?? 0) >= 45);
  if (csharp) {
    const nightSessions = sessions.filter((s) => s.habitId === csharp.id && hourOf(s.startedAt) >= 19);
    const nightAbandon = nightSessions.filter((s) => s.status === 'abandoned').length;
    if (nightSessions.length >= 4 && nightAbandon / nightSessions.length >= 0.3) {
      recs.push({
        id: `rec-change-time-${csharp.id}`,
        category: 'change',
        title: `Mover «${csharp.name}» a la tarde (4–6 PM)`,
        reason: `Tus sesiones nocturnas tienen un ${Math.round((nightAbandon / nightSessions.length) * 100)}% de interrupción. Las sesiones de tarde rinden mucho mejor.`,
        habitId: csharp.id,
        priority: 80,
        actions: [
          {
            label: 'Cambiar a horario de tarde',
            type: 'change_time',
            habitId: csharp.id,
            payload: { preferredTime: 'afternoon' },
          },
        ],
      });
    }
  }

  /* --- 3. QUÉ MANTENER: Hábitos con alta consistencia --- */
  activeHabits.forEach((h) => {
    const c = consistency(data, h, 30, ref);
    if (c != null && c >= 0.8 && diffDays(habitStart(h), ref) >= 21) {
      recs.push({
        id: `rec-keep-${h.id}`,
        category: 'keep',
        title: `«${h.name}» está completamente consolidado (${Math.round(c * 100)}%)`,
        reason: 'Consistencia sólida durante más de 3 semanas. No toques nada aquí; es un hábito ancla.',
        habitId: h.id,
        priority: 40,
        actions: [],
      });
    }
  });

  /* --- 4. QUÉ ELIMINAR / PAUSAR: Hábitos con muy baja consistencia o desinterés --- */
  activeHabits.forEach((h) => {
    const c = consistency(data, h, 30, ref);
    const notInterested = Object.values(data.logs).filter((l) => l.habitId === h.id && l.failReason === 'not_interested').length;
    if ((c != null && c <= 0.25 && diffDays(habitStart(h), ref) >= 28) || notInterested >= 3) {
      recs.push({
        id: `rec-remove-${h.id}`,
        category: 'remove',
        title: `Pausar temporalmente «${h.name}»`,
        reason: notInterested >= 3
          ? 'Has marcado "Ya no me interesa" repetidamente. La app optimiza para mejores hábitos, no acumularlos.'
          : `Consistencia muy baja (${Math.round((c ?? 0) * 100)}%). Pausarlo liberará atención para tus objetivos prioritarios.`,
        habitId: h.id,
        priority: 75,
        actions: [
          {
            label: 'Pausar hábito',
            type: 'pause_habit',
            habitId: h.id,
          },
          {
            label: 'Archivar definitivamente',
            type: 'archive_habit',
            habitId: h.id,
          },
        ],
      });
    }
  });

  /* --- 5. QUÉ EXPERIMENTAR: Pruebas sugeridas --- */
  if (data.experiments.filter((e) => e.status === 'running').length === 0) {
    const longHabit = activeHabits.find((h) => (h.targetMinutes ?? 0) >= 60);
    if (longHabit) {
      recs.push({
        id: `rec-exp-pomodoro-${longHabit.id}`,
        category: 'experiment',
        title: `Probar experimento: Pomodoro 25/5 vs. Sesión continua en «${longHabit.name}»`,
        reason: 'Descubre en 14 días con qué método experimentas menor fatiga mental y mayor enfoque.',
        habitId: longHabit.id,
        priority: 60,
        actions: [
          {
            label: 'Crear experimento (14 días)',
            type: 'start_experiment',
            habitId: longHabit.id,
            payload: { type: 'method', name: `Pomodoro vs Bloque en ${longHabit.name}` },
          },
        ],
      });
    }
  }

  // Filtrar las que ya recibieron feedback o están ignoradas
  return recs
    .filter((r) => !data.recommendationFeedback[r.id])
    .sort((a, b) => b.priority - a.priority);
}
