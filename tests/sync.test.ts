import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deriveAccountKeys, generateRootKey } from '@/crypto/keys';
import { UserDb, type LocalRecord } from '@/db/localDb';
import { syncOnce } from '@/sync/engine';
import { memoryRemote } from './memoryRemote';

let n = 0;
// Marcas recientes: las lápidas de más de 90 días se purgan en local
const T = Date.now() - 10_000;
const newDb = () => new UserDb(`test-${++n}-${Math.random()}`);
const rec = (key: string, value: unknown, updatedAt: number, extra: Partial<LocalRecord> = {}): LocalRecord => ({
  key, value, updatedAt, deleted: 0, dirty: 1, ...extra,
});

describe('sincronización', () => {
  it('lo que sube un dispositivo llega al otro, cifrado en el servidor', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.bulkPut([rec('habits:h1', { id: 'h1', name: 'Leer' }, T + 1000), rec('single:settings', { userName: 'Ana' }, T + 1000)]);
    expect((await syncOnce(a, keys, remote)).pushed).toBe(2);
    const onServer = JSON.stringify([...remote.rows.values()]);
    expect(onServer).not.toContain('Leer');
    expect(onServer).not.toContain('habits');
    expect((await syncOnce(b, keys, remote)).applied).toBe(2);
    expect((await b.records.get('habits:h1'))?.value).toEqual({ id: 'h1', name: 'Leer' });
    expect((await a.records.get('habits:h1'))?.dirty).toBe(0);
  });

  it('conflicto: gana el cambio más reciente, en ambos sentidos', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.put(rec('habits:h1', { name: 'A viejo' }, T + 1000));
    await b.records.put(rec('habits:h1', { name: 'B nuevo' }, T + 2000));
    await syncOnce(a, keys, remote);
    await syncOnce(b, keys, remote);
    await syncOnce(a, keys, remote);
    expect((await a.records.get('habits:h1'))?.value).toEqual({ name: 'B nuevo' });
    expect((await b.records.get('habits:h1'))?.value).toEqual({ name: 'B nuevo' });
  });

  it('los borrados viajan como lápidas', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.put(rec('goals:g1', { id: 'g1' }, T + 1000));
    await syncOnce(a, keys, remote);
    await syncOnce(b, keys, remote);
    await a.records.put(rec('goals:g1', null, T + 3000, { deleted: 1 }));
    await syncOnce(a, keys, remote);
    await syncOnce(b, keys, remote);
    expect((await b.records.get('goals:g1'))?.deleted).toBe(1);
  });

  it('pagina más de un lote con marcas de tiempo iguales sin perder registros', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.bulkPut(Array.from({ length: 1234 }, (_, i) => rec(`logs:${i}`, { i }, T + 1000)));
    await syncOnce(a, keys, remote);
    await syncOnce(b, keys, remote);
    expect(await b.records.count()).toBe(1234);
  });

  it('con otra clave de cuenta los registros no se pueden leer', async () => {
    const remote = memoryRemote();
    const a = newDb();
    await a.records.put(rec('habits:h1', { name: 'secreto' }, T + 1000));
    await syncOnce(a, await deriveAccountKeys(generateRootKey()), remote);
    const intruder = newDb();
    const res = await syncOnce(intruder, await deriveAccountKeys(generateRootKey()), remote);
    expect(res.undecryptable).toBe(1);
    expect(await intruder.records.count()).toBe(0);
  });

  it('un servidor manipulado no puede borrar ni mover registros', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    const a = newDb();
    await a.records.bulkPut([rec('habits:h1', { name: 'Leer' }, T + 1000), rec('habits:h2', { name: 'Correr' }, T + 1000)]);
    await syncOnce(a, keys, remote);
    const [r1, r2] = [...remote.rows.values()];
    // Marca «borrado» y una fecha futura sin poder tocar el contenido cifrado
    remote.rows.set(r1.rid, { ...r1, deleted: true, client_updated_at: new Date(T + 99_000).toISOString(), server_updated_at: '2030-01-01T00:00:00.000Z' });
    // Copia el texto cifrado de un registro en otro
    remote.rows.set(r2.rid, { ...r2, ciphertext: r1.ciphertext, server_updated_at: '2030-01-01T00:00:00.000Z' });
    const b = newDb();
    const res = await syncOnce(b, keys, remote);
    expect(res.undecryptable).toBe(1);
    expect((await b.records.get('habits:h1'))?.deleted).toBe(0);
    expect((await b.records.get('habits:h1'))?.value).toEqual({ name: 'Leer' });
  });
});
