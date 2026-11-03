import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pgSupabase';

/**
 * Datos legibles y dispositivos verificados (supabase/migrations/0006_sin_cifrado_dispositivos.sql)
 * contra un Postgres real en memoria.
 */

let db: TestDb;
let ana: string;
let beto: string;

const PHONE = 'telefono-de-ana-0123456789abcdefghijklmnopqrstuv';
const LAPTOP = 'portatil-de-ana-0123456789abcdefghijklmnopqrstuv';
const now = () => Math.floor(Date.now() / 1000);

const fails = async (p: Promise<unknown>, message: RegExp) => {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(String((err as Error | null)?.message)).toMatch(message);
};

/** Como `db.as`, con el `amr` del JWT (cómo se abrió la sesión) */
async function asSession<T = Record<string, unknown>>(uid: string, amr: { method: string; timestamp: number }[], query: string, params: unknown[] = []) {
  await db.pg.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: uid, amr })]);
  try {
    return await db.as<T>(uid, query, params);
  } finally {
    await db.pg.query(`select set_config('request.jwt.claims', '', false)`);
  }
}

const body = (k: string, v: unknown, t: number) => ({ rid: k, body: { k, v, t, d: false }, client_updated_at: new Date(t).toISOString(), deleted: false });
const push = (uid: string, device: string, rows: unknown[]) => db.as(uid, `select public.push_records($1::jsonb, $2) as n`, [JSON.stringify(rows), device]);
const pull = (uid: string, device: string) =>
  db.as<{ rid: string; body: { v: unknown } | null; ciphertext: string | null }>(uid, `select * from public.pull_records(null, '', 100, $1)`, [device]);

beforeAll(async () => {
  db = await createTestDb();
  ana = await db.user('ana@example.com');
  beto = await db.user('beto@example.com');
});

describe('dispositivos verificados', () => {
  it('con solo la contraseña no se puede verificar un dispositivo', async () => {
    await fails(asSession(ana, [{ method: 'password', timestamp: now() }], `select public.trust_device($1, 'Teléfono')`, [PHONE]), /código/);
    expect((await db.as<{ ok: boolean }>(ana, `select public.device_status($1) as ok`, [PHONE]))[0].ok).toBe(false);
  });

  it('un código del correo antiguo (más de 15 min) tampoco sirve', async () => {
    await fails(asSession(ana, [{ method: 'otp', timestamp: now() - 3600 }], `select public.trust_device($1, 'Teléfono')`, [PHONE]), /código/);
  });

  it('con un código del correo reciente queda verificado', async () => {
    await asSession(ana, [{ method: 'password', timestamp: now() - 60 }, { method: 'otp', timestamp: now() }], `select public.trust_device($1, 'Teléfono')`, [PHONE]);
    expect((await db.as<{ ok: boolean }>(ana, `select public.device_status($1) as ok`, [PHONE]))[0].ok).toBe(true);
    // Es de Ana: para Beto ese dispositivo no está verificado
    expect((await db.as<{ ok: boolean }>(beto, `select public.device_status($1) as ok`, [PHONE]))[0].ok).toBe(false);
  });

  it('el servidor no guarda el identificador real del dispositivo', async () => {
    const rows = await db.sql<{ token_hash: string }>(`select token_hash from public.trusted_devices where user_id = $1`, [ana]);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].token_hash).not.toContain('telefono');
    // Y nadie con sesión puede leer la tabla directamente
    await fails(db.as(ana, `select * from public.trusted_devices`), /permission denied/);
  });
});

describe('registros legibles', () => {
  it('solo desde un dispositivo verificado', async () => {
    await fails(push(ana, LAPTOP, [body('habits:h1', { name: 'Leer' }, 1000)]), /no verificado/);
    await fails(pull(ana, LAPTOP), /no verificado/);
    // Tampoco a mano, saltándose las funciones
    await fails(db.as(ana, `select * from public.records`), /permission denied/);
  });

  it('se suben y se bajan legibles; cada cuenta ve solo lo suyo', async () => {
    expect((await push(ana, PHONE, [body('habits:h1', { name: 'Leer' }, 1000), body('single:settings', { userName: 'Ana' }, 1000)]))[0].n).toBe(2);
    const rows = await pull(ana, PHONE);
    expect(rows.map((r) => r.rid).sort()).toEqual(['habits:h1', 'single:settings']);
    expect(rows.find((r) => r.rid === 'habits:h1')?.body?.v).toEqual({ name: 'Leer' });
    await asSession(beto, [{ method: 'otp', timestamp: now() }], `select public.trust_device($1, 'PC')`, [LAPTOP]);
    expect(await pull(beto, LAPTOP)).toHaveLength(0);
  });

  it('gana el cambio más reciente', async () => {
    await push(ana, PHONE, [body('habits:h1', { name: 'viejo' }, 500)]);
    expect((await pull(ana, PHONE)).find((r) => r.rid === 'habits:h1')?.body?.v).toEqual({ name: 'Leer' });
    await push(ana, PHONE, [body('habits:h1', { name: 'nuevo' }, 2000)]);
    expect((await pull(ana, PHONE)).find((r) => r.rid === 'habits:h1')?.body?.v).toEqual({ name: 'nuevo' });
  });

  it('la conversión de una cuenta de antes borra lo cifrado y la fila de claves', async () => {
    await db.sql(
      `insert into public.records (user_id, rid, ciphertext, client_updated_at) values ($1, 'opaco-0123456789abcdef', 'xxx', now())`,
      [ana],
    );
    await db.sql(
      `insert into public.user_keys (user_id, key_id, kdf, wrapped_dek_pw, wrapped_dek_recovery) values ($1, gen_random_uuid(), '{}', 'a', 'b')`,
      [ana],
    );
    expect((await pull(ana, PHONE)).find((r) => r.rid === 'opaco-0123456789abcdef')?.ciphertext).toBe('xxx');
    await db.as(ana, `select public.finish_plaintext_migration($1)`, [PHONE]);
    expect((await pull(ana, PHONE)).some((r) => r.ciphertext)).toBe(false);
    expect(await db.sql(`select 1 from public.user_keys where user_id = $1`, [ana])).toHaveLength(0);
    expect((await pull(ana, PHONE)).length).toBe(2);
  });

  it('al recuperar la cuenta se olvidan los demás dispositivos', async () => {
    await asSession(ana, [{ method: 'otp', timestamp: now() }], `select public.trust_device($1, 'Portátil')`, [LAPTOP]);
    await asSession(ana, [{ method: 'recovery', timestamp: now() }], `select public.forget_other_devices($1)`, [LAPTOP]);
    expect((await db.as<{ ok: boolean }>(ana, `select public.device_status($1) as ok`, [PHONE]))[0].ok).toBe(false);
    expect((await db.as<{ ok: boolean }>(ana, `select public.device_status($1) as ok`, [LAPTOP]))[0].ok).toBe(true);
  });
});
