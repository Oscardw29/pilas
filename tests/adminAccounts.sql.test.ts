import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pgSupabase';

/** Cuentas en el panel del creador (supabase/migrations/0005_cuentas_panel.sql) contra un Postgres real en memoria */

let db: TestDb;
let admin: string;
let ana: string;
let sinPerfil: string;

const fails = async (p: Promise<unknown>, message: RegExp) => {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(String((err as Error | null)?.message)).toMatch(message);
};

const accounts = async () => (await db.as<{ r: Record<string, unknown>[] }>(admin, `select public.admin_accounts() as r`))[0].r;
const remove = (uid: string | null, target: string, reason = 'Prueba') => db.as(uid, `select public.admin_delete_account($1, $2)`, [target, reason]);

beforeAll(async () => {
  db = await createTestDb();
  admin = await db.user('oscarwis2009@gmail.com', 400);
  ana = await db.user('ana@example.com', 30);
  sinPerfil = await db.user('nuevo@example.com', 1);
  await db.sql(`insert into public.app_admins (user_id) values ($1) on conflict do nothing`, [admin]);
  await db.as(ana, `insert into public.profiles (user_id, alias) values ($1, 'ana')`, [ana]);
}, 60_000);

describe('cuentas en el panel del creador', () => {
  it('lista todas las cuentas, con perfil o sin él, y al propio creador', async () => {
    const rows = await accounts();
    expect(rows.map((r) => r.email).sort()).toEqual(['ana@example.com', 'nuevo@example.com', 'oscarwis2009@gmail.com']);
    expect(rows.find((r) => r.user_id === sinPerfil)).toMatchObject({ has_profile: false, is_admin: false });
    expect(rows.find((r) => r.user_id === ana)).toMatchObject({ has_profile: true, alias: 'ana' });
    expect(rows.find((r) => r.user_id === admin)).toMatchObject({ is_admin: true });
  });

  it('solo el creador puede ver y eliminar cuentas', async () => {
    await fails(db.as(ana, `select public.admin_accounts()`), /Solo el creador/);
    await fails(db.as(null, `select public.admin_accounts()`), /permission denied/);
    await fails(remove(ana, sinPerfil), /Solo el creador/);
    await fails(remove(null, sinPerfil), /permission denied/);
  });

  it('pide motivo y no elimina cuentas de creador por esta vía', async () => {
    await fails(remove(admin, ana, '  '), /motivo/);
    await fails(remove(admin, admin), /creador/);
  });

  it('elimina la cuenta con sus datos y deja registro sin datos personales', async () => {
    await remove(admin, ana, 'Spam');
    expect(await db.sql(`select 1 from auth.users where id = $1`, [ana])).toHaveLength(0);
    expect(await db.sql(`select 1 from public.profiles where user_id = $1`, [ana])).toHaveLength(0);
    const [log] = await db.sql<{ reason: string; data: Record<string, unknown> }>(`select reason, data from public.moderation_actions where action = 'delete_account'`);
    expect(log).toEqual({ reason: 'Spam', data: { user_id: ana } });
    await fails(remove(admin, ana), /ya no existe/);
  });

  it('el creador no puede eliminar su propia cuenta; los demás sí', async () => {
    await fails(db.as(admin, `select public.delete_my_account()`), /no se puede eliminar/);
    expect(await db.sql(`select 1 from auth.users where id = $1`, [admin])).toHaveLength(1);
    await db.as(sinPerfil, `select public.delete_my_account()`);
    expect(await db.sql(`select 1 from auth.users where id = $1`, [sinPerfil])).toHaveLength(0);
  });
});
