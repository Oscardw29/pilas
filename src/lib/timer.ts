import { useEffect, useState } from 'react';
import type { ActiveTimer, Habit, HabitLog } from '@/types';
import { minimumMinutesFor } from '@/store/useStore';

/**
 * LÓGICA COMPARTIDA DEL TEMPORIZADOR (vista, modal y barra flotante).
 * El tiempo se calcula siempre por diferencia con Date.now(): no deriva aunque la pestaña esté en segundo plano.
 */

/** Segundos activos (sin pausas) de un temporizador */
export function elapsedSeconds(t: ActiveTimer, now = Date.now()): number {
  const start = new Date(t.startedAt).getTime();
  const pausedNow = t.pausedAt ? now - new Date(t.pausedAt).getTime() : 0;
  return Math.max(0, Math.round((now - start - t.pausedMs - pausedNow) / 1000));
}

/** Segundos transcurridos, actualizados cada segundo (y al volver a la pestaña) */
export function useElapsed(timer: ActiveTimer | null | undefined): number {
  const [seconds, setSeconds] = useState(() => (timer ? elapsedSeconds(timer) : 0));

  useEffect(() => {
    if (!timer) {
      setSeconds(0);
      return;
    }
    const tick = () => setSeconds(elapsedSeconds(timer));
    tick();
    // Pausado: el valor no cambia, no hace falta intervalo
    if (timer.pausedAt) return;
    const interval = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [timer]);

  return seconds;
}

export interface TimerProgress {
  isCustom: boolean;
  title: string;
  icon: string;
  /** Meta del hábito (o duración del temporizador libre) en minutos */
  targetMin: number;
  /** Minutos ya registrados hoy antes de esta sesión */
  alreadyLoggedMin: number;
  /** Duración objetivo de ESTA sesión (lo que falta para la meta de hoy) */
  sessionTargetSec: number;
  remainingSec: number;
  isCompleted: boolean;
  /** Segundos por encima del objetivo de la sesión */
  overtimeSec: number;
  minMin: number;
  hasReachedMinimum: boolean;
  /** 1 al inicio → 0 al agotarse */
  fractionRemaining: number;
  /** Posición del mínimo dentro de la meta (0-1), para la marca del anillo */
  minFraction: number;
}

export function computeTimerProgress(
  timer: ActiveTimer,
  habit: Habit | null | undefined,
  todayLog: HabitLog | undefined,
  minimumRatio: number,
  elapsed: number
): TimerProgress {
  const isCustom = Boolean(timer.isCustom);
  const customMin = timer.customMinutes ?? 25;
  const targetMin = isCustom ? customMin : habit?.targetMinutes ?? 25;
  const alreadyLoggedMin = isCustom ? 0 : todayLog?.minutes || 0;
  const remainingTargetMin = isCustom ? customMin : Math.max(0, targetMin - alreadyLoggedMin);
  const sessionTargetSec = (isCustom ? customMin : remainingTargetMin > 0 ? remainingTargetMin : targetMin) * 60;
  const remainingSec = Math.max(0, sessionTargetSec - elapsed);
  const minMin = isCustom || !habit ? 0 : minimumMinutesFor({ ...habit, targetMinutes: targetMin }, minimumRatio);
  const totalMinDoneToday = alreadyLoggedMin + Math.floor(elapsed / 60);

  return {
    isCustom,
    title: isCustom ? timer.customTitle || 'Temporizador libre' : habit?.name ?? 'Sesión',
    icon: isCustom ? timer.customIcon || '⏱️' : habit?.icon ?? '⏱️',
    targetMin,
    alreadyLoggedMin,
    sessionTargetSec,
    remainingSec,
    isCompleted: elapsed >= sessionTargetSec,
    overtimeSec: Math.max(0, elapsed - sessionTargetSec),
    minMin,
    hasReachedMinimum: !isCustom && minMin > 0 && totalMinDoneToday >= minMin,
    fractionRemaining: sessionTargetSec > 0 ? Math.max(0, Math.min(1, remainingSec / sessionTargetSec)) : 0,
    minFraction: targetMin > 0 ? Math.min(1, minMin / targetMin) : 0,
  };
}
