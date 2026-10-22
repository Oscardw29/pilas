import { describe, expect, it } from 'vitest';
import { createEmptyData } from '@/data/seed';
import { fromRecords, recordOrders, toRecords } from '@/db/records';

describe('registros', () => {
  it('ida y vuelta conserva datos y orden, sin el temporizador del dispositivo', () => {
    const data = createEmptyData();
    data.habits = [{ id: 'b' } as never, { id: 'a' } as never];
    data.logs = { '2026-10-01|a': { habitId: 'a', date: '2026-10-01', status: 'full', points: 10, loggedAt: 'x' } };
    data.achievements = { first: '2026-10-01' };
    data.hasStreakFreeze = true;
    data.activeTimer = { startedAt: 'x', pausedMs: 0 };
    const recs = toRecords(data);
    expect(recs.has('single:activeTimer')).toBe(false);
    const orders = recordOrders(data);
    const back = fromRecords([...recs].reverse().map(([key, value]) => ({ key, value, order: orders.get(key) })));
    expect(back.habits.map((h) => h.id)).toEqual(['b', 'a']);
    expect(back.logs).toEqual(data.logs);
    expect(back.achievements).toEqual({ first: '2026-10-01' });
    expect(back.hasStreakFreeze).toBe(true);
    expect(back.activeTimer).toBeNull();
  });
});
