import { describe, expect, it } from 'vitest';
import { useStore } from '@/store/useStore';
import { CHALLENGE_REWARD_POINTS, REWARD_MIN_COST, challengeSuccessDays, clampRewardCost } from '@/lib/economyRules';
import { addDaysKey, todayKey } from '@/lib/dates';

describe('retos', () => {
  it('los días para ganar se calculan con la duración (≈83 %)', () => {
    expect(challengeSuccessDays(30)).toBe(25);
    expect(challengeSuccessDays(21)).toBe(18);
    expect(challengeSuccessDays(7)).toBe(6);
    expect(challengeSuccessDays(60)).toBe(50);
    expect(challengeSuccessDays(365)).toBe(305);
  });

  it('crear o editar un reto fija los días para ganar y las 250 monedas, aunque se pidan otros valores', () => {
    const { addChallenge, updateChallenge } = useStore.getState();
    const ch = addChallenge({
      name: 'Madrugar', icon: '🌅', description: '', metric: 'Días', startDate: todayKey(),
      durationDays: 30, successDays: 2, rewardPoints: 5000,
    });
    expect(ch.successDays).toBe(25);
    expect(ch.rewardPoints).toBe(CHALLENGE_REWARD_POINTS);

    updateChallenge(ch.id, { durationDays: 21, successDays: 1, rewardPoints: 9999 });
    const edited = useStore.getState().challenges.find((c) => c.id === ch.id)!;
    expect(edited.successDays).toBe(18);
    expect(edited.rewardPoints).toBe(250);
  });

  it('no se puede marcar un día futuro; hoy y los anteriores sí', () => {
    const { addChallenge, toggleChallengeCheckin } = useStore.getState();
    const ch = addChallenge({
      name: 'Leer', icon: '📚', description: '', metric: 'Días', startDate: addDaysKey(todayKey(), -3),
      durationDays: 30, successDays: 25, rewardPoints: 250,
    });
    const tomorrow = addDaysKey(todayKey(), 1);
    toggleChallengeCheckin(ch.id, tomorrow);
    toggleChallengeCheckin(ch.id, todayKey());
    toggleChallengeCheckin(ch.id, addDaysKey(todayKey(), -2));
    const checkins = useStore.getState().challenges.find((c) => c.id === ch.id)!.checkins;
    expect(checkins).not.toContain(tomorrow);
    expect(checkins).toEqual([addDaysKey(todayKey(), -2), todayKey()]);
  });
});

describe('recompensas', () => {
  it('el costo mínimo es de 50 monedas', () => {
    expect(REWARD_MIN_COST).toBe(50);
    expect(clampRewardCost(10)).toBe(50);
    expect(clampRewardCost(120.4)).toBe(120);
    expect(clampRewardCost(Number.NaN)).toBe(50);

    const { addReward, updateReward } = useStore.getState();
    const rw = addReward({ name: 'Café', icon: '☕', cost: 5 });
    expect(rw.cost).toBe(50);
    updateReward(rw.id, { cost: 1 });
    expect(useStore.getState().rewards.find((r) => r.id === rw.id)!.cost).toBe(50);
  });
});
