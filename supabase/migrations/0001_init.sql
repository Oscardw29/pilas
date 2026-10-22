-- ¡Pilas! · Esquema de sincronización cifrada de extremo a extremo
--
-- El servidor solo guarda texto cifrado: no ve colecciones, ids reales ni valores.
-- Toda la seguridad de acceso descansa en RLS: cada usuario solo ve y escribe sus propias filas.
-- Aplicar en: Supabase → SQL Editor → pegar este archivo → Run (o `supabase db push`).

-- ---------------------------------------------------------------------------
-- Claves de la cuenta (envueltas: inútiles sin la contraseña o el código de recuperación)
-- ---------------------------------------------------------------------------
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kdf jsonb not null,
  wrapped_dek_pw text not null check (octet_length(wrapped_dek_pw) < 512),
  wrapped_dek_recovery text not null check (octet_length(wrapped_dek_recovery) < 512),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Registros cifrados
-- ---------------------------------------------------------------------------
create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rid text not null check (char_length(rid) between 16 and 64),
  ciphertext text not null check (octet_length(ciphertext) < 2000000),
  client_updated_at timestamptz not null,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, rid)
);

create index if not exists records_user_server_updated on public.records (user_id, server_updated_at, rid);

-- Marca del servidor en cada escritura (cursor de descarga); nadie puede fijarla a mano
create or replace function public.records_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.records_touch();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.user_keys enable row level security;
alter table public.records enable row level security;

drop policy if exists user_keys_select on public.user_keys;
drop policy if exists user_keys_insert on public.user_keys;
drop policy if exists user_keys_update on public.user_keys;
create policy user_keys_select on public.user_keys for select to authenticated using (user_id = (select auth.uid()));
create policy user_keys_insert on public.user_keys for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_keys_update on public.user_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists records_select on public.records;
drop policy if exists records_insert on public.records;
drop policy if exists records_update on public.records;
drop policy if exists records_delete on public.records;
create policy records_select on public.records for select to authenticated using (user_id = (select auth.uid()));
create policy records_insert on public.records for insert to authenticated with check (user_id = (select auth.uid()));
create policy records_update on public.records for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy records_delete on public.records for delete to authenticated using (user_id = (select auth.uid()));

-- Los visitantes sin sesión no tienen acceso a nada
revoke all on public.user_keys from anon;
revoke all on public.records from anon;
grant select, insert, update on public.user_keys to authenticated;
grant select, insert, update, delete on public.records to authenticated;

-- ---------------------------------------------------------------------------
-- Subida: upsert por lotes; si el servidor ya tiene un cambio más reciente, se ignora (LWW)
-- ---------------------------------------------------------------------------
create or replace function public.push_records(rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  written integer;
begin
  if uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then
    raise exception 'Lote no válido (máximo 500 registros)' using errcode = '22023';
  end if;
  -- Cuota por cuenta para que nadie llene la base gratuita
  if (select count(*) from public.records where user_id = uid) > 200000 then
    raise exception 'La cuenta superó el límite de registros' using errcode = '54000';
  end if;

  with input as (
    select
      r ->> 'rid' as rid,
      r ->> 'ciphertext' as ciphertext,
      (r ->> 'client_updated_at')::timestamptz as client_updated_at,
      coalesce((r ->> 'deleted')::boolean, false) as deleted
    from jsonb_array_elements(rows) as r
  ), up as (
    insert into public.records as t (user_id, rid, ciphertext, client_updated_at, deleted)
    select uid, i.rid, i.ciphertext, i.client_updated_at, i.deleted from input i
    on conflict (user_id, rid) do update
      set ciphertext = excluded.ciphertext,
          client_updated_at = excluded.client_updated_at,
          deleted = excluded.deleted
      where t.client_updated_at < excluded.client_updated_at
    returning 1
  )
  select count(*) into written from up;
  return written;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bajada: registros recibidos después del cursor (marca del servidor + rid), paginados
-- ---------------------------------------------------------------------------
create or replace function public.pull_records(after_ts timestamptz, after_rid text, max_rows integer)
returns table (rid text, ciphertext text, client_updated_at timestamptz, deleted boolean, server_updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.rid, r.ciphertext, r.client_updated_at, r.deleted, r.server_updated_at
  from public.records r
  where r.user_id = auth.uid()
    and (
      after_ts is null
      or r.server_updated_at > after_ts
      or (r.server_updated_at = after_ts and r.rid > coalesce(after_rid, ''))
    )
  order by r.server_updated_at, r.rid
  limit least(greatest(coalesce(max_rows, 500), 1), 1000);
$$;

-- ---------------------------------------------------------------------------
-- Restablecer datos (recuperación sin código: lo cifrado con la clave anterior es ilegible)
-- ---------------------------------------------------------------------------
create or replace function public.reset_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  delete from public.records where user_id = auth.uid();
  delete from public.user_keys where user_id = auth.uid();
end;
$$;

-- reset_my_data borra la fila de claves: hace falta permiso de borrado solo para el propio usuario
drop policy if exists user_keys_delete on public.user_keys;
create policy user_keys_delete on public.user_keys for delete to authenticated using (user_id = (select auth.uid()));
grant delete on public.user_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Eliminar la cuenta (borra auth.users → cascada a user_keys y records)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end;
$$;

-- Solo usuarios con sesión pueden ejecutar las funciones
revoke all on function public.push_records(jsonb) from public, anon;
revoke all on function public.pull_records(timestamptz, text, integer) from public, anon;
revoke all on function public.reset_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;
grant execute on function public.pull_records(timestamptz, text, integer) to authenticated;
grant execute on function public.reset_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
