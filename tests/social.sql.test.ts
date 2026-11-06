import { beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, reapplySocialMigration, type TestDb } from './pgSupabase';

/**
 * Capa pública (supabase/migrations/0002_social.sql + 0003_perfiles_ligas.sql) contra un Postgres real en memoria.
 * Comprueba lo que el servidor garantiza aunque alguien modifique la app: topes, fechas, saldo, rol de creador,
 * cierre semanal idempotente, ligas por puestos, logros una sola vez, límites de ánimos y «me gusta», vetos y el
 * reinicio del progreso.
 */

let db: TestDb;
let admin: string;
let ana: string;
let beto: string;
let caro: string;

const today = async () => (await db.sql<{ d: string }>(`select public.co_today()::text as d`))[0].d;
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const balance = async (uid: string) => Number((await db.sql<{ b: string }>(`select public.balance_of($1) as b`, [uid]))[0].b);
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
const profile = (uid: string, alias: string) => db.as(uid, `insert into public.profiles (user_id, alias) values ($1, $2)`, [uid, alias]);
const baseline = (uid: string, streak = 0, xp = 0, coins = 0) =>
  db.as(uid, `select public.claim_baseline($1, $1, $2, $3, 0) as r`, [streak, xp, coins]);
const publish = (uid: string, rows: object[]) => db.as<{ r: { written: number } }>(uid, `select public.publish_days($1::jsonb) as r`, [JSON.stringify(rows)]);
const reset = async (uid: string, at?: string) =>
  (await db.as<{ r: Record<string, unknown> }>(uid, `select public.reset_my_progress($1::timestamptz) as r`, [at ?? null]))[0].r;

beforeAll(async () => {
  db = await createTestDb();
  admin = await db.user('oscarwis2009@gmail.com', 400);
  ana = await db.user('ana@example.com', 30);
  beto = await db.user('beto@example.com', 30);
  caro = await db.user('caro@example.com', 2);
  // El creador se registra por correo solo en el SQL (la cuenta ya existe: se vuelve a ejecutar esa línea)
  await db.sql(`insert into public.app_admins (user_id) select id from auth.users where lower(email) = 'oscarwis2009@gmail.com' on conflict do nothing`);
}, 60_000);

describe('perfiles y permisos', () => {
  it('el rol de creador lo da el servidor', async () => {
    expect((await db.as<{ a: boolean }>(admin, `select public.is_admin() as a`))[0].a).toBe(true);
    expect((await db.as<{ a: boolean }>(ana, `select public.is_admin() as a`))[0].a).toBe(false);
    // Nadie puede darse el rol
    await fails(db.as(ana, `insert into public.app_admins (user_id) values ($1)`, [ana]));
  });

  it('alias único, con formato y sin palabras reservadas', async () => {
    await fails(profile(ana, 'A'), /check|alias/i);
    await fails(profile(ana, 'creador'), /reservado/);
    await profile(ana, 'Ana_Run');
    // Sin nombre al crearlo, el nombre visible es el alias
    expect((await db.sql<{ alias: string; display_name: string }>(`select alias, display_name from public.profiles where user_id = $1`, [ana]))[0])
      .toEqual({ alias: 'ana_run', display_name: 'ana_run' });
    await fails(profile(beto, 'ana_run'), /duplicate|unique/i);
    await profile(beto, 'beto');
    await profile(admin, 'oscar');
  });

  it('nadie edita el perfil de otra persona ni se pone cosméticos que no tiene', async () => {
    await db.as(beto, `update public.profiles set alias = 'hackeado' where user_id = $1`, [ana]);
    expect((await db.sql<{ alias: string }>(`select alias from public.profiles where user_id = $1`, [ana]))[0].alias).toBe('ana_run');
    const [item] = await db.as<{ id: string }>(admin,
      `insert into public.catalog_items (kind, name, price, status) values ('frame', 'Marco dorado', 50, 'published') returning id`);
    await fails(db.as(ana, `update public.profiles set frame_item = $1 where user_id = $2`, [item.id, ana]), /No tienes ese marco/);
    await fails(db.as(ana, `update public.profiles set featured_achievements = '{chispa}' where user_id = $1`, [ana]), /logros que ya tienes/);
    await fails(db.as(ana, `update public.profiles set avatar_path = $1 where user_id = $2`, [`${beto}/x.webp`, ana]), /tu carpeta/);
    // «Miembro desde» sale de la cuenta, no de lo que mande la app
    await db.as(ana, `update public.profiles set member_since = '2001-01-01' where user_id = $1`, [ana]).catch(() => undefined);
    const [p] = await db.sql<{ ms: string }>(`select member_since::date::text as ms from public.profiles where user_id = $1`, [ana]);
    expect(p.ms).not.toBe('2001-01-01');
  });

  it('perfil sin alias: nombre, biografía, color del banner y foto por defecto', async () => {
    const nora = await db.user('nora@example.com', 10);
    await db.as(nora, `insert into public.profiles (user_id, display_name, avatar_path) values ($1, '  Nora Pérez ', 'default:3')`, [nora]);
    const row = async () => (await db.sql<{ alias: string | null; display_name: string; bio: string; banner_color: string | null; cards: string[] }>(
      `select alias, display_name, bio, banner_color, cards from public.profiles where user_id = $1`, [nora]))[0];
    expect(await row()).toMatchObject({ alias: null, display_name: 'Nora Pérez', bio: '', banner_color: null });
    // Un perfil nuevo muestra las cinco tarjetas
    expect((await row()).cards).toEqual(['streak', 'xp_week', 'member_since', 'habits', 'achievements']);
    // Alias vacío = sin alias; varias personas pueden no tenerlo
    await db.as(nora, `update public.profiles set bio = ' Corro cada mañana ', banner_color = 'teal', alias = '' where user_id = $1`, [nora]);
    expect(await row()).toMatchObject({ alias: null, bio: 'Corro cada mañana', banner_color: 'teal' });
    const otra = await db.user('otra@example.com', 10);
    await db.as(otra, `insert into public.profiles (user_id, display_name, avatar_path) values ($1, 'Otra', 'default:5')`, [otra]);
    await fails(db.as(nora, `update public.profiles set banner_color = 'pink' where user_id = $1`, [nora]), /color/);
    await fails(db.as(nora, `update public.profiles set bio = $2 where user_id = $1`, [nora, 'x'.repeat(161)]), /160/);
    await fails(db.as(nora, `update public.profiles set display_name = $2 where user_id = $1`, [nora, 'x'.repeat(41)]), /40/);
    // Solo las cinco fotos por defecto o la carpeta propia
    await fails(db.as(nora, `update public.profiles set avatar_path = 'default:9' where user_id = $1`, [nora]), /tu carpeta/);
    await fails(db.as(nora, `update public.profiles set avatar_path = $2 where user_id = $1`, [nora, `default:1/${beto}/x.webp`]), /tu carpeta/);
    // Nadie cambia el nombre de otra persona
    await db.as(beto, `update public.profiles set display_name = 'Hackeado' where user_id = $1`, [nora]);
    expect((await row()).display_name).toBe('Nora Pérez');

    // Se abre por id, con todo lo nuevo
    const [{ r }] = await db.as<{ r: Record<string, unknown> }>(ana, `select public.public_profile($1) as r`, [nora]);
    expect(r).toMatchObject({ user_id: nora, alias: null, display_name: 'Nora Pérez', bio: 'Corro cada mañana', banner_color: 'teal',
      avatar_path: 'default:3', likes: 0, liked_by_me: false });
    const [{ fw }] = await db.sql<{ fw: string }>(
      `select public.week_start(((member_since at time zone 'UTC') - interval '5 hours')::date)::text as fw from public.profiles where user_id = $1`, [nora]);
    expect(r.first_week).toBe(fw);
    // La vista de perfiles (búsqueda del cliente) y las clasificaciones traen el nombre
    const found = await db.as<{ user_id: string; display_name: string }>(ana,
      `select user_id, display_name from public.public_profiles where alias ilike 'nor%' or display_name ilike '%nora%'`);
    expect(found).toEqual([{ user_id: nora, display_name: 'Nora Pérez' }]);
    await db.as(ana, `select display_name from public.leaderboard_streak union all select display_name from public.leaderboard_xp_week
      union all select display_name from public.leaderboard_xp_total`);
  });

  it('un usuario normal no escribe en el catálogo, el saldo, los logros, las ligas ni los vetos', async () => {
    await fails(db.as(ana, `insert into public.catalog_items (kind, name, price) values ('banner', 'x', 1)`));
    await fails(db.as(ana, `insert into public.coin_ledger (user_id, amount, kind, ref) values ($1, 99999, 'admin', 'x')`, [ana]));
    await fails(db.as(ana, `insert into public.daily_stats (user_id, day, xp) values ($1, current_date, 99999)`, [ana]));
    await fails(db.as(ana, `insert into public.user_achievements (user_id, achievement_id) values ($1, 'campeon')`, [ana]));
    await fails(db.as(ana, `insert into public.inventory (user_id, item_id) select $1, id from public.catalog_items limit 1`, [ana]));
    await fails(db.as(ana, `insert into public.league_results (user_id, week_start, league, group_no, position, xp) values ($1, current_date, 5, 1, 1, 1)`, [ana]));
    await fails(db.as(ana, `insert into public.bans (user_id, reason) values ($1, 'x')`, [beto]));
    await fails(db.as(ana, `insert into public.notifications (user_id, kind) values ($1, 'x')`, [beto]));
    await fails(db.as(ana, `update public.profile_stats set xp_total = 999999 where user_id = $1`, [ana]));
    await fails(db.as(ana, `select public.admin_ban($1, 'x', null)`, [beto]), /Solo el creador/);
    await fails(db.as(ana, `select public.admin_adjust_coins($1, 1000, 'x')`, [ana]), /Solo el creador/);
    await fails(db.as(ana, `select public.close_week(null, true)`), /permission denied/);
    await fails(db.as(ana, `select public.check_achievements($1)`, [ana]), /permission denied/);
    // Sin sesión no se ve nada
    await fails(db.as(null, `select * from public.profiles`), /permission denied/);
    await fails(db.as(null, `select * from public.leaderboard_xp_week`), /permission denied/);
  });

  it('el creador sí gestiona el catálogo y los borradores no se ven', async () => {
    await db.as(admin, `insert into public.catalog_items (kind, name, price, status) values ('banner', 'Secreto', 10, 'draft')`);
    const seen = await db.as<{ name: string }>(ana, `select name from public.catalog_items`);
    expect(seen.map((r) => r.name)).not.toContain('Secreto');
    expect((await db.as<{ name: string }>(admin, `select name from public.catalog_items`)).map((r) => r.name)).toContain('Secreto');
  });
});

describe('publicar el día: topes y fechas', () => {
  it('el punto de partida se acepta una sola vez y con topes por antigüedad', async () => {
    await baseline(ana, 5, 1000, 300);
    const again = await baseline(ana, 999, 999999, 999999);
    expect((again[0].r as { claimed: boolean }).claimed).toBe(false);
    expect(await balance(ana)).toBe(300);
    // Cuenta de 2 días: como mucho (2 + 1 + 365) × 200 monedas
    await profile(caro, 'caro');
    await baseline(caro, 0, 0, 10_000_000);
    expect(await balance(caro)).toBe((2 + 1 + 365) * 200);
  });

  it('XP y monedas con tope diario; solo hoy y ayer', async () => {
    const t = await today();
    await publish(ana, [
      { day: addDays(t, -5), xp: 500, coins: 100, streak: 6 },
      { day: t, xp: 99999, coins: 9999, completion: 1, done: 3, scheduled: 3, perfect: true, streak: 6 },
    ]);
    const rows = await db.sql<{ day: string; xp: string; coins: string }>(`select day::text, xp, coins from public.daily_stats where user_id = $1 order by day`, [ana]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].xp)).toBe(1070);
    expect(Number(rows[0].coins)).toBe(200);
    expect(await balance(ana)).toBe(500);
    // Marcado con multiplicador sin haberlo comprado: tope normal
    await publish(ana, [{ day: t, xp: 1500, coins: 0, boosted: true, streak: 6 }]);
    expect(Number((await db.sql<{ xp: string }>(`select xp from public.daily_stats where user_id = $1 and day = $2`, [ana, t]))[0].xp)).toBe(1070);
    // Desmarcar resta lo ganado
    await publish(ana, [{ day: t, xp: 24, coins: 10, streak: 6 }]);
    expect(await balance(ana)).toBe(310);
  });

  it('la racha sube como mucho 1 por día publicado', async () => {
    const t = await today();
    await publish(beto, []).catch(() => undefined);
    await baseline(beto, 10, 0, 0);
    await publish(beto, [{ day: addDays(t, -1), xp: 10, streak: 50 }, { day: t, xp: 10, streak: 50 }]);
    const rows = await db.sql<{ streak: number }>(`select streak from public.daily_stats where user_id = $1 order by day`, [beto]);
    expect(rows.map((r) => r.streak)).toEqual([11, 12]);
    // Si ayer baja, hoy se ajusta
    await publish(beto, [{ day: addDays(t, -1), xp: 10, streak: 0 }]);
    const after = await db.sql<{ streak: number }>(`select streak from public.daily_stats where user_id = $1 order by day`, [beto]);
    expect(after.map((r) => r.streak)).toEqual([0, 1]);
    // Días sin publicar (sin conexión): sube como mucho 1 por día transcurrido
    await db.sql(`delete from public.daily_stats where user_id = $1`, [beto]);
    await db.sql(`insert into public.daily_stats (user_id, day, streak) values ($1, $2, 5)`, [beto, addDays(t, -3)]);
    await publish(beto, [{ day: t, xp: 10, streak: 99 }]);
    const [gap] = await db.sql<{ streak: number }>(`select streak from public.daily_stats where user_id = $1 and day = $2`, [beto, t]);
    expect(gap.streak).toBe(8);
  });

  it('sin punto de partida no se publica', async () => {
    const dani = await db.user('dani@example.com', 10);
    await profile(dani, 'dani');
    await fails(publish(dani, [{ day: await today(), xp: 10 }]), /punto de partida/);
  });
});

describe('monedas, compras y multiplicador', () => {
  it('sin saldo no se compra; con saldo sí, una sola vez', async () => {
    const [cheap] = await db.as<{ id: string }>(admin,
      `insert into public.catalog_items (kind, name, price, status) values ('banner', 'Atardecer', 200, 'published') returning id`);
    const [pricey] = await db.as<{ id: string }>(admin,
      `insert into public.catalog_items (kind, name, price, status) values ('card', 'Galaxia', 5000, 'published') returning id`);
    const [draft] = await db.sql<{ id: string }>(`select id from public.catalog_items where name = 'Secreto'`);
    await fails(db.as(ana, `select public.purchase_item($1)`, [pricey.id]), /No te alcanzan/);
    await fails(db.as(ana, `select public.purchase_item($1)`, [draft.id]), /no está a la venta/);
    await db.as(ana, `select public.purchase_item($1)`, [cheap.id]);
    expect(await balance(ana)).toBe(110);
    await fails(db.as(ana, `select public.purchase_item($1)`, [cheap.id]), /Ya tienes/);
    // Ya lo tiene: puede equiparlo
    await db.as(ana, `update public.profiles set banner_item = $1 where user_id = $2`, [cheap.id, ana]);
    // Primer cosmético → logro «Con estilo» y gastar 100 → «Primer gasto»
    const got = (await db.sql<{ achievement_id: string }>(`select achievement_id from public.user_achievements where user_id = $1`, [ana])).map((r) => r.achievement_id);
    expect(got).toEqual(expect.arrayContaining(['con_estilo', 'primer_gasto', 'chispa', 'primeros_mil']));
  });

  it('gastos y extras del dispositivo: idempotentes y con tope', async () => {
    const t = await today();
    const spend = [{ id: 'r1', amount: 30, note: 'Cine', day: t }];
    const bonuses = [{ id: 'p1', amount: 400, day: t }, { id: 'p2', amount: 400, day: t }, { id: 'p3', amount: 50, day: addDays(t, -9) }];
    await db.as(ana, `select public.sync_wallet($1::jsonb, $2::jsonb)`, [JSON.stringify(spend), JSON.stringify(bonuses)]);
    await db.as(ana, `select public.sync_wallet($1::jsonb, $2::jsonb)`, [JSON.stringify(spend), JSON.stringify(bonuses)]);
    // 110 − 30 + 500 (tope diario de extras; el de hace 9 días no entra)
    expect(await balance(ana)).toBe(580);
  });

  it('multiplicador: 24 h de espera y máximo 4 al mes', async () => {
    const r = await db.as<{ r: { price: number } }>(ana, `select public.purchase_boost() as r`);
    expect(r[0].r.price).toBeGreaterThanOrEqual(100);
    await fails(db.as(ana, `select public.purchase_boost()`), /activo/);
    // Pasado el multiplicador, aún dentro de las 24 h
    await db.sql(`update public.xp_boosts set started_at = now() - interval '13 hours', ends_at = now() - interval '1 hour' where user_id = $1`, [ana]);
    await fails(db.as(ana, `select public.purchase_boost()`), /24 h/);
    // Ya hubo 4 este mes
    await db.sql(`update public.xp_boosts set started_at = now() - interval '30 hours', ends_at = now() - interval '18 hours' where user_id = $1`, [ana]);
    await db.sql(`insert into public.xp_boosts (user_id, started_at, ends_at, price) select $1, now() - make_interval(hours => 30 + g), now() - make_interval(hours => 18 + g), 100 from generate_series(1, 3) g`, [ana]);
    const sameMonth = (await db.sql<{ n: string }>(`select count(*) as n from public.xp_boosts where user_id = $1 and date_trunc('month', started_at at time zone 'UTC' - interval '5 hours') = date_trunc('month', now() at time zone 'UTC' - interval '5 hours')`, [ana]))[0].n;
    if (Number(sameMonth) >= 4) await fails(db.as(ana, `select public.purchase_boost()`), /este mes/);
  });

  it('con un multiplicador comprado, el tope de XP del día sube', async () => {
    const t = await today();
    await db.sql(`delete from public.xp_boosts where user_id = $1`, [beto]);
    await db.sql(`insert into public.xp_boosts (user_id, started_at, ends_at, price) values ($1, now() - interval '1 hour', now() + interval '11 hours', 100)`, [beto]);
    await publish(beto, [{ day: t, xp: 99999, boosted: true, streak: 1 }]);
    expect(Number((await db.sql<{ xp: string }>(`select xp from public.daily_stats where user_id = $1 and day = $2`, [beto, t]))[0].xp)).toBe(1590);
  });
});

describe('archivos: solo WebP y en la carpeta propia', () => {
  it('avatars y catálogo', async () => {
    await db.as(ana, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${ana}/foto.webp`]);
    await fails(db.as(ana, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${ana}/foto.png`]));
    await fails(db.as(ana, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${beto}/foto.webp`]));
    await fails(db.as(ana, `insert into storage.objects (bucket_id, name) values ('catalog', 'banners/x.webp')`));
    await db.as(admin, `insert into storage.objects (bucket_id, name) values ('catalog', 'banners/x.webp')`);
    const [b] = await db.sql<{ m: string[]; l: string }>(`select allowed_mime_types as m, file_size_limit::text as l from storage.buckets where id = 'avatars'`);
    expect(b.m).toEqual(['image/webp']);
    expect(b.l).toBe('1048576');
  });
});

describe('cierre semanal', () => {
  it('cinco en Bronce: los cinco suben, premios una sola vez y podio', async () => {
    const t = await today();
    const [{ wk }] = await db.sql<{ wk: string }>(`select (public.week_start(public.co_today()) - 7)::text as wk`);
    // Cinco personas en Bronce la semana pasada con XP distintas
    const people: string[] = [];
    for (let i = 0; i < 5; i++) {
      const u = await db.user(`liga${i}@example.com`, 40);
      people.push(u);
      await profile(u, `liga_${i}`);
      await db.sql(`delete from public.league_memberships where user_id = $1`, [u]);
      await db.sql(`insert into public.league_memberships (user_id, week_start, league, group_no) values ($1, $2, 1, 77)`, [u, wk]);
      await db.sql(`insert into public.daily_stats (user_id, day, xp, completion, scheduled, done) values ($1, $2::date + 1, $3, 0.5, 2, 1)`, [u, wk, 1000 - i * 100]);
    }
    const first = await db.sql<{ r: { closed: boolean } }>(`select public.close_week($1::date) as r`, [wk]);
    expect(first[0].r.closed).toBe(true);
    const second = await db.sql<{ r: { closed: boolean } }>(`select public.close_week($1::date) as r`, [wk]);
    expect(second[0].r.closed).toBe(false);

    const res = await db.sql<{ user_id: string; position: number; movement: number; prize: number }>(
      `select user_id, position, movement, prize from public.league_results where week_start = $1 and group_no = 77 order by position`, [wk]);
    // Del 1.º al 5.º suben
    expect(res.map((r) => r.movement)).toEqual([1, 1, 1, 1, 1]);
    expect(res.map((r) => r.prize)).toEqual([150, 100, 70, 25, 25]);
    const paid = await db.sql<{ n: string }>(`select count(*) as n from public.coin_ledger where kind = 'league' and ref = $1 and user_id = $2`, [`league:${wk}`, people[0]]);
    expect(Number(paid[0].n)).toBe(1);
    expect(await balance(people[0])).toBe(150);

    // El 1.º sube a Plata la semana siguiente
    const [next] = await db.sql<{ league: number }>(`select league from public.league_memberships where user_id = $1 and week_start = $2::date + 7`, [people[0], wk]);
    expect(next.league).toBe(2);
    // Podio global: el 1.º de la semana tiene el logro de campeón y su notificación
    const [pod] = await db.sql<{ user_id: string }>(`select user_id from public.weekly_podium where week_start = $1 and position = 1`, [wk]);
    expect(pod.user_id).toBe(people[0]);
    const podium = await db.as<{ pos: number; alias: string; display_name: string }>(ana, `select * from public.podium($1::date)`, [wk]);
    expect(podium[0]).toMatchObject({ pos: 1, alias: 'liga_0', display_name: 'liga_0' });
    const ach = await db.sql(`select 1 from public.user_achievements where user_id = $1 and achievement_id in ('campeon', 'ascenso')`, [people[0]]);
    expect(ach).toHaveLength(2);
    const notes = await db.as<{ kind: string }>(people[0], `select kind from public.notifications`);
    expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(['league_result', 'podium', 'achievement']));
    // Nadie ve las notificaciones de otra persona
    expect(await db.as(people[1], `select * from public.notifications where user_id = $1`, [people[0]])).toHaveLength(0);
    void t;
  });

  it('un grupo de una sola persona: ni sube ni baja y gana el premio de participación', async () => {
    const [{ wk }] = await db.sql<{ wk: string }>(`select (public.week_start(public.co_today()) - 14)::text as wk`);
    const solo = await db.user('solo@example.com', 60);
    await profile(solo, 'solo');
    await db.sql(`insert into public.league_memberships (user_id, week_start, league, group_no) values ($1, $2, 3, 1)`, [solo, wk]);
    await db.sql(`insert into public.daily_stats (user_id, day, xp) values ($1, $2::date, 10)`, [solo, wk]);
    await db.sql(`select public.close_week($1::date)`, [wk]);
    const [r] = await db.sql<{ movement: number; prize: number }>(`select movement, prize from public.league_results where user_id = $1`, [solo]);
    expect(r).toEqual({ movement: 0, prize: 25 });
    const [l] = await db.sql<{ amount: string; note: string }>(`select amount, note from public.coin_ledger where user_id = $1 and kind = 'league'`, [solo]);
    expect(Number(l.amount)).toBe(25);
    expect(l.note).toMatch(/participación/);
    // Sigue en Oro la semana siguiente
    const [next] = await db.sql<{ league: number }>(`select league from public.league_memberships where user_id = $1 and week_start = $2::date + 7`, [solo, wk]);
    expect(next.league).toBe(3);
  });

  describe('doce personas en un grupo', () => {
    const twelve: string[] = [];
    beforeAll(async () => {
      for (let i = 0; i < 12; i++) {
        const u = await db.user(`doce${i}@example.com`, 60);
        twelve.push(u);
        await profile(u, `doce_${String(i).padStart(2, '0')}`);
      }
    });

    it('en Plata: 5 suben, 5 se quedan y 2 bajan', async () => {
      const [{ wk }] = await db.sql<{ wk: string }>(`select (public.week_start(public.co_today()) - 28)::text as wk`);
      for (let i = 0; i < 12; i++) {
        await db.sql(`insert into public.league_memberships (user_id, week_start, league, group_no) values ($1, $2, 2, 5)`, [twelve[i], wk]);
        await db.sql(`insert into public.daily_stats (user_id, day, xp) values ($1, $2::date + 3, $3)`, [twelve[i], wk, 1200 - i * 50]);
      }
      expect((await db.sql<{ r: { closed: boolean } }>(`select public.close_week($1::date) as r`, [wk]))[0].r.closed).toBe(true);
      const res = await db.sql<{ user_id: string; movement: number; prize: number }>(
        `select user_id, movement, prize from public.league_results where week_start = $1 and league = 2 and group_no = 5 order by position`, [wk]);
      expect(res.map((r) => r.user_id)).toEqual(twelve);
      expect(res.map((r) => r.movement)).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0, 0, -1, -1]);
      // Premios de Plata: 1.º, 2.º, 3.º y 4.º–10.º
      expect(res.map((r) => r.prize)).toEqual([200, 135, 95, 35, 35, 35, 35, 35, 35, 35, 0, 0]);
      const next = await db.sql<{ league: number }>(
        `select m.league from public.league_memberships m join unnest($1::uuid[]) with ordinality u(id, n) on u.id = m.user_id
         where m.week_start = $2::date + 7 order by u.n`, [twelve, wk]);
      expect(next.map((r) => r.league)).toEqual([3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1]);
    });

    it('Mi liga: zonas por puestos ajustadas a la liga y el grupo de una persona', async () => {
      const [{ wk }] = await db.sql<{ wk: string }>(`select public.week_start(public.co_today())::text as wk`);
      await db.sql(`update public.league_memberships set league = 2, group_no = 901 where user_id = any ($1) and week_start = $2`, [twelve, wk]);
      for (let i = 0; i < 12; i++) {
        await db.sql(`insert into public.daily_stats (user_id, day, xp) values ($1, $2::date, $3)`, [twelve[i], wk, 600 - i * 10]);
      }
      type Standings = { ranked: number; promote: number; stay: number; demote: number; solo: boolean; solo_prize: number;
        members: { alias: string; display_name: string }[] };
      const standings = async () => (await db.as<{ r: Standings }>(twelve[0], `select public.league_standings() as r`))[0].r;
      const plata = await standings();
      expect(plata).toMatchObject({ ranked: 12, promote: 5, stay: 5, demote: 2, solo: false, solo_prize: 25 });
      expect(plata.members[0]).toMatchObject({ alias: 'doce_00', display_name: 'doce_00' });
      // En Diamante nadie sube; en Bronce nadie baja
      await db.sql(`update public.league_memberships set league = 5 where group_no = 901 and week_start = $1`, [wk]);
      expect(await standings()).toMatchObject({ promote: 0, stay: 10, demote: 2 });
      await db.sql(`update public.league_memberships set league = 1 where group_no = 901 and week_start = $1`, [wk]);
      expect(await standings()).toMatchObject({ promote: 5, stay: 7, demote: 0 });
      // Solo en su grupo: no sube ni baja y gana la participación
      await db.sql(`update public.league_memberships set league = 3, group_no = 902 where user_id = $1 and week_start = $2`, [twelve[0], wk]);
      expect(await standings()).toMatchObject({ ranked: 1, promote: 0, stay: 1, demote: 0, solo: true, solo_prize: 25 });
    });
  });

  it('no se cierra una semana que aún no termina (salvo forzado por el creador)', async () => {
    await fails(db.sql(`select public.close_week(public.week_start(public.co_today()))`), /aún no termina/);
  });
});

describe('logros', () => {
  it('se otorgan una sola vez y nadie se los da a sí mismo', async () => {
    const before = await db.sql<{ n: string }>(`select count(*) as n from public.user_achievements where user_id = $1`, [ana]);
    await db.as(ana, `select public.sync_wallet('[]', '[]')`);
    await db.as(ana, `select public.sync_wallet('[]', '[]')`);
    const after = await db.sql<{ n: string }>(`select count(*) as n from public.user_achievements where user_id = $1`, [ana]);
    expect(after[0].n).toBe(before[0].n);
    const prizeRefs = await db.sql(`select ref from public.coin_ledger where user_id = $1 and kind = 'achievement' group by ref having count(*) > 1`, [ana]);
    expect(prizeRefs).toHaveLength(0);
  });

  it('el premio opcional de un logro se cobra una vez', async () => {
    await db.as(admin, `insert into public.achievement_defs (id, name, metric, threshold, prize) values ('prueba_premio', 'Prueba', 'xp_total', 1, 40)`);
    const b0 = await balance(ana);
    await db.as(ana, `select public.sync_wallet('[]', '[]')`);
    await db.as(ana, `select public.sync_wallet('[]', '[]')`);
    expect(await balance(ana)).toBe(b0 + 40);
  });

  it('el creador se marca o se quita logros solo en su cuenta, sin premio ni aviso', async () => {
    await fails(db.as(ana, `select public.admin_set_achievement('leyenda', true)`), /Solo el creador/);
    await db.as(admin, `select public.admin_set_achievement('prueba_premio', true)`);
    await db.as(admin, `select public.admin_set_achievement('leyenda', true)`);
    await db.as(admin, `select public.admin_set_achievement('leyenda', true)`);
    const mine = async () => (await db.sql<{ a: string }>(`select achievement_id as a from public.user_achievements where user_id = $1 order by 1`, [admin])).map((r) => r.a);
    expect(await mine()).toEqual(['leyenda', 'prueba_premio']);
    expect(await db.sql(`select 1 from public.coin_ledger where user_id = $1 and kind = 'achievement'`, [admin])).toHaveLength(0);
    expect(await db.sql(`select 1 from public.notifications where user_id = $1 and kind = 'achievement'`, [admin])).toHaveLength(0);
    await db.as(admin, `select public.admin_set_achievement('leyenda', false)`);
    expect(await mine()).toEqual(['prueba_premio']);
    await fails(db.as(admin, `select public.admin_set_achievement('no_existe', true)`), /no existe/);
    // A nadie más se le tocan
    expect(await db.sql(`select 1 from public.user_achievements where achievement_id = 'leyenda'`)).toHaveLength(0);
  });

  it('% de usuarios que tienen cada logro', async () => {
    const rates = await db.as<{ achievement_id: string; pct: string }>(ana, `select * from public.achievement_rates()`);
    expect(Number(rates.find((r) => r.achievement_id === 'chispa')!.pct)).toBeGreaterThan(0);
  });
});

describe('amigos, publicaciones y ánimos', () => {
  it('solicitudes con aceptación', async () => {
    expect((await db.as<{ s: string }>(ana, `select public.send_friend_request($1) as s`, [beto]))[0].s).toBe('pending');
    // Beto no la ve como amistad aceptada hasta responder
    expect((await db.as<{ r: { friends: unknown[] } }>(beto, `select public.my_friends() as r`))[0].r.friends).toHaveLength(0);
    await db.as(beto, `select public.respond_friend_request($1, true)`, [ana]);
    expect((await db.as<{ r: { friends: { alias: string; display_name: string }[] } }>(beto, `select public.my_friends() as r`))[0].r.friends[0])
      .toMatchObject({ alias: 'ana_run', display_name: 'ana_run' });
    // Caro no puede ver la amistad de otros
    expect(await db.as(caro, `select * from public.friendships`)).toHaveLength(0);
  });

  it('publicaciones desde plantillas: datos del servidor, máx. 3 al día y aviso a los amigos', async () => {
    const tpls = (await db.as<{ r: { template: string; ref: string | null; data: { n?: number } }[] }>(ana, `select public.available_post_templates() as r`))[0].r;
    const streak = tpls.find((x) => x.template === 'streak');
    expect(streak?.data.n).toBeGreaterThan(0);
    // Un hábito oculto (no está en public_habits) no se puede usar
    await fails(db.as(ana, `select public.create_post('habit_streak', 'oculto', null)`), /no está disponible/);
    const t = await today();
    await db.as(ana, `insert into public.public_habits (habit_key, name, icon, days) values ('h1', 'Leer', '📚', $1::jsonb)`,
      [JSON.stringify({ [t]: { s: 'full' }, [addDays(t, -1)]: { s: 'full' }, [addDays(t, -2)]: { s: 'minimum' } })]);
    await db.as(ana, `select public.create_post('habit_streak', 'h1', 'Vamos')`);
    const [post] = await db.sql<{ data: { n: number; habit: string } }>(`select data from public.posts where user_id = $1`, [ana]);
    expect(post.data).toMatchObject({ n: 3, habit: 'Leer' });
    const notes = await db.as<{ kind: string }>(beto, `select kind from public.notifications where kind = 'friend_post'`);
    expect(notes).toHaveLength(1);
    await db.as(ana, `select public.create_post('streak', null, null)`);
    await db.as(ana, `select public.create_post('xp_week', null, null)`);
    await fails(db.as(ana, `select public.create_post('streak', null, null)`), /3 publicaciones/);
    await fails(db.as(ana, `select public.create_post('streak', null, $1)`, ['x'.repeat(201)]));
  });

  it('reacciones fijas y sin duplicados', async () => {
    const [post] = await db.sql<{ id: string }>(`select id from public.posts where user_id = $1 limit 1`, [ana]);
    await db.as(beto, `insert into public.post_reactions (post_id, emoji) values ($1, 'fire')`, [post.id]);
    await fails(db.as(beto, `insert into public.post_reactions (post_id, emoji) values ($1, 'fire')`, [post.id]));
    await fails(db.as(beto, `insert into public.post_reactions (post_id, emoji) values ($1, 'poop')`, [post.id]));
    const feed = (await db.as<{ r: { reactions: { fire: number }; mine: string[] }[] }>(beto, `select public.post_feed($1) as r`, [ana]))[0].r;
    expect(feed[0].reactions.fire + feed.slice(1).reduce((s, p) => s + p.reactions.fire, 0)).toBe(1);
  });

  it('las publicaciones de tus amigos no incluyen las tuyas', async () => {
    const feed = async (uid: string) => (await db.as<{ r: { user_id: string }[] }>(uid, `select public.post_feed(null) as r`))[0].r;
    expect(await feed(ana)).toHaveLength(0);
    const fromAna = await feed(beto);
    expect(fromAna).toHaveLength(3);
    expect(fromAna.every((p) => p.user_id === ana)).toBe(true);
    // Las propias se ven en el perfil
    expect((await db.as<{ r: unknown[] }>(ana, `select public.post_feed($1) as r`, [ana]))[0].r).toHaveLength(3);
  });

  it('editar el comentario: solo el dueño, queda marcado y con los mismos límites', async () => {
    const [post] = await db.sql<{ id: string }>(`select id from public.posts where user_id = $1 order by created_at limit 1`, [ana]);
    const row = async () => (await db.sql<{ comment: string | null; edited_at: string | null }>(`select comment, edited_at from public.posts where id = $1`, [post.id]))[0];
    expect((await row()).edited_at).toBeNull();
    await fails(db.as(beto, `select public.edit_post($1, 'Hackeado')`, [post.id]), /tus publicaciones/);
    await db.as(ana, `select public.edit_post($1, '  Nuevo texto  ')`, [post.id]);
    expect(await row()).toMatchObject({ comment: 'Nuevo texto', edited_at: expect.anything() });
    await fails(db.as(ana, `select public.edit_post($1, $2)`, [post.id, 'x'.repeat(201)]), /200/);
    expect((await row()).comment).toBe('Nuevo texto');
    // El feed trae la marca de editada y el nombre
    const feed = (await db.as<{ r: { id: string; edited_at: string | null; display_name: string }[] }>(beto, `select public.post_feed($1) as r`, [ana]))[0].r;
    expect(feed.find((p) => p.id === post.id)).toMatchObject({ edited_at: expect.anything(), display_name: 'ana_run' });
    // Vacío = sin comentario
    await db.as(ana, `select public.edit_post($1, '   ')`, [post.id]);
    expect((await row()).comment).toBeNull();
    // Nadie lo cambia directamente
    await fails(db.as(ana, `update public.posts set comment = 'x' where id = $1`, [post.id]), /permission denied/);
  });

  it('ánimos: uno por persona y día, 20 al día y nunca a quien te bloqueó', async () => {
    await db.as(beto, `select public.send_cheer($1)`, [ana]);
    await fails(db.as(beto, `select public.send_cheer($1)`, [ana]), /hoy/);
    await fails(db.as(beto, `select public.send_cheer($1)`, [beto]));
    const [n] = await db.as<{ data: { kind: string } }>(ana, `select data from public.notifications where kind = 'cheer'`);
    expect(['cheer', 'congrats']).toContain(n.data.kind);
    // 20 al día en total
    const many: string[] = [];
    for (let i = 0; i < 20; i++) {
      const u = await db.user(`fan${i}@example.com`, 5);
      await profile(u, `fan_${i}`);
      many.push(u);
    }
    for (let i = 0; i < 19; i++) await db.as(caro, `select public.send_cheer($1)`, [many[i]]);
    await db.as(caro, `select public.send_cheer($1)`, [ana]);
    await fails(db.as(caro, `select public.send_cheer($1)`, [many[19]]), /20 ánimos/);
    // Bloquear corta la amistad y los ánimos
    await db.as(ana, `insert into public.blocks (blocked) values ($1)`, [beto]);
    expect(await db.sql(`select 1 from public.friendships where $1 in (requester, addressee) and $2 in (requester, addressee)`, [ana, beto])).toHaveLength(0);
    await fails(db.as(beto, `select public.send_cheer($1)`, [ana]), /No puedes/);
    await fails(db.as(beto, `select public.send_friend_request($1)`, [ana]), /No puedes/);
    // Y quien te bloqueó no aparece
    expect((await db.as<{ r: unknown }>(beto, `select public.public_profile('ana_run') as r`))[0].r).toBeNull();
  });
});

describe('perfil público y privacidad', () => {
  it('los hábitos visibles solo salen si la persona eligió esa tarjeta', async () => {
    const view = async () => (await db.as<{ r: { habits: unknown[] } }>(caro, `select public.public_profile('ana_run') as r`))[0].r;
    await db.as(ana, `update public.profiles set cards = '{streak}' where user_id = $1`, [ana]);
    expect((await view()).habits).toHaveLength(0);
    await db.as(ana, `update public.profiles set cards = '{streak,habits}' where user_id = $1`, [ana]);
    const habits = (await view()).habits as { name: string }[];
    expect(habits.map((h) => h.name)).toEqual(['Leer']);
  });
});

describe('«me gusta» a perfiles', () => {
  let lu: string;
  let mo: string;
  let ni: string;
  const like = async (who: string, target: string) =>
    (await db.as<{ r: { liked: boolean; likes: number } }>(who, `select public.toggle_profile_like($1) as r`, [target]))[0].r;
  beforeAll(async () => {
    lu = await db.user('lu@example.com', 10);
    mo = await db.user('mo@example.com', 10);
    ni = await db.user('ni@example.com', 10);
    await profile(lu, 'lu_lu');
    await profile(mo, 'mo_mo');
    await profile(ni, 'ni_ni');
  });

  it('dar y quitar, contar y avisar solo la primera vez', async () => {
    expect(await like(lu, mo)).toEqual({ liked: true, likes: 1 });
    expect(await like(ni, mo)).toEqual({ liked: true, likes: 2 });
    expect(await like(lu, mo)).toEqual({ liked: false, likes: 1 });
    expect(await like(lu, mo)).toEqual({ liked: true, likes: 2 });
    const notes = await db.as<{ actor_id: string }>(mo, `select actor_id from public.notifications where kind = 'profile_like' order by id`);
    expect(notes.map((n) => n.actor_id)).toEqual([lu, ni]);
    type Likes = { likes: number; liked_by_me: boolean };
    expect((await db.as<{ r: Likes }>(lu, `select public.public_profile('mo_mo') as r`))[0].r).toMatchObject({ likes: 2, liked_by_me: true });
    expect((await db.as<{ r: Likes }>(mo, `select public.public_profile('mo_mo') as r`))[0].r).toMatchObject({ likes: 2, liked_by_me: false });
    // Cada quien ve solo los que dio; nadie los escribe directamente
    expect(await db.as(mo, `select * from public.profile_likes`)).toHaveLength(0);
    expect(await db.as(lu, `select * from public.profile_likes`)).toHaveLength(1);
    await fails(db.as(mo, `insert into public.profile_likes (liker, liked) values ($1, $2)`, [mo, lu]), /permission denied/);
    await fails(db.as(mo, `select * from public.profile_like_notices`), /permission denied/);
  });

  it('no a uno mismo ni con un bloqueo de por medio', async () => {
    await fails(like(lu, lu), /ti mismo/);
    await db.as(ni, `insert into public.blocks (blocked) values ($1)`, [lu]);
    await fails(like(lu, ni), /No puedes/);
    await fails(like(ni, lu), /No puedes/);
    // Bloquear quita los «me gusta» entre las dos personas
    await db.as(mo, `insert into public.blocks (blocked) values ($1)`, [lu]);
    expect((await db.as<{ r: { likes: number } }>(ni, `select public.public_profile('mo_mo') as r`))[0].r.likes).toBe(1);
    await fails(like(lu, mo), /No puedes/);
  });
});

describe('semanas del perfil', () => {
  let pia: string;
  let prev: string;
  type Week = { week_start: string; week: { day: string; xp: number; completion: number | null }[]; habits: { days: Record<string, unknown> }[] | null };
  const week = async (viewer: string, day: string) =>
    (await db.as<{ r: Week | null }>(viewer, `select public.profile_week($1, $2::date) as r`, [pia, day]))[0].r;
  beforeAll(async () => {
    pia = await db.user('pia@example.com', 3);
    await profile(pia, 'pia');
    const [{ wk, p }] = await db.sql<{ wk: string; p: string }>(
      `select public.week_start(public.co_today())::text as wk, (public.week_start(public.co_today()) - 7)::text as p`);
    prev = p;
    await db.sql(`insert into public.daily_stats (user_id, day, xp, completion, scheduled, done) values ($1, $2::date + 2, 120, 0.5, 2, 1), ($1, $3::date, 80, 1, 1, 1)`,
      [pia, prev, wk]);
    const days = { [addDays(prev, -3)]: { s: 'missed' }, [addDays(prev, 2)]: { s: 'full' }, [wk]: { s: 'minimum' } };
    await db.as(pia, `insert into public.public_habits (habit_key, name, days) values ('h', 'Leer', $1::jsonb)`, [JSON.stringify(days)]);
  });

  it('7 días, los hábitos con los días de esa semana y la primera semana con datos', async () => {
    // Cualquier día de la semana lleva a su lunes
    const r = (await week(ana, addDays(prev, 4)))!;
    expect(r.week_start).toBe(prev);
    expect(r.week.map((d) => d.day)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(prev, i)));
    expect(r.week[0]).toEqual({ day: prev, xp: 0, completion: null });
    expect(r.week[2]).toEqual({ day: addDays(prev, 2), xp: 120, completion: 0.5 });
    expect(r.habits).toHaveLength(1);
    expect(Object.keys(r.habits![0].days)).toEqual([addDays(prev, 2)]);
    const [{ r: pub }] = await db.as<{ r: { first_week: string } }>(ana, `select public.public_profile('pia') as r`);
    expect(pub.first_week).toBe(prev);
  });

  it('privacidad: tarjetas elegidas, bloqueos y vetos', async () => {
    expect(await db.as(ana, `select habit_key from public.public_habits where user_id = $1`, [pia])).toHaveLength(1);
    await db.as(pia, `update public.profiles set cards = '{streak}' where user_id = $1`, [pia]);
    expect(await week(ana, prev)).toEqual({ week_start: prev, week: [], habits: null });
    // Tampoco se leen directamente de la tabla (la dueña sí)
    expect(await db.as(ana, `select habit_key from public.public_habits where user_id = $1`, [pia])).toHaveLength(0);
    expect(await db.as(pia, `select habit_key from public.public_habits where user_id = $1`, [pia])).toHaveLength(1);
    // La propia persona lo ve todo
    const own = (await week(pia, prev))!;
    expect(own.week).toHaveLength(7);
    expect(own.habits).toHaveLength(1);
    // Quien te bloqueó no aparece
    await db.as(pia, `insert into public.blocks (blocked) values ($1)`, [caro]);
    expect(await week(caro, prev)).toBeNull();
    // Con un veto solo la ven ella y el creador
    await db.as(admin, `select public.admin_ban($1, 'Prueba', 1)`, [pia]);
    expect(await week(ana, prev)).toBeNull();
    expect(await week(admin, prev)).not.toBeNull();
    expect(await week(pia, prev)).not.toBeNull();
    await db.as(admin, `select public.admin_unban($1, 'Fin de la prueba')`, [pia]);
    expect(await week(ana, prev)).not.toBeNull();
  });
});

describe('borrar el perfil público', () => {
  it('desaparece lo publicado y las cifras dejan de verse, pero no se reinician', async () => {
    const eva = await db.user('eva@example.com', 20);
    await profile(eva, 'eva');
    await baseline(eva, 4, 100, 50);
    await publish(eva, [{ day: await today(), xp: 30, coins: 10, streak: 5 }]);
    await db.as(eva, `insert into public.public_habits (habit_key, name) values ('h', 'Correr')`);
    const before = await balance(eva);
    await db.as(eva, `delete from public.profiles where user_id = $1`, [eva]);
    expect(await db.as(caro, `select * from public.daily_stats where user_id = $1`, [eva])).toHaveLength(0);
    expect(await db.as(caro, `select * from public.profile_stats where user_id = $1`, [eva])).toHaveLength(0);
    expect(await db.sql(`select * from public.public_habits where user_id = $1`, [eva])).toHaveLength(0);
    // La liga de la semana se queda: borrar el perfil el domingo no esquiva el descenso
    expect(await db.sql(`select * from public.league_memberships where user_id = $1`, [eva])).toHaveLength(1);
    // Al volver, el punto de partida no se puede reclamar otra vez
    await profile(eva, 'eva2');
    expect(((await baseline(eva, 999, 99999, 99999))[0].r as { claimed: boolean }).claimed).toBe(false);
    expect(await balance(eva)).toBe(before);
  });
});

describe('vetos y moderación', () => {
  it('un veto impide escribir lo público y saca de las clasificaciones', async () => {
    await db.as(admin, `select public.admin_ban($1, 'Trampas evidentes', 7)`, [beto]);
    await fails(publish(beto, [{ day: await today(), xp: 1 }]), /VETO/);
    await fails(db.as(beto, `update public.profiles set alias = 'beto2' where user_id = $1`, [beto]), /VETO/);
    await fails(db.as(beto, `select public.send_friend_request($1)`, [caro]), /VETO/);
    const status = (await db.as<{ s: { ban: { reason: string } | null } }>(beto, `select public.my_status() as s`))[0].s;
    expect(status.ban?.reason).toBe('Trampas evidentes');
    const lb = await db.as<{ alias: string }>(caro, `select alias from public.leaderboard_xp_week`);
    expect(lb.map((r) => r.alias)).not.toContain('beto');
    await db.as(admin, `select public.admin_unban($1, 'Revisado')`, [beto]);
    expect((await db.as<{ b: boolean }>(beto, `select public.is_banned() as b`))[0].b).toBe(false);
    const log = await db.as<{ action: string }>(admin, `select action from public.moderation_actions where target_user = $1 order by id`, [beto]);
    expect(log.map((l) => l.action)).toEqual(['ban', 'unban']);
    expect(await db.as(ana, `select * from public.moderation_actions`)).toHaveLength(0);
  });

  it('la ficha del creador se abre por alias o por id', async () => {
    type Overview = { profile: { user_id: string; alias: string; display_name: string } } | null;
    const byAlias = (await db.as<{ r: Overview }>(admin, `select public.admin_user('BETO') as r`))[0].r;
    const byId = (await db.as<{ r: Overview }>(admin, `select public.admin_user($1) as r`, [beto]))[0].r;
    expect(byAlias?.profile).toMatchObject({ user_id: beto, alias: 'beto', display_name: 'beto' });
    expect(byId?.profile.user_id).toBe(beto);
    await fails(db.as(ana, `select public.admin_user($1)`, [beto]), /Solo el creador/);
  });

  it('ajustes del creador quedan registrados', async () => {
    const b0 = await balance(caro);
    await db.as(admin, `select public.admin_adjust_coins($1, -100, 'Corrección')`, [caro]);
    expect(await balance(caro)).toBe(b0 - 100);
    const ledger = await db.as<{ kind: string }>(caro, `select kind from public.my_ledger(0)`);
    expect(ledger.map((l) => l.kind)).toContain('admin');
  });

  it('economía versionada: borrador, publicar y revertir', async () => {
    const [d] = await db.as<{ version: number }>(admin, `insert into public.economy_config (params) values ('{"coinDailyCap": 150}') returning version`);
    await fails(db.as(ana, `insert into public.economy_config (params) values ('{"coinDailyCap": 99999}')`));
    await db.as(admin, `select public.admin_publish_economy($1, now() - interval '1 second')`, [d.version]);
    expect((await db.as<{ c: string }>(ana, `select public.econ('coinDailyCap', 200) as c`))[0].c).toBe('150');
    // Una versión sin tabla de premios no deja las ligas a 0
    const [p] = await db.as<{ p: { bronze: number[] } }>(ana, `select public.league_prizes() as p`);
    expect(p.p.bronze).toEqual([150, 100, 70, 25]);
    await db.as(admin, `select public.admin_revert_economy(1)`);
    expect((await db.as<{ c: string }>(ana, `select public.econ('coinDailyCap', 200) as c`))[0].c).toBe('200');
  });

  it('reportes: cualquiera reporta, solo el creador los ve todos', async () => {
    await db.as(caro, `insert into public.reports (target_user, reason, details) values ($1, 'spam', 'Publica mucho')`, [ana]);
    expect(await db.as(beto, `select * from public.reports`)).toHaveLength(0);
    expect(await db.as(admin, `select * from public.reports`)).toHaveLength(1);
    await db.as(admin, `select public.admin_resolve_report(id, 'resolved') from public.reports`);
    expect((await db.sql<{ status: string }>(`select status from public.reports`))[0].status).toBe('resolved');
  });
});

describe('agujeros cerrados en la revisión', () => {
  let x: string;
  let y: string;
  let z: string;
  beforeAll(async () => {
    x = await db.user('xavi@example.com', 30);
    y = await db.user('yoli@example.com', 30);
    z = await db.user('zoe@example.com', 30);
    await profile(x, 'xavi');
    await profile(y, 'yoli');
    await profile(z, 'zoe');
    await baseline(x, 5, 0, 1000);
    await baseline(y, 0, 0, 0);
  });

  it('sin sesión no se ejecuta ninguna función ni se toca ninguna tabla o contador', async () => {
    const fns = await db.sql<{ f: string }>(`
      select p.oid::regprocedure::text as f from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute') order by 1`);
    // Única excepción: calificar la app desde /descargar sin cuenta (0008_calificaciones.sql)
    expect(fns).toEqual([{ f: 'app_rating_summary()' }, { f: 'rate_app(uuid,integer)' }]);
    const rels = await db.sql<{ r: string }>(`
      select c.relname as r from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
        and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or (c.relkind = 'S' and (has_sequence_privilege('authenticated', c.oid, 'update') or has_sequence_privilege('authenticated', c.oid, 'usage'))))`);
    expect(rels).toEqual([]);
    // Las columnas identity siguen funcionando sin permiso sobre su contador
    await db.as(z, `insert into public.reports (target_user, reason) values ($1, 'other')`, [x]);
  });

  it('los bloqueos de otras personas son privados', async () => {
    await db.as(x, `insert into public.blocks (blocked) values ($1)`, [y]);
    expect((await db.as<{ b: boolean }>(z, `select public.blocked_between($1, $2) as b`, [x, y]))[0].b).toBe(false);
    expect((await db.as<{ b: boolean }>(y, `select public.blocked_between($1, $2) as b`, [x, y]))[0].b).toBe(true);
    await db.as(x, `delete from public.blocks where blocked = $1`, [y]);
  });

  it('volver a publicar los hábitos visibles (upsert) funciona aunque ya haya 12', async () => {
    const values = Array.from({ length: 12 }, (_, i) => `('k${i}', 'Hábito ${i}')`).join(', ');
    await db.as(x, `insert into public.public_habits (habit_key, name) values ${values}`);
    await db.as(x, `insert into public.public_habits (user_id, habit_key, name) values ($1, 'k1', 'Leer'), ($1, 'k2', 'Correr')
      on conflict (user_id, habit_key) do update set name = excluded.name`, [x]);
    expect((await db.sql<{ name: string }>(`select name from public.public_habits where user_id = $1 and habit_key = 'k1'`, [x]))[0].name).toBe('Leer');
    await fails(db.as(x, `insert into public.public_habits (habit_key, name) values ('k12', 'Uno más')`), /12 hábitos/);
  });

  it('cancelar y repetir no salta los límites de solicitudes ni de publicaciones', async () => {
    for (let i = 0; i < 20; i++) {
      await db.as(x, `select public.send_friend_request($1)`, [z]);
      await db.as(x, `select public.remove_friend($1)`, [z]);
    }
    await fails(db.as(x, `select public.send_friend_request($1)`, [z]), /20 solicitudes/);
    expect(Number((await db.sql<{ n: string }>(`select count(*) as n from public.notifications where user_id = $1 and kind = 'friend_request'`, [z]))[0].n)).toBe(20);

    await publish(x, [{ day: await today(), xp: 10, streak: 6 }]);
    for (let i = 0; i < 3; i++) {
      await db.as(x, `select public.create_post('streak', null, null)`);
      await db.as(x, `delete from public.posts where user_id = $1`, [x]);
    }
    await fails(db.as(x, `select public.create_post('streak', null, null)`), /3 publicaciones/);
  });

  it('con un veto no entran monedas por el saldo del dispositivo', async () => {
    await db.as(admin, `select public.admin_ban($1, 'Prueba', 1)`, [y]);
    await fails(db.as(y, `select public.sync_wallet('[]', $1::jsonb)`, [JSON.stringify([{ id: 'v1', amount: 100, day: await today() }])]), /VETO/);
    expect(await balance(y)).toBe(0);
    await db.as(admin, `select public.admin_unban($1, 'Fin de la prueba')`, [y]);
  });

  it('en Mi liga, quien tiene un veto no cuenta para las zonas', async () => {
    await publish(y, [{ day: await today(), xp: 50, streak: 1 }]);
    const [{ wk }] = await db.sql<{ wk: string }>(`select public.week_start(public.co_today())::text as wk`);
    await db.sql(`update public.league_memberships set league = 2, group_no = 900 where user_id = any ($1) and week_start = $2`, [[x, y], wk]);
    const ranked = async () => (await db.as<{ r: { ranked: number; members: unknown[] } }>(x, `select public.league_standings() as r`))[0].r;
    expect((await ranked()).ranked).toBe(2);
    await db.as(admin, `select public.admin_ban($1, 'Prueba', 1)`, [y]);
    const r = await ranked();
    expect(r.ranked).toBe(1);
    expect(r.members).toHaveLength(1);
    await db.as(admin, `select public.admin_unban($1, 'Fin de la prueba')`, [y]);
  });

  it('la tienda devuelve el precio que cobró', async () => {
    const [item] = await db.as<{ id: string }>(admin,
      `insert into public.catalog_items (kind, name, price, status) values ('frame', 'Marco caro', 120, 'published') returning id`);
    const [{ r }] = await db.as<{ r: { price: number } }>(x, `select public.purchase_item($1) as r`, [item.id]);
    expect(r.price).toBe(120);
  });

  it('una versión de la economía rige por días completos de Colombia, igual en el servidor y en la app', async () => {
    await db.sql('begin');
    try {
      const [{ version }] = await db.as<{ version: number }>(admin, `insert into public.economy_config (params) values ('{"coinDailyCap": 50}') returning version`);
      // Publicada «para mañana a las 14:00»: rige desde las 00:00 de Colombia de mañana
      await db.as(admin, `select public.admin_publish_economy($1, now() + interval '1 day')`, [version]);
      const [{ from, ok }] = await db.sql<{ from: string; ok: boolean }>(
        `select effective_from::text as from, effective_from = public.co_day_start(now() + interval '1 day') as ok from public.economy_config where version = $1`, [version]);
      expect(ok).toBe(true);
      expect(from).toMatch(/05:00:00\+00/);
      const t = await today();
      await publish(x, [{ day: t, xp: 10, coins: 999, streak: 6 }]);
      expect(Number((await db.sql<{ c: string }>(`select coins as c from public.daily_stats where user_id = $1 and day = $2`, [x, t]))[0].c)).toBe(200);
      expect((await db.sql<{ c: string }>(`select public.econ_on($1::date + 1, 'coinDailyCap', 200) as c`, [t]))[0].c).toBe('50');
    } finally {
      await db.sql('rollback');
    }
  });

  it('un tamaño de grupo o un ritmo a 0 en la economía no rompe el cierre ni el precio', async () => {
    await db.sql('begin');
    try {
      await db.sql(`insert into public.economy_config (params, status, effective_from) values ('{"leagueGroupSize": 0, "rhythmDays": 0}', 'published', now() - interval '1 second')`);
      const [{ wk }] = await db.sql<{ wk: string }>(`select (public.week_start(public.co_today()) - 21)::text as wk`);
      await db.sql(`insert into public.league_memberships (user_id, week_start, league, group_no) values ($1, $2, 1, 1)`, [z, wk]);
      await db.sql(`insert into public.daily_stats (user_id, day, xp) values ($1, $2::date, 10)`, [z, wk]);
      expect((await db.sql<{ r: { closed: boolean } }>(`select public.close_week($1::date) as r`, [wk]))[0].r.closed).toBe(true);
      expect(Number((await db.sql<{ p: number }>(`select public.dynamic_price($1, 2, 100, 600) as p`, [z]))[0].p)).toBe(100);
    } finally {
      await db.sql('rollback');
    }
  });

  it('volver a ejecutar la migración no borra datos ni abre permisos', async () => {
    const b0 = await balance(x);
    const n0 = (await db.sql<{ n: string }>(`select count(*) as n from public.rate_log`))[0].n;
    await reapplySocialMigration(db);
    expect(await balance(x)).toBe(b0);
    expect((await db.sql<{ n: string }>(`select count(*) as n from public.rate_log`))[0].n).toBe(n0);
    await fails(db.as(x, `select * from public.rate_log`), /permission denied/);
    await fails(db.as(x, `select * from public.profile_like_notices`), /permission denied/);
    await fails(db.as(x, `select setval('public.coin_ledger_id_seq', 1)`), /permission denied/);
    // Las vistas que se vuelven a crear siguen cerradas sin sesión
    await fails(db.as(null, `select * from public.public_profiles`), /permission denied/);
  });
});

describe('reiniciar el progreso', () => {
  let rita: string;
  beforeAll(async () => {
    rita = await db.user('rita@example.com', 30);
    await profile(rita, 'rita');
  });
  const achievementsOf = async (uid: string) =>
    (await db.sql<{ a: string }>(`select achievement_id as a from public.user_achievements where user_id = $1`, [uid])).map((r) => r.a);

  it('borra lo que sale del dispositivo y conserva compras, premios y ajustes del creador', async () => {
    const t = await today();
    // Logros: «Chispa» (racha 3), «Primeros mil» (1 000 XP) y «Prueba» (XP ≥ 1, premio 40)
    await baseline(rita, 3, 1000, 300);
    await publish(rita, [{ day: t, xp: 100, coins: 50, streak: 4 }]);
    await db.as(rita, `select public.sync_wallet($1::jsonb, $2::jsonb)`,
      [JSON.stringify([{ id: 's1', amount: 20, day: t }]), JSON.stringify([{ id: 'b1', amount: 30, day: t }])]);
    await db.as(rita, `insert into public.public_habits (habit_key, name) values ('h', 'Leer')`);
    const [item] = await db.as<{ id: string }>(admin,
      `insert into public.catalog_items (kind, name, price, status) values ('banner', 'Reinicio', 100, 'published') returning id`);
    await db.as(rita, `select public.purchase_item($1)`, [item.id]);
    await db.as(rita, `update public.profiles set featured_achievements = '{chispa}' where user_id = $1`, [rita]);
    await db.as(admin, `select public.admin_adjust_coins($1, 7, 'Regalo')`, [rita]);
    await db.as(admin, `select public.admin_adjust_xp($1, 5, 'Ajuste')`, [rita]);
    // 300 + 50 − 20 + 30 − 100 + 40 + 7
    expect(await balance(rita)).toBe(307);
    expect(await achievementsOf(rita)).toEqual(expect.arrayContaining(['chispa', 'primeros_mil', 'prueba_premio', 'primer_gasto', 'con_estilo']));
    const [{ league0 }] = await db.sql<{ league0: string }>(`select count(*) as league0 from public.league_memberships where user_id = $1`, [rita]);

    await db.as(rita, `select public.reset_my_progress()`);
    expect(await db.sql(`select 1 from public.daily_stats where user_id = $1`, [rita])).toHaveLength(0);
    expect(await db.sql(`select 1 from public.public_habits where user_id = $1`, [rita])).toHaveLength(0);
    const kinds = (await db.sql<{ kind: string; ref: string }>(`select kind, ref from public.coin_ledger where user_id = $1 order by kind, ref`, [rita]));
    expect(kinds.map((r) => r.kind)).toEqual(['achievement', 'admin', 'admin', 'purchase']);
    // −100 + 40 + 7 = −53: se devuelve a 0 (el dispositivo nunca baja de 0) con un ajuste que el dispositivo recibe
    expect(await balance(rita)).toBe(0);
    const [fix] = await db.as<{ amount: string; ref: string }>(rita, `select amount, ref from public.my_ledger(0) where ref like 'reset:%'`);
    expect(Number(fix.amount)).toBe(53);
    // Los logros que salen de las cifras del dispositivo se van; el del cosmético comprado y el de gasto se quedan
    // (los gastos de antes no se vuelven a enviar: no se podría recuperar)
    const left = await achievementsOf(rita);
    expect(left).toEqual(expect.arrayContaining(['con_estilo', 'primer_gasto']));
    expect(left.filter((a) => ['chispa', 'primeros_mil', 'prueba_premio'].includes(a))).toEqual([]);
    const [st] = await db.sql<{ baseline_at: string | null; xp_total: string; best_streak: number; habits_done: number; xp_adjust: string }>(
      `select baseline_at, xp_total, best_streak, habits_done, xp_adjust from public.profile_stats where user_id = $1`, [rita]);
    expect(st.baseline_at).toBeNull();
    expect(Number(st.xp_total)).toBe(5);
    expect(Number(st.xp_adjust)).toBe(5);
    expect(st.best_streak).toBe(0);
    expect(st.habits_done).toBe(0);
    // Topes del próximo reclamo: lo publicado hasta anteayer (hoy sigue abierto y se vuelve a publicar)
    const [cap] = await db.sql<{ cap_xp: string; cap_best: number; cap_done: number; cap_coins: string; last_reset_at: string | null }>(
      `select cap_xp, cap_best, cap_done, cap_coins, last_reset_at from public.profile_stats where user_id = $1`, [rita]);
    // XP 1000 del punto de partida; monedas 300 − 20 + 30 (sin las 50 de hoy); racha 3
    expect([Number(cap.cap_xp), cap.cap_best, cap.cap_done, Number(cap.cap_coins)]).toEqual([1000, 3, 0, 310]);
    expect(cap.last_reset_at).not.toBeNull();
    expect((await db.sql<{ n: string }>(`select count(*) as n from public.league_memberships where user_id = $1`, [rita]))[0].n).toBe(league0);
    // Los destacados que ya no tiene dejan de estar elegidos y el perfil se sigue pudiendo editar
    expect((await db.sql<{ f: string[] }>(`select featured_achievements as f from public.profiles where user_id = $1`, [rita]))[0].f).toEqual([]);
    await db.as(rita, `update public.profiles set bio = 'De nuevo' where user_id = $1`, [rita]);
    expect((await db.as<{ r: { achievements: unknown[] } }>(ana, `select public.public_profile('rita') as r`))[0].r.achievements).toHaveLength(0);

    // El punto de partida se reclama otra vez y los premios de logros no se cobran ni se avisan dos veces
    expect(((await baseline(rita, 3, 500, 200))[0].r as { claimed: boolean }).claimed).toBe(true);
    // 200 desde el saldo devuelto a 0
    expect(await balance(rita)).toBe(200);
    expect(await achievementsOf(rita)).toEqual(expect.arrayContaining(['chispa', 'prueba_premio', 'primer_gasto']));
    expect(Number((await db.sql<{ n: string }>(`select count(*) as n from public.coin_ledger where user_id = $1 and ref = 'ach:prueba_premio'`, [rita]))[0].n)).toBe(1);
    const notes = await db.sql<{ id: string; n: string }>(
      `select data ->> 'id' as id, count(*) as n from public.notifications where user_id = $1 and kind = 'achievement' group by 1`, [rita]);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((r) => Number(r.n) === 1)).toBe(true);
    // Al recuperarlo no vuelve a destacarse solo: se elige otra vez en el editor
    expect((await db.as<{ r: { achievements: { id: string }[] } }>(ana, `select public.public_profile('rita') as r`))[0].r.achievements).toHaveLength(0);
    // Y se vuelve a publicar con normalidad
    expect((await publish(rita, [{ day: t, xp: 10, coins: 5, streak: 4 }]))[0].r.written).toBe(1);
  });

  it('como mucho 10 reinicios al día y nunca con un veto', async () => {
    for (let i = 0; i < 9; i++) await db.as(rita, `select public.reset_my_progress()`);
    await fails(db.as(rita, `select public.reset_my_progress()`), /10 reinicios/);
    await db.as(admin, `select public.admin_ban($1, 'Prueba', 1)`, [caro]);
    await fails(db.as(caro, `select public.reset_my_progress()`), /VETO/);
    await db.as(admin, `select public.admin_unban($1, 'Fin de la prueba')`, [caro]);
    await fails(db.as(null, `select public.reset_my_progress()`), /permission denied/);
    // Un cambio ya atendido no cuenta ni falla aunque se haya llegado al límite
    expect((await reset(rita, new Date(Date.now() - 3_600_000).toISOString()))).toEqual({ reset: false });
  });

  it('el mismo cambio se atiende una sola vez aunque llegue desde varios dispositivos', async () => {
    // El logro de prueba con premio (XP ≥ 1) movería el saldo de estas cuentas
    await db.as(admin, `update public.achievement_defs set active = false where id = 'prueba_premio'`);
    const teo = await db.user('teo@example.com', 30);
    await profile(teo, 'teo');
    await baseline(teo, 2, 300, 100);
    const t1 = '2026-10-20T10:00:00.000Z';
    const resets = async () => Number((await db.sql<{ n: string }>(
      `select count(*) as n from public.rate_log where user_id = $1 and action = 'reset_progress'`, [teo]))[0].n);
    expect(await reset(teo, t1)).toMatchObject({ reset: true });
    // El punto de partida se reclama con los datos nuevos; luego llega el mismo cambio desde otro dispositivo
    await baseline(teo, 2, 250, 80);
    expect(await reset(teo, t1)).toEqual({ reset: false });
    // …o uno anterior (un dispositivo desfasado con ajustes viejos): tampoco borra nada
    expect(await reset(teo, '2026-10-19T10:00:00.000Z')).toEqual({ reset: false });
    expect(await balance(teo)).toBe(80);
    expect(await resets()).toBe(1);
    // Un cambio posterior sí
    expect(await reset(teo, '2026-10-21T10:00:00.000Z')).toMatchObject({ reset: true });
    expect(await balance(teo)).toBe(0);
    expect(await resets()).toBe(2);
  });

  it('tras un reinicio, volver a reclamar el punto de partida no infla el perfil', async () => {
    // Cuenta de 2 días: el primer reclamo admite hasta (3 + 365) días de historial
    const vera = await db.user('vera@example.com', 2);
    await profile(vera, 'vera');
    const t = await today();
    const claim = (streak: number, xp: number, coins: number, done: number) =>
      db.as(vera, `select public.claim_baseline($1, $1, $2, $3, $4) as r`, [streak, xp, coins, done]);
    const stats = async () => (await db.sql<{ xp_total: string; best_streak: number; habits_done: number }>(
      `select xp_total, best_streak, habits_done from public.profile_stats where user_id = $1`, [vera]))[0];
    await claim(300, 100_000, 50_000, 5_000);
    expect(Number((await stats()).xp_total)).toBe(100_000);
    // Varias vueltas de reiniciar, reclamar todo lo posible y publicar hoy: siempre los mismos topes
    for (let i = 0; i < 3; i++) {
      await reset(vera);
      await claim(9_999, 9_999_999, 9_999_999, 999_999);
      const s = await stats();
      expect([Number(s.xp_total), s.best_streak, s.habits_done]).toEqual([100_000, 300, 5_000]);
      expect(await balance(vera)).toBe(50_000);
      await publish(vera, [{ day: t, xp: 1_000, coins: 200, done: 3, scheduled: 3, streak: 301 }]);
    }
    // Lo publicado hoy sigue abierto: no sube el tope del siguiente reclamo
    await reset(vera);
    await claim(9_999, 9_999_999, 9_999_999, 999_999);
    expect(Number((await stats()).xp_total)).toBe(100_000);
    // Con días desde el reinicio, el tope crece lo que se pudo ganar en ellos (3 días × 1 600 XP, 200 monedas, 100 hábitos)
    await reset(vera);
    await db.sql(`update public.profile_stats set last_reset_at = now() - interval '3 days' where user_id = $1`, [vera]);
    await claim(9_999, 9_999_999, 9_999_999, 999_999);
    const s = await stats();
    expect([Number(s.xp_total), s.best_streak, s.habits_done]).toEqual([104_800, 303, 5_300]);
    expect(await balance(vera)).toBe(50_600);
  });

  it('un reinicio sin nada publicado no quita el margen del primer reclamo (importar en una cuenta nueva)', async () => {
    const wen = await db.user('wen@example.com', 2);
    await profile(wen, 'wen');
    expect(await reset(wen, '2026-10-20T10:00:00.000Z')).toMatchObject({ reset: true });
    await baseline(wen, 0, 0, 10_000_000);
    expect(await balance(wen)).toBe((2 + 1 + 365) * 200);
  });
});

describe('XP y monedas siempre enteros', () => {
  let sol: string;
  beforeAll(async () => {
    sol = await db.user('sol@example.com', 30);
    await profile(sol, 'sol');
    // El logro de prueba con premio (XP ≥ 1) movería el saldo de estas cuentas
    await db.as(admin, `update public.achievement_defs set active = false where id = 'prueba_premio'`);
  });
  const stats = async () => (await db.sql<{ baseline_xp: string; baseline_coins: string; xp_total: string }>(
    `select baseline_xp, baseline_coins, xp_total from public.profile_stats where user_id = $1`, [sol]))[0];

  it('el servidor redondea lo que llega del dispositivo y del creador', async () => {
    const t = await today();
    await baseline(sol, 0, 100.6, 50.4);
    expect(Number((await stats()).baseline_xp)).toBe(101);
    expect(Number((await stats()).baseline_coins)).toBe(50);
    expect(await balance(sol)).toBe(50);
    await publish(sol, [{ day: t, xp: 10.5, coins: 3.4, streak: 1 }]);
    const [d] = await db.sql<{ xp: string; coins: string }>(`select xp, coins from public.daily_stats where user_id = $1`, [sol]);
    expect([Number(d.xp), Number(d.coins)]).toEqual([11, 3]);
    await db.as(sol, `select public.sync_wallet($1::jsonb, $2::jsonb)`,
      [JSON.stringify([{ id: 's1', amount: 2.6, day: t }, { id: 's2', amount: 0.4, day: t }]), JSON.stringify([{ id: 'b1', amount: 1.4, day: t }])]);
    // 50 + 3 − 3 + 1 (el gasto de 0,4 se queda en 0 y no entra)
    expect(await balance(sol)).toBe(51);
    await db.as(admin, `select public.admin_adjust_coins($1, 2.5, 'Redondeo')`, [sol]);
    await db.as(admin, `select public.admin_adjust_xp($1, 1.4, 'Redondeo')`, [sol]);
    await fails(db.as(admin, `select public.admin_adjust_coins($1, 0.4, 'Nada')`, [sol]), /Cantidad no válida/);
    expect(await balance(sol)).toBe(54);
    // 101 + 11 + 1
    expect(Number((await stats()).xp_total)).toBe(113);
    const amounts = await db.sql<{ amount: string }>(`select amount from public.coin_ledger where user_id = $1`, [sol]);
    expect(amounts.every((a) => Number.isInteger(Number(a.amount)))).toBe(true);
  });

  it('al aplicar la migración se redondean los valores ya guardados', async () => {
    const t = await today();
    await db.sql(`insert into public.daily_stats (user_id, day, xp, coins) values ($1, $2::date - 1, 10.4, 2.5)`, [sol, t]);
    await db.sql(`insert into public.coin_ledger (user_id, amount, kind, ref) values ($1, 0.6, 'admin', 'decimales')`, [sol]);
    await db.sql(`select public.recompute_stats($1)`, [sol]);
    expect(Number((await stats()).xp_total)).toBe(123.4);
    await reapplySocialMigration(db);
    const [d] = await db.sql<{ xp: string; coins: string }>(`select xp, coins from public.daily_stats where user_id = $1 and day = $2::date - 1`, [sol, t]);
    expect([Number(d.xp), Number(d.coins)]).toEqual([10, 3]);
    expect(Number((await stats()).xp_total)).toBe(123);
    expect(await balance(sol)).toBe(55);
  });
});
