import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, Check, Clock, Flag, Gavel, HandHeart, ImageOff, PartyPopper, ShieldAlert, ShieldCheck,
  Trash2, UserCheck, UserPlus, UserRoundX, X,
} from 'lucide-react';
import {
  FeaturedAchievements, ProfileHero, ProfilePosts, ProfileStats, ProfileWeekSection, longDay, useServerWeek, useWeekNav,
} from '@/components/profile/ProfileSections';
import { BanScreen } from '@/components/social/BanScreen';
import { CommunityUnavailable, MoreMenu, useSocialFail, type MoreMenuItem } from '@/components/social/PostCard';
import { ReasonModal, ReportModal } from '@/components/social/ReportModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { startOfWeekKey, todayKey } from '@/lib/dates';
import { levelFromXp } from '@/lib/metrics';
import { playSound } from '@/lib/sound';
import {
  adminBan, adminClearAvatar, adminClearBanner, adminUnban, adminWarn, assetUrl, blockUser, getPublicProfile, removeAvatarFiles,
  removeFriend, respondFriendRequest, sendCheer, sendFriendRequest, toggleProfileLike, unblockUser,
} from '@/social/api';
import { parseDefaultAvatarPath } from '@/lib/defaultAvatars';
import { myUserId } from '@/social/runtime';
import { cheerText, LEAGUES, personName } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { PublicProfile } from '@/social/types';
import '@/components/profile/profile.css';
import '@/components/social/social.css';
import '@/components/social/community.css';

type ModAction = 'avatar' | 'banner' | 'warn' | 'ban' | 'unban';
type Confirm = 'remove' | 'cancel' | 'block' | 'unblock' | null;

/**
 * PERFIL PÚBLICO (/u/:alias, también /u/:id para quien no tiene alias) — docs/plan-social.md, F5 y F6
 * Lo que se ve aquí lo decide el servidor (public_profile): tarjetas elegidas, hábitos visibles y la relación contigo.
 * La presentación es la misma que «Mi perfil» (components/profile/ProfileSections.tsx). Tu propio perfil se abre siempre en
 * /perfil: así hay una sola página para él y nunca ves dos cifras distintas (en modo demostración las del dispositivo).
 */
export const PublicProfileView: React.FC = () => {
  const { alias: handle = '' } = useParams();
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
  const [busy, setBusy] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reporting, setReporting] = useState(false);
  const [mod, setMod] = useState<ModAction | null>(null);

  // Al pasar de un perfil a otro (/u/a → /u/b) la respuesta del anterior no pisa la del nuevo
  const handleRef = useRef(handle);
  handleRef.current = handle;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState('loading');
      try {
        const res = await getPublicProfile(handle);
        if (handleRef.current !== handle) return;
        if (!res) {
          setP(null);
          setState('missing');
          return;
        }
        setP(res);
        setState('ready');
      } catch (err) {
        if (handleRef.current !== handle) return;
        if (!silent) setState('error');
        fail(err, 'No se pudo cargar el perfil.');
      }
    },
    [handle, fail],
  );

  useEffect(() => {
    if (available) void load();
  }, [available, load]);

  // Semanas: las mismas flechas mueven la XP y los hábitos visibles
  // Un perfil suspendido llega sin `stats` (el servidor solo manda el nombre): no hay semanas que recorrer
  const nav = useWeekNav(
    p?.user_id ? `srv:${p.user_id}` : 'none',
    p?.stats?.week_start ?? startOfWeekKey(todayKey()),
    p?.stats ? p.first_week || (p.member_since ? startOfWeekKey(p.member_since.slice(0, 10)) : null) : null,
  );
  const srvWeek = useServerWeek(p?.user_id, nav.weekStart, Boolean(p?.stats) && !nav.isCurrent);

  if (p?.is_me || (myProfile && (handle === myProfile.alias || handle === myProfile.user_id))) return <Navigate to="/perfil" replace />;

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
          <p>{state === 'error' ? 'Revisa tu conexión e inténtalo de nuevo.' : 'Puede que haya cambiado su alias o que ya no esté en la comunidad.'}</p>
          {state === 'error' && (
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              Reintentar
            </button>
          )}
        </div>
      </div>
    );
  }

  const who = personName(p);
  const canSeeFull = !p.suspended || isAdmin;

  if (!canSeeFull) {
    return (
      <div className="stack fade-up" style={{ maxWidth: 860 }}>
        {backBtn}
        <div className="card empty">
          <div className="empty-icon">
            <Ban aria-hidden="true" />
          </div>
          <h3>Cuenta suspendida</h3>
          <p>El perfil de {who} no está disponible mientras dure la suspensión.</p>
        </div>
      </div>
    );
  }

  const uid = p.user_id;
  const me = myUserId();
  const league = p.stats.league ? LEAGUES.find((l) => l.name === p.stats.league) : undefined;
  const lvl = levelFromXp(Math.round(Number(p.stats.xp_total) || 0));
  const has = (c: PublicProfile['cards'][number]) => p.cards?.includes(c);
  const fr = p.friendship;
  const cheer = p.cheer;
  const cheerLabel = cheer?.sent_today ? 'Ya le enviaste ánimos hoy' : cheer?.kind === 'congrats' ? 'Felicitar' : 'Enviar ánimos';
  const likes = Math.max(0, Number(p.likes) || 0);

  /** «Me gusta» al momento; si el servidor falla, vuelve a como estaba */
  const onLike = async () => {
    if (likeBusy) return;
    const before = { liked: Boolean(p.liked_by_me), likes };
    const liked = !before.liked;
    const patch = (v: { liked: boolean; likes: number }) =>
      setP((cur) => (cur && cur.user_id === uid ? { ...cur, liked_by_me: v.liked, likes: Math.max(0, v.likes) } : cur));
    patch({ liked, likes: before.likes + (liked ? 1 : -1) });
    if (liked) playSound.pop();
    else playSound.click();
    setLikeBusy(true);
    try {
      const res = await toggleProfileLike(uid);
      patch({ liked: Boolean(res.liked), likes: Number(res.likes) || 0 });
    } catch (err) {
      patch(before);
      fail(err, 'No se pudo guardar tu me gusta.');
    } finally {
      setLikeBusy(false);
    }
  };

  const onCheer = () =>
    run(
      async () => {
        const res = await sendCheer(uid);
        const text = cheerText({ kind: res.kind, variant: res.variant, reason: cheer?.reason, n: cheer?.n });
        playSound.pop();
        showToast(`${res.kind === 'congrats' ? '¡Felicitación enviada!' : '¡Ánimos enviados!'} ${who} recibirá: «${myProfile ? personName(myProfile) : 'Tú'} ${text}»`, 'success');
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
        showToast(status === 'accepted' ? `¡Ahora eres amigo de ${who}!` : `Solicitud enviada a ${who}`, 'success');
      },
      null,
      'No se pudo enviar la solicitud.',
    );

  const onRespond = (accept: boolean) =>
    run(() => respondFriendRequest(uid, accept), accept ? `¡Ahora eres amigo de ${who}!` : 'Solicitud rechazada', 'No se pudo responder la solicitud.');

  const onConfirm = () => {
    if (confirm === 'remove') void run(() => removeFriend(uid), `${who} ya no está en tus amigos`, 'No se pudo eliminar la amistad.');
    if (confirm === 'cancel') void run(() => removeFriend(uid), 'Solicitud cancelada', 'No se pudo cancelar la solicitud.');
    if (confirm === 'block') void run(() => blockUser(uid), `Bloqueaste a ${who}`, 'No se pudo bloquear.');
    if (confirm === 'unblock' && me) void run(() => unblockUser(me, uid), `Desbloqueaste a ${who}`, 'No se pudo desbloquear.');
  };

  const onModerate = async (reason: string, days: number | null) => {
    try {
      if (mod === 'avatar') {
        await adminClearAvatar(uid, reason);
        const path = p.avatar_path;
        // El archivo se borra si se puede; si no, al menos ya no se muestra (las fotos por defecto no son archivos)
        if (path && !/^(data:|blob:|https?:)/.test(path) && !parseDefaultAvatarPath(path)) await removeAvatarFiles([path]).catch(() => undefined);
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
      showToast(`${done[mod!]} · ${who}`, 'success');
      await load(true);
    } catch (err) {
      fail(err, 'No se pudo aplicar la acción de moderación.');
      throw err;
    }
  };

  const MOD: Record<ModAction, { title: string; description: string; confirmLabel: string; danger?: boolean; withDays?: boolean }> = {
    avatar: { title: 'Borrar foto', description: `Se borra la foto de perfil de ${who}.`, confirmLabel: 'Borrar foto', danger: true },
    banner: { title: 'Quitar banner', description: `${who} vuelve al banner por defecto (conserva el artículo).`, confirmLabel: 'Quitar banner', danger: true },
    warn: { title: 'Advertir', description: `${who} recibirá una notificación con el motivo.`, confirmLabel: 'Enviar advertencia' },
    ban: {
      title: 'Vetar',
      description: `Mientras dure, ${who} no podrá publicar, reaccionar, enviar ánimos ni cambiar su perfil público.`,
      confirmLabel: 'Aplicar veto',
      danger: true,
      withDays: true,
    },
    unban: { title: 'Levantar veto', description: `${who} podrá volver a usar la comunidad.`, confirmLabel: 'Levantar veto' },
  };

  const menu: MoreMenuItem[] = [
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
        <button type="button" className="btn btn-secondary sm" onClick={() => setConfirm('remove')} disabled={busy} title="Toca para eliminar la amistad">
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
    remove: {
      title: `¿Eliminar a ${who} de tus amigos?`,
      message: 'Dejarás de ver sus publicaciones en tu inicio. Podrás enviarle otra solicitud cuando quieras.',
      label: 'Eliminar',
      danger: true,
    },
    cancel: { title: '¿Cancelar la solicitud?', message: `${who} ya no verá tu solicitud de amistad.`, label: 'Cancelar solicitud' },
    block: {
      title: `¿Bloquear a ${who}?`,
      message: 'No podrá ver tu perfil, enviarte solicitudes ni ánimos, y se elimina la amistad si la había. No se le avisa.',
      label: 'Bloquear',
      danger: true,
    },
    unblock: { title: `¿Desbloquear a ${who}?`, message: 'Podrá volver a ver tu perfil y enviarte solicitudes.', label: 'Desbloquear' },
  };

  const cheerHint =
    cheer?.kind === 'congrats' && !cheer.sent_today
      ? cheer.reason === 'streak'
        ? `¡Lleva ${cheer.n ?? ''} días de racha!`
        : cheer.reason === 'achievement'
          ? `Acaba de conseguir el logro «${cheer.name ?? ''}».`
          : cheer.reason === 'podium'
            ? 'Quedó en el podio la semana pasada.'
            : cheer.reason === 'league_up'
              ? 'Acaba de subir de liga.'
              : null
      : null;

  return (
    <div className="stack fade-up profile-page" style={{ maxWidth: 860 }}>
      {backBtn}
      {banned && <BanScreen compact />}

      <ProfileHero
        label={`Perfil de ${who}`}
        name={who}
        bio={p.bio}
        avatarSrc={assetUrl('avatars', p.avatar_path)}
        frame={p.frame}
        banner={p.banner}
        bannerColor={p.banner_color}
        likes={{
          count: likes,
          liked: Boolean(p.liked_by_me),
          onToggle: () => void onLike(),
          disabled: likeBusy || banned || p.i_blocked,
        }}
        meta={
          <>
            {league && (
              <span className="badge" style={{ color: `color-mix(in srgb, ${league.text} 72%, var(--text))` }}>
                <span aria-hidden="true">{league.icon}</span> Liga {league.name}
              </span>
            )}
            <span className="badge accent">Nivel {lvl.level}</span>
            {p.suspended && <span className="badge danger">Cuenta suspendida</span>}
            {has('member_since') && p.member_since && <span className="ph-meta-text">Miembro desde el {longDay(p.member_since)}</span>}
          </>
        }
        actions={
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
            <MoreMenu items={menu} label={`Más opciones para ${who}`} className="btn btn-ghost sm" />
          </>
        }
      >
        {p.i_blocked && <p className="ph-hint">Bloqueaste a esta persona. Puedes desbloquearla desde el menú ⋯.</p>}
        {cheerHint && <p className="ph-hint">{cheerHint}</p>}
      </ProfileHero>

      <ProfileStats
        stats={{ xpTotal: Number(p.stats.xp_total) || 0, currentStreak: p.stats.current_streak, bestStreak: p.stats.best_streak }}
        showStreak={Boolean(has('streak'))}
        isMe={false}
      />

      {has('achievements') && <FeaturedAchievements achievements={p.achievements ?? []} isMe={false} />}

      <ProfileWeekSection
        nav={nav}
        showXp={Boolean(has('xp_week'))}
        showHabits={Boolean(has('habits'))}
        week={nav.isCurrent ? (p.stats.week ?? []) : (srvWeek.data?.week ?? null)}
        habits={nav.isCurrent ? (p.habits ?? []) : (srvWeek.data?.habits ?? null)}
        loading={srvWeek.loading}
        failed={srvWeek.failed}
        onRetry={srvWeek.retry}
        isMe={false}
      />

      <ProfilePosts userId={uid} subtitle={`Lo que ha compartido ${who}`} reloadKey={0} />

      {isAdmin && (
        <section className="card" aria-label="Moderación">
          <div className="card-head">
            <div>
              <div className="card-title">Moderación</div>
              <div className="card-sub">Solo la ves tú. Cada acción queda registrada con su motivo.</div>
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary sm"
              onClick={() => setMod('avatar')}
              disabled={!p.avatar_path || Boolean(parseDefaultAvatarPath(p.avatar_path))}
            >
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
      <ReportModal isOpen={reporting} onClose={() => setReporting(false)} targetUser={uid} alias={who} />
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
