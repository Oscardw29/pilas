import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, reapplyAppAiMigration, type TestDb } from './pgSupabase';

/**
 * IA de la app (supabase/migrations/0004_ia_de_la_app.sql) contra un Postgres real en memoria: la clave del creador no
 * puede salir hacia la app por ningún camino y el límite diario se cumple.
 */

const SECRET = 'clave-secreta-del-creador-1234';

let db: TestDb;
let admin: string;
let ana: string;
let beto: string;

const fails = async (p: Promise<unknown>, message?: RegExp) => {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'debía fallar').not.toBeNull();
  if (message) expect(String((err as Error).message)).toMatch(message);
};

const setService = (uid: string, service: string, provider: string, key: string, limit = 2) =>
  db.as(uid, `select public.admin_set_ai_service($1, $2, $3, 'modelo-a', 'modelo-b', '', $4)`, [service, provider, key, limit]);
const authorize = async (uid: string, service = 'llm') =>
  (await db.service<{ r: Record<string, unknown> }>(`select public.ai_authorize($1, $2) as r`, [uid, service]))[0].r;
const status = async (uid: string) => (await db.as<{ r: Record<string, unknown> }>(uid, `select public.ai_status() as r`))[0].r;

beforeAll(async () => {
  db = await createTestDb();
  admin = await db.user('oscarwis2009@gmail.com', 400);
  ana = await db.user('ana@example.com', 30);
  beto = await db.user('beto@example.com', 30);
  await db.sql(`insert into public.app_admins (user_id) values ($1) on conflict do nothing`, [admin]);
}, 60_000);

describe('IA de la app', () => {
  it('solo el creador pone claves, y con un proveedor válido', async () => {
    await fails(setService(ana, 'llm', 'gemini', SECRET), /Solo el creador/);
    await fails(setService(admin, 'llm', 'deepgram', SECRET), /Proveedor no válido/);
    await fails(setService(admin, 'otro', 'gemini', SECRET), /Servicio no válido/);
    await fails(setService(admin, 'llm', 'gemini', ''), /Pega la clave/);
    await setService(admin, 'llm', 'gemini', SECRET);
    expect(await status(ana)).toEqual({ llm: { provider: 'gemini', model: 'modelo-a' } });
  });

  it('la clave no se puede leer desde la app por ningún camino', async () => {
    await fails(db.as(ana, `select * from public.app_ai_services`), /permission denied/);
    await fails(db.as(admin, `select * from public.app_ai_services`), /permission denied/);
    await fails(db.as(null, `select * from public.app_ai_services`), /permission denied/);
    await fails(db.as(ana, `select public.ai_authorize($1, 'llm')`, [ana]), /permission denied/);
    await fails(db.as(admin, `select public.ai_authorize($1, 'llm')`, [admin]), /permission denied/);
    await fails(db.as(null, `select public.ai_status()`), /permission denied/);

    expect(JSON.stringify(await status(ana))).not.toContain(SECRET);
    const panel = (await db.as<{ r: Record<string, unknown>[] }>(admin, `select public.admin_ai_services() as r`))[0].r;
    expect(JSON.stringify(panel)).not.toContain(SECRET);
    expect(panel[0]).toMatchObject({ service: 'llm', key_hint: '1234', model: 'modelo-a', backup_model: 'modelo-b', daily_limit: 2 });
    await fails(db.as(ana, `select public.admin_ai_services()`), /Solo el creador/);

    const log = await db.sql<{ data: unknown }>(`select data from public.moderation_actions where action = 'ai_service_set'`);
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toContain(SECRET);
  });

  it('cambiar el modelo sin pegar la clave la conserva', async () => {
    await db.as(admin, `select public.admin_set_ai_service('llm', 'gemini', '', 'modelo-c', '', '', 2)`);
    expect(await authorize(ana)).toMatchObject({ ok: true, api_key: SECRET, model: 'modelo-c' });
    await db.sql(`delete from public.ai_usage`);
  });

  it('cuenta los usos por persona y corta al llegar al límite', async () => {
    expect((await authorize(ana)).ok).toBe(true);
    expect((await authorize(ana)).ok).toBe(true);
    expect(await authorize(ana)).toEqual({ ok: false, reason: 'quota', limit: 2 });
    // El tope no se pasa aunque se insista, y es de cada persona
    await authorize(ana);
    expect((await db.sql<{ used: number }>(`select used from public.ai_usage where user_id = $1`, [ana]))[0].used).toBe(2);
    expect((await authorize(beto)).ok).toBe(true);
  });

  it('el creador no tiene tope para poder hacer pruebas', async () => {
    for (let i = 0; i < 4; i++) expect((await authorize(admin)).ok).toBe(true);
  });

  it('una cuenta vetada no puede usarla', async () => {
    await db.sql(`insert into public.bans (user_id, reason, starts_at) values ($1, 'prueba', now())`, [beto]);
    expect(await authorize(beto)).toEqual({ ok: false, reason: 'banned' });
  });

  it('al quitar la clave desaparece del servidor y la app vuelve al modo local', async () => {
    await fails(db.as(ana, `select public.admin_clear_ai_service('llm')`), /Solo el creador/);
    await db.as(admin, `select public.admin_clear_ai_service('llm')`);
    expect(await status(ana)).toEqual({});
    expect(await authorize(ana)).toEqual({ ok: false, reason: 'unconfigured' });
    expect(await db.sql(`select 1 from public.app_ai_services`)).toHaveLength(0);
  });

  it('la migración se puede repetir sin perder las claves', async () => {
    await setService(admin, 'tts', 'fish_audio', SECRET);
    await reapplyAppAiMigration(db);
    expect((await authorize(ana, 'tts')).api_key).toBe(SECRET);
  });
});
