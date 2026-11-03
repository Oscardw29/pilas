-- ¡Pilas! · Datos sin cifrado de extremo a extremo + verificación de dispositivos nuevos
--
-- Requiere 0001_init.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run. Se puede volver a ejecutar.
--
-- 1. Los registros se guardan como JSON legible (`body`) en lugar de texto cifrado: así, si alguien olvida la
--    contraseña, recupera la cuenta y sus datos solo con el código del correo. Los protege RLS (cada persona solo
--    accede a lo suyo) y el cifrado en reposo de Supabase; quien administra el proyecto puede leerlos.
--    Las filas cifradas de antes (`ciphertext`) se siguen pudiendo bajar hasta que la app de cada cuenta las convierte
--    (`finish_plaintext_migration`), que borra también la fila de `user_keys`.
-- 2. Cada dispositivo tiene un identificador secreto. Sus datos (`records`) solo se pueden leer o escribir desde un
--    dispositivo verificado con un código del correo (`trust_device`). Iniciar sesión con la contraseña en un
--    dispositivo nuevo no basta.

-- ---------------------------------------------------------------------------
-- Registros legibles
-- ---------------------------------------------------------------------------
alter table public.records add column if not exists body jsonb;
alter table public.records alter column ciphertext drop not null;
alter table public.records drop constraint if exists records_rid_check;
alter table public.records drop constraint if exists records_rid_length;
alter table public.records add constraint records_rid_length check (char_length(rid) between 1 and 300);
alter table public.records drop constraint if exists records_body_size;
alter table public.records add constraint records_body_size check (body is null or octet_length(body::text) < 1000000);
alter table public.records drop constraint if exists records_has_content;
alter table public.records add constraint records_has_content check (body is not null or ciphertext is not null);

-- ---------------------------------------------------------------------------
-- Dispositivos verificados
-- ---------------------------------------------------------------------------
create table if not exists public.trusted_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 del identificador del dispositivo: el identificador real nunca se guarda
  token_hash text not null check (char_length(token_hash) = 64),
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, token_hash)
);

alter table public.trusted_devices enable row level security;
-- Sin políticas ni permisos: solo se usa a través de las funciones de abajo
revoke all on public.trusted_devices from public, anon, authenticated;

create or replace function public.device_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

/** ¿Este dispositivo está verificado para la cuenta con sesión? */
create or replace function public.is_trusted_device(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and char_length(coalesce(p_token, '')) between 32 and 128
    and exists (
      select 1 from public.trusted_devices d
      where d.user_id = auth.uid() and d.token_hash = public.device_hash(p_token)
    );
$$;

/** Igual que is_trusted_device, pero apunta la última vez que se usó (lo llama la app al abrir) */
create or replace function public.device_status(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trusted_device(p_token) then
    return false;
  end if;
  update public.trusted_devices set last_seen_at = now()
    where user_id = auth.uid() and token_hash = public.device_hash(p_token) and last_seen_at < now() - interval '1 hour';
  return true;
end;
$$;

/**
 * ¿La sesión se abrió hace poco con un código del correo? (registro, código de acceso o recuperación).
 * Supabase lo anota en el JWT (`amr`): una sesión abierta solo con la contraseña no lo tiene.
 */
create or replace function public.session_has_recent_email_proof()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where jsonb_typeof(a) = 'object'
      and a ->> 'method' in ('otp', 'magiclink', 'recovery', 'email/signup', 'invite')
      and (a ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 900
  );
$$;

/** Marca este dispositivo como verificado. Exige haber entrado con un código del correo hace menos de 15 min. */
create or replace function public.trust_device(p_token text, p_label text)
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
  if char_length(coalesce(p_token, '')) not between 32 and 128 then
    raise exception 'Identificador de dispositivo no válido' using errcode = '22023';
  end if;
  if not public.session_has_recent_email_proof() then
    raise exception 'Verifica este dispositivo con el código que te enviamos al correo' using errcode = '42501';
  end if;
  -- Máximo 30 dispositivos por cuenta: se olvidan los que llevan más tiempo sin usarse
  delete from public.trusted_devices
    where user_id = uid and token_hash in (
      select token_hash from public.trusted_devices where user_id = uid order by last_seen_at desc offset 29
    );
  insert into public.trusted_devices (user_id, token_hash, label)
    values (uid, public.device_hash(p_token), left(btrim(coalesce(p_label, '')), 80))
    on conflict (user_id, token_hash) do update set last_seen_at = now(), label = excluded.label;
end;
$$;

/** Tras recuperar la cuenta con el correo: solo queda verificado este dispositivo */
create or replace function public.forget_other_devices(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trusted_device(p_token) then
    raise exception 'Dispositivo no verificado' using errcode = '42501';
  end if;
  delete from public.trusted_devices where user_id = auth.uid() and token_hash <> public.device_hash(p_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceso a los registros: solo con las funciones y desde un dispositivo verificado
-- ---------------------------------------------------------------------------
revoke select, insert, update, delete on public.records from authenticated;

drop function if exists public.push_records(jsonb);
drop function if exists public.push_records(jsonb, text);
create or replace function public.push_records(rows jsonb, device text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  written integer;
begin
  if uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if not public.is_trusted_device(device) then
    raise exception 'Dispositivo no verificado' using errcode = '42501', hint = 'pilas:untrusted_device';
  end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then
    raise exception 'Lote no válido (máximo 500 registros)' using errcode = '22023';
  end if;
  -- Cuota por cuenta (registros y tamaño) para que nadie llene la base gratuita
  if (select count(*) from public.records where user_id = uid) > 200000
     or (select coalesce(sum(coalesce(octet_length(body::text), octet_length(ciphertext))), 0) from public.records where user_id = uid) > 50000000 then
    raise exception 'La cuenta superó el espacio disponible' using errcode = '54000';
  end if;

  with input as (
    select
      r ->> 'rid' as rid,
      r -> 'body' as body,
      (r ->> 'client_updated_at')::timestamptz as client_updated_at,
      coalesce((r ->> 'deleted')::boolean, false) as deleted
    from jsonb_array_elements(rows) as r
    where jsonb_typeof(r -> 'body') = 'object'
  ), up as (
    insert into public.records as t (user_id, rid, body, ciphertext, client_updated_at, deleted)
    select uid, i.rid, i.body, null, i.client_updated_at, i.deleted from input i
    on conflict (user_id, rid) do update
      set body = excluded.body,
          ciphertext = null,
          client_updated_at = excluded.client_updated_at,
          deleted = excluded.deleted
      where t.client_updated_at < excluded.client_updated_at
    returning 1
  )
  select count(*) into written from up;
  return written;
end;
$$;

drop function if exists public.pull_records(timestamptz, text, integer);
drop function if exists public.pull_records(timestamptz, text, integer, text);
create or replace function public.pull_records(after_ts timestamptz, after_rid text, max_rows integer, device text)
returns table (rid text, body jsonb, ciphertext text, client_updated_at timestamptz, deleted boolean, server_updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if not public.is_trusted_device(device) then
    raise exception 'Dispositivo no verificado' using errcode = '42501', hint = 'pilas:untrusted_device';
  end if;
  return query
    select r.rid, r.body, r.ciphertext, r.client_updated_at, r.deleted, r.server_updated_at
    from public.records r
    where r.user_id = auth.uid()
      and (
        after_ts is null
        or r.server_updated_at > after_ts
        or (r.server_updated_at = after_ts and r.rid > coalesce(after_rid, ''))
      )
    order by r.server_updated_at, r.rid
    limit least(greatest(coalesce(max_rows, 500), 1), 1000);
end;
$$;

/** Fin de la conversión de una cuenta antigua: borra lo que siga cifrado y la fila de claves */
create or replace function public.finish_plaintext_migration(device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_trusted_device(device) then
    raise exception 'Dispositivo no verificado' using errcode = '42501', hint = 'pilas:untrusted_device';
  end if;
  delete from public.records where user_id = auth.uid() and body is null;
  delete from public.user_keys where user_id = auth.uid();
end;
$$;

-- La recuperación ya no borra los datos de la nube: reset_my_data deja de existir
drop function if exists public.reset_my_data();

revoke all on function public.device_hash(text) from public, anon;
revoke all on function public.is_trusted_device(text) from public, anon;
revoke all on function public.device_status(text) from public, anon;
revoke all on function public.session_has_recent_email_proof() from public, anon;
revoke all on function public.trust_device(text, text) from public, anon;
revoke all on function public.forget_other_devices(text) from public, anon;
revoke all on function public.push_records(jsonb, text) from public, anon;
revoke all on function public.pull_records(timestamptz, text, integer, text) from public, anon;
revoke all on function public.finish_plaintext_migration(text) from public, anon;
grant execute on function public.device_status(text) to authenticated;
grant execute on function public.trust_device(text, text) to authenticated;
grant execute on function public.forget_other_devices(text) to authenticated;
grant execute on function public.push_records(jsonb, text) to authenticated;
grant execute on function public.pull_records(timestamptz, text, integer, text) to authenticated;
grant execute on function public.finish_plaintext_migration(text) to authenticated;
