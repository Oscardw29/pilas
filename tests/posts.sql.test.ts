import { beforeAll, describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATES } from '@/social/texts';
import { createTestDb, type TestDb } from './pgSupabase';

/** Frases libres para publicar (supabase/migrations/0007_plantillas_libres.sql) contra un Postgres real en memoria */

let db: TestDb;
let ana: string;

const fails = async (p: Promise<unknown>, message: RegExp) => {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(String((err as Error | null)?.message)).toMatch(message);
};

beforeAll(async () => {
  db = await createTestDb();
  ana = await db.user('ana@example.com', 10);
  await db.as(ana, `insert into public.profiles (user_id, alias) values ($1, 'ana')`, [ana]);
});

describe('frases libres', () => {
  it('están disponibles sin cumplir nada y coinciden con las de la app', async () => {
    const tpls = (await db.as<{ r: { template: string; ref: string; data: { id: string } }[] }>(ana, `select public.available_post_templates() as r`))[0].r;
    const free = tpls.filter((t) => t.template === 'message');
    expect(free.map((t) => t.ref)).toEqual(MESSAGE_TEMPLATES.map((m) => m.id));
    expect(free.every((t) => t.data.id === t.ref)).toBe(true);
  });

  it('se publican tal cual; una frase inventada no', async () => {
    await db.as(ana, `select public.create_post('message', 'gracias', null)`);
    const [post] = await db.sql<{ template: string; data: { id: string } }>(`select template, data from public.posts where user_id = $1`, [ana]);
    expect(post).toMatchObject({ template: 'message', data: { id: 'gracias' } });
    await fails(db.as(ana, `select public.create_post('message', 'texto libre', null)`), /no está disponible/);
  });
});
