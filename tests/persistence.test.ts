import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/localDb';
import { applyRemoteKeys, attachPersistence, detachPersistence, flushNow, hydrateFromDb } from '@/db/persistence';
import { mergeSettings, useStore } from '@/store/useStore';

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

  it('arrancar no vuelve a subir lo que no cambió (un dispositivo desfasado no pisa los ajustes ni los datos de otro)', async () => {
    const db = new UserDb(`persist-avatar-${Math.random()}`);
    // Ajustes tal como los guarda la app (completos), sin foto ni foto por defecto elegida y con un cambio de datos
    const value = mergeSettings({ userName: 'Leo', economyStartDate: '2026-10-01', demoMode: false, dataResetAt: '2026-10-20T10:00:00.000Z' });
    await db.records.put({ key: 'single:settings', value, updatedAt: 1, deleted: 0, dirty: 0 });
    const goal = { id: 'g1', name: 'Correr', description: '', category: 'Salud', icon: '🏃', color: '#fff', startDate: '2026-10-01', status: 'active', priority: 2, createdAt: '2026-10-01T00:00:00.000Z' };
    await db.records.put({ key: 'goals:g1', value: goal, order: 0, updatedAt: 1, deleted: 0, dirty: 0 });
    await hydrateFromDb(db);
    expect(useStore.getState().settings.avatarPreset).toBeUndefined();
    attachPersistence(db);
    await flushNow();
    // Sin cambios: no se marcan para subir ni cambia su hora (si no, ganarían a los cambios más nuevos de otro dispositivo)
    for (const key of ['single:settings', 'goals:g1']) {
      const saved = await db.records.get(key);
      expect(saved?.dirty, key).toBe(0);
      expect(saved?.updatedAt, key).toBe(1);
    }
    expect(((await db.records.get('single:settings'))?.value as { avatarPreset?: number }).avatarPreset).toBeUndefined();
    detachPersistence();
  });

  it('aplicar cambios remotos no pisa ediciones locales sin guardar', async () => {
    const db = new UserDb(`persist-remote-${Math.random()}`);
    await hydrateFromDb(db);
    attachPersistence(db);
    await flushNow();
    const goal = useStore.getState().addGoal({
      name: 'Local', description: '', category: 'x', icon: '🎯', color: '#fff', startDate: '2026-10-01', status: 'active', priority: 1,
    });
    // Llega de otro dispositivo un ajuste nuevo mientras el objetivo aún no se guardó
    await db.records.put({ key: 'single:hasStreakFreeze', value: true, updatedAt: Date.now() + 5000, deleted: 0, dirty: 0 });
    await applyRemoteKeys(['single:hasStreakFreeze']);
    expect(useStore.getState().hasStreakFreeze).toBe(true);
    expect(useStore.getState().goals.some((g) => g.id === goal.id)).toBe(true);
    await flushNow();
    expect((await db.records.get(`goals:${goal.id}`))?.dirty).toBe(1);
    detachPersistence();
  });
});
