import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/localDb';
import { attachPersistence, detachPersistence, flushNow, hydrateFromDb } from '@/db/persistence';
import { useStore } from '@/store/useStore';

describe('persistencia del store', () => {
  it('solo marca como pendientes los registros que cambian', async () => {
    const db = new UserDb(`persist-${Math.random()}`);
    await hydrateFromDb(db);
    attachPersistence(db);
    await flushNow();
    const goal = useStore.getState().addGoal({
      name: 'Correr', description: '', category: 'Salud', icon: '🏃', color: '#fff', startDate: '2026-10-01', status: 'active', priority: 2,
    });
    await flushNow();
    expect((await db.records.get(`goals:${goal.id}`))?.dirty).toBe(1);

    // Simula que ya se subió todo
    await db.records.toCollection().modify({ dirty: 0 });
    useStore.getState().updateSettings({ userName: 'Ana' });
    await flushNow();
    expect(await db.records.where('dirty').equals(1).primaryKeys()).toEqual(['single:settings']);

    useStore.getState().deleteGoal(goal.id);
    await flushNow();
    expect((await db.records.get(`goals:${goal.id}`))?.deleted).toBe(1);

    // Otro arranque que lee esta base ve el ajuste y no el objetivo borrado
    detachPersistence();
    useStore.setState({ goals: [] });
    await hydrateFromDb(db);
    expect(useStore.getState().settings.userName).toBe('Ana');
    expect(useStore.getState().goals).toHaveLength(0);
  });
});
