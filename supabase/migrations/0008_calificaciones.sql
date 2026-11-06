-- ¡Pilas! · Calificación con estrellas de la página de descarga (/descargar)
--
-- Aplicar en: Supabase → SQL Editor → pegar este archivo → Run. Se puede volver a ejecutar.
--
-- - Cualquiera puede calificar sin cuenta: un voto (1 a 5 estrellas) por equipo. El equipo se identifica con un id
--   aleatorio que la página guarda en el navegador (`voter`); con el mismo id el voto se cambia, no se suma.
-- - Sin comentarios: solo se guardan las estrellas. Lo único que se puede leer es la media y el número de votos.
-- - Nadie lee ni escribe las tablas directamente: solo las dos funciones de abajo.
-- - Para que nadie infle la nota creando ids nuevos: como mucho 5 votos nuevos al día por conexión (la IP solo se guarda
--   como huella md5 y se borra a los 2 días) y 300 votos nuevos por hora en total.

create table if not exists public.app_ratings (
  voter uuid primary key,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_ratings enable row level security;
revoke all on public.app_ratings from public, anon, authenticated;

create table if not exists public.app_rating_log (
  source text not null,
  created_at timestamptz not null default now()
);
create index if not exists app_rating_log_source on public.app_rating_log (source, created_at);
create index if not exists app_rating_log_created on public.app_rating_log (created_at);
alter table public.app_rating_log enable row level security;
revoke all on public.app_rating_log from public, anon, authenticated;

/** Media (con dos decimales) y número de votos */
create or replace function public.app_rating_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'average', coalesce(round(avg(stars)::numeric, 2), 0),
    'count', count(*)
  )
  from public.app_ratings;
$$;

/** Guarda (o cambia) el voto de un equipo y devuelve el resumen ya actualizado */
create or replace function public.rate_app(p_voter uuid, p_stars integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  ip text := nullif(trim(split_part(coalesce(headers ->> 'cf-connecting-ip', headers ->> 'x-real-ip', headers ->> 'x-forwarded-for', ''), ',', 1)), '');
  src text := case when ip is null then null else md5('pilas-calificacion:' || ip) end;
begin
  if p_voter is null then
    raise exception 'Falta el identificador del equipo.';
  end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    raise exception 'La calificación va de 1 a 5 estrellas.';
  end if;

  if exists (select 1 from public.app_ratings where voter = p_voter) then
    update public.app_ratings set stars = p_stars, updated_at = now() where voter = p_voter;
    return public.app_rating_summary();
  end if;

  -- Voto nuevo: límites por conexión y en total
  if src is not null
     and (select count(*) from public.app_rating_log where source = src and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Ya llegaron varias calificaciones desde esta conexión hoy. Prueba mañana.';
  end if;
  if (select count(*) from public.app_rating_log where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Están llegando muchas calificaciones ahora mismo. Prueba en un rato.';
  end if;
  delete from public.app_rating_log where created_at < now() - interval '2 days';
  insert into public.app_rating_log (source) values (coalesce(src, 'sin-ip'));

  insert into public.app_ratings (voter, stars) values (p_voter, p_stars)
  on conflict (voter) do update set stars = excluded.stars, updated_at = now();
  return public.app_rating_summary();
end;
$$;

revoke all on function public.app_rating_summary() from public;
revoke all on function public.rate_app(uuid, integer) from public;
grant execute on function public.app_rating_summary() to anon, authenticated;
grant execute on function public.rate_app(uuid, integer) to anon, authenticated;
