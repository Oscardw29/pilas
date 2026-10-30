-- ¡Pilas! · Capa pública: perfiles, clasificaciones, ligas, logros, social, tienda y panel del creador
--
-- Requiere 0001_init.sql. Aplicar en: Supabase → SQL Editor → pegar este archivo → Run.
-- Se puede volver a ejecutar: no borra datos.
--
-- Lo privado sigue cifrado en `records` (0001). Aquí solo vive lo que la persona decide publicar al crear su perfil
-- público (alias, foto, cosméticos, racha, XP por día, % de cumplimiento y los hábitos que marque como visibles).
--
-- Reglas de seguridad:
-- - Lo que da puestos o monedas (XP, racha, monedas, logros, ligas) solo se escribe por funciones que aplican los topes.
-- - El rol de creador vive en `app_admins` y lo comprueba `is_admin()`. La app nunca compara correos para dar permisos.
-- - Quien tiene un veto activo no puede escribir nada público (`assert_can_write()`).

-- ===========================================================================
-- Utilidades
-- ===========================================================================

-- Fecha de hoy en Colombia (UTC−5, sin horario de verano): define las semanas de las ligas y del ranking
create or replace function public.co_today()
returns date
language sql
stable
set search_path = ''
as $$
  select ((now() at time zone 'UTC') - interval '5 hours')::date;
$$;

-- Lunes de la semana de una fecha
create or replace function public.week_start(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select d - (extract(isodow from d)::int - 1);
$$;

-- ¿Se puede publicar este día? Solo hoy y ayer (en el huso horario de cualquier persona: UTC−12 a UTC+14)
create or replace function public.day_is_open(d date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select d between ((now() at time zone 'UTC') - interval '38 hours')::date and ((now() at time zone 'UTC') + interval '14 hours')::date;
$$;

-- ===========================================================================
-- Rol de creador
-- ===========================================================================
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- Cuenta del creador. Si la cuenta se crea después de ejecutar este archivo, vuelve a ejecutar esta línea.
insert into public.app_admins (user_id)
select id from auth.users where lower(email) = 'oscarwis2009@gmail.com'
on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- ===========================================================================
-- Vetos
-- ===========================================================================
create table if not exists public.bans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  admin_id uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  starts_at timestamptz not null default now(),
  -- null = permanente
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bans_user on public.bans (user_id);

create or replace function public.is_banned(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bans b
    where b.user_id = uid and b.lifted_at is null and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
  );
$$;

-- Usuario con sesión y sin veto activo (si no, error). Devuelve su id
create or replace function public.assert_can_write()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  if public.is_banned(uid) then
    raise exception 'VETO: tu cuenta tiene un veto activo' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function public.assert_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo el creador puede hacer esto' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- ===========================================================================
-- Parámetros de la economía (versionados: borrador → publicar con fecha → revertir)
-- ===========================================================================
create table if not exists public.economy_config (
  version integer generated always as identity primary key,
  params jsonb not null check (jsonb_typeof(params) = 'object' and octet_length(params::text) < 20000),
  status text not null default 'draft' check (status in ('draft', 'published')),
  effective_from timestamptz,
  note text check (char_length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

-- Versión inicial: los valores del documento de reglas y la tabla de premios de las ligas
insert into public.economy_config (params, status, effective_from, note, published_at)
select
  jsonb_build_object(
    'coinDailyCap', 200, 'xpBaseDailyCap', 800, 'streakBonusPerDay', 0.01, 'streakBonusMaxDays', 30,
    'perfectDayBonus', 30, 'boostMultiplier', 1.5, 'boostHours', 12, 'boostCooldownHours', 24, 'boostMaxPerMonth', 4,
    'boostPriceFactor', 2, 'boostPriceMin', 100, 'boostPriceMax', 600, 'rhythmDays', 14,
    'bonusDailyCap', 500,
    'leaguePromotePct', 20, 'leagueDemotePct', 20, 'leagueGroupSize', 30,
    'leaguePrizes', jsonb_build_object(
      'bronze', jsonb_build_array(150, 100, 70, 25),
      'silver', jsonb_build_array(200, 135, 95, 35),
      'gold', jsonb_build_array(260, 175, 120, 45),
      'platinum', jsonb_build_array(330, 220, 155, 55),
      'diamond', jsonb_build_array(400, 270, 190, 70)
    )
  ),
  'published', '2000-01-01', 'Valores iniciales', now()
where not exists (select 1 from public.economy_config);

-- Parámetros vigentes (la última versión publicada cuya fecha ya llegó)
create or replace function public.economy_params()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.params from public.economy_config c
     where c.status = 'published' and c.effective_from <= now()
     order by c.effective_from desc, c.version desc limit 1),
    '{}'::jsonb
  );
$$;

create or replace function public.econ(key text, fallback numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.economy_params() ->> key)::numeric, fallback);
$$;

-- Las versiones rigen por días completos de Colombia: publicar a las 14:00 cuenta desde las 00:00 de ese día, igual que
-- en el dispositivo (que aplica cada versión desde ese día). Así el servidor y la app topan cada día con los mismos valores
create or replace function public.co_day_start(t timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (((t at time zone 'UTC') - interval '5 hours')::date + interval '5 hours') at time zone 'UTC';
$$;

-- Parámetros que rigen un día (la versión publicada más reciente que empezó ese día o antes)
create or replace function public.economy_params_on(d date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.params from public.economy_config c
     where c.status = 'published' and c.effective_from < ((d + 1)::timestamp + interval '5 hours') at time zone 'UTC'
     order by c.effective_from desc, c.version desc limit 1),
    '{}'::jsonb
  );
$$;

create or replace function public.econ_on(d date, key text, fallback numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.economy_params_on(d) ->> key)::numeric, fallback);
$$;

-- Versiones publicadas (la app calcula cada día con la versión que regía ese día)
create or replace function public.economy_versions()
returns table (version integer, params jsonb, effective_from timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.version, c.params, c.effective_from from public.economy_config c
  where c.status = 'published' order by c.effective_from, c.version;
$$;

-- ===========================================================================
-- Catálogo de la tienda e inventario
-- ===========================================================================
create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('banner', 'frame', 'card', 'reward')),
  name text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 300),
  price integer not null check (price between 0 and 100000),
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  animated boolean not null default false,
  -- Rutas dentro del bucket `catalog` (WebP). `thumb_path`: fotograma fijo para tamaños pequeños
  asset_path text check (char_length(asset_path) < 300),
  thumb_path text check (char_length(thumb_path) < 300),
  -- Recompensas sin imagen
  icon text check (char_length(icon) <= 16),
  -- draft: solo lo ve el creador · published: a la venta · retired: ya no se vende, pero quien lo tiene lo sigue viendo
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  sort integer not null default 0,
  -- Muestras importadas desde la app (evita duplicarlas)
  sample_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory (
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.catalog_items (id) on delete restrict,
  price_paid integer not null default 0,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- ===========================================================================
-- Perfiles públicos
-- ===========================================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  alias text not null unique check (alias ~ '^[a-z0-9_]{3,20}$'),
  -- Ruta dentro del bucket `avatars` (siempre en la carpeta del usuario)
  avatar_path text check (char_length(avatar_path) < 200),
  banner_item uuid references public.catalog_items (id) on delete set null,
  frame_item uuid references public.catalog_items (id) on delete set null,
  card_item uuid references public.catalog_items (id) on delete set null,
  -- Tarjetas que se muestran en el perfil público
  cards text[] not null default array['streak', 'xp_week', 'member_since']::text[]
    check (cards <@ array['streak', 'xp_week', 'member_since', 'habits', 'achievements']::text[]),
  -- Hasta 3 logros elegidos
  featured_achievements text[] not null default '{}'::text[] check (cardinality(featured_achievements) <= 3),
  member_since timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cifras derivadas de cada persona (solo las escriben las funciones)
create table if not exists public.profile_stats (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Punto de partida: el historial del dispositivo al crear el perfil (se acepta una sola vez, con topes)
  baseline_at timestamptz,
  baseline_streak integer not null default 0,
  baseline_best integer not null default 0,
  baseline_xp numeric(12, 1) not null default 0,
  baseline_coins numeric(12, 1) not null default 0,
  baseline_done integer not null default 0,
  -- Ajustes del creador
  xp_adjust numeric(12, 1) not null default 0,
  best_streak integer not null default 0,
  xp_total numeric(12, 1) not null default 0,
  habits_done integer not null default 0,
  last_day date,
  updated_at timestamptz not null default now()
);

-- Un día de cada persona: lo que suma al ranking. Solo lo escribe publish_days(), que aplica los topes
create table if not exists public.daily_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  xp numeric(7, 1) not null default 0 check (xp >= 0),
  coins numeric(6, 1) not null default 0 check (coins >= 0),
  completion numeric(4, 3) check (completion between 0 and 1),
  done smallint not null default 0 check (done between 0 and 100),
  scheduled smallint not null default 0 check (scheduled between 0 and 100),
  perfect boolean not null default false,
  -- Racha (días seguidos) ese día; sube como mucho 1 respecto al día publicado anterior
  streak integer not null default 0 check (streak >= 0),
  boosted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_stats_day on public.daily_stats (day);

-- Hábitos marcados como «Visible en mi perfil» (los demás nunca salen del dispositivo sin cifrar)
create table if not exists public.public_habits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_key text not null check (char_length(habit_key) between 1 and 64),
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default '' check (char_length(icon) <= 16),
  kind text not null default 'action' check (kind in ('time', 'action', 'quantity')),
  unit text check (char_length(unit) <= 16),
  target numeric check (target >= 0),
  position smallint not null default 0,
  -- { "AAAA-MM-DD": { "s": "full" | "minimum" | "missed", "m": minutos, "q": cantidad } } de las últimas semanas
  days jsonb not null default '{}'::jsonb check (jsonb_typeof(days) = 'object' and octet_length(days::text) < 8000),
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_key)
);

-- ===========================================================================
-- Monedas (el saldo es la suma de los movimientos)
-- ===========================================================================
create table if not exists public.coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(10, 1) not null,
  -- opening: saldo al crear el perfil · habits: monedas de un día (con tope) · bonus: retos, revisiones… (con tope)
  -- spend: premios propios y protector · purchase: tienda del servidor · league / achievement: premios · admin: ajuste
  kind text not null check (kind in ('opening', 'habits', 'bonus', 'spend', 'purchase', 'league', 'achievement', 'admin')),
  ref text not null check (char_length(ref) <= 100),
  day date,
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, ref)
);
create index if not exists coin_ledger_user on public.coin_ledger (user_id, id);

create or replace function public.balance_of(uid uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0) from public.coin_ledger where user_id = uid;
$$;

-- Multiplicadores de XP comprados (el servidor los necesita para aceptar el tope alto de XP de ese día)
create table if not exists public.xp_boosts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  price integer not null,
  ledger_id bigint
);
create index if not exists xp_boosts_user on public.xp_boosts (user_id, started_at);

-- ===========================================================================
-- Ligas, podio y logros
-- ===========================================================================
create table if not exists public.leagues (
  id smallint primary key check (id between 1 and 5),
  slug text not null unique,
  name text not null
);
insert into public.leagues (id, slug, name) values
  (1, 'bronze', 'Bronce'), (2, 'silver', 'Plata'), (3, 'gold', 'Oro'), (4, 'platinum', 'Platino'), (5, 'diamond', 'Diamante')
on conflict (id) do nothing;

create table if not exists public.league_memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  league smallint not null references public.leagues (id),
  group_no integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
create index if not exists league_memberships_group on public.league_memberships (week_start, league, group_no);

create table if not exists public.league_results (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  league smallint not null references public.leagues (id),
  group_no integer not null,
  position integer not null,
  xp numeric(9, 1) not null,
  completion numeric(4, 3),
  -- 1 sube · 0 se queda · −1 baja
  movement smallint not null default 0 check (movement between -1 and 1),
  prize integer not null default 0,
  perfect boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create table if not exists public.weekly_podium (
  week_start date not null,
  position smallint not null check (position between 1 and 3),
  user_id uuid not null references auth.users (id) on delete cascade,
  xp numeric(9, 1) not null,
  primary key (week_start, position)
);
create index if not exists weekly_podium_user on public.weekly_podium (user_id);

create table if not exists public.week_closures (
  week_start date primary key,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users (id) on delete set null,
  forced boolean not null default false,
  summary jsonb
);

create table if not exists public.achievement_defs (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 200),
  icon text not null default '🏅' check (char_length(icon) <= 16),
  rarity text not null default 'common' check (rarity in ('common', 'rare', 'epic', 'legendary')),
  metric text not null check (metric in (
    'streak', 'xp_total', 'coins_spent', 'podium_1', 'podium_2', 'podium_3', 'promotions', 'league_max',
    'perfect_weeks', 'habits_done', 'friends', 'posts', 'cheers_sent', 'cosmetics'
  )),
  threshold numeric not null check (threshold > 0),
  prize integer not null default 0 check (prize between 0 and 10000),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.achievement_defs (id, name, description, icon, rarity, metric, threshold, sort) values
  ('chispa', 'Chispa', 'Racha de 3 días', '🔥', 'common', 'streak', 3, 10),
  ('semana_encendida', 'Semana encendida', 'Racha de 7 días', '🔥', 'common', 'streak', 7, 11),
  ('diez_de_diez', 'Diez de diez', 'Racha de 10 días', '🔥', 'common', 'streak', 10, 12),
  ('mes_imparable', 'Un mes imparable', 'Racha de 30 días', '🔥', 'rare', 'streak', 30, 13),
  ('dos_meses', 'Dos meses de fuego', 'Racha de 60 días', '🔥', 'rare', 'streak', 60, 14),
  ('centenario', 'Centenario', 'Racha de 100 días', '🔥', 'epic', 'streak', 100, 15),
  ('anio_entero', 'Un año entero', 'Racha de 365 días', '🔥', 'legendary', 'streak', 365, 16),
  ('primeros_mil', 'Primeros mil', '1 000 XP en total', '⚡', 'common', 'xp_total', 1000, 20),
  ('diez_mil', 'Diez mil', '10 000 XP en total', '⚡', 'rare', 'xp_total', 10000, 21),
  ('leyenda', 'Leyenda de la constancia', '50 000 XP en total', '⚡', 'epic', 'xp_total', 50000, 22),
  ('primer_gasto', 'Primer gasto', 'Gastar 100 monedas', '🪙', 'common', 'coins_spent', 100, 30),
  ('buen_cliente', 'Buen cliente', 'Gastar 1 000 monedas', '🪙', 'rare', 'coins_spent', 1000, 31),
  ('campeon', 'Campeón de la semana', 'Quedar 1.º en el ranking semanal', '🥇', 'epic', 'podium_1', 1, 40),
  ('subcampeon', 'Subcampeón', 'Quedar 2.º en el ranking semanal', '🥈', 'rare', 'podium_2', 1, 41),
  ('en_el_podio', 'En el podio', 'Quedar 3.º en el ranking semanal', '🥉', 'rare', 'podium_3', 1, 42),
  ('tricampeon', 'Tricampeón', 'Quedar 1.º en tres semanas distintas', '🏆', 'legendary', 'podium_1', 3, 43),
  ('ascenso', 'Ascenso', 'Subir de liga por primera vez', '🛡️', 'common', 'promotions', 1, 50),
  ('diamante', 'Diamante', 'Llegar a la liga Diamante', '💎', 'epic', 'league_max', 5, 51),
  ('semana_perfecta', 'Semana perfecta', 'Cumplir todos los hábitos programados de una semana', '✅', 'rare', 'perfect_weeks', 1, 60),
  ('cinco_perfectas', 'Cinco semanas perfectas', 'Cinco semanas perfectas, no necesariamente seguidas', '✅', 'epic', 'perfect_weeks', 5, 61),
  ('cien_habitos', 'Cien hábitos', '100 hábitos cumplidos', '📈', 'common', 'habits_done', 100, 70),
  ('buena_compania', 'Buena compañía', 'Tener 5 amigos', '🤝', 'common', 'friends', 5, 80),
  ('primera_publicacion', 'Primera publicación', 'Publicar por primera vez', '📣', 'common', 'posts', 1, 81),
  ('animador', 'Animador', 'Enviar ánimos 10 veces', '💬', 'common', 'cheers_sent', 10, 82),
  ('con_estilo', 'Con estilo', 'Comprar el primer cosmético', '🎨', 'common', 'cosmetics', 1, 90)
on conflict (id) do nothing;

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null references public.achievement_defs (id) on delete cascade,
  achieved_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

-- ===========================================================================
-- Social: amistades, bloqueos, publicaciones, reacciones, ánimos, notificaciones y reportes
-- ===========================================================================
create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee on public.friendships (addressee);

create table if not exists public.blocks (
  blocker uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked on public.blocks (blocked);

-- Solo responde si una de las dos personas es quien pregunta (los bloqueos de otros son privados)
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or auth.uid() in (a, b))
    and exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  template text not null check (template in ('streak', 'habit_streak', 'perfect_week', 'xp_week', 'achievement', 'league_up', 'podium')),
  -- Datos que rellena el servidor (no se pueden editar)
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 2000),
  comment text check (char_length(comment) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists posts_user on public.posts (user_id, created_at desc);

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null check (emoji in ('fire', 'muscle', 'clap')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

create table if not exists public.cheers (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cheer', 'congrats')),
  variant smallint not null default 0,
  day date not null default public.co_today(),
  created_at timestamptz not null default now(),
  unique (sender, recipient, day),
  check (sender <> recipient)
);
create index if not exists cheers_sender_day on public.cheers (sender, day);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- friend_request · friend_accepted · friend_post · cheer · achievement · league_result · podium · warning · ban · admin_coins
  kind text not null check (char_length(kind) <= 40),
  actor_id uuid references auth.users (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid default auth.uid() references auth.users (id) on delete set null,
  target_user uuid not null references auth.users (id) on delete cascade,
  post_id uuid references public.posts (id) on delete set null,
  reason text not null check (reason in ('spam', 'offensive', 'cheating', 'impersonation', 'other')),
  details text check (char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz
);
create index if not exists reports_status on public.reports (status, created_at);

create table if not exists public.warnings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  admin_id uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_actions (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users (id) on delete set null,
  target_user uuid references auth.users (id) on delete set null,
  action text not null,
  reason text check (char_length(reason) <= 500),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Registro de acciones con límite diario (publicar, solicitudes de amistad). Borrar lo creado no devuelve el cupo
create table if not exists public.rate_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_log_user on public.rate_log (user_id, action, created_at);
alter table public.rate_log enable row level security;
revoke all on public.rate_log from anon, authenticated;

-- Notificación interna (las funciones la usan; la app no puede crearlas directamente)
create or replace function public.notify(uid uuid, p_kind text, p_actor uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if uid is null then
    return;
  end if;
  insert into public.notifications (user_id, kind, actor_id, data) values (uid, p_kind, p_actor, coalesce(p_data, '{}'::jsonb));
  -- La bandeja guarda los últimos 120 días
  delete from public.notifications where user_id = uid and created_at < now() - interval '120 days';
end;
$$;

create or replace function public.log_action(p_target uuid, p_action text, p_reason text, p_data jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_actions (admin_id, target_user, action, reason, data)
  values (auth.uid(), p_target, p_action, p_reason, coalesce(p_data, '{}'::jsonb))
  returning id;
$$;

-- ===========================================================================
-- Cifras derivadas, ligas y logros (funciones internas)
-- ===========================================================================
create or replace function public.recompute_stats(uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profile_stats ps set
    xp_total = ps.baseline_xp + ps.xp_adjust + coalesce((select sum(d.xp) from public.daily_stats d where d.user_id = uid), 0),
    habits_done = ps.baseline_done + coalesce((select sum(d.done) from public.daily_stats d where d.user_id = uid), 0),
    best_streak = greatest(ps.baseline_best, ps.baseline_streak, coalesce((select max(d.streak) from public.daily_stats d where d.user_id = uid), 0)),
    last_day = (select max(d.day) from public.daily_stats d where d.user_id = uid),
    updated_at = now()
  where ps.user_id = uid;
$$;

-- Racha vigente: la del último día publicado, si fue hace 2 días como mucho
create or replace function public.current_streak(uid uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when d.day >= public.co_today() - 2 then d.streak else 0 end
     from public.daily_stats d where d.user_id = uid order by d.day desc limit 1),
    0
  );
$$;

-- Liga de la semana en curso (se crea al publicar o al crear el perfil)
create or replace function public.ensure_membership(uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  wk date := public.week_start(public.co_today());
  lg integer;
  g integer;
  gsize integer := public.econ('leagueGroupSize', 30)::integer;
begin
  if not exists (select 1 from public.profiles where user_id = uid) or public.is_banned(uid) then
    return;
  end if;
  if exists (select 1 from public.league_memberships where user_id = uid and week_start = wk) then
    return;
  end if;
  -- La última liga en la que estuvo, con el ascenso o descenso de esa semana si se cerró
  select m.league + coalesce(lr.movement, 0) into lg
  from public.league_memberships m
  left join public.league_results lr on lr.user_id = m.user_id and lr.week_start = m.week_start
  where m.user_id = uid and m.week_start < wk
  order by m.week_start desc limit 1;
  lg := least(5, greatest(1, coalesce(lg, 1)));

  select m.group_no into g from public.league_memberships m
  where m.week_start = wk and m.league = lg
  group by m.group_no having count(*) < gsize
  order by m.group_no limit 1;
  if g is null then
    select coalesce(max(m.group_no), 0) + 1 into g from public.league_memberships m where m.week_start = wk and m.league = lg;
  end if;

  insert into public.league_memberships (user_id, week_start, league, group_no) values (uid, wk, lg, g)
  on conflict do nothing;
end;
$$;

-- Valores de cada logro para una persona (los calcula el servidor con los datos públicos)
create or replace function public.achievement_metrics(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'streak', greatest(coalesce(ps.best_streak, 0), public.current_streak(uid)),
    'xp_total', coalesce(ps.xp_total, 0),
    'coins_spent', (select coalesce(-sum(l.amount), 0) from public.coin_ledger l where l.user_id = uid and l.amount < 0 and l.kind in ('purchase', 'spend')),
    'podium_1', (select count(*) from public.weekly_podium w where w.user_id = uid and w.position = 1),
    'podium_2', (select count(*) from public.weekly_podium w where w.user_id = uid and w.position = 2),
    'podium_3', (select count(*) from public.weekly_podium w where w.user_id = uid and w.position = 3),
    'promotions', (select count(*) from public.league_results r where r.user_id = uid and r.movement = 1),
    'league_max', (select coalesce(max(m.league), 0) from public.league_memberships m where m.user_id = uid),
    'perfect_weeks', (select count(*) from public.league_results r where r.user_id = uid and r.perfect),
    'habits_done', coalesce(ps.habits_done, 0),
    'friends', (select count(*) from public.friendships f where f.status = 'accepted' and uid in (f.requester, f.addressee)),
    'posts', (select count(*) from public.posts p where p.user_id = uid),
    'cheers_sent', (select count(*) from public.cheers c where c.sender = uid),
    'cosmetics', (select count(*) from public.inventory i join public.catalog_items ci on ci.id = i.item_id
                  where i.user_id = uid and ci.kind in ('banner', 'frame', 'card'))
  )
  from (select uid as id) u
  left join public.profile_stats ps on ps.user_id = u.id;
$$;

-- Otorga los logros que ya se cumplen (una sola vez cada uno), con su premio y su notificación
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
        if d.prize > 0 then
          insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
          values (uid, d.prize, 'achievement', 'ach:' || d.id, public.co_today(), d.name)
          on conflict do nothing;
        end if;
        perform public.notify(uid, 'achievement', null,
          jsonb_build_object('id', d.id, 'name', d.name, 'icon', d.icon, 'rarity', d.rarity, 'prize', d.prize));
      end if;
    end if;
  end loop;
  return got;
end;
$$;

-- Tabla de premios vigente; si una versión publicada no la trae, rige la inicial (nunca se paga 0 por olvido)
create or replace function public.league_prizes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case when jsonb_typeof(public.economy_params() -> 'leaguePrizes') = 'object' then public.economy_params() -> 'leaguePrizes' end,
    jsonb_build_object(
      'bronze', jsonb_build_array(150, 100, 70, 25),
      'silver', jsonb_build_array(200, 135, 95, 35),
      'gold', jsonb_build_array(260, 175, 120, 45),
      'platinum', jsonb_build_array(330, 220, 155, 55),
      'diamond', jsonb_build_array(400, 270, 190, 70)
    )
  );
$$;

-- Premio de un puesto según la tabla de la liga (1.º, 2.º, 3.º y 4.º–10.º)
create or replace function public.league_prize(prizes jsonb, p_league integer, p_position integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    ((prizes -> (array['bronze', 'silver', 'gold', 'platinum', 'diamond'])[p_league])
      ->> (case when p_position between 1 and 3 then p_position - 1 when p_position between 4 and 10 then 3 else null end))::integer,
    0
  );
$$;

-- ===========================================================================
-- Perfil: validaciones (alias, cosméticos que se tienen, logros conseguidos, foto en la carpeta propia)
-- ===========================================================================
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin boolean := public.is_admin();
  created timestamptz;
begin
  if not admin then
    if new.user_id is distinct from auth.uid() then
      raise exception 'No puedes editar el perfil de otra persona' using errcode = '42501';
    end if;
    perform public.assert_can_write();
  end if;

  new.alias := lower(trim(new.alias));
  if new.alias = any (array['admin', 'administrador', 'creador', 'pilas', 'soporte', 'moderador', 'moderacion', 'pilo', 'pila', 'root', 'sistema', 'system', 'oficial']) then
    raise exception 'Ese alias está reservado' using errcode = '22023';
  end if;

  if new.avatar_path is not null and new.avatar_path not like new.user_id::text || '/%' then
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
    if exists (
      select 1 from unnest(new.featured_achievements) a
      where not exists (select 1 from public.user_achievements u where u.user_id = new.user_id and u.achievement_id = a)) then
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

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- Al crear el perfil entra en la liga de la semana
create or replace function public.profiles_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile_stats (user_id) values (new.user_id) on conflict do nothing;
  perform public.ensure_membership(new.user_id);
  return null;
end;
$$;

drop trigger if exists profiles_after_insert on public.profiles;
create trigger profiles_after_insert after insert on public.profiles
  for each row execute function public.profiles_after_insert();

-- Al borrar el perfil público desaparece lo publicado (hábitos visibles y publicaciones). Las cifras, las compras y la
-- liga de la semana se conservan ocultas (RLS) por si vuelve: así no se reinicia la racha ni el saldo, ni se esquiva un
-- descenso borrando el perfil antes del cierre
create or replace function public.profiles_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.public_habits where user_id = old.user_id;
  delete from public.posts where user_id = old.user_id;
  return null;
end;
$$;

drop trigger if exists profiles_after_delete on public.profiles;
create trigger profiles_after_delete after delete on public.profiles
  for each row execute function public.profiles_after_delete();

-- Hábitos visibles: como mucho 12 por persona, y nada con un veto activo
create or replace function public.public_habits_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_can_write();
  new.user_id := auth.uid();
  new.updated_at := now();
  -- Un upsert también pasa por aquí como INSERT: el propio hábito no cuenta
  if tg_op = 'INSERT' and (select count(*) from public.public_habits where user_id = new.user_id and habit_key <> new.habit_key) >= 12 then
    raise exception 'Como mucho 12 hábitos visibles' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists public_habits_guard on public.public_habits;
create trigger public_habits_guard before insert or update on public.public_habits
  for each row execute function public.public_habits_guard();

-- Reportes: como mucho 10 al día
create or replace function public.reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión' using errcode = '42501';
  end if;
  new.reporter := auth.uid();
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  if new.target_user = new.reporter then
    raise exception 'No puedes reportarte' using errcode = '22023';
  end if;
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Has enviado muchos reportes hoy. Inténtalo mañana' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before insert on public.reports
  for each row execute function public.reports_guard();

-- Bloquear corta la amistad
create or replace function public.blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friendships
  where (requester = new.blocker and addressee = new.blocked) or (requester = new.blocked and addressee = new.blocker);
  return null;
end;
$$;

drop trigger if exists blocks_after_insert on public.blocks;
create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.blocks_after_insert();

-- Reacciones: solo con perfil, sin veto y si el autor no te bloqueó
create or replace function public.post_reactions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  new.user_id := public.assert_can_write();
  if not exists (select 1 from public.profiles where user_id = new.user_id) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  select p.user_id into author from public.posts p where p.id = new.post_id;
  if author is null or public.blocked_between(author, new.user_id) then
    raise exception 'No puedes reaccionar a esta publicación' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists post_reactions_guard on public.post_reactions;
create trigger post_reactions_guard before insert on public.post_reactions
  for each row execute function public.post_reactions_guard();

-- Catálogo y logros: marca de edición
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists catalog_items_touch on public.catalog_items;
create trigger catalog_items_touch before update on public.catalog_items
  for each row execute function public.touch_updated_at();
drop trigger if exists achievement_defs_touch on public.achievement_defs;
create trigger achievement_defs_touch before update on public.achievement_defs
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Publicar (funciones de la app)
-- ===========================================================================

-- Estado de la persona: rol, veto, perfil, saldo y avisos sin leer
create or replace function public.my_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_admin', public.is_admin(),
    'ban', (select jsonb_build_object('reason', b.reason, 'ends_at', b.ends_at, 'starts_at', b.starts_at)
            from public.bans b
            where b.user_id = auth.uid() and b.lifted_at is null and b.starts_at <= now() and (b.ends_at is null or b.ends_at > now())
            order by b.ends_at desc nulls first limit 1),
    'profile', (select to_jsonb(p) from public.profiles p where p.user_id = auth.uid()),
    'baseline_at', (select ps.baseline_at from public.profile_stats ps where ps.user_id = auth.uid()),
    'balance', public.balance_of(auth.uid()),
    'unread', (select count(*) from public.notifications n where n.user_id = auth.uid() and n.read_at is null)
  )
  where auth.uid() is not null;
$$;

-- Punto de partida: el historial del dispositivo al crear el perfil. Se acepta una sola vez y con topes
-- (como mucho lo que se podría haber ganado desde un año antes de crear la cuenta). Queda registrado para el creador.
create or replace function public.claim_baseline(p_streak integer, p_best integer, p_xp numeric, p_coins numeric, p_done integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  created timestamptz;
  age integer;
  v_streak integer;
  v_coins numeric;
begin
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  if exists (select 1 from public.profile_stats where user_id = uid and baseline_at is not null) then
    return jsonb_build_object('claimed', false);
  end if;
  select u.created_at into created from auth.users u where u.id = uid;
  age := greatest(1, public.co_today() - ((coalesce(created, now()) at time zone 'UTC') - interval '5 hours')::date + 1) + 365;
  v_streak := least(greatest(coalesce(p_streak, 0), 0), age, 3650);
  v_coins := least(greatest(coalesce(p_coins, 0), 0), age * public.econ('coinDailyCap', 200));

  insert into public.profile_stats (user_id) values (uid) on conflict do nothing;
  update public.profile_stats set
    baseline_at = now(),
    baseline_streak = v_streak,
    baseline_best = greatest(v_streak, least(greatest(coalesce(p_best, 0), 0), age, 3650)),
    baseline_xp = least(greatest(coalesce(p_xp, 0), 0), age * 1600),
    baseline_coins = v_coins,
    baseline_done = least(greatest(coalesce(p_done, 0), 0), age * 100)
  where user_id = uid and baseline_at is null;

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
    v_xp := least(greatest(coalesce(r.xp, 0), 0), case when v_boosted then cap_xp_boost else cap_xp end);
    v_coins := least(greatest(coalesce(r.coins, 0), 0), cap_coins);

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
-- Idempotente por id. Los extras solo de hoy o ayer y con tope diario.
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
    if r.id is null or r.id like 'srv-%' or coalesce(r.amount, 0) <= 0 then
      continue;
    end if;
    insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
    values (uid, -least(r.amount, 100000), 'spend', left(r.id, 100), r.day, left(r.note, 200))
    on conflict do nothing;
  end loop;

  for r in select * from jsonb_to_recordset(coalesce(bonuses, '[]')) as x(id text, amount numeric, note text, day date) loop
    if r.id is null or r.id like 'srv-%' or coalesce(r.amount, 0) <= 0 or r.day is null or not public.day_is_open(r.day)
       or exists (select 1 from public.coin_ledger where user_id = uid and kind = 'bonus' and ref = left(r.id, 100)) then
      continue;
    end if;
    select coalesce(sum(amount), 0) into used from public.coin_ledger where user_id = uid and kind = 'bonus' and day = r.day;
    v := least(r.amount, cap - used);
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

-- Movimientos que nacen en el servidor (premios, compras, ajustes) para reflejarlos en el saldo del dispositivo
create or replace function public.my_ledger(after_id bigint)
returns table (id bigint, amount numeric, kind text, ref text, note text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.amount, l.kind, l.ref, l.note, l.created_at from public.coin_ledger l
  where l.user_id = auth.uid() and l.id > coalesce(after_id, 0) and l.kind in ('purchase', 'league', 'achievement', 'admin')
  order by l.id limit 500;
$$;

-- Precio dinámico (protector y multiplicador): factor × promedio de monedas de los 14 días anteriores, con mínimo y máximo
create or replace function public.dynamic_price(uid uuid, p_factor numeric, p_min numeric, p_max numeric)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select round(least(p_max, greatest(p_min, p_factor * coalesce((
    select sum(d.coins) from public.daily_stats d
    where d.user_id = uid and d.day >= public.co_today() - public.econ('rhythmDays', 14)::integer and d.day < public.co_today()
  ), 0) / greatest(1, public.econ('rhythmDays', 14)))))::integer;
$$;

-- Multiplicador 1.5× de XP (12 h): espera de 24 h desde el anterior, máximo 4 al mes y no se acumula
create or replace function public.purchase_boost()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  hours numeric := public.econ('boostHours', 12);
  cooldown numeric := public.econ('boostCooldownHours', 24);
  per_month integer := public.econ('boostMaxPerMonth', 4)::integer;
  price integer;
  last_start timestamptz;
  ledger bigint;
  boost public.xp_boosts;
begin
  if not exists (select 1 from public.profile_stats where user_id = uid and baseline_at is not null) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  if exists (select 1 from public.xp_boosts where user_id = uid and started_at <= now() and ends_at > now()) then
    raise exception 'Ya tienes un multiplicador activo' using errcode = '22023';
  end if;
  select max(started_at) into last_start from public.xp_boosts where user_id = uid;
  if last_start is not null and last_start + make_interval(secs => cooldown * 3600) > now() then
    raise exception 'Hay que esperar 24 h entre multiplicadores' using errcode = '22023';
  end if;
  if (select count(*) from public.xp_boosts
      where user_id = uid and date_trunc('month', started_at at time zone 'UTC' - interval '5 hours') = date_trunc('month', now() at time zone 'UTC' - interval '5 hours')) >= per_month then
    raise exception 'Ya usaste los multiplicadores de este mes' using errcode = '22023';
  end if;
  price := public.dynamic_price(uid, public.econ('boostPriceFactor', 2), public.econ('boostPriceMin', 100), public.econ('boostPriceMax', 600));
  if public.balance_of(uid) < price then
    raise exception 'No te alcanzan las monedas (cuesta %)', price using errcode = '22023';
  end if;

  insert into public.xp_boosts (user_id, started_at, ends_at, price)
  values (uid, now(), now() + make_interval(secs => hours * 3600), price)
  returning * into boost;
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  values (uid, -price, 'purchase', 'boost:' || boost.id, public.co_today(), 'Multiplicador 1.5× XP (12 h)')
  returning id into ledger;
  update public.xp_boosts set ledger_id = ledger where id = boost.id;

  perform public.check_achievements(uid);
  return jsonb_build_object('id', boost.id, 'started_at', boost.started_at, 'ends_at', boost.ends_at, 'price', price,
    'ledger_id', ledger, 'balance', public.balance_of(uid));
end;
$$;

-- Comprar un artículo de la tienda (banner, marco, tarjeta o recompensa del creador)
create or replace function public.purchase_item(p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  item public.catalog_items;
  ledger bigint;
begin
  if not exists (select 1 from public.profile_stats where user_id = uid and baseline_at is not null) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('wallet:' || uid::text));
  select * into item from public.catalog_items where id = p_item and status = 'published';
  if item.id is null then
    raise exception 'Ese artículo no está a la venta' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory where user_id = uid and item_id = p_item) then
    raise exception 'Ya tienes este artículo' using errcode = '22023';
  end if;
  if public.balance_of(uid) < item.price then
    raise exception 'No te alcanzan las monedas' using errcode = '22023';
  end if;
  insert into public.inventory (user_id, item_id, price_paid) values (uid, p_item, item.price);
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  values (uid, -item.price, 'purchase', 'item:' || p_item, public.co_today(), item.name)
  returning id into ledger;
  perform public.check_achievements(uid);
  -- El precio cobrado (el del servidor, aunque el catálogo del dispositivo esté desactualizado)
  return jsonb_build_object('ledger_id', ledger, 'price', item.price, 'balance', public.balance_of(uid));
end;
$$;

-- ===========================================================================
-- Social (funciones)
-- ===========================================================================
create or replace function public.send_friend_request(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  existing public.friendships;
begin
  if p_user is null or p_user = uid then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) or public.blocked_between(uid, p_user) then
    raise exception 'No puedes enviar una solicitud a esta persona' using errcode = '42501';
  end if;
  select * into existing from public.friendships
  where (requester = uid and addressee = p_user) or (requester = p_user and addressee = uid);
  if existing.requester is not null then
    -- Si la otra persona ya te la había enviado, se aceptan las dos
    if existing.status = 'pending' and existing.requester = p_user then
      perform public.respond_friend_request(p_user, true);
      return 'accepted';
    end if;
    return existing.status;
  end if;
  if (select count(*) from public.rate_log where user_id = uid and action = 'friend_request' and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Como mucho 20 solicitudes al día' using errcode = '54000';
  end if;
  insert into public.friendships (requester, addressee) values (uid, p_user);
  delete from public.rate_log where user_id = uid and created_at < now() - interval '2 days';
  insert into public.rate_log (user_id, action) values (uid, 'friend_request');
  perform public.notify(p_user, 'friend_request', uid, '{}'::jsonb);
  return 'pending';
end;
$$;

create or replace function public.respond_friend_request(p_user uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
begin
  if p_accept then
    update public.friendships set status = 'accepted', responded_at = now()
    where requester = p_user and addressee = uid and status = 'pending';
    if found then
      perform public.notify(p_user, 'friend_accepted', uid, '{}'::jsonb);
      perform public.check_achievements(uid);
      perform public.check_achievements(p_user);
    end if;
  else
    delete from public.friendships where requester = p_user and addressee = uid and status = 'pending';
  end if;
end;
$$;

-- Eliminar a un amigo o cancelar una solicitud enviada
create or replace function public.remove_friend(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where (requester = auth.uid() and addressee = p_user) or (requester = p_user and addressee = auth.uid());
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
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'streak', public.current_streak(p.user_id), 'since', f.responded_at)
        order by p.alias)
      from public.friendships f
      join public.profiles p on p.user_id = case when f.requester = auth.uid() then f.addressee else f.requester end
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'accepted' and auth.uid() in (f.requester, f.addressee)), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.user_id = f.requester
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'pending' and f.addressee = auth.uid()), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'avatar_path', p.avatar_path,
        'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path, 'at', f.created_at) order by f.created_at desc)
      from public.friendships f join public.profiles p on p.user_id = f.addressee
      left join public.catalog_items fi on fi.id = p.frame_item
      where f.status = 'pending' and f.requester = auth.uid()), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', b.blocked, 'alias', p.alias) order by p.alias)
      from public.blocks b left join public.profiles p on p.user_id = b.blocked
      where b.blocker = auth.uid()), '[]'::jsonb)
  );
$$;

-- Racha de un hábito visible que termina hoy o ayer (para la plantilla «Completé {hábito} {N} días seguidos»)
create or replace function public.public_habit_streak(p_days jsonb)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  d date := public.co_today() + 1;
  n integer := 0;
  started boolean := false;
  s text;
begin
  -- Margen de un día por las diferencias de huso horario
  for i in 0..400 loop
    s := p_days -> d::text ->> 's';
    if s in ('full', 'minimum') then
      n := n + 1;
      started := true;
    elsif started or i >= 2 then
      exit;
    end if;
    d := d - 1;
  end loop;
  return n;
end;
$$;

-- Plantillas de publicación disponibles ahora (el servidor rellena los datos: no se pueden editar)
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
  return out;
end;
$$;

-- Publicar desde una plantilla (máx. 3 al día). Avisa a los amigos
create or replace function public.create_post(p_template text, p_ref text, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  tpl jsonb;
  post_id uuid;
  friend uuid;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  if char_length(v_comment) > 200 then
    raise exception 'El comentario tiene más de 200 caracteres' using errcode = '22023';
  end if;
  if (select count(*) from public.rate_log where user_id = uid and action = 'post' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Como mucho 3 publicaciones al día' using errcode = '54000';
  end if;
  select t.value into tpl from jsonb_array_elements(public.available_post_templates()) as t(value)
  where t.value ->> 'template' = p_template and (t.value ->> 'ref') is not distinct from p_ref
  limit 1;
  if tpl is null then
    raise exception 'Esa plantilla no está disponible ahora' using errcode = '22023';
  end if;
  insert into public.posts (user_id, template, data, comment) values (uid, p_template, tpl -> 'data', v_comment)
  returning id into post_id;
  delete from public.rate_log where user_id = uid and created_at < now() - interval '2 days';
  insert into public.rate_log (user_id, action) values (uid, 'post');
  for friend in
    select case when f.requester = uid then f.addressee else f.requester end
    from public.friendships f where f.status = 'accepted' and uid in (f.requester, f.addressee)
  loop
    perform public.notify(friend, 'friend_post', uid, jsonb_build_object('post_id', post_id, 'template', p_template, 'data', tpl -> 'data'));
  end loop;
  perform public.check_achievements(uid);
  return post_id;
end;
$$;

-- Publicaciones de una persona (o de tus amigos y tuyas si no se indica) con sus reacciones
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
      'alias', pr.alias, 'avatar_path', pr.avatar_path, 'frame_path', fi.asset_path, 'frame_thumb', fi.thumb_path,
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
        or (p_user is null and (p.user_id = auth.uid() or exists (
          select 1 from public.friendships f where f.status = 'accepted'
            and ((f.requester = auth.uid() and f.addressee = p.user_id) or (f.addressee = auth.uid() and f.requester = p.user_id)))))
      )
    order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) t;
$$;

-- ¿Ánimos o felicitación? Felicitar si en los últimos 3 días consiguió un logro, el podio, subir de liga o una racha redonda
create or replace function public.cheer_kind(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  streak integer := public.current_streak(p_user);
  last_week date := public.week_start(public.co_today()) - 7;
  closed timestamptz := (select closed_at from public.week_closures where week_start = last_week);
  ach text;
begin
  select d.name into ach from public.user_achievements u join public.achievement_defs d on d.id = u.achievement_id
  where u.user_id = p_user and u.achieved_at > now() - interval '3 days' order by u.achieved_at desc limit 1;
  if ach is not null then
    return jsonb_build_object('kind', 'congrats', 'reason', 'achievement', 'name', ach);
  end if;
  if closed is not null and closed > now() - interval '3 days' then
    if exists (select 1 from public.weekly_podium where user_id = p_user and week_start = last_week) then
      return jsonb_build_object('kind', 'congrats', 'reason', 'podium');
    end if;
    if exists (select 1 from public.league_results where user_id = p_user and week_start = last_week and movement = 1) then
      return jsonb_build_object('kind', 'congrats', 'reason', 'league_up');
    end if;
  end if;
  if streak in (7, 10, 14, 21, 30, 45, 60, 90, 100, 150, 200, 250, 300, 365) or (streak >= 100 and streak % 50 = 0) then
    return jsonb_build_object('kind', 'congrats', 'reason', 'streak', 'n', streak);
  end if;
  return jsonb_build_object('kind', 'cheer', 'reason', null);
end;
$$;

-- Enviar ánimos o felicitar: uno por persona y día, 20 al día en total; no a quien te bloqueó. No dan XP ni monedas
create or replace function public.send_cheer(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.assert_can_write();
  info jsonb;
  v_kind text;
  v_variant smallint;
begin
  if p_user is null or p_user = uid then
    raise exception 'No puedes enviarte ánimos' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = uid) then
    raise exception 'Primero crea tu perfil público' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) or public.blocked_between(uid, p_user) then
    raise exception 'No puedes enviar ánimos a esta persona' using errcode = '42501';
  end if;
  if exists (select 1 from public.cheers where sender = uid and recipient = p_user and day = public.co_today()) then
    raise exception 'Ya le enviaste ánimos hoy' using errcode = '23505';
  end if;
  if (select count(*) from public.cheers where sender = uid and day = public.co_today()) >= 20 then
    raise exception 'Como mucho 20 ánimos al día' using errcode = '54000';
  end if;
  info := public.cheer_kind(p_user);
  v_kind := info ->> 'kind';
  -- Ánimos: 4 textos. Felicitación: 0 = logro / podio / liga, 1 = racha
  v_variant := case when v_kind = 'cheer' then floor(random() * 4)::smallint
                    when info ->> 'reason' = 'streak' then 1 else 0 end;
  insert into public.cheers (sender, recipient, kind, variant) values (uid, p_user, v_kind, v_variant);
  perform public.notify(p_user, 'cheer', uid, jsonb_build_object('kind', v_kind, 'variant', v_variant, 'reason', info ->> 'reason',
    'n', info -> 'n', 'name', info ->> 'name'));
  perform public.check_achievements(uid);
  return jsonb_build_object('kind', v_kind, 'variant', v_variant);
end;
$$;

create or replace function public.mark_notifications_read(ids bigint[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (ids is null or id = any (ids));
$$;

-- ===========================================================================
-- Lecturas públicas
-- ===========================================================================

-- Perfil público por alias: cosméticos, tarjetas elegidas, XP de la semana, hábitos visibles y relación contigo
create or replace function public.public_profile(p_alias text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  ps public.profile_stats;
  wk date := public.week_start(public.co_today());
  fr public.friendships;
  own boolean;
begin
  if me is null then
    return null;
  end if;
  select * into p from public.profiles where alias = lower(trim(p_alias));
  if p.user_id is null then
    return null;
  end if;
  own := p.user_id = me;
  -- Quien te bloqueó no aparece
  if not own and exists (select 1 from public.blocks where blocker = p.user_id and blocked = me) then
    return null;
  end if;
  if not own and public.is_banned(p.user_id) and not public.is_admin() then
    return jsonb_build_object('alias', p.alias, 'suspended', true);
  end if;
  select * into ps from public.profile_stats where user_id = p.user_id;
  select * into fr from public.friendships where (requester = me and addressee = p.user_id) or (requester = p.user_id and addressee = me);

  return jsonb_build_object(
    'user_id', p.user_id, 'alias', p.alias, 'avatar_path', p.avatar_path, 'member_since', p.member_since,
    'cards', to_jsonb(p.cards), 'is_me', own, 'suspended', public.is_banned(p.user_id),
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

-- Logros con el % de personas (con perfil) que tienen cada uno
create or replace function public.achievement_rates()
returns table (achievement_id text, holders bigint, pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, count(p.user_id),
    round(100.0 * count(p.user_id) / greatest(1, (select count(*) from public.profiles)), 1)
  from public.achievement_defs d
  left join public.user_achievements u on u.achievement_id = d.id
  left join public.profiles p on p.user_id = u.user_id
  group by d.id;
$$;

create or replace function public.my_achievement_progress()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.achievement_metrics(auth.uid()) where auth.uid() is not null;
$$;

-- Mi liga esta semana: el grupo, las zonas de ascenso y descenso y la cuenta atrás
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
  pct_up numeric := public.econ('leaguePromotePct', 20);
  pct_down numeric := public.econ('leagueDemotePct', 20);
begin
  select * into m from public.league_memberships where user_id = me and week_start = wk;
  if m.user_id is null then
    return jsonb_build_object('member', false);
  end if;
  select count(*) into n from public.league_memberships lm
  where lm.week_start = wk and lm.league = m.league and lm.group_no = m.group_no and not public.is_banned(lm.user_id)
    and coalesce((select sum(d.xp) from public.daily_stats d where d.user_id = lm.user_id and d.day between wk and wk + 6), 0) > 0;
  return jsonb_build_object(
    'member', true,
    'league', m.league,
    'league_name', (select name from public.leagues where id = m.league),
    'group', m.group_no,
    'week_start', wk,
    -- Lunes siguiente a las 00:00 de Colombia
    'ends_at', ((wk + 7)::timestamp + interval '5 hours') at time zone 'UTC',
    'ranked', n,
    'promote', case when m.league < 5 then ceil(n * pct_up / 100.0) else 0 end,
    'demote', case when m.league > 1 then floor(n * pct_down / 100.0) else 0 end,
    'prizes', public.league_prizes() -> (array['bronze', 'silver', 'gold', 'platinum', 'diamond'])[m.league],
    'members', coalesce((
      select jsonb_agg(x order by (x ->> 'xp')::numeric desc, (x ->> 'completion')::numeric desc nulls last, x ->> 'alias')
      from (
        select jsonb_build_object('user_id', p.user_id, 'alias', p.alias, 'avatar_path', p.avatar_path,
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

-- Perfiles visibles (sin vetos activos) con los cosméticos equipados
create or replace view public.public_profiles with (security_invoker = true) as
select
  p.user_id, p.alias, p.avatar_path, p.member_since,
  fi.asset_path as frame_path, fi.thumb_path as frame_thumb, fi.animated as frame_animated,
  bi.asset_path as banner_path, bi.thumb_path as banner_thumb, bi.animated as banner_animated,
  ci.asset_path as card_path, ci.thumb_path as card_thumb, ci.animated as card_animated
from public.profiles p
left join public.catalog_items fi on fi.id = p.frame_item
left join public.catalog_items bi on bi.id = p.banner_item
left join public.catalog_items ci on ci.id = p.card_item
where not public.is_banned(p.user_id);

-- Clasificación de racha (permanente): racha actual y récord
create or replace view public.leaderboard_streak with (security_invoker = true) as
select rank() over (order by s.current_streak desc, s.best_streak desc) as rank, pp.*, s.current_streak, s.best_streak
from public.public_profiles pp
cross join lateral (
  select public.current_streak(pp.user_id) as current_streak,
    coalesce((select ps.best_streak from public.profile_stats ps where ps.user_id = pp.user_id), 0) as best_streak
) s
where s.current_streak > 0;

-- XP de la semana en curso (de lunes a domingo, hora de Colombia); desempate por % de cumplimiento
create or replace view public.leaderboard_xp_week with (security_invoker = true) as
select rank() over (order by w.xp desc, w.completion desc nulls last) as rank, pp.*, w.xp, w.completion
from public.public_profiles pp
cross join lateral (
  select coalesce(sum(d.xp), 0) as xp, avg(d.completion) filter (where d.scheduled > 0) as completion
  from public.daily_stats d
  where d.user_id = pp.user_id and d.day between public.week_start(public.co_today()) and public.week_start(public.co_today()) + 6
) w
where w.xp > 0;

-- XP de por vida; desempate por % de cumplimiento de los últimos 30 días
create or replace view public.leaderboard_xp_total with (security_invoker = true) as
select rank() over (order by t.xp desc, t.completion desc nulls last) as rank, pp.*, t.xp, t.completion
from public.public_profiles pp
cross join lateral (
  select coalesce((select ps.xp_total from public.profile_stats ps where ps.user_id = pp.user_id), 0) as xp,
    (select avg(d.completion) from public.daily_stats d
     where d.user_id = pp.user_id and d.scheduled > 0 and d.day > public.co_today() - 30) as completion
) t
where t.xp > 0;

-- Ganadores de una semana cerrada
create or replace function public.podium(p_week date)
returns table (pos smallint, user_id uuid, alias text, avatar_path text, frame_path text, frame_thumb text, xp numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select w.position, w.user_id, p.alias, p.avatar_path, fi.asset_path, fi.thumb_path, w.xp
  from public.weekly_podium w
  join public.profiles p on p.user_id = w.user_id
  left join public.catalog_items fi on fi.id = p.frame_item
  where w.week_start = p_week
  order by w.position;
$$;

-- ===========================================================================
-- Cierre semanal (lunes 00:00 de Colombia): ligas, premios, podio y logros. Idempotente
-- ===========================================================================
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
  pct_up numeric := public.econ('leaguePromotePct', 20);
  pct_down numeric := public.econ('leagueDemotePct', 20);
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
    case when r.league < 5 and r.pos <= ceil(r.n * pct_up / 100.0) then 1
         when r.league > 1 and r.pos > r.n - floor(r.n * pct_down / 100.0) then -1
         else 0 end,
    public.league_prize(prizes, r.league, r.pos::integer), coalesce(r.perfect, false)
  from ranked r
  on conflict do nothing;
  get diagnostics n_ranked = row_count;

  -- Premios en monedas (no cuentan para el tope diario). La referencia única evita cobrarlos dos veces
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  select r.user_id, r.prize, 'league', 'league:' || wk, wk + 6, 'Liga ' || l.name || ': puesto ' || r.position
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
    -- Razón monedas ganadas / gastadas de la semana (documento de reglas), para vigilar la inflación
    'earned', (select coalesce(sum(amount), 0) from public.coin_ledger where amount > 0 and kind <> 'opening' and day between wk and wk + 6),
    'spent', (select coalesce(-sum(amount), 0) from public.coin_ledger where amount < 0 and day between wk and wk + 6));
  update public.week_closures set summary = v_summary where week_start = wk;
  return v_summary;
end;
$$;

-- ===========================================================================
-- Panel del creador (todas comprueban is_admin y dejan registro)
-- ===========================================================================
create or replace function public.admin_close_week(p_week date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  res jsonb;
begin
  perform public.assert_admin();
  res := public.close_week(p_week, true);
  perform public.log_action(null, 'close_week', 'Cierre forzado', jsonb_build_object('week', p_week, 'result', res));
  return res;
end;
$$;

create or replace function public.admin_user(p_alias text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
begin
  perform public.assert_admin();
  select * into p from public.profiles where alias = lower(trim(p_alias));
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

create or replace function public.admin_delete_post(p_post uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  author uuid;
begin
  perform public.assert_admin();
  delete from public.posts where id = p_post returning user_id into author;
  if author is not null then
    perform public.log_action(author, 'delete_post', p_reason, jsonb_build_object('post_id', p_post));
  end if;
end;
$$;

create or replace function public.admin_clear_avatar(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.profiles set avatar_path = null where user_id = p_user;
  perform public.log_action(p_user, 'remove_avatar', p_reason);
end;
$$;

create or replace function public.admin_clear_banner(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.profiles set banner_item = null where user_id = p_user;
  perform public.log_action(p_user, 'remove_banner', p_reason);
end;
$$;

create or replace function public.admin_warn(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  insert into public.warnings (user_id, admin_id, reason) values (p_user, auth.uid(), p_reason);
  perform public.notify(p_user, 'warning', null, jsonb_build_object('reason', p_reason));
  perform public.log_action(p_user, 'warn', p_reason);
end;
$$;

-- p_days null = permanente
create or replace function public.admin_ban(p_user uuid, p_reason text, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ends timestamptz := case when p_days is null then null else now() + make_interval(days => greatest(p_days, 1)) end;
begin
  perform public.assert_admin();
  if p_user = auth.uid() then
    raise exception 'No puedes vetarte a ti mismo' using errcode = '22023';
  end if;
  insert into public.bans (user_id, admin_id, reason, ends_at) values (p_user, auth.uid(), p_reason, ends);
  perform public.notify(p_user, 'ban', null, jsonb_build_object('reason', p_reason, 'ends_at', ends));
  perform public.log_action(p_user, 'ban', p_reason, jsonb_build_object('days', p_days));
end;
$$;

create or replace function public.admin_unban(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.bans set lifted_at = now(), lifted_by = auth.uid()
  where user_id = p_user and lifted_at is null and (ends_at is null or ends_at > now());
  perform public.log_action(p_user, 'unban', p_reason);
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
begin
  perform public.assert_admin();
  if p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'Cantidad no válida' using errcode = '22023';
  end if;
  action_id := public.log_action(p_user, 'adjust_coins', p_reason, jsonb_build_object('amount', p_amount));
  insert into public.coin_ledger (user_id, amount, kind, ref, day, note)
  values (p_user, p_amount, 'admin', 'adm:' || action_id, public.co_today(), left(p_reason, 200));
  perform public.notify(p_user, 'admin_coins', null, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return public.balance_of(p_user);
end;
$$;

create or replace function public.admin_adjust_xp(p_user uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception 'Cantidad no válida' using errcode = '22023';
  end if;
  insert into public.profile_stats (user_id) values (p_user) on conflict do nothing;
  update public.profile_stats set xp_adjust = xp_adjust + p_amount where user_id = p_user;
  perform public.recompute_stats(p_user);
  perform public.log_action(p_user, 'adjust_xp', p_reason, jsonb_build_object('amount', p_amount));
  return (select xp_total from public.profile_stats where user_id = p_user);
end;
$$;

create or replace function public.admin_resolve_report(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  if p_status not in ('resolved', 'dismissed', 'open') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  update public.reports set status = p_status,
    resolved_by = case when p_status = 'open' then null else auth.uid() end,
    resolved_at = case when p_status = 'open' then null else now() end
  where id = p_id;
  perform public.log_action((select target_user from public.reports where id = p_id), 'resolve_report', p_status,
    jsonb_build_object('report_id', p_id));
end;
$$;

-- Publicar un borrador de la economía con fecha de inicio (por defecto, hoy). Rige desde las 00:00 de Colombia de ese día
create or replace function public.admin_publish_economy(p_version integer, p_effective_from timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.economy_config set status = 'published', effective_from = public.co_day_start(coalesce(p_effective_from, now())),
    published_at = now()
  where version = p_version and status = 'draft';
  if not found then
    raise exception 'Ese borrador no existe o ya se publicó' using errcode = '22023';
  end if;
  perform public.log_action(null, 'publish_economy', null, jsonb_build_object('version', p_version, 'effective_from', p_effective_from));
end;
$$;

-- Revertir: vuelve a publicar (como versión nueva, desde ahora) los parámetros de una versión anterior
create or replace function public.admin_revert_economy(p_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  perform public.assert_admin();
  insert into public.economy_config (params, status, effective_from, note, created_by, published_at)
  select c.params, 'published', public.co_day_start(now()), 'Revertido a la versión ' || c.version, auth.uid(), now()
  from public.economy_config c where c.version = p_version
  returning version into v;
  if v is null then
    raise exception 'Esa versión no existe' using errcode = '22023';
  end if;
  perform public.log_action(null, 'revert_economy', null, jsonb_build_object('to', p_version, 'version', v));
  return v;
end;
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.bans enable row level security;
alter table public.economy_config enable row level security;
alter table public.catalog_items enable row level security;
alter table public.inventory enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_stats enable row level security;
alter table public.daily_stats enable row level security;
alter table public.public_habits enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.xp_boosts enable row level security;
alter table public.leagues enable row level security;
alter table public.league_memberships enable row level security;
alter table public.league_results enable row level security;
alter table public.weekly_podium enable row level security;
alter table public.week_closures enable row level security;
alter table public.achievement_defs enable row level security;
alter table public.user_achievements enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.cheers enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.warnings enable row level security;
alter table public.moderation_actions enable row level security;

do $$
declare
  t text;
begin
  -- Se borran las políticas de estas tablas para poder volver a ejecutar el archivo
  for t in select unnest(array['bans', 'economy_config', 'catalog_items', 'inventory', 'profiles', 'profile_stats', 'daily_stats',
    'public_habits', 'coin_ledger', 'xp_boosts', 'leagues', 'league_memberships', 'league_results', 'weekly_podium', 'week_closures',
    'achievement_defs', 'user_achievements', 'friendships', 'blocks', 'posts', 'post_reactions', 'cheers', 'notifications', 'reports',
    'warnings', 'moderation_actions'])
  loop
    execute (select coalesce(string_agg(format('drop policy if exists %I on public.%I;', policyname, t), ' '), '')
             from pg_policies where schemaname = 'public' and tablename = t);
  end loop;
end;
$$;

-- Lectura pública (con sesión)
create policy profiles_select on public.profiles for select to authenticated using (true);
-- Las cifras solo se ven mientras la persona tiene perfil público (si lo borra, dejan de verse)
create policy profile_stats_select on public.profile_stats for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = profile_stats.user_id));
create policy daily_stats_select on public.daily_stats for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = daily_stats.user_id));
create policy public_habits_select on public.public_habits for select to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = public_habits.user_id));
create policy leagues_select on public.leagues for select to authenticated using (true);
create policy league_memberships_select on public.league_memberships for select to authenticated using (true);
create policy league_results_select on public.league_results for select to authenticated using (true);
create policy weekly_podium_select on public.weekly_podium for select to authenticated using (true);
create policy week_closures_select on public.week_closures for select to authenticated using (true);
create policy user_achievements_select on public.user_achievements for select to authenticated using (true);
create policy post_reactions_select on public.post_reactions for select to authenticated using (true);
create policy posts_select on public.posts for select to authenticated
  using (not public.blocked_between((select auth.uid()), user_id));

-- Lo propio
create policy profiles_insert on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete on public.profiles for delete to authenticated using (user_id = (select auth.uid()));
create policy public_habits_insert on public.public_habits for insert to authenticated with check (user_id = (select auth.uid()));
create policy public_habits_update on public.public_habits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy public_habits_delete on public.public_habits for delete to authenticated using (user_id = (select auth.uid()));
create policy coin_ledger_select on public.coin_ledger for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy inventory_select on public.inventory for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy xp_boosts_select on public.xp_boosts for select to authenticated using (user_id = (select auth.uid()));
create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester, addressee));
create policy blocks_select on public.blocks for select to authenticated using (blocker = (select auth.uid()));
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated using (blocker = (select auth.uid()));
create policy posts_delete on public.posts for delete to authenticated using (user_id = (select auth.uid()));
create policy post_reactions_insert on public.post_reactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy post_reactions_delete on public.post_reactions for delete to authenticated using (user_id = (select auth.uid()));
create policy cheers_select on public.cheers for select to authenticated using ((select auth.uid()) in (sender, recipient));
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
create policy reports_insert on public.reports for insert to authenticated with check (reporter = (select auth.uid()));
create policy reports_select on public.reports for select to authenticated using (reporter = (select auth.uid()) or public.is_admin());
create policy warnings_select on public.warnings for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy bans_select on public.bans for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Solo el creador
create policy catalog_select on public.catalog_items for select to authenticated using (status <> 'draft' or public.is_admin());
create policy catalog_insert on public.catalog_items for insert to authenticated with check (public.is_admin());
create policy catalog_update on public.catalog_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy catalog_delete on public.catalog_items for delete to authenticated using (public.is_admin());
create policy achievement_defs_select on public.achievement_defs for select to authenticated using (active or public.is_admin());
create policy achievement_defs_insert on public.achievement_defs for insert to authenticated with check (public.is_admin());
create policy achievement_defs_update on public.achievement_defs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy achievement_defs_delete on public.achievement_defs for delete to authenticated using (public.is_admin());
create policy economy_select on public.economy_config for select to authenticated using (status = 'published' or public.is_admin());
create policy economy_insert on public.economy_config for insert to authenticated with check (public.is_admin() and status = 'draft');
create policy economy_update on public.economy_config for update to authenticated
  using (public.is_admin() and status = 'draft') with check (public.is_admin() and status = 'draft');
create policy economy_delete on public.economy_config for delete to authenticated using (public.is_admin() and status = 'draft');
create policy moderation_select on public.moderation_actions for select to authenticated using (public.is_admin());

-- Permisos: los visitantes sin sesión no ven nada; lo que da puestos o monedas no se escribe directamente
do $$
declare
  t text;
begin
  for t in select unnest(array['bans', 'economy_config', 'catalog_items', 'inventory', 'profiles', 'profile_stats', 'daily_stats',
    'public_habits', 'coin_ledger', 'xp_boosts', 'leagues', 'league_memberships', 'league_results', 'weekly_podium', 'week_closures',
    'achievement_defs', 'user_achievements', 'friendships', 'blocks', 'posts', 'post_reactions', 'cheers', 'notifications', 'reports',
    'warnings', 'moderation_actions'])
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- Los contadores de las columnas identity: insertar no los necesita, y con permiso cualquiera podría hacer setval
  for t in select pg_get_serial_sequence(x[1], x[2]) from (values
    (array['public.bans', 'id']), (array['public.economy_config', 'version']), (array['public.coin_ledger', 'id']),
    (array['public.cheers', 'id']), (array['public.notifications', 'id']), (array['public.reports', 'id']),
    (array['public.warnings', 'id']), (array['public.moderation_actions', 'id'])) v(x)
  loop
    execute format('revoke all on sequence %s from anon, authenticated', t);
  end loop;
end;
$$;

grant insert (user_id, alias, avatar_path, banner_item, frame_item, card_item, cards, featured_achievements) on public.profiles to authenticated;
grant update (alias, avatar_path, banner_item, frame_item, card_item, cards, featured_achievements) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;
grant insert, update, delete on public.public_habits to authenticated;
grant insert, delete on public.blocks to authenticated;
grant delete on public.posts to authenticated;
grant insert, delete on public.post_reactions to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert (target_user, post_id, reason, details) on public.reports to authenticated;
grant insert, update, delete on public.catalog_items to authenticated;
grant insert, update, delete on public.achievement_defs to authenticated;
grant insert (params, note, created_by) on public.economy_config to authenticated;
grant update (params, note) on public.economy_config to authenticated;
grant delete on public.economy_config to authenticated;

revoke all on public.public_profiles, public.leaderboard_streak, public.leaderboard_xp_week, public.leaderboard_xp_total from anon, authenticated;
grant select on public.public_profiles, public.leaderboard_streak, public.leaderboard_xp_week, public.leaderboard_xp_total to authenticated;

-- Funciones: las internas no las puede llamar nadie desde la app; las públicas, solo con sesión
do $$
declare
  f text;
begin
  for f in select unnest(array[
    'public.notify(uuid, text, uuid, jsonb)', 'public.log_action(uuid, text, text, jsonb)', 'public.recompute_stats(uuid)',
    'public.ensure_membership(uuid)', 'public.check_achievements(uuid)', 'public.economy_params_on(date)', 'public.econ_on(date, text, numeric)', 'public.close_week(date, boolean)',
    'public.balance_of(uuid)', 'public.dynamic_price(uuid, numeric, numeric, numeric)', 'public.achievement_metrics(uuid)',
    'public.profiles_guard()', 'public.profiles_after_insert()', 'public.profiles_after_delete()', 'public.public_habits_guard()', 'public.reports_guard()',
    'public.blocks_after_insert()', 'public.post_reactions_guard()', 'public.touch_updated_at()'])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  for f in select unnest(array[
    'public.co_today()', 'public.co_day_start(timestamptz)', 'public.week_start(date)', 'public.day_is_open(date)', 'public.is_admin()', 'public.is_banned(uuid)',
    'public.assert_can_write()', 'public.assert_admin()', 'public.economy_params()', 'public.econ(text, numeric)',
    'public.economy_versions()', 'public.blocked_between(uuid, uuid)', 'public.current_streak(uuid)',
    'public.league_prize(jsonb, integer, integer)', 'public.league_prizes()', 'public.my_status()',
    'public.claim_baseline(integer, integer, numeric, numeric, integer)', 'public.publish_days(jsonb)',
    'public.sync_wallet(jsonb, jsonb)', 'public.my_ledger(bigint)', 'public.purchase_boost()', 'public.purchase_item(uuid)',
    'public.send_friend_request(uuid)', 'public.respond_friend_request(uuid, boolean)', 'public.remove_friend(uuid)',
    'public.my_friends()', 'public.public_habit_streak(jsonb)', 'public.available_post_templates()',
    'public.create_post(text, text, text)', 'public.post_feed(uuid, timestamptz, integer)', 'public.cheer_kind(uuid)',
    'public.send_cheer(uuid)', 'public.mark_notifications_read(bigint[])', 'public.public_profile(text)',
    'public.achievement_rates()', 'public.my_achievement_progress()', 'public.league_standings()', 'public.podium(date)',
    'public.admin_close_week(date)', 'public.admin_user(text)', 'public.admin_delete_post(uuid, text)',
    'public.admin_clear_avatar(uuid, text)', 'public.admin_clear_banner(uuid, text)', 'public.admin_warn(uuid, text)',
    'public.admin_ban(uuid, text, integer)', 'public.admin_unban(uuid, text)', 'public.admin_adjust_coins(uuid, numeric, text)',
    'public.admin_adjust_xp(uuid, numeric, text)', 'public.admin_resolve_report(bigint, text)',
    'public.admin_publish_economy(integer, timestamptz)', 'public.admin_revert_economy(integer)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

-- ===========================================================================
-- Archivos (Supabase Storage): solo WebP. Fotos ≤ 1 MB en la carpeta propia; catálogo ≤ 2 MB, solo el creador
-- ===========================================================================
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars', 'avatars', true, 1048576, array['image/webp']),
    ('catalog', 'catalog', true, 2097152, array['image/webp'])
  on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists pilas_avatars_select on storage.objects;
  drop policy if exists pilas_catalog_select on storage.objects;
  drop policy if exists pilas_avatars_insert on storage.objects;
  drop policy if exists pilas_avatars_delete on storage.objects;
  drop policy if exists pilas_catalog_insert on storage.objects;
  drop policy if exists pilas_catalog_update on storage.objects;
  drop policy if exists pilas_catalog_delete on storage.objects;

  -- Listar y borrar necesitan permiso de lectura (las imágenes se sirven por la URL pública del bucket)
  create policy pilas_avatars_select on storage.objects for select to authenticated using (
    bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
  create policy pilas_catalog_select on storage.objects for select to authenticated using (
    bucket_id = 'catalog' and public.is_admin());
  create policy pilas_avatars_insert on storage.objects for insert to authenticated with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(name) like '%.webp' and not public.is_banned());
  create policy pilas_avatars_delete on storage.objects for delete to authenticated using (
    bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));
  create policy pilas_catalog_insert on storage.objects for insert to authenticated with check (
    bucket_id = 'catalog' and public.is_admin() and lower(name) like '%.webp');
  create policy pilas_catalog_update on storage.objects for update to authenticated using (
    bucket_id = 'catalog' and public.is_admin()) with check (bucket_id = 'catalog' and public.is_admin());
  create policy pilas_catalog_delete on storage.objects for delete to authenticated using (
    bucket_id = 'catalog' and public.is_admin());
end;
$$;

-- ===========================================================================
-- Avisos en tiempo real (Supabase Realtime sobre la bandeja de notificaciones)
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- ===========================================================================
-- Cierre semanal automático: lunes 00:00 de Colombia = 05:00 UTC (pg_cron, incluido gratis en Supabase)
-- ===========================================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('pilas-close-week', '0 5 * * 1', 'select public.close_week()');
  end if;
exception when others then
  raise notice 'No se pudo programar el cierre semanal (actívalo en Database → Extensions → pg_cron): %', sqlerrm;
end;
$$;
