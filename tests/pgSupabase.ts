import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/**
 * Postgres en memoria (PGlite) con lo mínimo de Supabase para probar las migraciones de verdad:
 * roles `anon`/`authenticated`, `auth.users` + `auth.uid()`, Storage (buckets, objetos y `foldername`) y los
 * privilegios por defecto que Supabase da en `public` (así una tabla sin `revoke` se detecta en las pruebas).
 */
const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid default auth.uid());
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to authenticated;
`;

const migration = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

export interface TestDb {
  pg: PGlite;
  /** Como superusuario (salta RLS): para preparar datos */
  sql: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
  /** Como una persona con sesión (rol `authenticated`), o sin sesión si uid es null */
  as: <T = Record<string, unknown>>(uid: string | null, query: string, params?: unknown[]) => Promise<T[]>;
  /** Como la función de servidor `pilas-ai` (rol `service_role`) */
  service: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
  /** Crea una cuenta en auth.users y devuelve su id */
  user: (email: string, createdDaysAgo?: number) => Promise<string>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(SHIM);
  await pg.exec(migration('0001_init.sql'));
  await pg.exec(migration('0002_social.sql'));
  await pg.exec(migration('0003_perfiles_ligas.sql'));
  await pg.exec(migration('0004_ia_de_la_app.sql'));

  const sql = async <T,>(query: string, params: unknown[] = []) => (await pg.query<T>(query, params)).rows;
  const as = async <T,>(uid: string | null, query: string, params: unknown[] = []) => {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
    await pg.exec(uid ? 'set role authenticated' : 'set role anon');
    try {
      return (await pg.query<T>(query, params)).rows;
    } finally {
      await pg.exec('reset role');
      await pg.query(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  };
  const service = async <T,>(query: string, params: unknown[] = []) => {
    await pg.exec('set role service_role');
    try {
      return (await pg.query<T>(query, params)).rows;
    } finally {
      await pg.exec('reset role');
    }
  };
  let n = 0;
  const user = async (email: string, createdDaysAgo = 0) => {
    const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    await sql(`insert into auth.users (id, email, created_at) values ($1, $2, now() - make_interval(days => $3))`, [id, email, createdDaysAgo]);
    return id;
  };
  return { pg, sql, as, service, user };
}

/** Vuelve a ejecutar la última migración de la capa pública (0003 se puede repetir; 0002 ya no se ejecuta encima de 0003) */
export const reapplySocialMigration = (db: TestDb) => db.pg.exec(migration('0003_perfiles_ligas.sql'));

/** 0004 también se puede repetir */
export const reapplyAppAiMigration = (db: TestDb) => db.pg.exec(migration('0004_ia_de_la_app.sql'));
