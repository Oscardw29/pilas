import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from './useStore';
import { economySummary, type EconomySummary } from '@/lib/economy';
import { todayKey } from '@/lib/dates';

/** Saldo de monedas, XP total y por día (solo se recalcula cuando cambian los datos que influyen) */
export function useEconomy(): EconomySummary {
  const d = useStore(
    useShallow((s) => ({
      habits: s.habits,
      logs: s.logs,
      pointEvents: s.pointEvents,
      redemptions: s.redemptions,
      streakFreezes: s.streakFreezes,
      xpBoosts: s.xpBoosts,
      minimumRatio: s.settings.minimumRatio,
      economyStartDate: s.settings.economyStartDate,
    })),
  );
  const today = todayKey();
  return useMemo(
    () => economySummary({ ...d, settings: { minimumRatio: d.minimumRatio, economyStartDate: d.economyStartDate } }, today),
    [d, today],
  );
}
