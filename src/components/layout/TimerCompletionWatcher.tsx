import { useEffect, useRef } from 'react';
import { useStore } from '@/store/useStore';
import { computeTimerProgress, useElapsed } from '@/lib/timer';
import { getLog } from '@/lib/metrics';
import { todayKey } from '@/lib/dates';
import { playSound } from '@/lib/sound';
import { showSystemNotification, getNotificationPermission } from '@/lib/notifications';
import { useToast } from '@/components/ui/ToastContext';

/**
 * Avisa UNA vez cuando el temporizador activo llega a su objetivo, aunque el modal esté cerrado
 * o la pestaña en segundo plano (en ese caso con una notificación del sistema). El reloj sigue
 * contando el tiempo extra hasta que el usuario termina la sesión.
 */
export function TimerCompletionWatcher() {
  const activeTimer = useStore((s) => s.activeTimer);
  const habits = useStore((s) => s.habits);
  const logs = useStore((s) => s.logs);
  const minimumRatio = useStore((s) => s.settings.minimumRatio);
  const elapsed = useElapsed(activeTimer);
  const { toast } = useToast();
  const notifiedFor = useRef<string | null>(null);

  const habit = activeTimer?.habitId ? habits.find((h) => h.id === activeTimer.habitId) : null;
  const progress = activeTimer
    ? computeTimerProgress(activeTimer, habit, habit ? getLog({ logs }, habit.id, todayKey()) : undefined, minimumRatio, elapsed)
    : null;

  useEffect(() => {
    if (!activeTimer || !progress?.isCompleted) return;
    if (notifiedFor.current === activeTimer.startedAt) return;
    notifiedFor.current = activeTimer.startedAt;

    playSound.complete();
    toast(`¡Objetivo alcanzado en «${progress.title}»!`, 'success', 'El reloj sigue contando: termina la sesión cuando quieras.');
    if (document.hidden && getNotificationPermission() === 'granted') {
      void showSystemNotification({
        title: `⏰ ¡Tiempo cumplido: ${progress.title}!`,
        body: 'Has alcanzado el objetivo de la sesión. Vuelve a ¡Pilas! para registrarla.',
        tag: `timer-${activeTimer.startedAt}`,
      });
    }
  }, [activeTimer, progress?.isCompleted, progress?.title, toast]);

  return null;
}
