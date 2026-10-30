/**
 * CAPA PÚBLICA — tipos de lo que devuelve el servidor (supabase/migrations/0002_social.sql).
 * Todo lo de aquí es legible por cualquier persona con sesión: nunca se mezcla con los datos cifrados.
 */

export type ProfileCard = 'streak' | 'xp_week' | 'member_since' | 'habits' | 'achievements';
export type CatalogKind = 'banner' | 'frame' | 'card' | 'reward';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CatalogStatus = 'draft' | 'published' | 'retired';
export type ReactionEmoji = 'fire' | 'muscle' | 'clap';
export type PostTemplate = 'streak' | 'habit_streak' | 'perfect_week' | 'xp_week' | 'achievement' | 'league_up' | 'podium';
export type LeaderboardKind = 'streak' | 'xp_week' | 'xp_total';
/** Colores del banner por defecto (sin cosmético). La paleta está en texts.ts (BANNER_COLORS) */
export type BannerColor = 'violet' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'rose' | 'slate';

export interface ProfileRow {
  user_id: string;
  /** Opcional: sin alias se muestra el nombre (display_name) */
  alias: string | null;
  /** Nombre visible (el de la bienvenida / Ajustes) */
  display_name: string;
  /** Biografía corta (≤ 160) */
  bio: string;
  /** Color del banner por defecto (null = violeta) */
  banner_color: BannerColor | null;
  /** Ruta en Storage o `default:N` (foto por defecto, ver lib/defaultAvatars.ts) */
  avatar_path: string | null;
  banner_item: string | null;
  frame_item: string | null;
  card_item: string | null;
  cards: ProfileCard[];
  featured_achievements: string[];
  member_since: string;
}

export interface Ban {
  reason: string;
  starts_at: string;
  /** null = permanente */
  ends_at: string | null;
}

export interface MyStatus {
  is_admin: boolean;
  ban: Ban | null;
  profile: ProfileRow | null;
  baseline_at: string | null;
  balance: number;
  unread: number;
}

export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  name: string;
  description: string | null;
  price: number;
  rarity: Rarity;
  animated: boolean;
  asset_path: string | null;
  thumb_path: string | null;
  icon: string | null;
  status: CatalogStatus;
  sort: number;
  sample_key: string | null;
  created_at?: string;
}

/** Un cosmético equipado tal como lo devuelven las lecturas públicas */
export interface Cosmetic {
  path: string | null;
  thumb: string | null;
  animated: boolean;
}

/** Lo mínimo para dibujar a alguien (avatar + marco) */
export interface Person {
  user_id: string;
  alias: string | null;
  display_name?: string | null;
  avatar_path: string | null;
  frame_path?: string | null;
  frame_thumb?: string | null;
  frame_animated?: boolean | null;
}

export interface LeaderRow extends Person {
  rank: number;
  member_since: string;
  banner_path: string | null;
  banner_thumb: string | null;
  banner_animated: boolean | null;
  card_path: string | null;
  card_thumb: string | null;
  card_animated: boolean | null;
  current_streak?: number;
  best_streak?: number;
  xp?: number;
  completion?: number | null;
}

export interface PodiumEntry extends Person {
  pos: number;
  xp: number;
}

export interface LeagueMember extends Person {
  card_path: string | null;
  card_thumb: string | null;
  card_animated: boolean | null;
  xp: number;
  completion: number | null;
}

export interface LeagueStandings {
  member: boolean;
  league?: number;
  league_name?: string;
  group?: number;
  week_start?: string;
  ends_at?: string;
  ranked?: number;
  /** Los primeros `promote` suben, los `stay` siguientes se quedan y el resto (`demote`) baja */
  promote?: number;
  stay?: number;
  demote?: number;
  /** Solo hay una persona en el grupo: no sube ni baja y gana el premio de participación */
  solo?: boolean;
  solo_prize?: number;
  /** Premios del 1.º, 2.º, 3.º y 4.º–10.º */
  prizes?: number[] | null;
  members?: LeagueMember[];
}

export interface PublicHabit {
  key: string;
  name: string;
  icon: string;
  kind: 'time' | 'action' | 'quantity';
  unit: string | null;
  target: number | null;
  days: Record<string, { s: 'full' | 'minimum' | 'missed' | 'partial'; m?: number; q?: number }>;
}

export interface FeaturedAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  achieved_at: string;
}

export interface CheerInfo {
  kind: 'cheer' | 'congrats';
  reason: 'achievement' | 'podium' | 'league_up' | 'streak' | null;
  n?: number;
  name?: string;
  sent_today: boolean;
}

export interface PublicProfile {
  user_id: string;
  alias: string | null;
  display_name: string;
  bio: string;
  banner_color: BannerColor | null;
  /** «Me gusta» que ha recibido el perfil y si ya le diste el tuyo */
  likes: number;
  liked_by_me: boolean;
  avatar_path: string | null;
  member_since: string;
  cards: ProfileCard[];
  is_me: boolean;
  suspended: boolean;
  banner: (Cosmetic & { id: string }) | null;
  frame: (Cosmetic & { id: string }) | null;
  card: (Cosmetic & { id: string }) | null;
  stats: {
    current_streak: number;
    best_streak: number;
    xp_total: number;
    week_start: string;
    week: { day: string; xp: number; completion: number | null }[];
    league: string | null;
  };
  /** Primera semana con datos (lunes): hasta ahí se puede retroceder */
  first_week: string;
  habits: PublicHabit[];
  achievements: FeaturedAchievement[];
  friendship: { status: 'pending' | 'accepted'; outgoing: boolean } | null;
  i_blocked: boolean;
  cheer: CheerInfo | null;
}

export interface FriendEntry extends Person {
  streak?: number;
  since?: string;
  at?: string;
}

export interface MyFriends {
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
  blocked: { user_id: string; alias: string | null; display_name?: string | null }[];
}

export interface Post extends Person {
  id: string;
  template: PostTemplate;
  data: Record<string, unknown>;
  comment: string | null;
  created_at: string;
  /** Si se editó el comentario */
  edited_at: string | null;
  reactions: Record<ReactionEmoji, number>;
  mine: ReactionEmoji[];
}

export interface TemplateOption {
  template: PostTemplate;
  ref: string | null;
  data: Record<string, unknown>;
}

export interface NotificationRow {
  id: number;
  kind:
    | 'friend_request'
    | 'friend_accepted'
    | 'friend_post'
    | 'cheer'
    | 'achievement'
    | 'league_result'
    | 'podium'
    | 'warning'
    | 'ban'
    | 'admin_coins'
    | 'profile_like'
    | string;
  actor_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  /** Se completa en el cliente con el perfil de quien la generó */
  actor?: Person | null;
}

export type AchievementMetric =
  | 'streak' | 'xp_total' | 'coins_spent' | 'podium_1' | 'podium_2' | 'podium_3' | 'promotions' | 'league_max'
  | 'perfect_weeks' | 'habits_done' | 'friends' | 'posts' | 'cheers_sent' | 'cosmetics';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  metric: AchievementMetric;
  threshold: number;
  prize: number;
  active: boolean;
  sort: number;
}

export interface LedgerEntry {
  id: number;
  amount: number;
  kind: 'purchase' | 'league' | 'achievement' | 'admin';
  ref: string;
  note: string | null;
  created_at: string;
}

export interface EconomyVersion {
  version: number;
  params: Record<string, unknown>;
  status?: 'draft' | 'published';
  effective_from: string | null;
  note?: string | null;
  created_at?: string;
  published_at?: string | null;
}

export interface ReportRow {
  id: number;
  reporter: string | null;
  target_user: string;
  post_id: string | null;
  reason: 'spam' | 'offensive' | 'cheating' | 'impersonation' | 'other';
  details: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: string;
}

export interface ModerationAction {
  id: number;
  admin_id: string | null;
  target_user: string | null;
  action: string;
  reason: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface AdminUserOverview {
  profile: ProfileRow;
  stats: Record<string, unknown> | null;
  balance: number;
  current_streak: number;
  banned: boolean;
  bans: (Ban & { id: number; lifted_at: string | null })[];
  warnings: { id: number; reason: string; created_at: string }[];
}

/** Una semana del perfil de alguien (para recorrer sus semanas) */
export interface ProfileWeek {
  week_start: string;
  week: { day: string; xp: number; completion: number | null }[];
  /** null si la persona no muestra la tarjeta de hábitos; los días solo llegan para las últimas 8 semanas */
  habits: PublicHabit[] | null;
}

/** Una fila de `publish_days` */
export interface DayRow {
  day: string;
  xp: number;
  coins: number;
  completion: number | null;
  done: number;
  scheduled: number;
  perfect: boolean;
  streak: number;
  boosted: boolean;
}
