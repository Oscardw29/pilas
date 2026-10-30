import type { AchievementMetric, CatalogKind, NotificationRow, PostTemplate, Rarity, ReactionEmoji, ReportRow } from './types';

/**
 * TEXTOS DE LA CAPA PÚBLICA (un solo sitio para notificaciones, plantillas, ánimos, rarezas y ligas)
 */

export const LEAGUES = [
  { id: 1, slug: 'bronze', name: 'Bronce', color: '#cd7f32', icon: '🥉' },
  { id: 2, slug: 'silver', name: 'Plata', color: '#c0c7d1', icon: '🥈' },
  { id: 3, slug: 'gold', name: 'Oro', color: '#f5c542', icon: '🥇' },
  { id: 4, slug: 'platinum', name: 'Platino', color: '#7dd3fc', icon: '💠' },
  { id: 5, slug: 'diamond', name: 'Diamante', color: '#a78bfa', icon: '💎' },
] as const;

export const leagueName = (id: number | null | undefined) => LEAGUES.find((l) => l.id === id)?.name ?? 'Bronce';

export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'Común', color: '#9ca3af' },
  rare: { label: 'Rara', color: '#60a5fa' },
  epic: { label: 'Épica', color: '#a78bfa' },
  legendary: { label: 'Legendaria', color: '#f59e0b' },
};

export const KIND_LABEL: Record<CatalogKind, { one: string; many: string }> = {
  banner: { one: 'Banner', many: 'Banners' },
  frame: { one: 'Marco', many: 'Marcos' },
  card: { one: 'Tarjeta de ranking', many: 'Tarjetas de ranking' },
  reward: { one: 'Recompensa', many: 'Recompensas' },
};

export const REACTIONS: { id: ReactionEmoji; emoji: string; label: string }[] = [
  { id: 'fire', emoji: '🔥', label: 'Fuego' },
  { id: 'muscle', emoji: '💪', label: 'Fuerza' },
  { id: 'clap', emoji: '👏', label: 'Aplausos' },
];

export const REPORT_REASONS: { id: ReportRow['reason']; label: string }[] = [
  { id: 'spam', label: 'Spam o publicaciones repetidas' },
  { id: 'offensive', label: 'Contenido ofensivo' },
  { id: 'cheating', label: 'Hace trampas en el ranking' },
  { id: 'impersonation', label: 'Se hace pasar por otra persona' },
  { id: 'other', label: 'Otro motivo' },
];

/** Para la barra de progreso de cada logro */
export const METRIC_LABEL: Record<AchievementMetric, string> = {
  streak: 'días de racha (récord)',
  xp_total: 'XP en total',
  coins_spent: 'monedas gastadas',
  podium_1: 'semanas en 1.º lugar',
  podium_2: 'semanas en 2.º lugar',
  podium_3: 'semanas en 3.º lugar',
  promotions: 'ascensos de liga',
  league_max: 'liga más alta (5 = Diamante)',
  perfect_weeks: 'semanas perfectas',
  habits_done: 'hábitos cumplidos',
  friends: 'amigos',
  posts: 'publicaciones',
  cheers_sent: 'ánimos enviados',
  cosmetics: 'cosméticos comprados',
};

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0));

/** Texto de una publicación hecha desde plantilla (los datos los puso el servidor) */
export function postText(template: PostTemplate, data: Record<string, unknown>): { icon: string; text: string } {
  switch (template) {
    case 'streak':
      return { icon: '🔥', text: `Llegué a ${num(data.n)} días de racha` };
    case 'habit_streak':
      return { icon: '✅', text: `Completé ${String(data.icon ?? '')} ${String(data.habit ?? 'un hábito')} ${num(data.n)} días seguidos`.replace(/\s+/g, ' ') };
    case 'perfect_week':
      return { icon: '🏆', text: 'Semana perfecta: cumplí todos mis hábitos' };
    case 'xp_week':
      return { icon: '⚡', text: `Gané ${num(data.xp).toLocaleString('es')} XP esta semana` };
    case 'achievement':
      return { icon: String(data.icon ?? '🏅'), text: `Conseguí el logro «${String(data.name ?? '')}»` };
    case 'league_up':
      return { icon: '🛡️', text: `Subí a la liga ${String(data.league ?? '')}` };
    case 'podium':
      return { icon: num(data.position) === 1 ? '🥇' : num(data.position) === 2 ? '🥈' : '🥉', text: `Quedé ${num(data.position)}.º de la semana` };
    default:
      return { icon: '📣', text: 'Publicación' };
  }
}

/** Textos de los ánimos (el servidor elige la variante al azar) */
export const CHEER_TEXTS = [
  'te envía ánimos para que sigas con toda 💪',
  'cree en ti: ¡no sueltes la racha! 🔥',
  'te manda energía para el día de hoy ⚡',
  'dice: ¡vas muy bien, sigue así! 👏',
];

export function cheerText(data: Record<string, unknown>): string {
  if (data.kind === 'congrats') {
    if (data.reason === 'streak' || num(data.variant) === 1) return `celebra tu racha de ${num(data.n)} días contigo 🎉`;
    return 'te felicita por tu logro: ¡te lo ganaste! 🏆';
  }
  return CHEER_TEXTS[num(data.variant) % CHEER_TEXTS.length] ?? CHEER_TEXTS[0];
}

/** Notificación → icono, texto (el alias de quien la envía va aparte, en negrita) y enlace */
export function notificationText(n: NotificationRow): { icon: string; actor?: string; text: string; to?: string } {
  const d = n.data ?? {};
  const actor = n.actor?.alias ? `@${n.actor.alias}` : undefined;
  switch (n.kind) {
    case 'friend_request':
      return { icon: '🤝', actor, text: 'quiere ser tu amigo', to: '/amigos' };
    case 'friend_accepted':
      return { icon: '🤝', actor, text: 'aceptó tu solicitud de amistad', to: n.actor ? `/u/${n.actor.alias}` : '/amigos' };
    case 'friend_post': {
      const p = postText((d.template as PostTemplate) ?? 'streak', (d.data as Record<string, unknown>) ?? {});
      return { icon: p.icon, actor, text: `publicó: ${p.text}`, to: n.actor ? `/u/${n.actor.alias}` : undefined };
    }
    case 'cheer':
      return { icon: d.kind === 'congrats' ? '🎉' : '💪', actor, text: cheerText(d), to: n.actor ? `/u/${n.actor.alias}` : undefined };
    case 'achievement':
      return {
        icon: String(d.icon ?? '🏅'),
        text: `Conseguiste el logro «${String(d.name ?? '')}»${num(d.prize) > 0 ? ` (+${num(d.prize)} monedas)` : ''}`,
        to: '/logros',
      };
    case 'league_result': {
      const mv = num(d.movement);
      const move = mv > 0 ? ` Subes a ${leagueName(num(d.league) + 1)}.` : mv < 0 ? ` Bajas a ${leagueName(num(d.league) - 1)}.` : '';
      const prize = num(d.prize) > 0 ? ` Premio: ${num(d.prize)} monedas.` : '';
      return { icon: '🛡️', text: `Liga ${leagueName(num(d.league))}: quedaste ${num(d.position)}.º.${prize}${move}`, to: '/clasificaciones?tab=liga' };
    }
    case 'podium':
      return { icon: num(d.position) === 1 ? '🥇' : num(d.position) === 2 ? '🥈' : '🥉', text: `¡Quedaste ${num(d.position)}.º de la semana con ${Math.round(num(d.xp))} XP!`, to: '/clasificaciones' };
    case 'warning':
      return { icon: '⚠️', text: `Advertencia del equipo de ¡Pilas!: ${String(d.reason ?? '')}` };
    case 'ban':
      return { icon: '⛔', text: `Tu cuenta recibió un veto: ${String(d.reason ?? '')}` };
    case 'admin_coins':
      return { icon: '🪙', text: `${num(d.amount) > 0 ? 'Recibiste' : 'Se descontaron'} ${Math.abs(num(d.amount))} monedas: ${String(d.reason ?? '')}` };
    default:
      return { icon: '🔔', text: 'Tienes un aviso nuevo' };
  }
}

/** «hace 5 min», «ayer»… */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Alias válido: 3 a 20 letras minúsculas, números o «_» */
export const ALIAS_RE = /^[a-z0-9_]{3,20}$/;
export const normalizeAlias = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 20);
