import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pgSupabase';

/** Calificación con estrellas de /descargar (supabase/migrations/0008_calificaciones.sql) contra un Postgres real en memoria */

let db: TestDb;

const fails = async (p: Promise<unknown>, message: RegExp) => {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(String((err as Error | null)?.message)).toMatch(message);
};

const voter = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
type Summary = { average: number; count: number };
const rate = (n: number, stars: number) =>
  db.as<{ r: Summary }>(null, `select public.rate_app($1::uuid, $2) as r`, [voter(n), stars]).then((r) => r[0].r);
const summary = () => db.as<{ r: Summary }>(null, `select public.app_rating_summary() as r`).then((r) => r[0].r);
const fromIp = (ip: string | null) =>
  db.sql(`select set_config('request.headers', $1, false)`, [ip ? JSON.stringify({ 'x-forwarded-for': `${ip}, 10.0.0.1` }) : '']);

beforeAll(async () => {
  db = await createTestDb();
});

describe('calificaciones', () => {
  it('sin votos la media es 0', async () => {
    expect(await summary()).toEqual({ average: 0, count: 0 });
  });

  it('cualquiera vota sin cuenta y la media se actualiza', async () => {
    expect(await rate(1, 5)).toEqual({ average: 5, count: 1 });
    expect(await rate(2, 4)).toEqual({ average: 4.5, count: 2 });
  });

  it('el mismo equipo cambia su voto en vez de sumar otro', async () => {
    expect(await rate(2, 2)).toEqual({ average: 3.5, count: 2 });
  });

  it('solo de 1 a 5 estrellas', async () => {
    await fails(rate(3, 0), /1 a 5/);
    await fails(rate(3, 6), /1 a 5/);
  });

  it('nadie lee ni escribe la tabla directamente', async () => {
    await fails(db.as(null, `select * from public.app_ratings`), /permission denied/);
    await fails(db.as(null, `insert into public.app_ratings (voter, stars) values ($1, 5)`, [voter(9)]), /permission denied/);
    await fails(db.as(null, `select * from public.app_rating_log`), /permission denied/);
  });

  it('como mucho 5 votos nuevos al día por conexión; cambiar el voto sigue funcionando', async () => {
    await fromIp('203.0.113.7');
    for (let n = 10; n < 15; n++) await rate(n, 5);
    await fails(rate(15, 5), /varias calificaciones/);
    await rate(10, 1);
    await fromIp('198.51.100.2');
    await rate(15, 5);
    await fromIp(null);
    const [{ n }] = await db.sql<{ n: number }>(`select count(*)::int as n from public.app_rating_log where source like '%203.0.113.7%'`);
    expect(n).toBe(0);
  });
});
