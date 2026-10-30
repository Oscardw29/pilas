import type { AppData, FailReason, Habit, Insight } from '@/types';
import { addDaysKey, diffDays, hourOf, rangeKeys, todayKey, toKey, weekdayIndex } from './dates';
import { consistency, getLog, habitStart, isDoneLog, periodConsistency } from './metrics';
import { MAX_ACTIVE_HABITS } from './limits';

/**
 * MOTOR DE APRENDIZAJE E INSIGHTS (Puntos 7, 9, 15, 16)
 * Analiza el historial real del usuario y extrae patrones objetivos:
 *  1. Horarios: franja más efectiva vs. franja con mayor abandono.
 *  2. Duración: abandono en sesiones largas (> 50-60 min).
 *  3. Día de la semana: días con menor consistencia sistemática (ej. lunes/domingos).
 *  4. Correlaciones entre hábitos (ej. Dormir temprano -> Ejercicio al día siguiente).
 *  5. Razones de falla más repetidas.
 *  6. Detección de abandono (caída en las últimas semanas).
 *  7. Sobrecarga de hábitos (demasiados hábitos activos o con baja consistencia).
 */

export const FAIL_REASON_LABELS: Record<FailReason, string> = {
  forgot: 'Me olvidé',
  no_time: 'No tuve tiempo',
  no_energy: 'No tenía energía',
  distracted: 'Me distraje',
  too_hard: 'Era demasiado difícil',
  not_interested: 'Ya no me interesa',
  other: 'Otro',
};

export function detectInsights(data: AppData, ref = todayKey()): Insight[] {
  const insights: Insight[] = [];
  const sessions = data.sessions;
  const activeHabits = data.habits.filter((h) => h.status === 'active');

  /* 1. ANÁLISIS DE HORARIOS (sesiones completadas vs abandonadas por rango de horas) */
  if (sessions.length >= 10) {
    const buckets: Record<'morning' | 'afternoon' | 'evening' | 'night', { done: number; total: number; dur: number }> = {
      morning: { done: 0, total: 0, dur: 0 },
      afternoon: { done: 0, total: 0, dur: 0 },
      evening: { done: 0, total: 0, dur: 0 },
      night: { done: 0, total: 0, dur: 0 },
    };

    sessions.forEach((s) => {
      const h = hourOf(s.startedAt);
      const b = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
      buckets[b].total++;
      if (s.status === 'completed' || s.status === 'minimum') {
        buckets[b].done++;
        buckets[b].dur += s.durationSec / 60;
      }
    });

    const labelMap = {
      morning: 'la mañana (5 AM – 12 PM)',
      afternoon: 'la tarde (12 PM – 5 PM)',
      evening: 'la tarde/noche (5 PM – 10 PM)',
      night: 'la noche (10 PM – 5 AM)',
    };

    const ratedBuckets = Object.entries(buckets)
      .filter(([, v]) => v.total >= 4)
      .map(([k, v]) => ({ key: k as keyof typeof buckets, rate: v.done / v.total, avgDur: v.done ? v.dur / v.done : 0, count: v.total }));

    if (ratedBuckets.length >= 2) {
      ratedBuckets.sort((a, b) => b.rate - a.rate);
      const best = ratedBuckets[0];
      const worst = ratedBuckets[ratedBuckets.length - 1];

      if (best.rate >= 0.75) {
        insights.push({
          id: `insight-schedule-best`,
          kind: 'schedule',
          title: `Tu mejor horario es ${labelMap[best.key]}`,
          detail: `Completas con éxito el ${Math.round(best.rate * 100)}% de tus sesiones iniciadas en esta franja con un promedio de ${Math.round(best.avgDur)} minutos.`,
          confidence: Math.min(1, best.count / 20),
          tone: 'positive',
        });
      }

      if (worst.rate <= 0.6 && worst.count >= 5) {
        insights.push({
          id: `insight-schedule-worst`,
          kind: 'schedule',
          title: `Mayor dificultad en ${labelMap[worst.key]}`,
          detail: `Tienes una tasa de interrupción o abandono del ${Math.round((1 - worst.rate) * 100)}% cuando inicias actividades en este horario. Considera moverlas más temprano.`,
          confidence: Math.min(1, worst.count / 15),
          tone: 'attention',
        });
      }
    }
  }

  /* 2. ANÁLISIS DE DURACIÓN (sesiones largas vs abandono) */
  if (sessions.length >= 8) {
    const long = sessions.filter((s) => (s.targetSec ?? 0) >= 3600); // 60+ min
    const short = sessions.filter((s) => (s.targetSec ?? 0) > 0 && (s.targetSec ?? 0) < 3600);

    if (long.length >= 5 && short.length >= 5) {
      const longAbandon = long.filter((s) => s.status === 'abandoned').length / long.length;
      const shortAbandon = short.filter((s) => s.status === 'abandoned').length / short.length;
      const diff = Math.round((longAbandon - shortAbandon) * 100);

      if (diff >= 20) {
        insights.push({
          id: 'insight-duration-abandon',
          kind: 'duration',
          title: 'Sesiones de 60+ minutos sufren mayor abandono',
          detail: `Tus sesiones de más de 1 hora tienen un ${diff}% más de probabilidad de abandono. Dividirlas en bloques de 25-45 minutos aumentaría tu éxito.`,
          confidence: 0.85,
          tone: 'attention',
        });
      }
    }
  }

  /* 3. DÍA DE LA SEMANA (análisis de consistencia por día) */
  const dayStats = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    let total = 0;
    let done = 0;
    const past30 = rangeKeys(addDaysKey(ref, -45), ref);
    past30.forEach((d) => {
      if (weekdayIndex(d) === wd) {
        activeHabits.forEach((h) => {
          if (h.days.includes(wd) && d >= habitStart(h)) {
            total++;
            const l = getLog(data, h.id, d);
            if (isDoneLog(l)) done++;
          }
        });
      }
    });
    return { wd, rate: total > 0 ? done / total : 0, total };
  });

  const validDays = dayStats.filter((d) => d.total >= 8);
  if (validDays.length >= 4) {
    const avg = validDays.reduce((a, b) => a + b.rate, 0) / validDays.length;
    validDays.sort((a, b) => a.rate - b.rate);
    const worstDay = validDays[0];
    const bestDay = validDays[validDays.length - 1];
    const dayNames = ['Los lunes', 'Los martes', 'Los miércoles', 'Los jueves', 'Los viernes', 'Los sábados', 'Los domingos'];

    if (avg - worstDay.rate >= 0.18) {
      const dropPct = Math.round((avg - worstDay.rate) * 100);
      insights.push({
        id: `insight-weekday-drop-${worstDay.wd}`,
        kind: 'weekday',
        title: `${dayNames[worstDay.wd]} tienes un ${dropPct}% menos consistencia`,
        detail: `Tu promedio general es de ${Math.round(avg * 100)}%, pero ese día baja a ${Math.round(worstDay.rate * 100)}%. Prueba activar versiones mínimas esos días.`,
        confidence: 0.8,
        tone: 'attention',
      });
    }

    if (bestDay.rate - avg >= 0.15) {
      insights.push({
        id: `insight-weekday-peak-${bestDay.wd}`,
        kind: 'weekday',
        title: `${dayNames[bestDay.wd]} es tu día más consistente`,
        detail: `Alcanzas un ${Math.round(bestDay.rate * 100)}% de cumplimiento. Excelente momento para abordar hábitos clave o sesiones más complejas.`,
        confidence: 0.8,
        tone: 'positive',
      });
    }
  }

  /* 4. CORRELACIÓN ENTRE HÁBITOS (ej. Dormir temprano -> Ejercicio / Estudio) */
  const sleepHabit = data.habits.find((h) => h.name.toLowerCase().includes('dormir') || h.name.toLowerCase().includes('sueño'));
  const exerciseHabit = data.habits.find((h) => h.name.toLowerCase().includes('ejercicio') || h.name.toLowerCase().includes('entren'));

  if (sleepHabit && exerciseHabit) {
    let daysBothPossible = 0;
    let exerciseWhenSleptWell = 0;
    let sleptWellCount = 0;
    let exerciseWhenNotSlept = 0;
    let notSleptCount = 0;

    const testDays = rangeKeys(addDaysKey(ref, -50), addDaysKey(ref, -1));
    testDays.forEach((prevD) => {
      const nextD = addDaysKey(prevD, 1);
      const sleepLog = getLog(data, sleepHabit.id, prevD);
      const exLog = getLog(data, exerciseHabit.id, nextD);

      if (exerciseHabit.days.includes(weekdayIndex(nextD))) {
        daysBothPossible++;
        if (isDoneLog(sleepLog)) {
          sleptWellCount++;
          if (isDoneLog(exLog)) exerciseWhenSleptWell++;
        } else {
          notSleptCount++;
          if (isDoneLog(exLog)) exerciseWhenNotSlept++;
        }
      }
    });

    if (sleptWellCount >= 5 && notSleptCount >= 5) {
      const rateWell = exerciseWhenSleptWell / sleptWellCount;
      const rateBad = exerciseWhenNotSlept / notSleptCount;
      const boost = Math.round((rateWell - rateBad) * 100);

      if (boost >= 25) {
        insights.push({
          id: 'insight-correlation-sleep-exercise',
          kind: 'correlation',
          title: 'Dormir temprano multiplica tu probabilidad de entrenar',
          detail: `Completas ejercicio un ${boost}% más a menudo los días posteriores a cumplir tu hábito de descanso (${Math.round(rateWell * 100)}% vs ${Math.round(rateBad * 100)}%).`,
          confidence: 0.9,
          tone: 'positive',
          data: { rateWell, rateBad, boost },
        });
      }
    }
  }

  /* 5. RAZONES DE FALLA RECURRENTES */
  const failLogs = Object.values(data.logs).filter((l) => l.status === 'missed' && l.failReason);
  if (failLogs.length >= 6) {
    const counts: Record<string, number> = {};
    failLogs.forEach((l) => {
      if (l.failReason) counts[l.failReason] = (counts[l.failReason] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const [topReason, topCount] = sorted[0];
    const topPct = Math.round((topCount / failLogs.length) * 100);

    if (topPct >= 30) {
      insights.push({
        id: `insight-fail-reason-${topReason}`,
        kind: 'failure',
        title: `"${FAIL_REASON_LABELS[topReason as FailReason]}" es tu principal obstáculo (${topPct}%)`,
        detail: `De los fallos registrados, ${topCount} fueron por esta causa. Adaptar tus mínimos o tu horario puede neutralizar esta fricción.`,
        confidence: 0.85,
        tone: 'attention',
      });
    }
  }

  /* 6. DETECCIÓN DE HÁBITOS PROBLEMÁTICOS / BAJA CONSISTENCIA */
  activeHabits.forEach((h) => {
    const c = consistency(data, h, 30, ref);
    if (c != null && c < 0.35 && diffDays(habitStart(h), ref) >= 20) {
      insights.push({
        id: `insight-habit-low-${h.id}`,
        kind: 'trend',
        habitId: h.id,
        title: `«${h.name}» tiene baja consistencia (${Math.round(c * 100)}%)`,
        detail: `Lleva más de 20 días activo pero rara vez se completa. Quizás convenga reducir su dificultad, pasarlo a versión mínima o pausarlo temporalmente.`,
        confidence: 0.9,
        tone: 'attention',
      });
    }
  });

  /* 7. DETECCIÓN DE SOBRECARGA */
  if (activeHabits.length > MAX_ACTIVE_HABITS) {
    insights.push({
      id: 'insight-load-habits',
      kind: 'load',
      title: `Tienes ${activeHabits.length} hábitos activos simultáneos`,
      detail: `La aplicación optimiza para mejores hábitos, no para acumularlos. Te recomendamos auditar y mantener un máximo de ${MAX_ACTIVE_HABITS} para no dispersar tu atención.`,
      confidence: 0.95,
      tone: 'attention',
    });
  }

  // Filtrar los que el usuario ya haya descartado
  return insights.filter((i) => !data.dismissedInsights[i.id]);
}

/** DETECCIÓN DE ABANDONO GENERAL O POR HÁBITO (Punto 15) */
export interface AbandonmentAlert {
  type: 'general' | 'habit';
  habitId?: string;
  habitName?: string;
  recentRate: number;
  previousRate: number;
  dropPercentage: number;
  weeksData: number[];
}

/** Clave en dismissedInsights con la que se omite la alerta de abandono */
export const ABANDONMENT_DISMISS_ID = 'abandonment';
/** Días que la alerta queda en silencio tras omitirla o responder el chequeo */
const ABANDONMENT_SNOOZE_DAYS = 7;

export function detectAbandonment(data: AppData, ref = todayKey()): AbandonmentAlert | null {
  // Si el usuario la omitió o ya respondió el chequeo hace poco, no se vuelve a mostrar
  const lastSeen = [data.dismissedInsights[ABANDONMENT_DISMISS_ID], ...data.checkins.map((c) => c.at)]
    .filter(Boolean)
    .map((iso) => toKey(new Date(iso!)));
  if (lastSeen.some((k) => diffDays(k, ref) < ABANDONMENT_SNOOZE_DAYS)) return null;

  const activeHabits = data.habits.filter((h) => h.status === 'active');
  if (activeHabits.length === 0) return null;

  // Consistencia de las últimas 4 semanas. Sin datos reales en alguna semana no hay base para comparar:
  // no se inventan valores (antes se rellenaban y los usuarios nuevos recibían falsas alertas).
  const w4 = periodConsistency(data, addDaysKey(ref, -27), addDaysKey(ref, -21), activeHabits, ref);
  const w3 = periodConsistency(data, addDaysKey(ref, -20), addDaysKey(ref, -14), activeHabits, ref);
  const w2 = periodConsistency(data, addDaysKey(ref, -13), addDaysKey(ref, -7), activeHabits, ref);
  const w1 = periodConsistency(data, addDaysKey(ref, -6), ref, activeHabits, ref);
  if (w4 == null || w3 == null || w2 == null || w1 == null) return null;

  const previousAvg = (w4 + w3 + w2) / 3;
  const recentRate = w1;

  if (previousAvg >= 0.65 && recentRate <= 0.45 && previousAvg - recentRate >= 0.25) {
    return {
      type: 'general',
      recentRate,
      previousRate: previousAvg,
      dropPercentage: Math.round((previousAvg - recentRate) * 100),
      weeksData: [Math.round(w4 * 100), Math.round(w3 * 100), Math.round(w2 * 100), Math.round(w1 * 100)],
    };
  }

  // Buscar hábito individual con caída drástica
  for (const h of activeHabits) {
    if (diffDays(habitStart(h), ref) < 28) continue;
    const prevC = consistency(data, h, 30, addDaysKey(ref, -14));
    const recentC = consistency(data, h, 14, ref);
    if (prevC != null && recentC != null && prevC >= 0.7 && recentC <= 0.35) {
      return {
        type: 'habit',
        habitId: h.id,
        habitName: h.name,
        recentRate: recentC,
        previousRate: prevC,
        dropPercentage: Math.round((prevC - recentC) * 100),
        weeksData: [Math.round(prevC * 100), Math.round(recentC * 100)],
      };
    }
  }

  return null;
}
