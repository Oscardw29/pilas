-- ¡Pilas! · IA de la app: claves del creador (LLM, voz y dictado) que todos usan mientras estén puestas
--
-- Requiere 0002_social.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run. Se puede volver a ejecutar.
-- Después hay que crear la función `pilas-ai` (supabase/functions/pilas-ai/index.ts, ver docs/supabase.md).
--
-- Cómo funciona:
-- - Las claves viven en `app_ai_services` y NUNCA salen hacia la app: ni `anon` ni `authenticated` pueden leer la tabla, y
--   ninguna función que pueda llamar la app devuelve la clave (el creador solo ve sus 4 últimos caracteres).
-- - La app pide cada respuesta a la función `pilas-ai`, que comprueba la sesión, llama a `ai_authorize` (solo la puede
--   ejecutar `service_role`) y habla con el proveedor. Así nadie puede sacar tu clave de la app ni gastarla sin cuenta.
-- - `daily_limit`: usos al día por persona y servicio (el creador no tiene tope, para poder hacer pruebas).
-- - Al quitar un servicio la fila se borra: la app vuelve al modo local y a los avisos de configurar una clave.

create table if not exists public.app_ai_services (
  service text primary key check (service in ('llm', 'tts', 'stt')),
  provider text not null,
  api_key text not null check (char_length(api_key) between 8 and 500),
  model text not null default '' check (char_length(model) <= 120),
  backup_model text not null default '' check (char_length(backup_model) <= 120),
  voice text not null default '' check (char_length(voice) <= 120),
  daily_limit integer not null default 40 check (daily_limit between 1 and 100000),
  updated_at timestamptz not null default now()
);
alter table public.app_ai_services enable row level security;
revoke all on public.app_ai_services from public, anon, authenticated;

-- Usos por persona y día (hora de Colombia, como el resto de la app)
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  service text not null,
  used integer not null default 0,
  primary key (user_id, day, service)
);
create index if not exists ai_usage_day on public.ai_usage (day, service);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

-- ===========================================================================
-- Lo que puede ver cualquiera con sesión: qué servicios hay, nunca sus claves
-- ===========================================================================
create or replace function public.ai_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(service, jsonb_build_object('provider', provider, 'model', model)), '{}'::jsonb)
  from public.app_ai_services;
$$;

-- ===========================================================================
-- Panel del creador
-- ===========================================================================
create or replace function public.admin_ai_services()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'service', s.service, 'provider', s.provider, 'model', s.model, 'backup_model', s.backup_model, 'voice', s.voice,
      'daily_limit', s.daily_limit, 'updated_at', s.updated_at, 'key_hint', right(s.api_key, 4),
      'used_today', coalesce((select sum(u.used) from public.ai_usage u where u.day = public.co_today() and u.service = s.service), 0)
    ) order by s.service)
    from public.app_ai_services s
  ), '[]'::jsonb);
end;
$$;

-- `p_api_key` vacío conserva la clave guardada (para cambiar el modelo o el límite sin volver a pegarla)
create or replace function public.admin_set_ai_service(
  p_service text, p_provider text, p_api_key text, p_model text, p_backup_model text, p_voice text, p_daily_limit integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := public.assert_admin();
  key_text text := btrim(coalesce(p_api_key, ''));
  saved_key text;
begin
  if p_service not in ('llm', 'tts', 'stt') then
    raise exception 'Servicio no válido' using errcode = '22023';
  end if;
  if (p_service = 'llm' and p_provider not in ('gemini', 'openai', 'groq', 'openrouter'))
    or (p_service = 'tts' and p_provider not in ('gemini', 'openai', 'elevenlabs', 'fish_audio'))
    or (p_service = 'stt' and p_provider <> 'deepgram') then
    raise exception 'Proveedor no válido para este servicio' using errcode = '22023';
  end if;
  select api_key into saved_key from public.app_ai_services where service = p_service;
  if key_text = '' and saved_key is null then
    raise exception 'Pega la clave de API' using errcode = '22023';
  end if;
  if key_text <> '' and char_length(key_text) < 8 then
    raise exception 'La clave de API es demasiado corta' using errcode = '22023';
  end if;

  insert into public.app_ai_services (service, provider, api_key, model, backup_model, voice, daily_limit, updated_at)
  values (p_service, p_provider, coalesce(nullif(key_text, ''), saved_key), btrim(coalesce(p_model, '')),
          btrim(coalesce(p_backup_model, '')), btrim(coalesce(p_voice, '')), coalesce(p_daily_limit, 40), now())
  on conflict (service) do update set
    provider = excluded.provider,
    api_key = excluded.api_key,
    model = excluded.model,
    backup_model = excluded.backup_model,
    voice = excluded.voice,
    daily_limit = excluded.daily_limit,
    updated_at = now();

  -- El registro nunca lleva la clave
  insert into public.moderation_actions (admin_id, action, data)
  values (admin_id, 'ai_service_set', jsonb_build_object('service', p_service, 'provider', p_provider, 'key_changed', key_text <> ''));
end;
$$;

create or replace function public.admin_clear_ai_service(p_service text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_id uuid := public.assert_admin();
begin
  delete from public.app_ai_services where service = p_service;
  if found then
    insert into public.moderation_actions (admin_id, action, data)
    values (admin_id, 'ai_service_cleared', jsonb_build_object('service', p_service));
  end if;
end;
$$;

-- ===========================================================================
-- Solo para la función `pilas-ai` (service_role): autoriza un uso y le entrega la clave al servidor
-- ===========================================================================
create or replace function public.ai_authorize(p_user uuid, p_service text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.app_ai_services;
  today date := public.co_today();
  unlimited boolean := exists (select 1 from public.app_admins a where a.user_id = p_user);
  used_now integer;
begin
  select * into s from public.app_ai_services where service = p_service;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unconfigured');
  end if;
  if public.is_banned(p_user) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;

  -- Se cuenta y comprueba en una sola escritura: dos peticiones a la vez no pueden colarse por encima del tope
  insert into public.ai_usage as u (user_id, day, service, used)
  values (p_user, today, p_service, 1)
  on conflict (user_id, day, service) do update set used = u.used + 1
    where unlimited or u.used < s.daily_limit
  returning u.used into used_now;
  if used_now is null then
    return jsonb_build_object('ok', false, 'reason', 'quota', 'limit', s.daily_limit);
  end if;

  -- Limpieza ocasional: los usos solo importan el día en curso (el panel enseña los de hoy)
  if random() < 0.01 then
    delete from public.ai_usage where day < today - 30;
  end if;

  return jsonb_build_object(
    'ok', true, 'provider', s.provider, 'api_key', s.api_key, 'model', s.model, 'backup_model', s.backup_model, 'voice', s.voice
  );
end;
$$;

-- ===========================================================================
-- Permisos
-- ===========================================================================
revoke all on function public.ai_authorize(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_authorize(uuid, text) to service_role;

revoke all on function public.ai_status() from public, anon;
revoke all on function public.admin_ai_services() from public, anon;
revoke all on function public.admin_set_ai_service(text, text, text, text, text, text, integer) from public, anon;
revoke all on function public.admin_clear_ai_service(text) from public, anon;
grant execute on function public.ai_status() to authenticated;
grant execute on function public.admin_ai_services() to authenticated;
grant execute on function public.admin_set_ai_service(text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.admin_clear_ai_service(text) to authenticated;
