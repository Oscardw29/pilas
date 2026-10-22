import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptyData } from '@/data/seed';
import { UserDb } from '@/db/localDb';
import { importLegacyData } from '@/db/legacyImport';

const habit = (id: string, name: string) => ({ id, name }) as never;

async function accountWith(...names: [string, string][]) {
  const db = new UserDb(`legacy-${Math.random()}`);
  await db.records.bulkPut(
    names.map(([id, name]) => ({ key: `habits:${id}`, value: { id, name }, updatedAt: Date.now() - 1000, deleted: 0 as const, dirty: 0 as const })),
  );
  return db;
}

describe('datos de una versión anterior', () => {
  it('combinar: añade lo que falta y respeta lo de la cuenta', async () => {
    const db = await accountWith(['a', 'Cuenta A']);
    const local = createEmptyData();
    local.habits = [habit('a', 'Local A'), habit('b', 'Local B')];
    await importLegacyData(db, local, 'merge');
    expect((await db.records.get('habits:a'))?.value).toEqual({ id: 'a', name: 'Cuenta A' });
    expect((await db.records.get('habits:b'))?.value).toEqual({ id: 'b', name: 'Local B' });
    expect((await db.records.get('habits:b'))?.dirty).toBe(1);
  });

  it('reemplazar: gana este dispositivo y lo demás de la cuenta se borra', async () => {
    const db = await accountWith(['a', 'Cuenta A'], ['c', 'Cuenta C']);
    const local = createEmptyData();
    local.habits = [habit('a', 'Local A')];
    await importLegacyData(db, local, 'replace');
    expect((await db.records.get('habits:a'))?.value).toEqual({ id: 'a', name: 'Local A' });
    expect((await db.records.get('habits:c'))?.deleted).toBe(1);
    expect((await db.records.get('habits:c'))?.dirty).toBe(1);
  });
});
