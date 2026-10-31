import { isSupabaseConfigured, supabase } from '@/sync/supabase';
import { defaultAvatarSrc, parseDefaultAvatarPath } from '@/lib/defaultAvatars';
import type {
  AchievementDef, AdminAccount, AdminAiService, AdminUserOverview, CatalogItem, DayRow, EconomyVersion, LeaderRow, LeaderboardKind, LeagueStandings,
  LedgerEntry, ModerationAction, MyFriends, MyStatus, NotificationRow, Person, PodiumEntry, Post, ProfileRow,
  ProfileWeek, PublicProfile, ReactionEmoji, ReportRow, TemplateOption,
} from './types';

/**
 * CAPA PÚBLICA — llamadas al servidor
 * Todas pasan por las políticas RLS y las funciones de 0002_social.sql: aquí no se decide ningún permiso.
 * Los errores del servidor ya vienen en español; se quita el prefijo técnico del veto.
 */

export class SocialError extends Error {
  /** La cuenta tiene un veto activo */
  readonly banned: boolean;
  /** Código de Postgres (p. ej. `54000` = se alcanzó un límite diario), si lo hay */
  readonly code?: string;
  constructor(message: string, code?: string) {
    const banned = message.startsWith('VETO:');
    super(banned ? message.slice(5).trim().replace(/^./, (c) => c.toUpperCase()) : message);
    this.banned = banned;
    this.code = code;
  }
}

const fail = (error: { message: string; code?: string } | null) => {
  if (!error) return;
  const msg = error.message || 'Error del servidor';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) throw new SocialError('Sin conexión con el servidor');
  throw new SocialError(msg, typeof error.code === 'string' ? error.code : undefined);
};

const sb = () => supabase();

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args ?? {});
  fail(error);
  return data as T;
}

export const socialAvailable = () => isSupabaseConfigured;

/* ---------------- Archivos ---------------- */

const STORAGE_BASE = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''}/storage/v1/object/public`;

/**
 * URL pública de un archivo de Storage (los buckets `avatars` y `catalog` son de lectura pública).
 * `default:N` es una de las fotos por defecto: se dibuja en el dispositivo, no se descarga.
 */
export const assetUrl = (bucket: 'avatars' | 'catalog', path: string | null | undefined) => {
  if (!path) return undefined;
  const preset = parseDefaultAvatarPath(path);
  if (preset) return defaultAvatarSrc(preset);
  return /^(data:|blob:|https?:)/.test(path) ? path : `${STORAGE_BASE}/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
};

const rand = () => Math.random().toString(36).slice(2, 10);

/** Sube la foto de perfil (WebP) con un nombre nuevo: así la caché del dispositivo nunca muestra una vieja */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const path = `${userId}/avatar-${Date.now().toString(36)}-${rand()}.webp`;
  const { error } = await sb().storage.from('avatars').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  fail(error);
  return path;
}

export async function removeAvatarFiles(paths: string[]) {
  if (!paths.length) return;
  const { error } = await sb().storage.from('avatars').remove(paths);
  fail(error);
}

/** Creador: sube un archivo del catálogo (WebP) */
export async function uploadCatalogFile(folder: string, blob: Blob): Promise<string> {
  const path = `${folder}/${Date.now().toString(36)}-${rand()}.webp`;
  const { error } = await sb().storage.from('catalog').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  fail(error);
  return path;
}

export async function removeCatalogFiles(paths: string[]) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await sb().storage.from('catalog').remove(list);
  fail(error);
}

/* ---------------- Estado y perfil propio ---------------- */

export const getStatus = () => rpc<MyStatus | null>('my_status');

/** Todo perfil es público: se crea solo al entrar con el nombre, el alias (opcional) y la foto de la bienvenida */
export async function createProfile(
  userId: string,
  init: { display_name: string; alias?: string | null; avatar_path?: string | null },
): Promise<ProfileRow> {
  const { data, error } = await sb()
    .from('profiles')
    .insert({ user_id: userId, display_name: init.display_name.trim().slice(0, 40), alias: init.alias || null, avatar_path: init.avatar_path ?? null })
    .select()
    .single();
  fail(error);
  return data as ProfileRow;
}

export type ProfilePatch = Partial<
  Pick<
    ProfileRow,
    'alias' | 'display_name' | 'bio' | 'banner_color' | 'avatar_path' | 'banner_item' | 'frame_item' | 'card_item' | 'cards' | 'featured_achievements'
  >
>;

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow> {
  const { data, error } = await sb().from('profiles').update(patch).eq('user_id', userId).select().single();
  fail(error);
  return data as ProfileRow;
}

/** Dejar de tener perfil público (las cifras y compras se conservan por si vuelve) */
export async function deleteProfile(userId: string) {
  const { error } = await sb().from('profiles').delete().eq('user_id', userId);
  fail(error);
}

export async function aliasTaken(alias: string): Promise<boolean> {
  const { data, error } = await sb().from('profiles').select('user_id').eq('alias', alias.toLowerCase()).maybeSingle();
  fail(error);
  return Boolean(data);
}

/**
 * Borra lo publicado a partir de los datos del dispositivo (días, hábitos visibles, logros, saldo de partida y
 * movimientos del dispositivo) para volver a calcularlo. Se usa cuando los datos cambian por completo (empezar de cero,
 * quitar la demostración, importar una copia). Las compras, premios de liga y ajustes del creador se conservan.
 * `resetAt` es el `settings.dataResetAt` de ese cambio: el servidor lo atiende una sola vez aunque llegue desde varios
 * dispositivos (`reset: false` si ya se atendió ese cambio o uno posterior). Más de 10 al día → error `54000`.
 */
export const resetMyProgress = (resetAt?: string) =>
  rpc<{ reset: boolean; balance?: number }>('reset_my_progress', { p_reset_at: resetAt ?? null });

/* ---------------- Publicar el día y el saldo ---------------- */

export const claimBaseline = (b: { streak: number; best: number; xp: number; coins: number; done: number }) =>
  rpc<{ claimed: boolean; balance?: number }>('claim_baseline', { p_streak: b.streak, p_best: b.best, p_xp: b.xp, p_coins: b.coins, p_done: b.done });

export const publishDays = (rows: DayRow[]) => rpc<{ written: number; balance: number }>('publish_days', { rows });

export interface WalletMove {
  id: string;
  amount: number;
  note?: string;
  day: string;
}

export const syncWallet = (spends: WalletMove[], bonuses: WalletMove[]) => rpc<{ balance: number }>('sync_wallet', { spends, bonuses });

export const myLedger = (afterId: number) => rpc<LedgerEntry[]>('my_ledger', { after_id: afterId });

/** `price`: lo que cobró el servidor (puede diferir del catálogo guardado en el dispositivo) */
export const purchaseItem = (itemId: string) => rpc<{ ledger_id: number; price: number; balance: number }>('purchase_item', { p_item: itemId });

export const purchaseBoost = () =>
  rpc<{ id: string; started_at: string; ends_at: string; price: number; ledger_id: number; balance: number }>('purchase_boost');

export async function upsertPublicHabits(rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const { error } = await sb().from('public_habits').upsert(rows, { onConflict: 'user_id,habit_key' });
  fail(error);
}

export async function deletePublicHabits(userId: string, keys: string[]) {
  if (!keys.length) return;
  const { error } = await sb().from('public_habits').delete().eq('user_id', userId).in('habit_key', keys);
  fail(error);
}

export async function myPublicHabitKeys(userId: string): Promise<string[]> {
  const { data, error } = await sb().from('public_habits').select('habit_key').eq('user_id', userId);
  fail(error);
  return (data ?? []).map((r) => (r as { habit_key: string }).habit_key);
}

/* ---------------- Tienda ---------------- */

export async function getCatalog(): Promise<CatalogItem[]> {
  const { data, error } = await sb().from('catalog_items').select('*').order('sort').order('created_at');
  fail(error);
  return (data ?? []) as CatalogItem[];
}

export async function getInventory(userId: string): Promise<string[]> {
  const { data, error } = await sb().from('inventory').select('item_id').eq('user_id', userId);
  fail(error);
  return (data ?? []).map((r) => (r as { item_id: string }).item_id);
}

export async function getEconomyVersions(): Promise<{ from: string; params: Record<string, unknown> }[]> {
  const rows = await rpc<EconomyVersion[]>('economy_versions');
  return (rows ?? []).map((v) => ({ from: v.effective_from ?? '2000-01-01T00:00:00Z', params: v.params }));
}

/* ---------------- Clasificaciones ---------------- */

const LEADERBOARD_VIEW: Record<LeaderboardKind, string> = {
  streak: 'leaderboard_streak',
  xp_week: 'leaderboard_xp_week',
  xp_total: 'leaderboard_xp_total',
};

export async function getLeaderboard(kind: LeaderboardKind, offset = 0, limit = 50): Promise<LeaderRow[]> {
  const { data, error } = await sb()
    .from(LEADERBOARD_VIEW[kind])
    .select('*')
    .order('rank')
    // El puesto tiene empates y el alias puede faltar: el id da un orden total para que las páginas no se pisen
    .order('user_id')
    .range(offset, offset + limit - 1);
  fail(error);
  return (data ?? []) as LeaderRow[];
}

export async function getMyRank(kind: LeaderboardKind, userId: string): Promise<LeaderRow | null> {
  const { data, error } = await sb().from(LEADERBOARD_VIEW[kind]).select('*').eq('user_id', userId).maybeSingle();
  fail(error);
  return (data as LeaderRow) ?? null;
}

export const getPodium = (weekStart: string) => rpc<PodiumEntry[]>('podium', { p_week: weekStart });

export const getLeagueStandings = () => rpc<LeagueStandings>('league_standings');

/* ---------------- Perfiles públicos ---------------- */

/** `handle` = el alias o, si la persona no tiene alias, su id */
export const getPublicProfile = (handle: string) => rpc<PublicProfile | null>('public_profile', { p_alias: handle });

/** Una semana concreta del perfil de alguien (XP por día y, si los muestra, sus hábitos visibles) */
export const getProfileWeek = (userId: string, weekStart: string) =>
  rpc<ProfileWeek | null>('profile_week', { p_user: userId, p_week: weekStart });

/** Da o quita tu «me gusta» a un perfil */
export const toggleProfileLike = (userId: string) => rpc<{ liked: boolean; likes: number }>('toggle_profile_like', { p_user: userId });

/** Busca por alias (empieza por) o por nombre (contiene) */
export async function searchProfiles(q: string, limit = 20): Promise<Person[]> {
  // Solo letras, números, espacios y guion bajo: las comas y paréntesis romperían el filtro `or`
  const term = q.trim().toLowerCase().replace(/[^\p{L}\p{N}_ ]/gu, '').replace(/\s+/g, ' ');
  if (term.length < 2) return [];
  // `_` es comodín en LIKE: se escapa para buscar el guion bajo literal
  const like = term.replace(/_/g, '\\_');
  const { data, error } = await sb()
    .from('public_profiles')
    .select('user_id, alias, display_name, avatar_path, frame_path, frame_thumb, frame_animated')
    .or(`alias.ilike.${like}%,display_name.ilike.%${like}%`)
    .order('alias', { nullsFirst: false })
    .limit(limit);
  fail(error);
  return (data ?? []) as Person[];
}

/** Perfiles por id (para las notificaciones) */
export async function getPeople(ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await sb()
    .from('public_profiles')
    .select('user_id, alias, display_name, avatar_path, frame_path, frame_thumb, frame_animated')
    .in('user_id', unique);
  fail(error);
  return (data ?? []) as Person[];
}

/** Para el creador: perfiles por id aunque tengan un veto activo (la vista pública los oculta) */
async function getPeopleForAdmin(ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await sb()
    .from('profiles')
    .select('user_id, alias, display_name, avatar_path, frame:catalog_items!profiles_frame_item_fkey(asset_path, thumb_path, animated)')
    .in('user_id', unique);
  fail(error);
  type Row = {
    user_id: string;
    alias: string | null;
    display_name: string | null;
    avatar_path: string | null;
    frame: { asset_path: string | null; thumb_path: string | null; animated: boolean } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    user_id: r.user_id,
    alias: r.alias,
    display_name: r.display_name,
    avatar_path: r.avatar_path,
    frame_path: r.frame?.asset_path ?? null,
    frame_thumb: r.frame?.thumb_path ?? null,
    frame_animated: r.frame?.animated ?? null,
  }));
}

/* ---------------- Amigos y bloqueos ---------------- */

export const getMyFriends = () => rpc<MyFriends>('my_friends');
export const sendFriendRequest = (userId: string) => rpc<'pending' | 'accepted'>('send_friend_request', { p_user: userId });
export const respondFriendRequest = (userId: string, accept: boolean) => rpc<void>('respond_friend_request', { p_user: userId, p_accept: accept });
export const removeFriend = (userId: string) => rpc<void>('remove_friend', { p_user: userId });

export async function blockUser(userId: string) {
  const { error } = await sb().from('blocks').insert({ blocked: userId });
  if (error && !/duplicate/i.test(error.message)) fail(error);
}

export async function unblockUser(me: string, userId: string) {
  const { error } = await sb().from('blocks').delete().eq('blocker', me).eq('blocked', userId);
  fail(error);
}

/* ---------------- Publicaciones y reacciones ---------------- */

export const getPostTemplates = () => rpc<TemplateOption[]>('available_post_templates');
export const createPost = (template: string, ref: string | null, comment: string | null) =>
  rpc<string>('create_post', { p_template: template, p_ref: ref, p_comment: comment });
export const getFeed = (userId: string | null, before?: string) =>
  rpc<Post[]>('post_feed', { p_user: userId, p_before: before ?? null, p_limit: 20 });

/** Cambia el comentario de una publicación propia (queda marcada como editada) */
export const editPost = (postId: string, comment: string | null) => rpc<void>('edit_post', { p_post: postId, p_comment: comment });

export async function deletePost(postId: string, asAdmin = false, reason = '') {
  if (asAdmin) return rpc<void>('admin_delete_post', { p_post: postId, p_reason: reason || 'Contenido no permitido' });
  const { error } = await sb().from('posts').delete().eq('id', postId);
  fail(error);
}

export async function setReaction(postId: string, userId: string, emoji: ReactionEmoji, on: boolean) {
  if (on) {
    const { error } = await sb().from('post_reactions').insert({ post_id: postId, emoji });
    if (error && !/duplicate/i.test(error.message)) fail(error);
  } else {
    const { error } = await sb().from('post_reactions').delete().eq('post_id', postId).eq('user_id', userId).eq('emoji', emoji);
    fail(error);
  }
}

export async function report(targetUser: string, reason: ReportRow['reason'], details: string, postId?: string | null) {
  const { error } = await sb().from('reports').insert({ target_user: targetUser, reason, details: details.trim() || null, post_id: postId ?? null });
  fail(error);
}

/* ---------------- Ánimos ---------------- */

export const sendCheer = (userId: string) => rpc<{ kind: 'cheer' | 'congrats'; variant: number }>('send_cheer', { p_user: userId });

/* ---------------- Notificaciones ---------------- */

export async function getNotifications(limit = 40): Promise<NotificationRow[]> {
  const { data, error } = await sb().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  fail(error);
  const rows = (data ?? []) as NotificationRow[];
  const people = new Map((await getPeople(rows.map((r) => r.actor_id ?? ''))).map((p) => [p.user_id, p]));
  return rows.map((r) => ({ ...r, actor: r.actor_id ? (people.get(r.actor_id) ?? null) : null }));
}

export const markNotificationsRead = (ids?: number[]) => rpc<void>('mark_notifications_read', { ids: ids ?? null });

/** Avisos en tiempo real (Supabase Realtime). Devuelve la función para dejar de escuchar */
export function subscribeNotifications(userId: string, onInsert: (n: NotificationRow) => void): () => void {
  const channel = sb()
    // Nombre único: al parar y volver a arrancar rápido, el canal anterior aún se está cerrando
    .channel(`notifications:${userId}:${rand()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) =>
      onInsert(payload.new as NotificationRow),
    )
    .subscribe();
  return () => {
    void sb().removeChannel(channel);
  };
}

/* ---------------- Logros ---------------- */

export async function getAchievementDefs(): Promise<AchievementDef[]> {
  const { data, error } = await sb().from('achievement_defs').select('*').order('sort').order('id');
  fail(error);
  return (data ?? []) as AchievementDef[];
}

export async function getUserAchievements(userId: string): Promise<{ achievement_id: string; achieved_at: string }[]> {
  const { data, error } = await sb().from('user_achievements').select('achievement_id, achieved_at').eq('user_id', userId);
  fail(error);
  return (data ?? []) as { achievement_id: string; achieved_at: string }[];
}

export async function getAchievementRates(): Promise<Map<string, number>> {
  const rows = await rpc<{ achievement_id: string; pct: number }[]>('achievement_rates');
  return new Map((rows ?? []).map((r) => [r.achievement_id, Number(r.pct)]));
}

export const getAchievementProgress = () => rpc<Record<string, number> | null>('my_achievement_progress');

/* ---------------- Panel del creador ---------------- */

export async function adminSaveItem(item: Partial<CatalogItem> & { id?: string }): Promise<CatalogItem> {
  const { id, created_at: _c, ...fields } = item as CatalogItem & { updated_at?: string };
  delete (fields as { updated_at?: string }).updated_at;
  const q = id ? sb().from('catalog_items').update(fields).eq('id', id) : sb().from('catalog_items').insert(fields);
  const { data, error } = await q.select().single();
  fail(error);
  return data as CatalogItem;
}

export async function adminDeleteItem(id: string) {
  const { error } = await sb().from('catalog_items').delete().eq('id', id);
  if (error && /foreign key|violates/i.test(error.message)) {
    throw new SocialError('Alguien ya compró este artículo: retíralo en lugar de borrarlo (deja de venderse y quien lo tiene lo conserva).');
  }
  fail(error);
}

export async function adminSaveAchievement(def: AchievementDef, isNew: boolean): Promise<void> {
  const { error } = isNew
    ? await sb().from('achievement_defs').insert(def)
    : await sb().from('achievement_defs').update({ ...def, id: undefined }).eq('id', def.id);
  fail(error);
}

export async function adminDeleteAchievement(id: string) {
  const { error } = await sb().from('achievement_defs').delete().eq('id', id);
  fail(error);
}

export async function adminEconomyVersions(): Promise<EconomyVersion[]> {
  const { data, error } = await sb().from('economy_config').select('*').order('version', { ascending: false });
  fail(error);
  return (data ?? []) as EconomyVersion[];
}

export async function adminSaveEconomyDraft(params: Record<string, unknown>, note: string, version?: number): Promise<EconomyVersion> {
  const q = version
    ? sb().from('economy_config').update({ params, note }).eq('version', version)
    : sb().from('economy_config').insert({ params, note });
  const { data, error } = await q.select().single();
  fail(error);
  return data as EconomyVersion;
}

export async function adminDeleteEconomyDraft(version: number) {
  const { error } = await sb().from('economy_config').delete().eq('version', version);
  fail(error);
}

export const adminPublishEconomy = (version: number, effectiveFrom: string | null) =>
  rpc<void>('admin_publish_economy', { p_version: version, p_effective_from: effectiveFrom });
export const adminRevertEconomy = (version: number) => rpc<number>('admin_revert_economy', { p_version: version });
/** Creador: marcarse o desmarcarse un logro (solo en su propia cuenta, sin premio ni notificación) */
export const adminSetMyAchievement = (achievementId: string, on: boolean) =>
  rpc<void>('admin_set_achievement', { p_achievement: achievementId, p_on: on });
export const adminCloseWeek = (weekStart: string) => rpc<Record<string, unknown>>('admin_close_week', { p_week: weekStart });
export const adminAccounts = () => rpc<AdminAccount[]>('admin_accounts');

/** Elimina la cuenta de otra persona. Sus fotos van antes: Storage no las borra en cascada (si falla, se sigue igual) */
export async function adminDeleteAccount(userId: string, reason: string) {
  try {
    const { data } = await sb().storage.from('avatars').list(userId, { limit: 100 });
    if (data?.length) await removeAvatarFiles(data.map((f) => `${userId}/${f.name}`));
  } catch {
    /* sin conexión con Storage */
  }
  await rpc<void>('admin_delete_account', { p_user: userId, p_reason: reason });
}

export const adminUser = (alias: string) => rpc<AdminUserOverview | null>('admin_user', { p_alias: alias });
export const adminClearAvatar = (userId: string, reason: string) => rpc<void>('admin_clear_avatar', { p_user: userId, p_reason: reason });
export const adminClearBanner = (userId: string, reason: string) => rpc<void>('admin_clear_banner', { p_user: userId, p_reason: reason });
export const adminWarn = (userId: string, reason: string) => rpc<void>('admin_warn', { p_user: userId, p_reason: reason });
export const adminBan = (userId: string, reason: string, days: number | null) => rpc<void>('admin_ban', { p_user: userId, p_reason: reason, p_days: days });
export const adminUnban = (userId: string, reason: string) => rpc<void>('admin_unban', { p_user: userId, p_reason: reason });
export const adminAdjustCoins = (userId: string, amount: number, reason: string) =>
  rpc<number>('admin_adjust_coins', { p_user: userId, p_amount: amount, p_reason: reason });
export const adminAdjustXp = (userId: string, amount: number, reason: string) =>
  rpc<number>('admin_adjust_xp', { p_user: userId, p_amount: amount, p_reason: reason });
export const adminResolveReport = (id: number, status: ReportRow['status']) => rpc<void>('admin_resolve_report', { p_id: id, p_status: status });

export async function adminReports(status: ReportRow['status'] | 'all' = 'open'): Promise<(ReportRow & { target?: Person | null; reporterPerson?: Person | null })[]> {
  let q = sb().from('reports').select('*').order('created_at', { ascending: false }).limit(100);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  fail(error);
  const rows = (data ?? []) as ReportRow[];
  const people = new Map((await getPeopleForAdmin(rows.flatMap((r) => [r.target_user, r.reporter ?? '']))).map((p) => [p.user_id, p]));
  return rows.map((r) => ({ ...r, target: people.get(r.target_user) ?? null, reporterPerson: r.reporter ? (people.get(r.reporter) ?? null) : null }));
}

export async function adminActions(limit = 100): Promise<(ModerationAction & { target?: Person | null })[]> {
  const { data, error } = await sb().from('moderation_actions').select('*').order('created_at', { ascending: false }).limit(limit);
  fail(error);
  const rows = (data ?? []) as ModerationAction[];
  const people = new Map((await getPeopleForAdmin(rows.map((r) => r.target_user ?? ''))).map((p) => [p.user_id, p]));
  return rows.map((r) => ({ ...r, target: r.target_user ? (people.get(r.target_user) ?? null) : null }));
}

/** Resumen de los últimos cierres (razón monedas ganadas / gastadas) */
export async function adminClosures(limit = 8): Promise<{ week_start: string; closed_at: string; forced: boolean; summary: Record<string, number> | null }[]> {
  const { data, error } = await sb().from('week_closures').select('*').order('week_start', { ascending: false }).limit(limit);
  fail(error);
  return (data ?? []) as { week_start: string; closed_at: string; forced: boolean; summary: Record<string, number> | null }[];
}

/* ---------------- IA de la app (panel del creador) ---------------- */

export const adminAiServices = () => rpc<AdminAiService[]>('admin_ai_services');

export const adminSetAiService = (v: {
  service: string;
  provider: string;
  /** Vacía: se conserva la guardada */
  apiKey: string;
  model: string;
  backupModel: string;
  voice: string;
  dailyLimit: number;
}) =>
  rpc<void>('admin_set_ai_service', {
    p_service: v.service,
    p_provider: v.provider,
    p_api_key: v.apiKey,
    p_model: v.model,
    p_backup_model: v.backupModel,
    p_voice: v.voice,
    p_daily_limit: v.dailyLimit,
  });

export const adminClearAiService = (service: string) => rpc<void>('admin_clear_ai_service', { p_service: service });
