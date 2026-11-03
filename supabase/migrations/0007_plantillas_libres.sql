-- ¡Pilas! · Plantillas de publicación libres: siempre disponibles, sin cumplir ninguna condición
--
-- Requiere 0002_social.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run. Se puede volver a ejecutar.
--
-- Plantilla `message`: frases fijas de ánimo que cualquiera puede publicar cuando quiera. El servidor solo guarda el
-- id de la frase (`data.id`); el texto lo pone la app (src/social/texts.ts: MESSAGE_TEMPLATES), así nadie puede
-- publicar texto libre fuera del comentario (que sigue limitado a 200 caracteres). El límite de 3 publicaciones al
-- día se mantiene.

alter table public.posts drop constraint if exists posts_template_check;
alter table public.posts add constraint posts_template_check
  check (template in ('streak', 'habit_streak', 'perfect_week', 'xp_week', 'achievement', 'league_up', 'podium', 'message'));

/** Ids de las frases libres (mismo orden que MESSAGE_TEMPLATES en la app) */
create or replace function public.message_template_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['hoy_empiezo', 'no_rompo', 'nueva_semana', 'pasos', 'volvi', 'minimo', 'quien_se_une', 'gracias', 'enfoque', 'cada_dia'];
$$;

-- Igual que en 0002, más las frases libres al final
create or replace function public.available_post_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  out jsonb := '[]'::jsonb;
  streak integer := public.current_streak(uid);
  last_week date := public.week_start(public.co_today()) - 7;
  xp_week numeric;
  res public.league_results;
  pod public.weekly_podium;
  h record;
  a record;
  n integer;
  msg text;
begin
  if uid is null then
    return out;
  end if;
  if streak >= 2 then
    out := out || jsonb_build_object('template', 'streak', 'ref', null, 'data', jsonb_build_object('n', streak));
  end if;
  for h in select * from public.public_habits where user_id = uid order by position loop
    n := public.public_habit_streak(h.days);
    if n >= 2 then
      out := out || jsonb_build_object('template', 'habit_streak', 'ref', h.habit_key,
        'data', jsonb_build_object('n', n, 'habit', h.name, 'icon', h.icon));
    end if;
  end loop;
  select * into res from public.league_results where user_id = uid and week_start = last_week;
  if res.perfect then
    out := out || jsonb_build_object('template', 'perfect_week', 'ref', null, 'data', jsonb_build_object('week', last_week));
  end if;
  if res.movement = 1 then
    out := out || jsonb_build_object('template', 'league_up', 'ref', null,
      'data', jsonb_build_object('league', (select name from public.leagues where id = least(5, res.league + 1))));
  end if;
  select * into pod from public.weekly_podium where user_id = uid and week_start = last_week;
  if pod.user_id is not null then
    out := out || jsonb_build_object('template', 'podium', 'ref', null, 'data', jsonb_build_object('position', pod.position, 'week', last_week));
  end if;
  select coalesce(sum(d.xp), 0) into xp_week from public.daily_stats d
  where d.user_id = uid and d.day between public.week_start(public.co_today()) and public.week_start(public.co_today()) + 6;
  if xp_week > 0 then
    out := out || jsonb_build_object('template', 'xp_week', 'ref', null, 'data', jsonb_build_object('xp', round(xp_week)));
  end if;
  for a in
    select d.id, d.name, d.icon, u.achieved_at from public.user_achievements u join public.achievement_defs d on d.id = u.achievement_id
    where u.user_id = uid and u.achieved_at > now() - interval '14 days' order by u.achieved_at desc limit 5
  loop
    out := out || jsonb_build_object('template', 'achievement', 'ref', a.id, 'data', jsonb_build_object('id', a.id, 'name', a.name, 'icon', a.icon));
  end loop;
  -- Frases libres: siempre disponibles
  foreach msg in array public.message_template_ids() loop
    out := out || jsonb_build_object('template', 'message', 'ref', msg, 'data', jsonb_build_object('id', msg));
  end loop;
  return out;
end;
$$;

revoke all on function public.message_template_ids() from public, anon;
grant execute on function public.message_template_ids() to authenticated;
