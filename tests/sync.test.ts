import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deriveAccountKeys, generateRootKey, opaqueId, sealJson } from '@/crypto/keys';
import { UserDb, type LocalRecord } from '@/db/localDb';
import { migrateLegacy, syncOnce } from '@/sync/engine';
import type { RecordBody } from '@/sync/remote';
import { memoryRemote } from './memoryRemote';

let n = 0;
// Marcas recientes: las lápidas de más de 90 días se purgan en local
const T = Date.now() - 10_000;
const newDb = () => new UserDb(`test-${++n}-${Math.random()}`);
const rec = (key: string, value: unknown, updatedAt: number, extra: Partial<LocalRecord> = {}): LocalRecord => ({
  key, value, updatedAt, deleted: 0, dirty: 1, ...extra,
});

describe('sincronización', () => {
  it('lo que sube un dispositivo llega al otro', async () => {
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.bulkPut([rec('habits:h1', { id: 'h1', name: 'Leer' }, T + 1000), rec('single:settings', { userName: 'Ana' }, T + 1000)]);
    expect((await syncOnce(a, remote)).pushed).toBe(2);
    expect(remote.rows.get('habits:h1')?.body?.v).toEqual({ id: 'h1', name: 'Leer' });
    expect((await syncOnce(b, remote)).applied).toBe(2);
    expect((await b.records.get('habits:h1'))?.value).toEqual({ id: 'h1', name: 'Leer' });
    expect((await a.records.get('habits:h1'))?.dirty).toBe(0);
  });

  it('conflicto: gana el cambio más reciente, en ambos sentidos', async () => {
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.put(rec('habits:h1', { name: 'A viejo' }, T + 1000));
    await b.records.put(rec('habits:h1', { name: 'B nuevo' }, T + 2000));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    await syncOnce(a, remote);
    expect((await a.records.get('habits:h1'))?.value).toEqual({ name: 'B nuevo' });
    expect((await b.records.get('habits:h1'))?.value).toEqual({ name: 'B nuevo' });
  });

  it('los borrados viajan como lápidas', async () => {
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.put(rec('goals:g1', { id: 'g1' }, T + 1000));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    await a.records.put(rec('goals:g1', null, T + 3000, { deleted: 1 }));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    expect((await b.records.get('goals:g1'))?.deleted).toBe(1);
  });

  it('pagina más de un lote con marcas de tiempo iguales sin perder registros', async () => {
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.bulkPut(Array.from({ length: 1234 }, (_, i) => rec(`logs:${i}`, { i }, T + 1000)));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    expect(await b.records.count()).toBe(1234);
  }, 30_000);

  it('sin cambios nuevos no vuelve a bajar nada (solo repasa el último minuto una vez)', async () => {
    const remote = memoryRemote();
    let downloaded = 0;
    const counting = { ...remote, pull: async (...args: Parameters<typeof remote.pull>) => {
      const rows = await remote.pull(...args);
      downloaded += rows.length;
      return rows;
    } };
    const a = newDb();
    const b = newDb();
    await a.records.bulkPut(Array.from({ length: 300 }, (_, i) => rec(`logs:${i}`, { i }, T + 1000)));
    await syncOnce(a, remote);

    await syncOnce(b, counting);
    expect(downloaded).toBe(300);
    // El repaso del margen de seguridad vuelve a ver esas filas una vez…
    downloaded = 0;
    await syncOnce(b, counting);
    expect(downloaded).toBe(300);
    // …y a partir de ahí, sin cambios, cada sincronización baja 0 filas
    for (let i = 0; i < 5; i++) {
      downloaded = 0;
      await syncOnce(b, counting);
      expect(downloaded).toBe(0);
    }

    // Un cambio nuevo sí llega, y se repasa una sola vez
    await a.records.put(rec('habits:h1', { id: 'h1', name: 'Leer' }, T + 5000));
    await syncOnce(a, remote);
    downloaded = 0;
    expect((await syncOnce(b, counting)).applied).toBe(1);
    downloaded = 0;
    await syncOnce(b, counting);
    // El repaso abarca el minuto anterior al cambio (aquí también las 300 de antes, subidas 1 s antes)
    expect(downloaded).toBe(301);
    downloaded = 0;
    await syncOnce(b, counting);
    expect(downloaded).toBe(0);
    expect((await b.records.get('habits:h1'))?.value).toEqual({ id: 'h1', name: 'Leer' });
  }, 30_000);

  it('un registro que llega tarde dentro del margen no se pierde', async () => {
    const remote = memoryRemote();
    const a = newDb();
    const b = newDb();
    await a.records.put(rec('habits:h1', { id: 'h1' }, T + 1000));
    await syncOnce(a, remote);
    await syncOnce(b, remote);
    // Escritura que terminó después de la descarga pero con una marca anterior a lo ya visto
    const seenTs = remote.rows.get('habits:h1')!.server_updated_at;
    const late = new Date(Date.parse(seenTs) - 30_000).toISOString();
    remote.rows.set('habits:h2', { rid: 'habits:h2', body: { k: 'habits:h2', v: { id: 'h2' }, t: T + 2000 }, client_updated_at: new Date(T + 2000).toISOString(), deleted: false, server_updated_at: late } as never);
    await syncOnce(b, remote);
    expect((await b.records.get('habits:h2'))?.value).toEqual({ id: 'h2' });
  });
});

describe('cuentas de antes (datos cifrados)', () => {
  /** Sube filas en el formato antiguo: id opaco y contenido cifrado */
  async function seedLegacy(remote: ReturnType<typeof memoryRemote>, keys: Awaited<ReturnType<typeof deriveAccountKeys>>, items: RecordBody[]) {
    for (const p of items) {
      const rid = await opaqueId(keys.ridKey, p.k);
      remote.rows.set(rid, {
        rid,
        body: null,
        ciphertext: await sealJson(keys.encKey, p, rid),
        client_updated_at: new Date(p.t).toISOString(),
        deleted: p.d,
        server_updated_at: '2026-01-01T00:00:00.000Z',
      });
    }
  }

  it('con las claves antiguas se convierten a legibles; sin ellas no se pueden leer', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    await seedLegacy(remote, keys, [
      { k: 'habits:h1', v: { name: 'Leer' }, o: 0, t: T + 1000, d: false },
      { k: 'goals:g1', v: null, t: T + 1000, d: true },
    ]);

    const stranger = newDb();
    expect((await syncOnce(stranger, remote)).unreadable).toBe(2);
    expect(await stranger.records.count()).toBe(0);

    const a = newDb();
    const res = await migrateLegacy(a, remote, keys);
    expect(res.applied).toBe(2);
    expect((await a.records.get('habits:h1'))?.value).toEqual({ name: 'Leer' });
    // Ya están legibles en el servidor con su clave real
    expect(remote.rows.get('habits:h1')?.body?.v).toEqual({ name: 'Leer' });
    expect(remote.rows.get('goals:g1')?.body?.d).toBe(true);

    // Otro dispositivo sin las claves antiguas ya recibe los datos convertidos
    const b = newDb();
    await syncOnce(b, remote);
    expect((await b.records.get('habits:h1'))?.value).toEqual({ name: 'Leer' });
  });

  it('convertir no pisa un cambio local más reciente', async () => {
    const keys = await deriveAccountKeys(generateRootKey());
    const remote = memoryRemote();
    await seedLegacy(remote, keys, [{ k: 'habits:h1', v: { name: 'viejo' }, t: T + 1000, d: false }]);
    const a = newDb();
    await a.records.put(rec('habits:h1', { name: 'nuevo' }, T + 5000));
    await migrateLegacy(a, remote, keys);
    expect((await a.records.get('habits:h1'))?.value).toEqual({ name: 'nuevo' });
    expect(remote.rows.get('habits:h1')?.body?.v).toEqual({ name: 'nuevo' });
  });
});
