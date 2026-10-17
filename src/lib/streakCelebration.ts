import type { AppData, DateKey } from '@/types';
import { useStore } from '@/store/useStore';
import { calculateGlobalStreak, getDayStreakStatus } from './metrics';
import { todayKey } from './dates';
import { triggerStreakCelebration } from '@/components/ui/StreakCelebrationOverlay';

type StreakSnapshot = Pick<AppData, 'habits' | 'logs' | 'streakFreezes'>;

/** Captura el estado necesario ANTES de registrar un hábito */
export const streakSnapshot = (): StreakSnapshot => {
  const { habits, logs, streakFreezes } = useStore.getState();
  return { habits, logs, streakFreezes };
};

/**
 * Compara la racha de hoy antes y después de un registro y lanza la celebración si:
 * - hoy acaba de activarse la racha (primer hábito del día), o
 * - hoy acaba de convertirse en súper racha (todos los programados hechos).
 * Llamar justo DESPUÉS de `logHabit`, pasando el snapshot tomado antes.
 */
export function celebrateStreakChange(before: StreakSnapshot, date: DateKey): void {
  const T = todayKey();
  if (date !== T) return;
  const after = useStore.getState();
  const b = getDayStreakStatus(before, T);
  const a = getDayStreakStatus(after, T);

  // El sonido lo reproduce el overlay (antes sonaba dos veces: aquí y en el overlay)
  if (!b.hasStreak && a.hasStreak) {
    triggerStreakCelebration({ days: calculateGlobalStreak(after, T).streak, isSuper: a.isSuperStreak });
  } else if (!b.isSuperStreak && a.isSuperStreak) {
    triggerStreakCelebration({ days: calculateGlobalStreak(after, T).streak, isSuper: true });
  }
}
