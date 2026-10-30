import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { FlaskConical, PenSquare, RefreshCw, Save, Send, X } from 'lucide-react';
import { useDemoMode, useStore } from '@/store/useStore';
import { supabase, isSupabaseConfigured } from '@/sync/supabase';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { useMyAvatarSrc } from '@/components/profile/Avatar';
import { localWeekHabits } from '@/components/profile/localProfile';
import {
  CARD_OPTIONS, ProfileEditor, applyProfileDraft, draftAvatarSrc, draftChanges, draftFrom, type ProfileDraft,
} from '@/components/profile/ProfileEditor';
import {
  FeaturedAchievements, ProfileHero, ProfilePosts, ProfileStats, ProfileWeekSection, longDay, useServerWeek, useWeekNav,
} from '@/components/profile/ProfileSections';
import { BanScreen } from '@/components/social/BanScreen';
import { PostModal } from '@/components/social/PostModal';
import { cosmeticOf } from '@/components/social/Identity';
import { startOfWeekKey, todayKey } from '@/lib/dates';
import { levelFromXp } from '@/lib/metrics';
import { playSound } from '@/lib/sound';
import { assetUrl, getPublicProfile, socialAvailable } from '@/social/api';
import { localPreviewStats } from '@/social/publish';
import { refreshSocialStatus } from '@/social/runtime';
import { LEAGUES, personName } from '@/social/texts';
import { useCatalogItem, useSocial } from '@/social/useSocial';
import type { ProfileCard, PublicProfile } from '@/social/types';
import '@/components/profile/profile.css';

type Focus = 'photo' | 'banner' | null;

const ALL_CARDS: ProfileCard[] = CARD_OPTIONS.map((o) => o.id);

/**
 * MI PERFIL (página propia)
 * Sin modo edición se ve exactamente como lo ven los demás (misma presentación que /u/:alias). «Editar perfil» (o
 * pasar el ratón por la foto o el banner y pulsar «Editar») abre el modo edición: foto, biografía, banner, marco,
 * tarjeta de ranking, tarjetas visibles, logros destacados y hábitos visibles, con Guardar / Cancelar.
 * Todo perfil es público: lo crea solo la capa social al entrar (social/runtime.ts). Sin servidor o sin perfil todavía
 * (sin conexión, migración no aplicada) se muestra igualmente con los datos del dispositivo y solo se edita la foto.
 * En modo demostración las cifras son las del dispositivo (no se publica nada).
 */
export const ProfileView: React.FC = () => {
  const settings = useStore((s) => s.settings);
  const habits = useStore((s) => s.habits);
  const localData = useStore(
    useShallow((s) => ({
      habits: s.habits,
      logs: s.logs,
      pointEvents: s.pointEvents,
      redemptions: s.redemptions,
      streakFreezes: s.streakFreezes,
      xpBoosts: s.xpBoosts,
      settings: s.settings,
      hasStreakFreeze: s.hasStreakFreeze,
    })),
  );
  const { phase, available, profile, ban } = useSocial(
    useShallow((s) => ({ phase: s.phase, available: s.available, profile: s.profile, ban: s.ban })),
  );
  const { showToast } = useToast();
  const myAvatar = useMyAvatarSrc();
  const [searchParams, setSearchParams] = useSearchParams();

  const configured = socialAvailable();
  const enabled = configured && available;
  const hasProfile = enabled && Boolean(profile);
  const demo = useDemoMode();
  const uid = profile?.user_id ?? null;
  // El perfil se pide por alias (o por id, si no tiene): igual que lo abriría cualquiera
  const handle = profile ? profile.alias || profile.user_id : null;

  /* ---------- Cómo lo ven los demás (servidor) ---------- */

  const [pub, setPub] = useState<PublicProfile | null>(null);
  const [pubState, setPubState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const loadPub = useCallback(
    async (silent = false) => {
      if (!handle) return;
      if (!silent) setPubState('loading');
      try {
        const res = await getPublicProfile(handle);
        setPub(res);
        setPubState(res ? 'ready' : 'error');
      } catch {
        if (!silent) setPubState('error');
      }
    },
    [handle],
  );
  useEffect(() => {
    if (hasProfile) void loadPub();
    else {
      setPub(null);
      setPubState('idle');
    }
  }, [hasProfile, loadPub]);

  // Fecha de alta de la cuenta (viene en la sesión guardada; funciona sin conexión)
  const [accountSince, setAccountSince] = useState<string | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        const created = data.session?.user?.created_at;
        if (active && created) setAccountSince(created);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  /* ---------- Cifras: del servidor o del dispositivo ---------- */

  const today = todayKey();
  // Modo demostración, o sin las cifras del servidor: las del dispositivo
  const useLocal = demo || !pub;
  const waiting = !demo && enabled && (phase === 'loading' || (hasProfile && !pub && pubState === 'loading'));
  const localBase = useMemo(() => (useLocal ? localPreviewStats(localData, today) : null), [useLocal, localData, today]);

  const currentWeek = useLocal || !pub ? startOfWeekKey(today) : pub.stats.week_start;
  const firstWeek = useLocal || !pub ? localBase?.firstWeek : pub.first_week || (pub.member_since ? startOfWeekKey(pub.member_since.slice(0, 10)) : null);
  const nav = useWeekNav(useLocal ? 'local' : `srv:${pub?.user_id}`, currentWeek, firstWeek);
  const srvWeek = useServerWeek(pub?.user_id, nav.weekStart, !useLocal && !nav.isCurrent);

  const localWeek = useMemo(
    () => (useLocal ? (nav.isCurrent ? localBase : localPreviewStats(localData, today, nav.weekStart)) : null),
    [useLocal, nav.isCurrent, nav.weekStart, localBase, localData, today],
  );
  const localHabits = useMemo(() => (useLocal ? localWeekHabits(localData, nav.weekStart, today) : null), [useLocal, localData, nav.weekStart, today]);

  const numbers =
    useLocal || !pub
      ? { xpTotal: localBase?.xpTotal ?? 0, currentStreak: localBase?.currentStreak ?? 0, bestStreak: localBase?.bestStreak ?? 0 }
      : { xpTotal: Number(pub.stats.xp_total) || 0, currentStreak: pub.stats.current_streak, bestStreak: pub.stats.best_streak };
  const week = useLocal ? (localWeek?.week ?? null) : nav.isCurrent ? (pub?.stats.week ?? null) : (srvWeek.data?.week ?? null);
  const weekHabits = useLocal ? localHabits : nav.isCurrent ? (pub?.habits ?? null) : (srvWeek.data?.habits ?? null);

  /* ---------- Modo edición ---------- */

  const scope: 'full' | 'photo' = hasProfile && !ban ? 'full' : 'photo';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postsKey, setPostsKey] = useState(0);
  const photoRef = useRef<HTMLElement>(null);
  const bannerRef = useRef<HTMLElement>(null);

  const changes = draft ? draftChanges(draft, settings, scope === 'full' ? profile : null, habits) : null;
  const dirty = Boolean(editing && changes?.dirty);

  // Con qué alcance se hizo el borrador (si llega el perfil mientras se edita solo la foto, se rehace)
  const draftScope = useRef(scope);
  const startEdit = useCallback(
    (target: Focus = null) => {
      if (!editing) {
        const s = useStore.getState();
        setDraft(draftFrom(s.settings, useSocial.getState().profile, s.habits));
        draftScope.current = scope;
        setEditing(true);
        playSound.click();
      }
      setFocus(target);
    },
    [editing, scope],
  );

  // Lleva la vista a la sección pulsada (foto o banner) y la enfoca
  useEffect(() => {
    if (!editing || !focus) return;
    const el = (focus === 'banner' ? bannerRef : photoRef).current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    setFocus(null);
  }, [editing, focus]);

  // /perfil?editar=1 (desde «Editar perfil» en /u/:alias) abre directamente el modo edición
  const wantsEdit = searchParams.get('editar') === '1';
  useEffect(() => {
    if (!wantsEdit || (enabled && phase === 'loading')) return;
    startEdit();
    setSearchParams((p) => {
      p.delete('editar');
      return p;
    }, { replace: true });
  }, [wantsEdit, enabled, phase, startEdit, setSearchParams]);

  // Si el perfil llega cuando ya se estaba editando solo la foto, el borrador se rehace (sin perder la foto elegida)
  useEffect(() => {
    if (!editing || draftScope.current === scope) return;
    draftScope.current = scope;
    setDraft((d) => {
      const s = useStore.getState();
      const base = draftFrom(s.settings, useSocial.getState().profile, s.habits);
      return d ? { ...base, upload: d.upload, useUpload: d.useUpload, preset: d.preset } : base;
    });
  }, [editing, scope]);

  const exitEdit = () => {
    setEditing(false);
    setDraft(null);
    setFocus(null);
  };

  const onCancel = () => {
    if (dirty) setConfirmDiscard(true);
    else exitEdit();
  };

  const save = async (): Promise<boolean> => {
    if (!draft || saving) return false;
    if (!dirty) {
      exitEdit();
      return true;
    }
    setSaving(true);
    try {
      const ok = await applyProfileDraft(draft, scope === 'full', showToast);
      if (!ok) return false;
      playSound.pop();
      showToast('Perfil guardado', 'success');
      exitEdit();
      if (scope === 'full') void loadPub(true);
      return true;
    } finally {
      setSaving(false);
    }
  };

  // Salir de la página con cambios sin guardar: modal pequeño. Cerrar la pestaña: aviso del navegador
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* ---------- Lo que se dibuja ---------- */

  const name = personName({ alias: profile?.alias ?? settings.pendingAlias, display_name: profile?.display_name || settings.userName });
  const d = editing ? draft : null;
  const frameItem = useCatalogItem(d ? d.frame : profile?.frame_item);
  const bannerItem = useCatalogItem(d ? d.banner : profile?.banner_item);
  const cards = hasProfile && profile ? profile.cards ?? [] : ALL_CARDS;
  const has = (c: ProfileCard) => cards.includes(c);
  const league = !useLocal && pub?.stats.league ? LEAGUES.find((l) => l.name === pub.stats.league) : undefined;
  const level = levelFromXp(Math.round(numbers.xpTotal)).level;
  const since = profile?.member_since || accountSince;

  const photoOnlyNote =
    scope === 'full'
      ? null
      : ban
        ? 'Con un veto activo solo puedes cambiar tu foto en este dispositivo.'
        : !configured
          ? null
          : !available
            ? 'La comunidad aún no está activa en el servidor: por ahora solo puedes cambiar tu foto.'
            : phase === 'error'
              ? 'Sin conexión con la comunidad: por ahora solo puedes cambiar tu foto. Lo demás se edita cuando vuelva la conexión.'
              : 'Tu perfil público se está preparando: en un momento podrás editar el resto.';

  // Por qué las cifras son las del dispositivo (salvo en modo demostración, que tiene su propia etiqueta)
  const localNote =
    demo || !useLocal || waiting
      ? null
      : !configured
        ? 'Tus cifras de este dispositivo.'
        : !available
          ? 'La comunidad aún no está activa: ves tus cifras de este dispositivo.'
          : phase === 'error' || pubState === 'error'
            ? 'Sin conexión con la comunidad: ves tus cifras de este dispositivo.'
            : hasProfile
              ? null
              : 'Tu perfil público se está preparando: por ahora ves tus cifras de este dispositivo.';

  const meta = (
    <>
      {league && (
        <span className="badge" style={{ color: `color-mix(in srgb, ${league.text} 72%, var(--text))` }}>
          <span aria-hidden="true">{league.icon}</span> Liga {league.name}
        </span>
      )}
      {!waiting && <span className="badge accent">Nivel {level}</span>}
      {has('member_since') && since && <span className="ph-meta-text">Miembro desde el {longDay(since)}</span>}
    </>
  );

  return (
    <div className="stack fade-up profile-page" style={{ maxWidth: 860 }}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Tu cuenta</p>
          <h1>{editing ? 'Editar perfil' : 'Mi perfil'}</h1>
        </div>
      </div>

      {ban && <BanScreen compact />}

      <ProfileHero
        label="Tu perfil"
        name={name}
        bio={d ? d.bio : profile?.bio}
        // Fuera de edición, con perfil público, la foto que ven los demás (la del servidor), no la del dispositivo
        avatarSrc={d ? draftAvatarSrc(d) : profile ? assetUrl('avatars', profile.avatar_path) : myAvatar}
        frame={cosmeticOf(frameItem)}
        banner={cosmeticOf(bannerItem)}
        bannerColor={d ? d.bannerColor : profile?.banner_color}
        likes={pub && !editing ? { count: Number(pub.likes) || 0, liked: false } : null}
        meta={editing ? null : meta}
        onEditAvatar={() => startEdit('photo')}
        onEditBanner={scope === 'full' ? () => startEdit('banner') : undefined}
        className={editing ? 'is-editing' : ''}
        actions={
          editing ? null : (
            <>
              <button type="button" className="btn btn-secondary sm" onClick={() => startEdit()}>
                <PenSquare aria-hidden="true" /> Editar perfil
              </button>
              {hasProfile && (
                <button type="button" className="btn btn-primary sm" onClick={() => setPosting(true)} disabled={Boolean(ban)}>
                  <Send aria-hidden="true" /> Publicar
                </button>
              )}
            </>
          )
        }
      >
        {!editing && hasProfile && (
          <p className="ph-hint">{demo ? 'Los demás siguen viendo tus datos reales: la demostración solo la ves tú.' : 'Así ven tu perfil los demás.'}</p>
        )}
        {editing && <p className="ph-hint">Vista previa: así se verá tu perfil al guardar.</p>}
      </ProfileHero>

      {editing && draft ? (
        <>
          <ProfileEditor
            draft={draft}
            onChange={(patch) => setDraft((cur) => (cur ? { ...cur, ...patch } : cur))}
            scope={scope}
            photoOnlyNote={photoOnlyNote}
            disabled={saving}
            photoRef={photoRef}
            bannerRef={bannerRef}
          />
          <div className="ph-savebar" role="region" aria-label="Guardar los cambios del perfil">
            <span className={`ph-savebar-state ${dirty ? 'is-dirty' : ''}`} aria-live="polite">
              {dirty && <span className="dot" aria-hidden="true" />}
              {saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Sin cambios'}
            </span>
            <div className="ph-savebar-actions">
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
                <X aria-hidden="true" /> Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !dirty}>
                <Save aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </>
      ) : waiting ? (
        <div className="card row" style={{ justifyContent: 'center', padding: 32 }} aria-live="polite">
          <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando tu perfil…</span>
        </div>
      ) : (
        <>
          {(demo || localNote) && (
            <div className="ph-notes">
              {demo && (
                <span className="ph-tag">
                  <FlaskConical aria-hidden="true" /> Datos de demostración · no se publican
                </span>
              )}
              {localNote && (
                <span className="ph-note">
                  {localNote}
                  {configured && available && (phase === 'error' || pubState === 'error') && (
                    <button
                      type="button"
                      className="btn btn-ghost sm"
                      onClick={() => {
                        void refreshSocialStatus().then(() => loadPub());
                      }}
                    >
                      <RefreshCw aria-hidden="true" /> Reintentar
                    </button>
                  )}
                </span>
              )}
            </div>
          )}

          <ProfileStats stats={numbers} showStreak={has('streak')} isMe />

          {hasProfile && pub && has('achievements') && <FeaturedAchievements achievements={pub.achievements ?? []} isMe />}

          <ProfileWeekSection
            nav={nav}
            showXp={has('xp_week')}
            showHabits={has('habits')}
            week={week}
            habits={weekHabits}
            loading={!useLocal && srvWeek.loading}
            failed={!useLocal && srvWeek.failed}
            onRetry={srvWeek.retry}
            isMe
          />

          {hasProfile && uid && <ProfilePosts userId={uid} subtitle="Lo que has compartido" reloadKey={postsKey} />}
        </>
      )}

      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          exitEdit();
        }}
        title="¿Descartar los cambios?"
        message="Tu perfil se queda como estaba. Los cambios que hiciste en el modo edición se perderán."
        confirmLabel="Descartar cambios"
        danger
      />

      {/* Intento de salir con cambios sin guardar */}
      <Modal isOpen={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} title="Cambios sin guardar">
        <div className="form">
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>Hiciste cambios en tu perfil que todavía no se han guardado. ¿Qué quieres hacer?</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => blocker.reset?.()}>
              Seguir editando
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => blocker.proceed?.()}>
              Salir sin guardar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={async () => {
                if (await save()) blocker.proceed?.();
                else blocker.reset?.();
              }}
            >
              <Save size={16} aria-hidden="true" /> Guardar y salir
            </button>
          </div>
        </div>
      </Modal>

      <PostModal isOpen={posting} onClose={() => setPosting(false)} onPosted={() => setPostsKey((k) => k + 1)} />
    </div>
  );
};
