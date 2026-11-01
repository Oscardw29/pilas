import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Pencil, RotateCcw } from 'lucide-react';
import { ProfileBanner } from '@/components/social/Identity';
import { PostCard, useSocialFail } from '@/components/social/PostCard';
import { PublicHabitsTable } from '@/components/social/PublicHabitsTable';
import { WeekXpBars } from '@/components/social/WeekXpBars';
import { Modal } from '@/components/ui/Modal';
import { addDaysKey, formatRange, fromKey, startOfWeekKey } from '@/lib/dates';
import { levelFromXp } from '@/lib/metrics';
import { getFeed, getProfileWeek } from '@/social/api';
import { RARITY } from '@/social/texts';
import type { BannerColor, Cosmetic, FeaturedAchievement, Post, ProfileWeek as ProfileWeekData, PublicHabit } from '@/social/types';
import { Avatar } from './Avatar';
import './profile.css';

/**
 * PRESENTACIÓN DEL PERFIL (la misma en «Mi perfil» y en /u/:alias)
 * Así la página propia se ve exactamente como la ven los demás: cabecera con banner, foto, nombre, biografía y
 * «me gusta»; cifras (nivel, racha y racha más alta); logros destacados; la semana (XP y hábitos visibles) con
 * flechas para recorrerla; y las publicaciones. Quien la usa decide de dónde salen los datos (servidor o dispositivo).
 */

/** Hábitos: el servidor solo guarda los días de las últimas 8 semanas */
export const HABIT_WEEKS = 8;

/** «2026-10-01» o un ISO → fecha local (sin el desfase de un día que da `new Date('2026-10-01')`) */
export const toDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fromKey(s) : new Date(s));
export const longDay = (s: string) => toDate(s).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

const days = (n: number) => `${n.toLocaleString('es')} ${n === 1 ? 'día' : 'días'}`;

/* ---------------- Cabecera ---------------- */

export interface HeroLikes {
  count: number;
  liked: boolean;
  /** Sin `onToggle` solo se muestra el número (tu propio perfil) */
  onToggle?: () => void;
  disabled?: boolean;
}

const LikeCounter: React.FC<HeroLikes> = ({ count, liked, onToggle, disabled }) => {
  const n = Math.max(0, Math.round(count)).toLocaleString('es');
  if (!onToggle) {
    return (
      <span className="ph-likes" title={`${n} me gusta`}>
        <Heart aria-hidden="true" />
        <span aria-hidden="true">{n}</span>
        <span className="ph-sr">{n} me gusta</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`ph-likes is-button ${liked ? 'is-liked' : ''}`}
      aria-pressed={liked}
      aria-label={liked ? `Quitar tu me gusta (${n} en total)` : `Dar me gusta (${n} en total)`}
      title={liked ? 'Quitar tu me gusta' : 'Me gusta'}
      onClick={onToggle}
      disabled={disabled}
    >
      {/* La clave vuelve a lanzar la animación al cambiar */}
      <Heart key={liked ? 'on' : 'off'} className={liked ? 'is-pop' : undefined} aria-hidden="true" />
      <span>{n}</span>
    </button>
  );
};

/** Capa «Editar» sobre la foto o el banner (solo en tu perfil). Con ratón aparece al pasar; en táctil, un lápiz fijo */
const EditOverlay: React.FC<{ label: string; onClick: () => void; round?: boolean }> = ({ label, onClick, round }) => (
  <button type="button" className={`ph-edit ${round ? 'is-round' : 'is-banner'}`} onClick={onClick} aria-label={label}>
    <span className="ph-edit-inner" aria-hidden="true">
      <Pencil />
      <span>Editar</span>
    </span>
    <span className="ph-edit-badge" aria-hidden="true">
      <Pencil />
    </span>
  </button>
);

export const ProfileHero: React.FC<{
  /** Nombre accesible de la sección */
  label: string;
  /** Lo que se ve como nombre: el alias (sin «@») o, sin alias, el nombre (personName) */
  name: string;
  /** Sustituye al nombre (modo edición: el alias se escribe en su sitio) */
  nameEditor?: React.ReactNode;
  bio?: string | null;
  avatarSrc?: string;
  avatarSize?: number;
  frame?: Cosmetic | null;
  banner?: Cosmetic | null;
  bannerColor?: BannerColor | null;
  likes?: HeroLikes | null;
  /** Insignias bajo el nombre (liga, nivel, miembro desde…) */
  meta?: React.ReactNode;
  /** Botones junto a la foto (en móvil, debajo del nombre) */
  actions?: React.ReactNode;
  onEditAvatar?: () => void;
  onEditBanner?: () => void;
  /** Avisos bajo la cabecera */
  children?: React.ReactNode;
  className?: string;
}> = ({ label, name, nameEditor, bio, avatarSrc, avatarSize = 96, frame, banner, bannerColor, likes, meta, actions, onEditAvatar, onEditBanner, children, className = '' }) => (
  <section className={`profile-hero ${className}`} aria-label={label} style={{ '--ph-avatar': `${avatarSize}px` } as React.CSSProperties}>
    <ProfileBanner banner={banner} color={bannerColor}>
      {onEditBanner && <EditOverlay label="Editar banner" onClick={onEditBanner} />}
    </ProfileBanner>
    {likes && <LikeCounter {...likes} />}
    <div className="ph-body">
      <div className="ph-avatar">
        <Avatar src={avatarSrc} name={name} size={avatarSize} frame={frame} />
        {onEditAvatar && <EditOverlay label="Editar foto de perfil" onClick={onEditAvatar} round />}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
      <div className="ph-info">
        {nameEditor ?? <h1 className="ph-name">{name}</h1>}
        {bio?.trim() && <p className="ph-bio">{bio.trim()}</p>}
        {meta && <div className="ph-meta">{meta}</div>}
      </div>
      {children && <div className="ph-foot">{children}</div>}
    </div>
  </section>
);

/* ---------------- Cifras ---------------- */

export interface ProfileNumbers {
  xpTotal: number;
  currentStreak: number;
  bestStreak: number;
}

/** Nivel (siempre), racha actual (si la persona muestra la tarjeta «Racha») y racha más alta (siempre) */
export const ProfileStats: React.FC<{ stats: ProfileNumbers; showStreak: boolean; isMe?: boolean }> = ({ stats, showStreak, isMe }) => {
  const xp = Math.max(0, Math.round(Number(stats.xpTotal) || 0));
  const lvl = levelFromXp(xp);
  const current = Math.max(0, Math.round(Number(stats.currentStreak) || 0));
  const best = Math.max(current, Math.round(Number(stats.bestStreak) || 0));
  return (
    <div className="ph-stats">
      <div className="ph-stat">
        <span className="ph-stat-label">Nivel</span>
        <span className="ph-stat-value">{lvl.level}</span>
        <span className="ph-stat-sub">{xp.toLocaleString('es')} XP en total</span>
        <div
          className="level-track"
          role="progressbar"
          aria-label="Progreso al siguiente nivel"
          aria-valuemin={0}
          aria-valuemax={lvl.xpForNext}
          aria-valuenow={Math.round(lvl.xpInLevel)}
        >
          <div className="level-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, lvl.progress))})` }} />
        </div>
      </div>
      {showStreak && (
        <div className="ph-stat">
          <span className="ph-stat-label">Racha actual</span>
          <span className="ph-stat-value">
            <span aria-hidden="true">🔥</span> {days(current)}
          </span>
          <span className="ph-stat-sub">{isMe ? 'Días seguidos cumpliendo tus hábitos' : 'Días seguidos cumpliendo sus hábitos'}</span>
        </div>
      )}
      <div className="ph-stat">
        <span className="ph-stat-label">Racha más alta</span>
        <span className="ph-stat-value">
          <span aria-hidden="true">🏆</span> {days(best)}
        </span>
        <span className="ph-stat-sub">{isMe ? 'Tu mejor racha hasta hoy' : 'Su mejor racha hasta hoy'}</span>
      </div>
    </div>
  );
};

/* ---------------- Logros destacados ---------------- */

export const FeaturedAchievements: React.FC<{ achievements: FeaturedAchievement[]; isMe?: boolean }> = ({ achievements, isMe }) => {
  const [open, setOpen] = useState<FeaturedAchievement | null>(null);
  const titleId = useId();
  return (
    <section className="card" aria-labelledby={titleId}>
      <div className="card-head">
        <div>
          <div className="card-title" id={titleId}>
            Logros destacados
          </div>
          <div className="card-sub">Toca uno para ver de qué se trata</div>
        </div>
      </div>
      {achievements.length ? (
        <div className="ph-ach">
          {achievements.slice(0, 3).map((a) => (
            <button
              key={a.id}
              type="button"
              className="ph-ach-chip"
              style={{ '--r': RARITY[a.rarity]?.color, '--r-text': RARITY[a.rarity]?.text } as React.CSSProperties}
              onClick={() => setOpen(a)}
            >
              <span className="ph-ach-icon" aria-hidden="true">
                {a.icon}
              </span>
              <span className="ph-ach-text">
                <span className="ph-ach-name">{a.name}</span>
                <span className="rarity">{RARITY[a.rarity]?.label ?? a.rarity}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          {isMe ? 'Aún no elegiste logros destacados. Elígelos en «Editar perfil».' : 'Aún no hay logros destacados.'}
        </p>
      )}
      <Modal isOpen={Boolean(open)} onClose={() => setOpen(null)} title="Logro">
        {open && (
          <div className="ph-ach-detail">
            <span className="ph-ach-detail-icon" aria-hidden="true">
              {open.icon}
            </span>
            <h3>{open.name}</h3>
            <span className="rarity" style={{ '--r': RARITY[open.rarity]?.color, '--r-text': RARITY[open.rarity]?.text } as React.CSSProperties}>
              {RARITY[open.rarity]?.label ?? open.rarity}
            </span>
            {open.description && <p className="muted">{open.description}</p>}
            <p className="ph-stat-sub">Conseguido el {longDay(open.achieved_at)}</p>
          </div>
        )}
      </Modal>
    </section>
  );
};

/* ---------------- La semana: navegación, XP y hábitos ---------------- */

export interface WeekNav {
  weekStart: string;
  /** Semanas hacia atrás desde la actual (0 = esta semana) */
  back: number;
  isCurrent: boolean;
  canPrev: boolean;
  canNext: boolean;
  prev: () => void;
  next: () => void;
  toCurrent: () => void;
}

/**
 * Semana que se muestra. No retrocede antes de la primera semana con datos ni avanza más allá de la actual.
 * Al cambiar `resetKey` (otra persona, otra fuente de datos) vuelve a la semana actual.
 */
export function useWeekNav(resetKey: string, currentWeek: string, firstWeek: string | null | undefined): WeekNav {
  const [s, setS] = useState({ key: resetKey, back: 0 });
  // Otra persona u otra fuente: se vuelve a la semana actual (también al regresar a la anterior, A → B → A)
  if (s.key !== resetKey) setS({ key: resetKey, back: 0 });
  const back = s.key === resetKey ? s.back : 0;
  const weekStart = addDaysKey(currentWeek, -7 * back);
  const first = firstWeek && /^\d{4}-\d{2}-\d{2}/.test(firstWeek) ? startOfWeekKey(firstWeek.slice(0, 10)) : currentWeek;
  const canPrev = addDaysKey(weekStart, -7) >= first;
  return {
    weekStart,
    back,
    isCurrent: back === 0,
    canPrev,
    canNext: back > 0,
    prev: () => canPrev && setS({ key: resetKey, back: back + 1 }),
    next: () => back > 0 && setS({ key: resetKey, back: back - 1 }),
    toCurrent: () => setS({ key: resetKey, back: 0 }),
  };
}

/** Otras semanas del perfil de alguien, pedidas al servidor (y guardadas mientras la página sigue abierta) */
export function useServerWeek(userId: string | null | undefined, weekStart: string, enabled: boolean) {
  const cache = useRef(new Map<string, ProfileWeekData | null>());
  const [status, setStatus] = useState<{ key: string; state: 'loading' | 'failed' } | null>(null);
  const [, setLoaded] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const key = `${userId ?? ''}|${weekStart}`;

  useEffect(() => {
    if (!enabled || !userId || cache.current.has(key)) return;
    let active = true;
    setStatus({ key, state: 'loading' });
    getProfileWeek(userId, weekStart)
      .then((w) => {
        if (!active) return;
        cache.current.set(key, w ?? null);
        setStatus(null);
        setLoaded((n) => n + 1);
      })
      .catch(() => active && setStatus({ key, state: 'failed' }));
    return () => {
      active = false;
    };
  }, [enabled, userId, weekStart, key, attempt]);

  return {
    data: cache.current.get(key) ?? null,
    // Mientras no esté en caché ni haya fallado, se considera cargando (también en el primer render de la semana nueva)
    loading: enabled && Boolean(userId) && !cache.current.has(key) && !(status?.key === key && status.state === 'failed'),
    failed: enabled && status?.key === key && status.state === 'failed',
    retry: () => setAttempt((n) => n + 1),
  };
}

export const ProfileWeekNav: React.FC<{ nav: WeekNav; loading?: boolean }> = ({ nav, loading }) => (
  <div className="ph-weeknav" role="group" aria-label="Semana que se muestra">
    <button type="button" className="icon-btn sm" onClick={nav.prev} disabled={!nav.canPrev} aria-label="Semana anterior">
      <ChevronLeft aria-hidden="true" />
    </button>
    <div className="ph-weeknav-label" aria-live="polite">
      <strong>{formatRange(fromKey(nav.weekStart))}</strong>
      <span>
        {nav.isCurrent ? 'Esta semana' : nav.back === 1 ? 'La semana pasada' : `Hace ${nav.back} semanas`}
        {loading && ' · cargando…'}
      </span>
    </div>
    <button type="button" className="icon-btn sm" onClick={nav.next} disabled={!nav.canNext} aria-label="Semana siguiente">
      <ChevronRight aria-hidden="true" />
    </button>
    {nav.back > 1 && (
      <button type="button" className="btn btn-ghost sm ph-weeknav-today" onClick={nav.toCurrent}>
        <RotateCcw aria-hidden="true" /> Esta semana
      </button>
    )}
  </div>
);

/** XP de la semana y hábitos visibles, movidos por las mismas flechas */
export const ProfileWeekSection: React.FC<{
  nav: WeekNav;
  showXp: boolean;
  showHabits: boolean;
  week: { day: string; xp: number }[] | null;
  habits: PublicHabit[] | null;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  isMe?: boolean;
}> = ({ nav, showXp, showHabits, week, habits, loading, failed, onRetry, isMe }) => {
  if (!showXp && !showHabits) return null;
  const tooOld = nav.back >= HABIT_WEEKS;
  return (
    <section className="ph-week" aria-label="La semana">
      <ProfileWeekNav nav={nav} loading={loading} />
      {failed && (
        <div className="ph-week-error" role="alert">
          <span>No se pudo cargar esa semana.</span>
          {onRetry && (
            <button type="button" className="btn btn-secondary sm" onClick={onRetry}>
              Reintentar
            </button>
          )}
        </div>
      )}
      {showXp && (
        <section className="card" aria-label="XP de la semana">
          <div className="card-head">
            <div>
              <div className="card-title">XP de la semana</div>
              <div className="card-sub">De lunes a domingo</div>
            </div>
          </div>
          <WeekXpBars weekStart={nav.weekStart} week={week ?? []} loading={loading} />
        </section>
      )}
      {showHabits && (
        <PublicHabitsTable
          habits={habits ?? []}
          weekStart={nav.weekStart}
          loading={loading}
          title="Hábitos visibles"
          noDataText={tooOld ? 'Sin datos de hábitos para esa semana.' : null}
          emptyText={
            isMe
              ? 'Aún no tienes hábitos visibles. Actívalos en «Editar perfil» o con «Visible en mi perfil» en cada hábito.'
              : 'No hay hábitos visibles.'
          }
        />
      )}
    </section>
  );
};

/* ---------------- Publicaciones ---------------- */

const PAGE = 20;

export const ProfilePosts: React.FC<{ userId: string; subtitle: string; reloadKey?: number }> = ({ userId, subtitle, reloadKey = 0 }) => {
  const fail = useSocialFail();
  const [posts, setPosts] = useState<Post[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'more' | 'error'>('loading');
  const [hasMore, setHasMore] = useState(false);
  // Al pasar de un perfil a otro, la respuesta del anterior no pisa la del nuevo
  const forUser = useRef<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      forUser.current = userId;
      setState(before ? 'more' : 'loading');
      try {
        const rows = (await getFeed(userId, before)) ?? [];
        if (forUser.current !== userId) return;
        setPosts((prev) => (before ? [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))] : rows));
        setHasMore(rows.length >= PAGE);
        setState('idle');
      } catch (err) {
        if (forUser.current !== userId) return;
        setState('error');
        fail(err, 'No se pudieron cargar las publicaciones.');
      }
    },
    [userId, fail],
  );

  useEffect(() => {
    setPosts([]);
    setHasMore(false);
  }, [userId]);

  // Al publicar algo nuevo (`reloadKey`) se vuelve a pedir la primera página sin vaciar la lista
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  return (
    <section className="card" aria-label="Publicaciones">
      <div className="card-head">
        <div>
          <div className="card-title">Publicaciones</div>
          <div className="card-sub">{subtitle}</div>
        </div>
      </div>
      {state === 'loading' ? (
        <div className="row" style={{ justifyContent: 'center', padding: 16 }}>
          <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
        </div>
      ) : posts.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5 }}>
          {state === 'error' ? 'No se pudieron cargar las publicaciones.' : 'Todavía no hay publicaciones.'}
        </p>
      ) : (
        <div className="post-list">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onDeleted={(id) => setPosts((list) => list.filter((x) => x.id !== id))} />
          ))}
        </div>
      )}
      {hasMore && posts.length > 0 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button type="button" className="btn btn-secondary sm" disabled={state === 'more'} onClick={() => void load(posts[posts.length - 1].created_at)}>
            {state === 'more' ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </section>
  );
};
