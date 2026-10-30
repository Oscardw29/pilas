-- ¡Pilas! · Perfiles para todos, «me gusta», semanas del perfil, edición de publicaciones, ligas por puestos,
-- reinicio del progreso y cifras enteras
--
-- Requiere 0002_social.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run (después de 0002).
-- Se puede volver a ejecutar: no borra datos. Después de aplicarlo, para repetir la instalación ejecuta solo este archivo
-- (volver a ejecutar 0002 encima falla sin cambiar nada: Postgres no deja quitar columnas a las vistas de aquí).
--
-- Qué cambia:
-- - Todo perfil es público y la app lo crea sola al entrar: el alias pasa a ser opcional y hay nombre visible
--   (`display_name`), biografía, color del banner por defecto y fotos por defecto (`default:1` … `default:5`).
-- - Donde se devolvía el alias de una persona ahora también va su nombre (`display_name`).
-- - «Me gusta» a perfiles (`profile_likes`, `toggle_profile_like`) con aviso `profile_like` solo la primera vez.
-- - `profile_week`: recorrer las semanas de un perfil. `public_profile` acepta también el id de la persona.
-- - Publicaciones: editar el comentario (`edit_post`, `edited_at`); «de tus amigos» ya no incluye las propias.
-- - Ligas por puestos: 1.º–5.º suben, 6.º–10.º se quedan y del 11.º en adelante bajan. Si en el grupo solo compite una
--   persona, no sube ni baja y gana un premio de participación.
-- - El creador puede marcarse o quitarse logros en su propia cuenta (`admin_set_achievement`).
-- - `reset_my_progress(p_reset_at)`: borra lo publicado desde el dispositivo cuando sus datos cambian por completo, una
--   sola vez por cambio. Después el punto de partida se puede reclamar otra vez, con topes que impiden inflar el perfil.
-- - XP y monedas siempre enteros (se redondean también los valores ya guardados).

-- ===========================================================================
-- Perfiles: alias opcional, nombre visible, biografía, color del banner y fotos por defecto
-- ===========================================================================
alter table public.profiles alter column alias drop not null;
alter table public.profiles add column if not exists display_name text not null default '';
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists banner_color text;

alter table public.profiles drop constraint if exists profiles_display_name_check;
alter table public.profiles add constraint profiles_display_name_check check (char_length(display_name) <= 40);
alter table public.profiles drop constraint if exists profiles_bio_check;
alter table public.profiles add constraint profiles_bio_check check (char_length(bio) <= 160);
alter table public.profiles drop constraint if exists profiles_banner_color_check;
alter table public.profiles add constraint profiles_banner_color_check
  check (banner_color in ('violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'slate'));

-- Un perfil nuevo muestra todas las tarjetas (la persona las puede quitar)
alter table public.profiles alter column cards set default array['streak', 'xp_week', 'member_since', 'habits', 'achievements']::text[];

-- Los perfiles que ya existían se muestran con su alias como nombre. Sin sesión, la validación del perfil no deja tocar
-- filas ajenas: se apaga solo durante este arreglo
alter table public.profiles disable trigger profiles_guard;
update public.profiles set display_name = alias where display_name = '' and alias is not null;
alter table public.profiles enable trigger profiles_guard;

-- Validaciones del perfil (alias opcional, nombre, biografía, color, foto, cosméticos que se tienen y logros conseguidos)
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
  created timestamptz;
  prev_featured text[] := '{}';
begin
  if not admin then
    if new.user_id is distinct from auth.uid() then
      raise exception 'No puedes editar el perfil de otra persona' using errcode = '42501';
    end if;
    perform public.assert_can_write();
  end if;

  -- Alias opcional: vacío = sin alias (se muestra el nombre)
  new.alias := nullif(lower(trim(new.alias)), '');
  if new.alias = any (array['admin', 'administrador', 'creador', 'pilas', 'soporte', 'moderador', 'moderacion', 'pilo', 'pila', 'root', 'sistema', 'system', 'oficial']) then
    raise exception 'Ese alias está reservado' using errcode = '22023';
  end if;

  new.display_name := trim(coalesce(new.display_name, ''));
  new.bio := trim(coalesce(new.bio, ''));
  if char_length(new.display_name) > 40 then
    raise exception 'El nombre tiene más de 40 caracteres' using errcode = '22023';
  end if;
  if char_length(new.bio) > 160 then
    raise exception 'La biografía tiene más de 160 caracteres' using errcode = '22023';
  end if;
  -- Sin nombre al crearlo: se muestra el alias
  if tg_op = 'INSERT' and new.display_name = '' and new.alias is not null then
    new.display_name := new.alias;
  end if;
  if new.banner_color is not null and new.banner_color <> all (array['violet', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'slate']) then
    raise exception 'Ese color de banner no existe' using errcode = '22023';
  end if;

  -- La foto está en la carpeta propia de Storage o es una de las cinco por defecto, que dibuja la app (`default:N`)
  if new.avatar_path is not null and new.avatar_path !~ '^default:[1-5]$' and new.avatar_path not like new.user_id::text || '/%' then
    raise exception 'La foto debe estar en tu carpeta' using errcode = '42501';
  end if;

  if not admin then
    if new.banner_item is not null and not exists (
      select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id
      where i.user_id = new.user_id and i.item_id = new.banner_item and c.kind = 'banner') then
      raise exception 'No tienes ese banner' using errcode = '42501';
    end if;
    if new.frame_item is not null and not exists (
      select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id
      where i.user_id = new.user_id and i.item_id = new.frame_item and c.kind = 'frame') then
      raise exception 'No tienes ese marco' using errcode = '42501';
    end if;
    if new.card_item is not null and not exists (
      select 1 from public.inventory i join public.catalog_items c on c.id = i.item_id
      where i.user_id = new.user_id and i.item_id = new.card_item and c.kind = 'card') then
      raise exception 'No tienes esa tarjeta' using errcode = '42501';
    end if;
    -- Solo se comprueban los logros que se añaden: tras reiniciar el progreso, los ya elegidos siguen en la lista
    -- (el perfil público solo muestra los que se tienen) y vuelven a verse al recuperarlos
    if tg_op = 'UPDATE' then
      prev_featured := coalesce(old.featured_achievements, '{}');
    end if;
    if exists (
      select 1 from unnest(new.featured_achievements) a
      where a <> all (prev_featured)
        and not exists (select 1 from public.user_achievements u where u.user_id = new.user_id and u.achievement_id = a)) then
      raise exception 'Solo puedes mostrar logros que ya tienes' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    select u.created_at into created from auth.users u where u.id = new.user_id;
    new.member_since := coalesce(created, now());
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.member_since := old.member_since;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

grant insert (user_id, alias, display_name, bio, banner_color, avatar_path, banner_item, frame_item, card_item, cards, featured_achievements)
  on public.profiles to authenticated;
grant update (alias, display_name, bio, banner_color, avatar_path, banner_item, frame_item, card_item, cards, featured_achievements)
  on public.profiles to authenticated;

-- ===========================================================================
-- «Me gusta» a perfiles
-- ===========================================================================
create table if not exists public.profile_likes (
  liker uuid not null references auth.users (id) on delete cascade,
  liked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker, liked),
  check (liker <> liked)
);
create index if not exists profile_likes_liked on public.profile_likes (liked);

-- Quién ya avisó a quién: quitar y volver a dar «me gusta» no repite el aviso (solo lo usan las funciones)
create table if not exists public.profile_like_notices (
  liker uuid not null references auth.users (id) on delete cascade,
  liked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker, liked)
);

alter table public.profile_likes enable row level security;
alter table public.profile_like_notices enable row level security;
drop policy if exists profile_likes_select on public.profile_likes;
-- Cada persona ve solo los «me gusta» que dio (cuántos tiene un perfil lo dice public_profile)
create policy profile_likes_select on public.profile_likes for select to authenticated using (liker = (select auth.uid()));
revoke all on public.profile_likes, public.profile_like_notices from anon, authenticated;
grant select on public.profile_likes to authenticated;

-- Dar o quitar el «me gusta» a un perfil. Avisa al dueño solo la primera vez que esa persona se lo da
create or replace function public.toggle_profile_like(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  v_liked boolean;
begin
  if p_user is null or p_user = uid then
    raise exception 'No puedes darte «me gusta» a ti mismo' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) or public.blocked_between(uid, p_user) then
    raise exception 'No puedes dar «me gusta» a esta persona' using errcode = '42501';
  end if;
  if (select count(*) from public.rate_log where user_id = uid and action = 'profile_like' and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Como mucho 100 «me gusta» al día' using errcode = '54000';
  end if;

  delete from public.profile_likes where liker = uid and liked = p_user;
  v_liked := not found;
  if v_liked then
    insert into public.profile_likes (liker, liked) values (uid, p_user) on conflict do nothing;
    insert into public.profile_like_notices (liker, liked) values (uid, p_user) on conflict do nothing;
    if found then
      perform public.notify(p_user, 'profile_like', uid, '{}'::jsonb);
    end if;
  end if;

  delete from public.rate_log where user_id = uid and created_at < now() - interval '2 days';
  insert into public.rate_log (user_id, action) values (uid, 'profile_like');
  return jsonb_build_object('liked', v_liked, 'likes', (select count(*) from public.profile_likes where liked = p_user));
end;
$$;

-- Bloquear corta la amistad y los «me gusta» entre las dos personas
create or replace function public.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where (requester = new.blocker and addressee = new.blocked) or (requester = new.blocked and addressee = new.blocker);
  delete from public.profile_likes
  where (liker = new.blocker and liked = new.blocked) or (liker = new.blocked and liked = new.blocker);
  return null;
end;
$$;

-- ===========================================================================
-- Perfil público (por alias o por id) y sus semanas
-- ===========================================================================

-- Perfil público por alias o, si la persona no tiene alias, por su id: cosméticos, tarjetas elegidas, XP de la semana,
-- hábitos visibles, «me gusta» y relación contigo
create or replace function public.public_profile(p_alias text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  handle text := lower(trim(p_alias));
  p public.profiles;
  ps public.profile_stats;
  wk date := public.week_start(public.co_today());
  fr public.friendships;
  own boolean;
begin
  if me is null or handle is null or handle = '' then
    return null;
  end if;
  -- Un alias nunca tiene guiones: no se confunde con un id
  select * into p from public.profiles where alias = handle or user_id::text = handle limit 1;
  if p.user_id is null then
    return null;
  end if;
  own := p.user_id = me;
  -- Quien te bloqueó no aparece
  if not own and exists (select 1 from public.blocks where blocker = p.user_id and blocked = me) then
    return null;
  end if;
  if not own and public.is_banned(p.user_id) and not public.is_admin() then
    return jsonb_build_object('alias', p.alias, 'display_name', p.display_name, 'suspended', true);
  end if;
  select * into ps from public.profile_stats where user_id = p.user_id;
  select * into fr from public.friendships where (requester = me and addressee = p.user_id) or (requester = p.user_id and addressee = me);

  return jsonb_build_object(
    'user_id', p.user_id, 'alias', p.alias, 'display_name', p.display_name, 'bio', p.bio, 'banner_color', p.banner_color,
    'avatar_path', p.avatar_path, 'member_since', p.member_since,
    'cards', to_jsonb(p.cards), 'is_me', own, 'suspended', public.is_banned(p.user_id),
    'likes', (select count(*) from public.profile_likes l where l.liked = p.user_id),
    'liked_by_me', exists (select 1 from public.profile_likes l where l.liker = me and l.liked = p.user_id),
    -- Lunes de la primera semana con datos (hasta ahí se puede retroceder): la de «miembro desde» o la del primer día publicado
    'first_week', public.week_start(least(((p.member_since at time zone 'UTC') - interval '5 hours')::date,
      (select min(d.day) from public.daily_stats d where d.user_id = p.user_id))),
    'banner', (select jsonb_build_object('id', c.id, 'path', c.asset_path, 'thumb', c.thumb_path, 'animated', c.animated) from public.catalog_items c where c.id = p.banner_item),
    'frame', (select jsonb_build_object('id', c.id, 'path', c.asset_path, 'thumb', c.thumb_path, 'animated', c.animated) from public.catalog_items c where c.id = p.frame_item),
    'card', (select jsonb_build_object('id', c.id, 'path', c.asset_path, 'thumb', c.thumb_path, 'animated', c.animated) from public.catalog_items c where c.id = p.card_item),
    'stats', jsonb_build_object(
      'current_streak', public.current_streak(p.user_id), 'best_streak', coalesce(ps.best_streak, 0),
      'xp_total', coalesce(ps.xp_total, 0),
      'week_start', wk,
      'week', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'xp', d.xp, 'completion', d.completion) order by d.day)
                        from public.daily_stats d where d.user_id = p.user_id and d.day between wk and wk + 6), '[]'::jsonb),
      'league', (select l.name from public.league_memberships m join public.leagues l on l.id = m.league where m.user_id = p.user_id and m.week_start = wk)
    ),
    'habits', case when own or 'habits' = any (p.cards) then coalesce((
      select jsonb_agg(jsonb_build_object('key', h.habit_key, 'name', h.name, 'icon', h.icon, 'kind', h.kind, 'unit', h.unit,
        'target', h.target, 'days', h.days) order by h.position)
      from public.public_habits h where h.user_id = p.user_id), '[]'::jsonb) else '[]'::jsonb end,
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'description', d.description, 'icon', d.icon,
        'rarity', d.rarity, 'achieved_at', u.achieved_at) order by array_position(p.featured_achievements, d.id))
      from public.user_achievements u join public.achievement_defs d on d.id = u.achievement_id
      where u.user_id = p.user_id and d.id = any (p.featured_achievements)), '[]'::jsonb),
    'friendship', case when fr.requester is null then null
      else jsonb_build_object('status', fr.status, 'outgoing', fr.requester = me) end,
    'i_blocked', exists (select 1 from public.blocks where blocker = me and blocked = p.user_id),
    'cheer', case when own then null else public.cheer_kind(p.user_id) || jsonb_build_object(
      'sent_today', exists (select 1 from public.cheers where sender = me and recipient = p.user_id and day = public.co_today())) end
  );
end;
$$;

-- Una semana del perfil de alguien: XP y % de cumplimiento de los 7 días y, si los muestra, sus hábitos visibles con los
-- días de esa semana. Mismas reglas que public_profile (quien te bloqueó o tiene un veto no aparece)
create or replace function public.profile_week(p_user uuid, p_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  own boolean;
  wk date := public.week_start(coalesce(p_week, public.co_today()));
begin
  if me is null or p_user is null then
    return null;
  end if;
  select * into p from public.profiles where user_id = p_user;
  if p.user_id is null then
    return null;
  end if;
  own := p.user_id = me;
  if not own and exists (select 1 from public.blocks where blocker = p.user_id and blocked = me) then
    return null;
  end if;
  if not own and public.is_banned(p.user_id) and not public.is_admin() then
    return null;
  end if;

  return jsonb_build_object(
    'week_start', wk,
    'week', case when own or 'xp_week' = any (p.cards) then (
      select jsonb_agg(jsonb_build_object('day', wk + g.i, 'xp', coalesce(d.xp, 0), 'completion', d.completion) order by g.i)
      from generate_series(0, 6) g(i)
      left join public.daily_stats d on d.user_id = p.user_id and d.day = wk + g.i) else '[]'::jsonb end,
    'habits', case when own or 'habits' = any (p.cards) then coalesce((
      select jsonb_agg(jsonb_build_object('key', h.habit_key, 'name', h.name, 'icon', h.icon, 'kind', h.kind, 'unit', h.unit,
        'target', h.target,
        'days', (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(h.days) e
                 where e.key between wk::text and (wk + 6)::text)) order by h.position)
      from public.public_habits h where h.user_id = p.user_id), '[]'::jsonb) else null end
  );
end;
$$;

-- Los hábitos visibles de otra persona solo se leen si muestra la tarjeta de hábitos (antes bastaba con tener perfil, y
-- ahora todos lo tienen). Las cifras por día siguen abiertas: las clasificaciones las suman con los permisos de quien mira
drop policy if exists public_habits_select on public.public_habits;
create policy public_habits_select on public.public_habits for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.profiles p where p.user_id = public_habits.user_id and 'habits' = any (p.cards)));

-- ===========================================================================
-- Nombre visible en todo lo que muestra personas
-- ===========================================================================

-- Las clasificaciones dependen de la vista de perfiles: se vuelven a crear todas con el nombre
drop view if exists public.leaderboard_streak;
drop view if exists public.leaderboard_xp_week;
drop view if exists public.leaderboard_xp_total;
drop view if exists public.public_profiles;

-- Perfiles visibles (sin vetos activos) con los cosméticos equipados
create view public.public_profiles with (security_invoker = true) as
select
  p.user_id, p.alias, p.display_name, p.avatar_path, p.member_since, p.banner_color,
  fi.asset_path as frame_path, fi.thumb_path as frame_thumb, fi.animated as frame_animated,
  bi.asset_path as banner_path, bi.thumb_path as banner_thumb, bi.animated as banner_animated,
  ci.asset_path as card_path, ci.thumb_path as card_thumb, ci.animated as card_animated
from public.profiles p
left join public.catalog_items fi on fi.id = p.frame_item
left join public.catalog_items bi on bi.id = p.banner_item
left join public.catalog_items ci on ci.id = p.card_item
where not public.is_banned(p.user_id);

-- Clasificación de racha (permanente): racha actual y récord
create view public.leaderboard_streak with (security_invoker = true) as
select rank() over (order by s.current_streak desc, s.best_streak desc) as rank, pp.*, s.current_streak, s.best_streak
from public.public_profiles pp
cross join lateral (
  select public.current_streak(pp.user_id) as current_streak,
    coalesce((select ps.best_streak from public.profile_stats ps where ps.user_id = pp.user_id), 0) as best_streak
) s
where s.current_streak > 0;

-- XP de la semana en curso (de lunes a domingo, hora de Colombia); desempate por % de cumplimiento
create view public.leaderboard_xp_week with (security_invoker = true) as
select rank() over (order by w.xp desc, w.completion desc nulls last) as rank, pp.*, w.xp, w.completion
from public.public_profiles pp
cross join lateral (
  select coalesce(sum(d.xp), 0) as xp, avg(d.completion) filter (where d.scheduled > 0) as completion
  from public.daily_stats d
  where d.user_id = pp.user_id and d.day between public.week_start(public.co_today()) and public.week_start(public.co_today()) + 6
) w
where w.xp > 0;

-- XP de por vida; desempate por % de cumplimiento de los últimos 30 días
create view public.leaderboard_xp_total with (security_invoker = true) as
select rank() over (order by t.xp desc, t.completion desc nulls last) as rank, pp.*, t.xp, t.completion
from public.public_profiles pp
cross join lateral (
  select coalesce((select ps.xp_total from public.profile_stats ps where ps.user_id = pp.user_id), 0) as xp,
    (select avg(d.completion) from public.daily_stats d
     where d.user_id = pp.user_id and d.scheduled > 0 and d.day > public.co_today() - 30) as completion
) t
where t.xp > 0;

revoke all on public.public_profiles, public.leaderboard_streak, public.leaderboard_xp_week, public.leaderboard_xp_total from anon, authenticated;
grant select on public.public_profiles, public.leaderboard_streak, public.leaderboard_xp_week, public.leaderboard_xp_total to authenticated;

-- Ganadores de una semana cerrada (cambian las columnas: hay que borrarla antes)
drop function if exists public.podium(date);
create function public.podium(p_week date)
returns table (pos smallint, user_id uuid, alias text, display_name text, avatar_path text, frame_path text, frame_thumb text, xp numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select w.position, w.user_id, p.alias, p.display_name, p.avatar_path, fi.asset_path, fi.thumb_path, w.xp
  from public.weekly_podium w
  join public.profiles p on p.user_id = w.user_id
  left join public.catalog_items fi on fi.id = p.frame_item
  where w.week_start = p_week
  order by w.position;
$$;

create or replace function public.my_friends()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'streak', public.current_streak(p.user_id), 'since', f.responded_at)
        order by coalesce(p.alias, p.display_name))
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.user_id = f.requester
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'pending' and f.addressee = auth.uid()), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.user_id = f.addressee
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'pending' and f.requester = auth.uid()), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', b.blocked, 'alias', p.alias, 'display_name', p.display_name)
        order by coalesce(p.alias, p.display_name))
      from public.blocks b left join public.profiles p on p.user_id = b.blocked
      where b.blocker = auth.uid()), '[]'::jsonb)
  );
$$;

-- Creador: ficha de una persona por alias o por id
create or replace function public.admin_user(p_alias text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  handle text := lower(trim(p_alias));
  p public.profiles;
begin
  perform public.assert_admin();
  select * into p from public.profiles where alias = handle or user_id::text = handle limit 1;
  if p.user_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'profile', to_jsonb(p),
    'stats', (select to_jsonb(ps) from public.profile_stats ps where ps.user_id = p.user_id),
    'balance', public.balance_of(p.user_id),
    'current_streak', public.current_streak(p.user_id),
    'bans', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from public.bans b where b.user_id = p.user_id), '[]'::jsonb),
    'warnings', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from public.warnings w where w.user_id = p.user_id), '[]'::jsonb),
    'banned', public.is_banned(p.user_id)
  );
end;
$$;

-- ===========================================================================
-- Publicaciones: editar el comentario y «de tus amigos» sin las propias
-- ===========================================================================
alter table public.posts add column if not exists edited_at timestamptz;

-- Cambiar el comentario de una publicación propia (máx. 30 ediciones al día). Queda marcada como editada
create or replace function public.edit_post(p_post uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if char_length(v_comment) > 200 then
    raise exception 'El comentario tiene más de 200 caracteres' using errcode = '22023';
  end if;
  if not exists (select 1 from public.posts where id = p_post and user_id = uid) then
    raise exception 'Solo puedes editar tus publicaciones' using errcode = '42501';
  end if;
  if (select count(*) from public.rate_log where user_id = uid and action = 'edit_post' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Como mucho 30 ediciones al día' using errcode = '54000';
  end if;
  update public.posts set comment = v_comment, edited_at = now() where id = p_post and user_id = uid;
  delete from public.rate_log where user_id = uid and created_at < now() - interval '2 days';
  insert into public.rate_log (user_id, action) values (uid, 'edit_post');
end;
$$;

-- Publicaciones de una persona (o de tus amigos si no se indica; las tuyas se ven en tu perfil) con sus reacciones
create or replace function public.post_feed(p_user uuid default null, p_before timestamptz default null, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'created_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'user_id', p.user_id, 'template', p.template, 'data', p.data, 'comment', p.comment, 'created_at', p.created_at,
      'edited_at', p.edited_at,
      'alias', pr.alias, 'display_name', pr.display_name, 'avatar_path', pr.avatar_path, 'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path,
      'reactions', jsonb_build_object(
        'fire', (select count(*) from public.post_reactions r where r.post_id = p.id and r.emoji = 'fire'),
        'muscle', (select count(*) from public.post_reactions r where r.post_id = p.id and r.emoji = 'muscle'),
        'clap', (select count(*) from public.post_reactions r where r.post_id = p.id and r.emoji = 'clap')),
      'mine', coalesce((select jsonb_agg(r.emoji) from public.post_reactions r where r.post_id = p.id and r.user_id = auth.uid()), '[]'::jsonb)
    ) as x
    from public.posts p
    join public.profiles pr on pr.user_id = p.user_id
    left join public.catalog_items fi on fi.id = pr.frame_item
    where auth.uid() is not null
      and (p_before is null or p.created_at < p_before)
      and not public.blocked_between(auth.uid(), p.user_id)
      and (
        (p_user is not null and p.user_id = p_user)
        or (p_user is null and exists (
          select 1 from public.friendships f where f.status = 'accepted'
            and ((f.requester = auth.uid() and f.addressee = p.user_id) or (f.addressee = auth.uid() and f.requester = p.user_id))))
      )
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) t;
$$;

-- ===========================================================================
-- Ligas por puestos: 1.º–5.º suben, 6.º–10.º se quedan, del 11.º en adelante bajan.
-- Con una sola persona que compite en el grupo: no sube ni baja y gana el premio de participación
-- ===========================================================================

-- Mi liga esta semana: el grupo, las zonas de ascenso, permanencia y descenso y la cuenta atrás
create or replace function public.league_standings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wk date := public.week_start(public.co_today());
  m public.league_memberships;
  n integer;
  up_n integer := greatest(0, round(public.econ('leaguePromoteCount', 5)))::integer;
  stay_n integer := greatest(0, round(public.econ('leagueStayCount', 5)))::integer;
  v_promote integer := 0;
  v_demote integer := 0;
begin
  select * into m from public.league_memberships where user_id = me and week_start = wk;
  if m.user_id is null then
    return jsonb_build_object('member', false);
  end if;
  select count(*) into n from public.league_memberships lm
  where lm.week_start = wk and lm.league = m.league and lm.group_no = m.group_no and not public.is_banned(lm.user_id)
    and coalesce((select sum(d.xp) from public.daily_stats d where d.user_id = lm.user_id and d.day between wk and wk + 6), 0) > 0;
  -- Zonas sobre las personas que ya compiten, ajustadas a la liga (en Diamante nadie sube, en Bronce nadie baja)
  if n >= 2 then
    v_promote := case when m.league < 5 then least(n, up_n) else 0 end;
    v_demote := case when m.league > 1 then greatest(0, n - up_n - stay_n) else 0 end;
  end if;
  return jsonb_build_object(
    'member', true,
    'league', m.league,
    'league_name', (select name from public.leagues where id = m.league),
    'group', m.group_no,
    'week_start', wk,
    -- Lunes siguiente a las 00:00 de Colombia
    'ends_at', ((wk + 7)::timestamp + interval '5 hours') at time zone 'UTC',
    'ranked', n,
    'promote', v_promote,
    'stay', n - v_promote - v_demote,
    'demote', v_demote,
    'solo', n < 2,
    'solo_prize', greatest(0, round(public.econ('leagueSoloPrize', 25)))::integer,
    'prizes', public.league_prizes() -> (array['bronze', 'silver', 'gold', 'platinum', 'diamond'])[m.league],
    'members', coalesce((
      -- Mismo desempate que close_week (por id): el puesto y la zona que se ven son los que tendrá al cerrar
      select jsonb_agg(x order by (x ->> 'xp')::numeric desc, (x ->> 'completion')::numeric desc nulls last, x ->> 'user_id')
      from (
        select jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'display_name', p.display_name, 'avatar_path', p.avatar_path,
          'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'card_path', ci.asset_path, 'card_thumb', ci.thumb_path,
          'card_animated', ci.animated,
          'xp', coalesce(w.xp, 0), 'completion', w.completion) as x
        from public.league_memberships lm
        join public.profiles p on p.user_id = lm.user_id
        left join public.catalog_items fi on fi.id = p.frame_item
        left join public.catalog_items ci on ci.id = p.card_item
        left join lateral (
          select sum(d.xp) as xp, avg(d.completion) filter (where d.scheduled > 0) as completion
          from public.daily_stats d where d.user_id = lm.user_id and d.day between wk and wk + 6) w on true
        where lm.week_start = wk and lm.league = m.league and lm.group_no = m.group_no and not public.is_banned(lm.user_id)
      ) t), '[]'::jsonb)
  );
end;
$$;

-- Cierre semanal (lunes 00:00 de Colombia): ligas, premios, podio y logros. Idempotente
create or replace function public.close_week(p_week date default null, p_forced boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur date := public.week_start(public.co_today());
  wk date := public.week_start(coalesce(p_week, public.week_start(public.co_today()) - 7));
  nxt date;
  up_n integer := greatest(0, round(public.econ('leaguePromoteCount', 5)))::integer;
  stay_n integer := greatest(0, round(public.econ('leagueStayCount', 5)))::integer;
  solo_prize integer := greatest(0, round(public.econ('leagueSoloPrize', 25)))::integer;
  gsize integer := greatest(1, public.econ('leagueGroupSize', 30)::integer);
  prizes jsonb := public.league_prizes();
  n_ranked integer;
  v_summary jsonb;
begin
  nxt := wk + 7;
  if wk > cur or (wk = cur and not p_forced) then
    raise exception 'Esa semana aún no termina' using errcode = '22023';
  end if;
  -- La fila de cierre bloquea un segundo cierre de la misma semana (aunque se ejecuten a la vez)
  insert into public.week_closures (week_start, closed_by, forced) values (wk, auth.uid(), p_forced)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('closed', false, 'reason', 'already_closed', 'week', wk);
  end if;

  with stats as (
    select m.user_id, m.league, m.group_no,
      coalesce(sum(d.xp), 0) as xp,
      avg(d.completion) filter (where d.scheduled > 0) as completion,
      (count(d.day) = 7 and bool_and(d.perfect or d.scheduled = 0) and sum(d.scheduled) > 0) as perfect
    from public.league_memberships m
    left join public.daily_stats d on d.user_id = m.user_id and d.day between wk and wk + 6
    where m.week_start = wk and not public.is_banned(m.user_id)
    group by m.user_id, m.league, m.group_no
  ), ranked as (
    select s.*,
      row_number() over (partition by s.league, s.group_no order by s.xp desc, s.completion desc nulls last, s.user_id) as pos,
      count(*) over (partition by s.league, s.group_no) as n
    from stats s where s.xp > 0
  )
  insert into public.league_results (user_id, week_start, league, group_no, position, xp, completion, movement, prize, perfect)
  select r.user_id, wk, r.league, r.group_no, r.pos, r.xp, r.completion,
    case when r.n < 2 then 0
         when r.league < 5 and r.pos <= up_n then 1
         when r.league > 1 and r.pos > up_n + stay_n then -1
         else 0 end,
    case when r.n < 2 then solo_prize else public.league_prize(prizes, r.league, r.pos::integer) end,
    coalesce(r.perfect, false)
  from ranked r
  on conflict do nothing;
  get diagnostics n_ranked = row_count;

  -- Premios en monedas (no cuentan para el tope diario). La referencia única evita cobrarlos dos veces
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  select r.user_id, r.prize, 'league', 'league:' || wk, wk + 6,
    'Liga ' || l.name || case
      when (select count(*) from public.league_results o where o.week_start = wk and o.league = r.league and o.group_no = r.group_no) < 2
        then ': participación' else ': puesto ' || r.position end
  from public.league_results r join public.leagues l on l.id = r.league
  where r.week_start = wk and r.prize > 0
  on conflict do nothing;

  -- Liga de la semana siguiente para quien compitió, en grupos de nivel parecido (por XP)
  insert into public.league_memberships (user_id, week_start, league, group_no)
  select g.user_id, nxt, g.lg, g.grp from (
    select r.user_id, least(5, greatest(1, r.league + r.movement)) as lg,
      ((row_number() over (partition by least(5, greatest(1, r.league + r.movement)) order by r.xp desc, r.user_id) - 1) / gsize + 1)::integer as grp
    from public.league_results r where r.week_start = wk
  ) g
  on conflict (user_id, week_start) do update set league = excluded.league, group_no = excluded.group_no;

  -- Podio global de la semana
  insert into public.weekly_podium (week_start, position, user_id, xp)
  select wk, t.pos, t.user_id, t.xp from (
    select d.user_id, sum(d.xp) as xp,
      row_number() over (order by sum(d.xp) desc, avg(d.completion) filter (where d.scheduled > 0) desc nulls last, d.user_id) as pos
    from public.daily_stats d join public.profiles p on p.user_id = d.user_id
    where d.day between wk and wk + 6 and not public.is_banned(d.user_id)
    group by d.user_id having sum(d.xp) > 0
  ) t where t.pos <= 3
  on conflict do nothing;

  insert into public.notifications (user_id, kind, data)
  select r.user_id, 'league_result', jsonb_build_object('week', wk, 'league', r.league, 'position', r.position,
    'prize', r.prize, 'movement', r.movement)
  from public.league_results r where r.week_start = wk;
  insert into public.notifications (user_id, kind, data)
  select w.user_id, 'podium', jsonb_build_object('week', wk, 'position', w.position, 'xp', w.xp)
  from public.weekly_podium w where w.week_start = wk;

  perform public.check_achievements(r.user_id) from public.league_results r where r.week_start = wk;

  v_summary := jsonb_build_object('closed', true, 'week', wk, 'ranked', n_ranked,
    'prizes', (select coalesce(sum(prize), 0) from public.league_results where week_start = wk),
    -- Razón monedas ganadas / gastadas de la semana (documento de reglas), para vigilar la inflación. Ni el saldo de
    -- partida ni el saldo devuelto a 0 tras reiniciar el progreso (`reset:…`) son monedas ganadas
    'earned', (select coalesce(sum(amount), 0) from public.coin_ledger
               where amount > 0 and kind <> 'opening' and ref not like 'reset:%' and day between wk and wk + 6),
    'spent', (select coalesce(-sum(amount), 0) from public.coin_ledger where amount < 0 and day between wk and wk + 6));
  update public.week_closures set summary = v_summary where week_start = wk;
  return v_summary;
end;
$$;

-- ===========================================================================
-- Logros: el creador se los marca a sí mismo y volver a conseguir uno no repite premio ni aviso
-- ===========================================================================

-- Otorga los logros que ya se cumplen (una sola vez cada uno), con su premio y su notificación. Si ya se había
-- conseguido antes (tras reiniciar el progreso), la referencia única del premio impide cobrarlo otra vez y no se avisa de nuevo
create or replace function public.check_achievements(uid uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb;
  d record;
  got text[] := '{}';
  paid boolean;
begin
  if uid is null or not exists (select 1 from public.profiles where user_id = uid) then
    return got;
  end if;
  m := public.achievement_metrics(uid);
  for d in
    select a.* from public.achievement_defs a
    where a.active and not exists (select 1 from public.user_achievements u where u.user_id = uid and u.achievement_id = a.id)
    order by a.sort
  loop
    if coalesce((m ->> d.metric)::numeric, 0) >= d.threshold then
      insert into public.user_achievements (user_id, achievement_id) values (uid, d.id) on conflict do nothing;
      if found then
        got := got || d.id;
        paid := false;
        if d.prize > 0 then
          insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
          values (uid, d.prize, 'achievement', 'ach:' || d.id, public.co_today(), d.name)
          on conflict do nothing;
          paid := found;
        end if;
        if paid or not exists (
          select 1 from public.notifications n where n.user_id = uid and n.kind = 'achievement' and n.data ->> 'id' = d.id) then
          perform public.notify(uid, 'achievement', null,
            jsonb_build_object('id', d.id, 'name', d.name, 'icon', d.icon, 'rarity', d.rarity, 'prize', case when paid then d.prize else 0 end));
        end if;
      end if;
    end if;
  end loop;
  return got;
end;
$$;

-- Creador: marcarse o quitarse un logro en su propia cuenta (para probar cómo se ve). Sin premio ni aviso; queda registrado
create or replace function public.admin_set_achievement(p_achievement text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_admin();
begin
  if not exists (select 1 from public.achievement_defs where id = p_achievement) then
    raise exception 'Ese logro no existe' using errcode = '22023';
  end if;
  if coalesce(p_on, false) then
    insert into public.user_achievements (user_id, achievement_id) values (uid, p_achievement) on conflict do nothing;
  else
    delete from public.user_achievements where user_id = uid and achievement_id = p_achievement;
  end if;
  -- Los destacados que ya no tiene dejan de estar elegidos (si no, ocuparían el cupo de 3 sin verse)
  update public.profiles p set featured_achievements = array(
    select a from unnest(p.featured_achievements) a
    where exists (select 1 from public.user_achievements u where u.user_id = uid and u.achievement_id = a))
  where p.user_id = uid and cardinality(p.featured_achievements) > 0;
  perform public.log_action(uid, 'set_achievement', null, jsonb_build_object('achievement', p_achievement, 'on', coalesce(p_on, false)));
end;
$$;

-- ===========================================================================
-- Reiniciar el progreso publicado (los datos del dispositivo cambiaron por completo)
-- ===========================================================================

-- Último cambio completo de datos atendido (la hora que manda el dispositivo: el mismo cambio llega desde todos los
-- dispositivos de la cuenta y solo se atiende una vez) y topes para volver a reclamar el punto de partida después de un
-- reinicio: lo más alto que llegó a estar publicado hasta anteayer. null = nunca hubo un reinicio con algo publicado
alter table public.profile_stats add column if not exists last_reset_at timestamptz;
alter table public.profile_stats add column if not exists cap_xp numeric(12, 1);
alter table public.profile_stats add column if not exists cap_best integer;
alter table public.profile_stats add column if not exists cap_done integer;
alter table public.profile_stats add column if not exists cap_coins numeric(12, 1);

-- La versión anterior no recibía la hora del cambio: con las dos, la llamada sin argumentos sería ambigua
drop function if exists public.reset_my_progress();

-- Al empezar de cero, quitar la demostración o importar una copia, lo publicado deja de corresponder al dispositivo: se
-- borran los días, los hábitos visibles, los logros que salen de esas cifras (racha, XP y hábitos cumplidos) y los
-- movimientos del saldo que nacen en el dispositivo (saldo de partida, monedas del día, extras y gastos). El punto de
-- partida queda libre para reclamarlo otra vez, con topes (ver claim_baseline).
-- Se conservan las compras, los premios de liga y de logros (sus referencias únicas impiden cobrarlos dos veces), los
-- logros de monedas gastadas (los gastos de antes no se vuelven a enviar: no se podrían recuperar), los ajustes del
-- creador, las publicaciones, las amistades y la liga.
-- `p_reset_at`: la hora del cambio (`settings.dataResetAt`). Si ya se atendió ese cambio o uno posterior, no hace nada.
-- Si el saldo queda negativo (se conservan las compras pero se borra el saldo de partida), se devuelve a 0 con un
-- movimiento `admin` de referencia `reset:…`: así coincide con el del dispositivo (que nunca baja de 0, y lo recibe por
-- my_ledger), ningún reinicio posterior lo borra y no cuenta como monedas ganadas.
create or replace function public.reset_my_progress(p_reset_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  st public.profile_stats;
  -- Hoy y ayer siguen abiertos: se volverán a publicar como días normales, no forman parte del punto de partida
  open_from date := public.co_today() - 1;
  v_bal numeric;
begin
  -- Un solo movimiento del saldo a la vez (y dos dispositivos que atienden el mismo cambio no reinician dos veces)
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  insert into public.profile_stats (user_id) values (uid) on conflict do nothing;
  select * into st from public.profile_stats where user_id = uid;
  if p_reset_at is not null and st.last_reset_at is not null and st.last_reset_at >= p_reset_at then
    return jsonb_build_object('reset', false);
  end if;
  if (select count(*) from public.rate_log where user_id = uid and action = 'reset_progress' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Como mucho 10 reinicios del progreso al día' using errcode = '54000';
  end if;

  -- Topes del próximo reclamo: lo más alto publicado hasta anteayer (nunca bajan). Si nunca se publicó nada, no hay
  -- topes y el próximo reclamo es como el primero
  if st.baseline_at is not null or st.cap_xp is not null then
    update public.profile_stats ps set
      cap_xp = greatest(coalesce(ps.cap_xp, 0), ps.baseline_xp
        + coalesce((select sum(d.xp) from public.daily_stats d where d.user_id = uid and d.day < open_from), 0)),
      cap_best = greatest(coalesce(ps.cap_best, 0), ps.baseline_best, ps.baseline_streak,
        coalesce((select max(d.streak) from public.daily_stats d where d.user_id = uid and d.day < open_from), 0)),
      cap_done = greatest(coalesce(ps.cap_done, 0), ps.baseline_done
        + coalesce((select sum(d.done) from public.daily_stats d where d.user_id = uid and d.day < open_from), 0)),
      cap_coins = greatest(coalesce(ps.cap_coins, 0), coalesce((
        select sum(l.amount) from public.coin_ledger l
        where l.user_id = uid and l.kind in ('opening', 'habits', 'bonus', 'spend') and not (l.kind = 'habits' and l.day >= open_from)), 0))
    where ps.user_id = uid;
  end if;

  delete from public.daily_stats where user_id = uid;
  delete from public.public_habits where user_id = uid;
  delete from public.user_achievements u using public.achievement_defs d
  where u.user_id = uid and d.id = u.achievement_id and d.metric in ('streak', 'xp_total', 'habits_done');
  -- Los destacados que ya no tiene dejan de estar elegidos (si no, ocuparían el cupo de 3 sin verse)
  update public.profiles p set featured_achievements = array(
    select a from unnest(p.featured_achievements) a
    where exists (select 1 from public.user_achievements u where u.user_id = uid and u.achievement_id = a))
  where p.user_id = uid and cardinality(p.featured_achievements) > 0;
  delete from public.coin_ledger where user_id = uid and kind in ('opening', 'habits', 'bonus', 'spend');
  update public.profile_stats set baseline_at = null, baseline_streak = 0, baseline_best = 0, baseline_xp = 0,
    baseline_coins = 0, baseline_done = 0, last_reset_at = coalesce(p_reset_at, now())
  where user_id = uid;
  -- Las cifras quedan como recién creadas (con los ajustes de XP del creador)
  perform public.recompute_stats(uid);

  v_bal := public.balance_of(uid);
  if v_bal < 0 then
    insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
    values (uid, -v_bal, 'admin', 'reset:' || to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS'), public.co_today(),
      'Saldo devuelto a 0 al reiniciar el progreso')
    on conflict do nothing;
  end if;

  delete from public.rate_log where user_id = uid and created_at < now() - interval '2 days';
  insert into public.rate_log (user_id, action) values (uid, 'reset_progress');
  return jsonb_build_object('reset', true, 'balance', public.balance_of(uid));
end;
$$;

-- ===========================================================================
-- XP y monedas siempre enteros
-- ===========================================================================

-- Punto de partida: el historial del dispositivo hasta anteayer. Se acepta una sola vez (hasta un reinicio del progreso)
-- y con topes. Queda registrado para el creador.
-- - La primera vez: como mucho lo que se podría haber ganado desde un año antes de crear la cuenta.
-- - Tras un reinicio: como mucho lo más alto que hubo publicado (los topes que guardó reset_my_progress) más lo que se
--   pudo ganar desde el reinicio, o la antigüedad de la cuenta sin el año extra. Reiniciar y reclamar otra vez no infla
--   el perfil.
create or replace function public.claim_baseline(p_streak integer, p_best integer, p_xp numeric, p_coins numeric, p_done integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  st public.profile_stats;
  created timestamptz;
  age integer;
  since integer;
  coin_cap numeric := public.econ('coinDailyCap', 200);
  -- Topes de racha y récord (días), XP, monedas y hábitos cumplidos
  lim_days integer;
  lim_xp numeric;
  lim_coins numeric;
  lim_done numeric;
  v_streak integer;
  v_coins numeric;
begin
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  insert into public.profile_stats (user_id) values (uid) on conflict do nothing;
  -- La fila bloqueada: dos reclamos a la vez no se aceptan los dos
  select * into st from public.profile_stats where user_id = uid for update;
  if st.baseline_at is not null then
    return jsonb_build_object('claimed', false);
  end if;
  select u.created_at into created from auth.users u where u.id = uid;
  -- Días de la cuenta (contando hoy)
  age := greatest(1, public.co_today() - ((coalesce(created, now()) at time zone 'UTC') - interval '5 hours')::date + 1);
  if st.cap_xp is null then
    lim_days := age + 365;
    lim_xp := (age + 365) * 1600;
    lim_coins := (age + 365) * coin_cap;
    lim_done := (age + 365) * 100;
  else
    since := greatest(0, public.co_today() - ((coalesce(st.last_reset_at, now()) at time zone 'UTC') - interval '5 hours')::date);
    lim_days := greatest(coalesce(st.cap_best, 0) + since, age);
    lim_xp := greatest(st.cap_xp + since * 1600, age * 1600);
    lim_coins := greatest(coalesce(st.cap_coins, 0) + since * coin_cap, age * coin_cap);
    lim_done := greatest(coalesce(st.cap_done, 0) + since * 100, age * 100);
  end if;
  v_streak := least(greatest(coalesce(p_streak, 0), 0), lim_days, 3650);
  v_coins := round(least(greatest(coalesce(p_coins, 0), 0), lim_coins));

  update public.profile_stats set
    baseline_at = now(),
    baseline_streak = v_streak,
    baseline_best = greatest(v_streak, least(greatest(coalesce(p_best, 0), 0), lim_days, 3650)),
    baseline_xp = round(least(greatest(coalesce(p_xp, 0), 0), lim_xp)),
    baseline_coins = v_coins,
    baseline_done = least(greatest(coalesce(p_done, 0), 0), lim_done)
  where user_id = uid and baseline_at is null;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  values (uid, v_coins, 'opening', 'opening', public.co_today(), 'Saldo al crear el perfil')
  on conflict do nothing;

  perform public.recompute_stats(uid);
  perform public.check_achievements(uid);
  return jsonb_build_object('claimed', true, 'balance', public.balance_of(uid));
end;
$$;

-- Publica hoy y ayer (como mucho 3 filas): XP, monedas, % de cumplimiento y racha, con los topes del servidor
create or replace function public.publish_days(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  st public.profile_stats;
  r record;
  prev_streak integer;
  prev_day date;
  bonus_mult numeric;
  cap_coins numeric;
  cap_xp numeric;
  cap_xp_boost numeric;
  v_xp numeric;
  v_coins numeric;
  v_streak integer;
  v_boosted boolean;
  written integer := 0;
begin
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 3 then
    raise exception 'Lote no válido (máximo 3 días)' using errcode = '22023';
  end if;
  select * into st from public.profile_stats where user_id = uid;
  if st.user_id is null or st.baseline_at is null then
    raise exception 'Falta el punto de partida del perfil' using errcode = '22023';
  end if;

  for r in
    select * from jsonb_to_recordset(rows) as x(day date, xp numeric, coins numeric, completion numeric, done integer,
      scheduled integer, perfect boolean, streak integer, boosted boolean)
    order by x.day
  loop
    -- El pasado queda congelado: solo hoy y ayer
    if r.day is null or not public.day_is_open(r.day) then
      continue;
    end if;
    -- Topes con la versión de la economía que rige ese día (la misma que usa el dispositivo)
    bonus_mult := 1 + public.econ_on(r.day, 'streakBonusMaxDays', 30) * public.econ_on(r.day, 'streakBonusPerDay', 0.01);
    cap_coins := public.econ_on(r.day, 'coinDailyCap', 200);
    cap_xp := public.econ_on(r.day, 'xpBaseDailyCap', 800) * bonus_mult + public.econ_on(r.day, 'perfectDayBonus', 30);
    cap_xp_boost := public.econ_on(r.day, 'xpBaseDailyCap', 800) * public.econ_on(r.day, 'boostMultiplier', 1.5) * bonus_mult
      + public.econ_on(r.day, 'perfectDayBonus', 30);
    v_boosted := coalesce(r.boosted, false) and exists (
      select 1 from public.xp_boosts b
      where b.user_id = uid and b.started_at < (r.day + 2)::timestamptz and b.ends_at > (r.day - 1)::timestamptz);
    -- Enteros, después de los topes
    v_xp := round(least(greatest(coalesce(r.xp, 0), 0), case when v_boosted then cap_xp_boost else cap_xp end));
    v_coins := round(least(greatest(coalesce(r.coins, 0), 0), cap_coins));

    -- La racha sube como mucho 1 por día transcurrido desde el último día publicado (o desde el punto de partida,
    -- que resume el historial hasta anteayer). Así un día sin conexión no la deja desfasada para siempre
    select d.streak, d.day into prev_streak, prev_day from public.daily_stats d
    where d.user_id = uid and d.day < r.day order by d.day desc limit 1;
    if not found then
      prev_streak := st.baseline_streak;
      prev_day := ((st.baseline_at at time zone 'UTC') - interval '5 hours')::date - 2;
    end if;
    v_streak := least(greatest(coalesce(r.streak, 0), 0), prev_streak + greatest(1, r.day - prev_day));

    insert into public.daily_stats as d (user_id, day, xp, coins, completion, done, scheduled, perfect, streak, boosted, updated_at)
    values (uid, r.day, v_xp, v_coins, case when r.completion is null then null else least(greatest(r.completion, 0), 1) end, least(greatest(coalesce(r.done, 0), 0), 100),
      least(greatest(coalesce(r.scheduled, 0), 0), 100), coalesce(r.perfect, false), v_streak, v_boosted, now())
    on conflict (user_id, day) do update set
      xp = excluded.xp, coins = excluded.coins, completion = excluded.completion, done = excluded.done,
      scheduled = excluded.scheduled, perfect = excluded.perfect, streak = excluded.streak, boosted = excluded.boosted,
      updated_at = now();

    -- Si este día bajó, el siguiente publicado tampoco puede quedar por encima de lo permitido
    update public.daily_stats d set streak = v_streak + (d.day - r.day)
    where d.user_id = uid and d.streak > v_streak + (d.day - r.day)
      and d.day = (select min(n.day) from public.daily_stats n where n.user_id = uid and n.day > r.day);

    insert into public.coin_ledger (user_id, amount, kind, ref, day)
    values (uid, v_coins, 'habits', r.day::text, r.day)
    on conflict (user_id, kind, ref) do update set amount = excluded.amount, updated_at = now();
    written := written + 1;
  end loop;

  perform public.recompute_stats(uid);
  perform public.ensure_membership(uid);
  perform public.check_achievements(uid);
  return jsonb_build_object('written', written, 'balance', public.balance_of(uid));
end;
$$;

-- Monedas que se mueven en el dispositivo: gastos (premios propios, protector) y extras (retos, revisiones…).
-- Idempotente por id. Los extras solo de hoy o ayer y con tope diario. Siempre enteros
create or replace function public.sync_wallet(spends jsonb, bonuses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  r record;
  cap numeric := public.econ('bonusDailyCap', 500);
  used numeric;
  v numeric;
begin
  if not exists (select 1 from public.profile_stats where user_id = uid and baseline_at is not null) then
    raise exception 'Falta el punto de partida del perfil' using errcode = '22023';
  end if;
  -- Un solo movimiento del saldo a la vez (el tope de extras y las compras leen la suma)
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  if jsonb_typeof(coalesce(spends, '[]')) <> 'array' or jsonb_typeof(coalesce(bonuses, '[]')) <> 'array'
     or jsonb_array_length(coalesce(spends, '[]')) > 200 or jsonb_array_length(coalesce(bonuses, '[]')) > 200 then
    raise exception 'Lote no válido' using errcode = '22023';
  end if;

  for r in select * from jsonb_to_recordset(coalesce(spends, '[]')) as x(id text, amount numeric, note text, day date) loop
    v := round(least(coalesce(r.amount, 0), 100000));
    if r.id is null or r.id like 'srv-%' or v <= 0 then
      continue;
    end if;
    insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
    values (uid, -v, 'spend', left(r.id, 100), r.day, left(r.note, 200))
    on conflict do nothing;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(bonuses, '[]')) as x(id text, amount numeric, note text, day date) loop
    if r.id is null or r.id like 'srv-%' or coalesce(r.amount, 0) <= 0 or r.day is null or not public.day_is_open(r.day)
       or exists (select 1 from public.coin_ledger where user_id = uid and kind = 'bonus' and ref = left(r.id, 100)) then
      continue;
    end if;
    select coalesce(sum(amount), 0) into used from public.coin_ledger where user_id = uid and kind = 'bonus' and day = r.day;
    -- Sin pasar del tope: se redondea hacia abajo lo que queda de él
    v := least(round(r.amount), floor(cap - used));
    if v > 0 then
      insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
      values (uid, v, 'bonus', left(r.id, 100), r.day, left(r.note, 200))
      on conflict do nothing;
    end if;
  end loop;

  perform public.check_achievements(uid);
  return jsonb_build_object('balance', public.balance_of(uid));
end;
$$;

create or replace function public.admin_adjust_coins(p_user uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_id bigint;
  v numeric := round(p_amount);
begin
  perform public.assert_admin();
  if v is null or v = 0 or abs(v) > 100000 then
    raise exception 'Cantidad no válida' using errcode = '22023';
  end if;
  action_id := public.log_action(p_user, 'adjust_coins', p_reason, jsonb_build_object('amount', v));
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  values (p_user, v, 'admin', 'adm:' || action_id, public.co_today(), left(p_reason, 200));
  perform public.notify(p_user, 'admin_coins', null, jsonb_build_object('amount', v, 'reason', p_reason));
  return public.balance_of(p_user);
end;
$$;

create or replace function public.admin_adjust_xp(p_user uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v numeric := round(p_amount);
begin
  perform public.assert_admin();
  if v is null or v = 0 or abs(v) > 1000000 then
    raise exception 'Cantidad no válida' using errcode = '22023';
  end if;
  insert into public.profile_stats (user_id) values (p_user) on conflict do nothing;
  update public.profile_stats set xp_adjust = xp_adjust + v where user_id = p_user;
  perform public.recompute_stats(p_user);
  perform public.log_action(p_user, 'adjust_xp', p_reason, jsonb_build_object('amount', v));
  return (select xp_total from public.profile_stats where user_id = p_user);
end;
$$;

-- Lo ya guardado con decimales se redondea (y se recalculan las cifras de quien tenía XP con decimales)
do $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(ps.user_id), '{}') into ids from public.profile_stats ps
  where ps.xp_total <> round(ps.xp_total) or ps.baseline_xp <> round(ps.baseline_xp) or ps.xp_adjust <> round(ps.xp_adjust)
     or exists (select 1 from public.daily_stats d where d.user_id = ps.user_id and d.xp <> round(d.xp));
  update public.daily_stats set xp = round(xp), coins = round(coins) where xp <> round(xp) or coins <> round(coins);
  update public.profile_stats set baseline_xp = round(baseline_xp), baseline_coins = round(baseline_coins), xp_adjust = round(xp_adjust)
  where baseline_xp <> round(baseline_xp) or baseline_coins <> round(baseline_coins) or xp_adjust <> round(xp_adjust);
  update public.coin_ledger set amount = round(amount) where amount <> round(amount);
  update public.league_results set xp = round(xp) where xp <> round(xp);
  update public.weekly_podium set xp = round(xp) where xp <> round(xp);
  perform public.recompute_stats(u) from unnest(ids) u;
end;
$$;

-- ===========================================================================
-- Permisos de las funciones de este archivo: las internas no las puede llamar nadie desde la app; las públicas, solo con sesión
-- ===========================================================================
do $$
declare
  f text;
begin
  for f in select unnest(array[
    'public.profiles_guard()', 'public.blocks_after_insert()', 'public.check_achievements(uuid)', 'public.close_week(date, boolean)'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in select unnest(array[
    'public.toggle_profile_like(uuid)', 'public.public_profile(text)', 'public.profile_week(uuid, date)', 'public.podium(date)',
    'public.my_friends()', 'public.admin_user(text)', 'public.edit_post(uuid, text)', 'public.post_feed(uuid, timestamptz, integer)',
    'public.league_standings()', 'public.admin_set_achievement(text, boolean)', 'public.reset_my_progress(timestamptz)',
    'public.claim_baseline(integer, integer, numeric, numeric, integer)', 'public.publish_days(jsonb)', 'public.sync_wallet(jsonb, jsonb)',
    'public.admin_adjust_coins(uuid, numeric, text)', 'public.admin_adjust_xp(uuid, numeric, text)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
