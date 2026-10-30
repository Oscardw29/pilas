import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, Check, Clock, Flag, Gavel, HandHeart, ImageOff, PartyPopper, PenSquare, Send, ShieldAlert, ShieldCheck,
  Trash2, UserCheck, UserPlus, UserRoundX, X,
} from 'lucide-react';
import { Avatar } from '@/components/profile/Avatar';
import { ProfileBanner } from '@/components/social/Identity';
import { BanScreen } from '@/components/social/BanScreen';
import { CommunityUnavailable, MoreMenu, PostCard, useSocialFail, type MoreMenuItem } from '@/components/social/PostCard';
import { PostModal } from '@/components/social/PostModal';
import { ReasonModal, ReportModal } from '@/components/social/ReportModal';
import { PublicHabitsTable } from '@/components/social/PublicHabitsTable';
import { WeekXpBars } from '@/components/social/WeekXpBars';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastContext';
import { fromKey } from '@/lib/dates';
import { levelFromXp } from '@/lib/metrics';
import { playSound } from '@/lib/sound';
import {
  adminBan, adminClearAvatar, adminClearBanner, adminUnban, adminWarn, assetUrl, blockUser, getFeed, getPublicProfile,
  removeAvatarFiles, removeFriend, respondFriendRequest, sendCheer, sendFriendRequest, unblockUser,
} from '@/social/api';
import { myUserId } from '@/social/runtime';
import { cheerText, LEAGUES, RARITY } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { FeaturedAchievement, Post, PublicProfile } from '@/social/types';
import '@/components/profile/profile.css';
import '@/components/social/social.css';
import '@/components/social/community.css';

const PAGE = 20;

/** «2026-10-01» o un ISO → fecha local (sin el desfase de un día que da `new Date('2026-10-01')`) */
const toDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? fromKey(s) : new Date(s));
const longDay = (s: string) => toDate(s).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });

type ModAction = 'avatar' | 'banner' | 'warn' | 'ban' | 'unban';
type Confirm = 'remove' | 'cancel' | 'block' | 'unblock' | null;

/**
 * PERFIL PÚBLICO (/u/:alias) — docs/plan-social.md, F5 y F6
 * Lo que se ve aquí lo decide el servidor (public_profile): tarjetas elegidas, hábitos visibles y la relación contigo.
 */
export const PublicProfileView: React.FC = () => {
  const { alias = '' } = useParams();
  const navigate = useNavigate();
  // «default» = se abrió el perfil directamente (sin página anterior de la app a la que volver)
  const firstEntry = useLocation().key === 'default';
  const { showToast } = useToast();
  const fail = useSocialFail();
  const available = useSocial((s) => s.available);
  const isAdmin = useSocial((s) => s.isAdmin);
  const myBan = useSocial((s) => s.ban);
  const myProfile = useSocial((s) => s.profile);
  const banned = Boolean(myBan);

  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [p, setP] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsState, setPostsState] = useState<'idle' | 'loading' | 'more' | 'error'>('idle');
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reporting, setReporting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [achievement, setAchievement] = useState<FeaturedAchievement | null>(null);
  const [mod, setMod] = useState<ModAction | null>(null);

  // Al pasar de un perfil a otro (/u/a → /u/b) la respuesta del anterior no pisa la del nuevo
  const aliasRef = useRef(alias);
  aliasRef.current = alias;
  const postsFor = useRef<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState('loading');
      try {
        const res = await getPublicProfile(alias);
        if (aliasRef.current !== alias) return;
        if (!res) {
          setP(null);
          setState('missing');
          return;
        }
        setP(res);
        setState('ready');
      } catch (err) {
        if (aliasRef.current !== alias) return;
        if (!silent) setState('error');
        fail(err, 'No se pudo cargar el perfil.');
      }
    },
    [alias, fail],
  );

  const loadPosts = useCallback(
    async (userId: string, before?: string) => {
      postsFor.current = userId;
      setPostsState(before ? 'more' : 'loading');
      try {
        const rows = (await getFeed(userId, before)) ?? [];
        if (postsFor.current !== userId) return;
        setPosts((prev) => (before ? [...prev, ...rows.filter((r) => !prev.some((x) => x.id === r.id))] : rows));
        setHasMore(rows.length >= PAGE);
        setPostsState('idle');
      } catch (err) {
        if (postsFor.current !== userId) return;
        setPostsState('error');
        fail(err, 'No se pudieron cargar las publicaciones.');
      }
    },
    [fail],
  );

  useEffect(() => {
    if (!available) return;
    postsFor.current = null;
    setPosts([]);
    setHasMore(false);
    void load();
  }, [available, load]);

  const userId = p?.user_id;
  const canSeeFull = Boolean(p && userId && !(p.suspended && !isAdmin && !p.is_me));
  useEffect(() => {
    if (userId && canSeeFull) void loadPosts(userId);
  }, [userId, canSeeFull, loadPosts]);

  /* ---------- Acciones ---------- */

  const run = async (fn: () => Promise<unknown>, ok: string | null, fallback: string, reload = true) => {
    setBusy(true);
    try {
      await fn();
      if (ok) {
        playSound.pop();
        showToast(ok, 'success');
      }
      if (reload) await load(true);
    } catch (err) {
      fail(err, fallback);
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        <CommunityUnavailable />
      </div>
    );
  }

  const goBack = () => (firstEntry ? navigate('/amigos') : navigate(-1));
  const backBtn = (
    <button type="button" className="btn btn-ghost sm pp-back" onClick={goBack}>
      <ArrowLeft aria-hidden="true" /> Volver
    </button>
  );

  if (state === 'loading') {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        {backBtn}
        <div className="card row" style={{ justifyContent: 'center', padding: 40 }} aria-live="polite">
          <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando el perfil…</span>
        </div>
      </div>
    );
  }

  if (state === 'error' || state === 'missing' || !p) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        {backBtn}
        <div className="card empty">
          <div className="empty-icon">
            <UserRoundX aria-hidden="true" />
          </div>
          <h3>{state === 'error' ? 'No se pudo cargar el perfil' : 'Este perfil no existe o no está disponible'}</h3>
          <p>{state === 'error' ? 'Revisa tu conexión e inténtalo de nuevo.' : `No encontramos a @${alias}.`}</p>
          {state === 'error' && (
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!canSeeFull) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        {backBtn}
        <div className="card empty">
          <div className="empty-icon">
            <Ban aria-hidden="true" />
          </div>
          <h3>Cuenta suspendida</h3>
          <p>El perfil de @{p.alias} no está disponible mientras dure la suspensión.</p>
        </div>
      </div>
    );
  }

  const uid = p.user_id;
  const me = myUserId();
  const league = p.stats.league ? LEAGUES.find((l) => l.name === p.stats.league) : undefined;
  const lvl = levelFromXp(Number(p.stats.xp_total) || 0);
  const has = (c: PublicProfile['cards'][number]) => p.cards?.includes(c);
  const fr = p.friendship;
  const cheer = p.cheer;
  const cheerLabel = cheer?.sent_today ? 'Ya le enviaste ánimos hoy' : cheer?.kind === 'congrats' ? 'Felicitar' : 'Enviar ánimos';

  const onCheer = () =>
    run(
      async () => {
        const res = await sendCheer(uid);
        const text = cheerText({ kind: res.kind, variant: res.variant, reason: cheer?.reason, n: cheer?.n });
        playSound.pop();
        showToast(`${res.kind === 'congrats' ? '¡Felicitación enviada!' : '¡Ánimos enviados!'} @${p.alias} recibirá: «@${myProfile?.alias ?? 'tú'} ${text}»`, 'success');
        setP((cur) => (cur && cur.cheer ? { ...cur, cheer: { ...cur.cheer, sent_today: true } } : cur));
      },
      null,
      'No se pudieron enviar los ánimos.',
      false,
    );

  const onAddFriend = () =>
    run(
      async () => {
        const status = await sendFriendRequest(uid);
        playSound.pop();
        showToast(status === 'accepted' ? `¡Ahora eres amigo de @${p.alias}!` : `Solicitud enviada a @${p.alias}`, 'success');
      },
      null,
      'No se pudo enviar la solicitud.',
    );

  const onRespond = (accept: boolean) =>
    run(
      () => respondFriendRequest(uid, accept),
      accept ? `¡Ahora eres amigo de @${p.alias}!` : 'Solicitud rechazada',
      'No se pudo responder la solicitud.',
    );

  const onConfirm = () => {
    if (confirm === 'remove') void run(() => removeFriend(uid), `@${p.alias} ya no está en tus amigos`, 'No se pudo eliminar la amistad.');
    if (confirm === 'cancel') void run(() => removeFriend(uid), 'Solicitud cancelada', 'No se pudo cancelar la solicitud.');
    if (confirm === 'block') void run(() => blockUser(uid), `Bloqueaste a @${p.alias}`, 'No se pudo bloquear.');
    if (confirm === 'unblock' && me) void run(() => unblockUser(me, uid), `Desbloqueaste a @${p.alias}`, 'No se pudo desbloquear.');
  };

  const onModerate = async (reason: string, days: number | null) => {
    try {
      if (mod === 'avatar') {
        await adminClearAvatar(uid, reason);
        const path = p.avatar_path;
        // El archivo se borra si se puede; si no, al menos ya no se muestra
        if (path && !/^(data:|blob:|https?:)/.test(path)) await removeAvatarFiles([path]).catch(() => undefined);
      } else if (mod === 'banner') await adminClearBanner(uid, reason);
      else if (mod === 'warn') await adminWarn(uid, reason);
      else if (mod === 'ban') await adminBan(uid, reason, days);
      else if (mod === 'unban') await adminUnban(uid, reason);
      const done: Record<ModAction, string> = {
        avatar: 'Foto borrada',
        banner: 'Banner quitado',
        warn: 'Advertencia enviada',
        ban: days ? `Veto de ${days} ${days === 1 ? 'día' : 'días'} aplicado` : 'Veto permanente aplicado',
        unban: 'Veto levantado',
      };
      playSound.pop();
      showToast(`${done[mod!]} · @${p.alias}`, 'success');
      await load(true);
    } catch (err) {
      fail(err, 'No se pudo aplicar la acción de moderación.');
      throw err;
    }
  };

  const MOD: Record<ModAction, { title: string; description: string; confirmLabel: string; danger?: boolean; withDays?: boolean }> = {
    avatar: { title: 'Borrar foto', description: `Se borra la foto de perfil de @${p.alias}.`, confirmLabel: 'Borrar foto', danger: true },
    banner: { title: 'Quitar banner', description: `@${p.alias} vuelve al banner por defecto (conserva el artículo).`, confirmLabel: 'Quitar banner' },
    warn: { title: 'Advertir', description: `@${p.alias} recibirá una notificación con el motivo.`, confirmLabel: 'Enviar advertencia' },
    ban: {
      title: 'Vetar',
      description: `Mientras dure, @${p.alias} no podrá publicar, reaccionar, enviar ánimos ni cambiar su perfil público.`,
      confirmLabel: 'Aplicar veto',
      danger: true,
      withDays: true,
    },
    unban: { title: 'Levantar veto', description: `@${p.alias} podrá volver a usar la comunidad.`, confirmLabel: 'Levantar veto' },
  };

  const menu: MoreMenuItem[] = p.is_me
    ? []
    : [
        { label: 'Reportar', icon: <Flag aria-hidden="true" />, onSelect: () => setReporting(true), disabled: banned },
        p.i_blocked
          ? { label: 'Desbloquear', icon: <ShieldCheck aria-hidden="true" />, onSelect: () => setConfirm('unblock') }
          : { label: 'Bloquear', icon: <ShieldAlert aria-hidden="true" />, onSelect: () => setConfirm('block'), danger: true },
      ];

  const writeOff = busy || banned;

  const friendButtons = () => {
    if (p.i_blocked) return null;
    if (!fr)
      return (
        <button type="button" className="btn btn-primary sm" onClick={() => void onAddFriend()} disabled={writeOff}>
          <UserPlus aria-hidden="true" /> Añadir amigo
        </button>
      );
    if (fr.status === 'accepted')
      return (
        <button
          type="button"
          className="btn btn-secondary sm"
          onClick={() => setConfirm('remove')}
          disabled={busy}
          title="Toca para eliminar la amistad"
        >
          <UserCheck aria-hidden="true" /> Amigos
        </button>
      );
    if (fr.outgoing)
      return (
        <button type="button" className="btn btn-secondary sm" onClick={() => setConfirm('cancel')} disabled={busy} title="Toca para cancelarla">
          <Clock aria-hidden="true" /> Solicitud enviada
        </button>
      );
    return (
      <>
        <button type="button" className="btn btn-primary sm" onClick={() => void onRespond(true)} disabled={writeOff}>
          <Check aria-hidden="true" /> Aceptar solicitud
        </button>
        <button type="button" className="btn btn-ghost sm" onClick={() => void onRespond(false)} disabled={writeOff}>
          <X aria-hidden="true" /> Rechazar
        </button>
      </>
    );
  };

  const CONFIRM: Record<Exclude<Confirm, null>, { title: string; message: string; label: string; danger?: boolean }> = {
    remove: { title: `¿Eliminar a @${p.alias} de tus amigos?`, message: 'Dejarás de ver sus publicaciones en tu inicio. Podrás enviarle otra solicitud cuando quieras.', label: 'Eliminar', danger: true },
    cancel: { title: '¿Cancelar la solicitud?', message: `@${p.alias} ya no verá tu solicitud de amistad.`, label: 'Cancelar solicitud' },
    block: {
      title: `¿Bloquear a @${p.alias}?`,
      message: 'No podrá ver tu perfil, enviarte solicitudes ni ánimos, y se elimina la amistad si la había. No se le avisa.',
      label: 'Bloquear',
      danger: true,
    },
    unblock: { title: `¿Desbloquear a @${p.alias}?`, message: 'Podrá volver a ver tu perfil y enviarte solicitudes.', label: 'Desbloquear' },
  };

  return (
    <div className="stack fade-up" style={{ maxWidth: 860 }}>
      {!p.is_me && backBtn}
      {banned && <BanScreen compact />}

      <section className="profile-hero" aria-label={`Perfil de @${p.alias}`}>
        <ProfileBanner banner={p.banner} />
        <div className="profile-hero-body">
          <Avatar src={assetUrl('avatars', p.avatar_path)} name={p.alias} size={96} frame={p.frame} />
          <div className="profile-hero-name">
            <h1>@{p.alias}</h1>
            <div className="pp-meta">
              {league && (
                <span className="badge" style={{ color: league.color }}>
                  <span aria-hidden="true">{league.icon}</span> Liga {league.name}
                </span>
              )}
              <span className="badge accent">Nivel {lvl.level}</span>
              {p.suspended && <span className="badge danger">Cuenta suspendida</span>}
              {has('member_since') && p.member_since && <span className="pp-stat-sub">Miembro desde el {longDay(p.member_since)}</span>}
            </div>
          </div>
        </div>
        <div className="pp-actions-wrap">
          <div className="pp-hero-actions">
            {p.is_me ? (
              <>
                <Link to="/perfil" className="btn btn-secondary sm">
                  <PenSquare aria-hidden="true" /> Editar perfil
                </Link>
                <button type="button" className="btn btn-primary sm" onClick={() => setPosting(true)} disabled={banned}>
                  <Send aria-hidden="true" /> Publicar
                </button>
              </>
            ) : (
              <>
                {friendButtons()}
                {!p.i_blocked && cheer && (
                  <button
                    type="button"
                    className={`btn sm ${cheer.kind === 'congrats' && !cheer.sent_today ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => void onCheer()}
                    disabled={writeOff || cheer.sent_today}
                  >
                    {cheer.kind === 'congrats' ? <PartyPopper aria-hidden="true" /> : <HandHeart aria-hidden="true" />} {cheerLabel}
                  </button>
                )}
                <MoreMenu items={menu} label={`Más opciones para @${p.alias}`} className="btn btn-ghost sm" />
              </>
            )}
          </div>
          {p.is_me && <p className="pp-hint">Así ven tu perfil los demás. Elige las tarjetas y los hábitos visibles en Mi perfil.</p>}
          {!p.is_me && p.i_blocked && <p className="pp-hint">Bloqueaste a esta persona. Puedes desbloquearla desde el menú ⋯.</p>}
          {!p.is_me && !myProfile && (
            <p className="pp-hint">
              Para añadir amigos o enviar ánimos, primero crea tu perfil público en <Link to="/perfil">Mi perfil</Link>.
            </p>
          )}
          {!p.is_me && cheer?.kind === 'congrats' && !cheer.sent_today && (
            <p className="pp-hint">
              {cheer.reason === 'streak'
                ? `¡Lleva ${cheer.n ?? ''} días de racha!`
                : cheer.reason === 'achievement'
                  ? `Acaba de conseguir el logro «${cheer.name ?? ''}».`
                  : cheer.reason === 'podium'
                    ? 'Quedó en el podio la semana pasada.'
                    : cheer.reason === 'league_up'
                      ? 'Acaba de subir de liga.'
                      : null}
            </p>
          )}
        </div>
      </section>

      <div className="pp-cards">
        <div className="card pp-stat">
          <span className="card-sub">Nivel</span>
          <span className="pp-stat-value">{lvl.level}</span>
          <span className="pp-stat-sub">{(Number(p.stats.xp_total) || 0).toLocaleString('es')} XP en total</span>
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
        {has('streak') && (
          <div className="card pp-stat">
            <span className="card-sub">Racha</span>
            <span className="pp-stat-value">
              <span aria-hidden="true">🔥</span> {p.stats.current_streak} {p.stats.current_streak === 1 ? 'día' : 'días'}
            </span>
            <span className="pp-stat-sub">Récord: {p.stats.best_streak} {p.stats.best_streak === 1 ? 'día' : 'días'}</span>
          </div>
        )}
        {has('achievements') && (
          <div className="card">
            <div className="card-sub" style={{ marginBottom: 8 }}>
              Logros destacados
            </div>
            {p.achievements.length ? (
              <div className="ach-featured">
                {p.achievements.slice(0, 3).map((a) => (
                  <button key={a.id} type="button" className="ach-chip" onClick={() => setAchievement(a)}>
                    <span className="ach-icon" aria-hidden="true">
                      {a.icon}
                    </span>
                    <span className="ach-name">{a.name}</span>
                    <span className="rarity" style={{ '--r': RARITY[a.rarity]?.color } as React.CSSProperties}>
                      {RARITY[a.rarity]?.label ?? a.rarity}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13 }}>
                Aún no hay logros destacados.
              </p>
            )}
          </div>
        )}
      </div>

      {has('xp_week') && (
        <section className="card" aria-label="XP de la semana">
          <div className="card-head">
            <div>
              <div className="card-title">XP de la semana</div>
              <div className="card-sub">De lunes a domingo</div>
            </div>
          </div>
          <WeekXpBars weekStart={p.stats.week_start} week={p.stats.week ?? []} />
        </section>
      )}

      {has('habits') && (
        <PublicHabitsTable
          habits={p.habits ?? []}
          title="Hábitos visibles"
          emptyText={p.is_me ? 'Aún no tienes hábitos visibles. Activa «Visible en mi perfil» en los hábitos que quieras mostrar.' : 'No hay hábitos visibles.'}
        />
      )}

      <section className="card" aria-label="Publicaciones">
        <div className="card-head">
          <div>
            <div className="card-title">Publicaciones</div>
            <div className="card-sub">{p.is_me ? 'Lo que has compartido' : `Lo que ha compartido @${p.alias}`}</div>
          </div>
        </div>
        {postsState === 'loading' ? (
          <div className="row" style={{ justifyContent: 'center', padding: 16 }}>
            <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
          </div>
        ) : posts.length === 0 ? (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {postsState === 'error' ? 'No se pudieron cargar las publicaciones.' : 'Todavía no hay publicaciones.'}
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
            <button
              type="button"
              className="btn btn-secondary sm"
              disabled={postsState === 'more'}
              onClick={() => void loadPosts(uid, posts[posts.length - 1].created_at)}
            >
              {postsState === 'more' ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        )}
      </section>

      {isAdmin && !p.is_me && (
        <section className="card" aria-label="Moderación">
          <div className="card-head">
            <div>
              <div className="card-title">Moderación</div>
              <div className="card-sub">Solo la ves tú. Cada acción queda registrada con su motivo.</div>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn btn-secondary sm" onClick={() => setMod('avatar')} disabled={!p.avatar_path}>
              <Trash2 aria-hidden="true" /> Borrar foto
            </button>
            <button type="button" className="btn btn-secondary sm" onClick={() => setMod('banner')} disabled={!p.banner}>
              <ImageOff aria-hidden="true" /> Quitar banner
            </button>
            <button type="button" className="btn btn-secondary sm" onClick={() => setMod('warn')}>
              <ShieldAlert aria-hidden="true" /> Advertir
            </button>
            {p.suspended ? (
              <button type="button" className="btn btn-secondary sm" onClick={() => setMod('unban')}>
                <ShieldCheck aria-hidden="true" /> Levantar veto
              </button>
            ) : (
              <button type="button" className="btn btn-danger-solid sm" onClick={() => setMod('ban')}>
                <Gavel aria-hidden="true" /> Vetar
              </button>
            )}
          </div>
        </section>
      )}

      {confirm && (
        <ConfirmModal
          isOpen
          onClose={() => setConfirm(null)}
          onConfirm={onConfirm}
          title={CONFIRM[confirm].title}
          message={CONFIRM[confirm].message}
          confirmLabel={CONFIRM[confirm].label}
          danger={CONFIRM[confirm].danger}
        />
      )}
      <ReportModal isOpen={reporting} onClose={() => setReporting(false)} targetUser={uid} alias={p.alias} />
      <PostModal isOpen={posting} onClose={() => setPosting(false)} onPosted={() => void loadPosts(uid)} />
      <Modal isOpen={Boolean(achievement)} onClose={() => setAchievement(null)} title="Logro">
        {achievement && (
          <div className="ach-detail">
            <span className="ach-icon" aria-hidden="true">
              {achievement.icon}
            </span>
            <h3>{achievement.name}</h3>
            <span className="rarity" style={{ '--r': RARITY[achievement.rarity]?.color } as React.CSSProperties}>
              {RARITY[achievement.rarity]?.label ?? achievement.rarity}
            </span>
            {achievement.description && <p className="muted">{achievement.description}</p>}
            <p className="pp-stat-sub">Conseguido el {longDay(achievement.achieved_at)}</p>
          </div>
        )}
      </Modal>
      {mod && (
        <ReasonModal
          isOpen
          onClose={() => setMod(null)}
          title={MOD[mod].title}
          description={MOD[mod].description}
          confirmLabel={MOD[mod].confirmLabel}
          danger={MOD[mod].danger}
          withDays={MOD[mod].withDays}
          onSubmit={onModerate}
        />
      )}
    </div>
  );
};
