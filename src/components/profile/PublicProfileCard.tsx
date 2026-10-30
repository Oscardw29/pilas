import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Check, ExternalLink, Eye, Globe, Lock, RefreshCw, Save, ShoppingBag, Trash2, UserPlus } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { BanScreen } from '@/components/social/BanScreen';
import {
  createProfile, deleteProfile, getAchievementDefs, getUserAchievements, removeAvatarFiles, socialAvailable, updateProfile,
  uploadAvatar, type ProfilePatch,
} from '@/social/api';
import { loadCatalog, myUserId, publishNow, refreshSocialStatus } from '@/social/runtime';
import { KIND_LABEL, RARITY, normalizeAlias } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { AchievementDef, CatalogItem, ProfileCard, ProfileRow } from '@/social/types';
import { playSound } from '@/lib/sound';
import { CosmeticPreview } from './CosmeticPreview';
import { ALIAS_HINT, aliasUsable, avatarBlobFrom, reportSocialError, useAliasStatus, type AliasStatus } from './publicProfile';
import './profile.css';

/**
 * PERFIL PÚBLICO (docs/plan-social.md, F5 y F5b)
 * Crearlo es una decisión explícita: antes se explica qué se publica y qué sigue cifrado.
 * Con perfil: alias, banner, marco, tarjeta de ranking, tarjetas visibles y hasta 3 logros destacados.
 * Todo lo comprueba el servidor (profiles_guard); aquí solo se ofrece lo que la persona tiene.
 */

const CARD_OPTIONS: { id: ProfileCard; label: string; hint: string }[] = [
  { id: 'streak', label: 'Racha', hint: 'Tu racha actual y tu récord' },
  { id: 'xp_week', label: 'XP de la semana', hint: 'Barras día a día con el total debajo' },
  { id: 'member_since', label: 'Miembro desde', hint: 'La fecha en que creaste tu cuenta' },
  { id: 'habits', label: 'Hábitos visibles', hint: 'La semana de los hábitos marcados como visibles' },
  { id: 'achievements', label: 'Logros destacados', hint: 'Los 3 logros que elijas abajo' },
];

const MAX_FEATURED = 3;

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/* ---------------- Alias ---------------- */

const AliasField: React.FC<{ value: string; onChange: (v: string) => void; status: AliasStatus; disabled?: boolean }> = ({
  value,
  onChange,
  status,
  disabled,
}) => {
  const id = useId();
  const bad = status === 'invalid' || status === 'reserved' || status === 'taken';
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        Alias
      </label>
      <div className={`pp-alias ${bad ? 'is-bad' : ''}`}>
        <span aria-hidden="true">@</span>
        <input
          id={id}
          className="input"
          value={value}
          onChange={(e) => onChange(normalizeAlias(e.target.value))}
          maxLength={20}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="tu_alias"
          aria-invalid={bad}
          aria-describedby={`${id}-hint`}
          disabled={disabled}
        />
      </div>
      <span id={`${id}-hint`} className={`hint pp-alias-hint is-${status}`} aria-live="polite">
        {ALIAS_HINT[status]}
      </span>
    </div>
  );
};

/* ---------------- Crear el perfil ---------------- */

const CreatePublicProfile: React.FC = () => {
  const avatar = useStore((s) => s.settings.avatarDataUrl);
  const { showToast } = useToast();
  const [alias, setAlias] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = useAliasStatus(alias);
  const canCreate = agreed && (status === 'free' || status === 'error') && !busy;

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    const uid = myUserId();
    if (!uid) {
      showToast('Inicia sesión para crear tu perfil público', 'warning');
      return;
    }
    setBusy(true);
    try {
      const row = await createProfile(uid, alias);
      useSocial.getState().set({ profile: row });
      // La foto del dispositivo pasa al perfil (si falla, el perfil ya existe y se puede reintentar al cambiarla)
      if (avatar) {
        try {
          const path = await uploadAvatar(uid, await avatarBlobFrom(avatar));
          useSocial.getState().set({ profile: await updateProfile(uid, { avatar_path: path }) });
        } catch (err) {
          showToast(`Tu perfil se creó, pero la foto no se pudo subir: ${(err as Error).message}`, 'warning');
        }
      }
      await refreshSocialStatus();
      await loadCatalog();
      // Reclama la línea base y publica hoy y ayer
      await publishNow();
      playSound.celebration();
      // publishNow no lanza errores (se reintenta solo): si el punto de partida no llegó, se avisa en lugar de dar por hecho
      if (useSocial.getState().baselineAt) showToast('¡Tu perfil público está listo!', 'success');
      else showToast('Tu perfil se creó, pero tus cifras aún no se publicaron', 'warning', 'Se reintentará solo en unos minutos (¿sin conexión?).');
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo crear el perfil público');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={(e) => void onCreate(e)}>
      <p className="pp-lead">
        Con un perfil público apareces en las clasificaciones, puedes tener amigos, publicar tus logros y usar cosméticos. Es
        opcional y puedes eliminarlo cuando quieras.
      </p>

      <div className="pp-privacy">
        <div className="pp-privacy-col is-public">
          <h3>
            <Eye size={15} aria-hidden="true" /> Será público
          </h3>
          <p className="pp-privacy-sub">Lo verá cualquier persona con sesión en ¡Pilas!</p>
          <ul>
            <li>Tu alias y tu foto</li>
            <li>Tu banner, marco y tarjeta de ranking</li>
            <li>Tu racha actual y tu récord</li>
            <li>Tu XP por día y tu XP total</li>
            <li>Tu % de cumplimiento</li>
            <li>Tu fecha de alta</li>
            <li>Tus publicaciones</li>
            <li>
              Solo los hábitos que marques como «Visible en mi perfil» (nombre, icono y cumplimiento por día). Está apagado por
              defecto.
            </li>
          </ul>
        </div>
        <div className="pp-privacy-col is-private">
          <h3>
            <Lock size={15} aria-hidden="true" /> Sigue privado
          </h3>
          <p className="pp-privacy-sub">Cifrado de extremo a extremo: nadie más puede leerlo</p>
          <ul>
            <li>Los hábitos que no marques como visibles</li>
            <li>Tus registros del día a día</li>
            <li>Tus notas</li>
            <li>Tus objetivos y retos</li>
            <li>Tus chats con el coach</li>
            <li>Tus claves API (nunca salen del dispositivo)</li>
            <li>El nombre con el que te llama tu coach</li>
          </ul>
        </div>
      </div>

      <AliasField value={alias} onChange={setAlias} status={status} disabled={busy} />

      <label className="pp-consent">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
        <span>
          <strong>Entiendo qué se publica.</strong> Puedo cambiar lo que se ve o eliminar mi perfil público en cualquier momento.
        </span>
      </label>

      <div>
        <button type="submit" className="btn btn-primary" disabled={!canCreate}>
          <UserPlus size={16} aria-hidden="true" /> {busy ? 'Creando tu perfil…' : 'Crear mi perfil público'}
        </button>
      </div>
    </form>
  );
};

/* ---------------- Selector de cosméticos ---------------- */

const CosmeticPicker: React.FC<{
  kind: 'banner' | 'frame' | 'card';
  items: CatalogItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}> = ({ kind, items, value, onChange, disabled }) => {
  const labelId = useId();
  const options: (CatalogItem | null)[] = [null, ...items];
  return (
    <div className="field">
      <span className="label" id={labelId}>
        {KIND_LABEL[kind].one}
      </span>
      <div className={`cos-picker kind-${kind}`} role="radiogroup" aria-labelledby={labelId}>
        {options.map((item) => {
          const selected = (item?.id ?? null) === value;
          return (
            <button
              key={item?.id ?? 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={item ? `${item.name} (${RARITY[item.rarity].label})` : 'Ninguno'}
              className={`cos-pick ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(item?.id ?? null)}
              disabled={disabled}
            >
              <CosmeticPreview kind={kind} item={item} size="sm" />
              <span className="cos-pick-name">{item?.name ?? 'Ninguno'}</span>
              {selected && (
                <span className="cos-pick-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {items.length === 0 && <span className="hint">Aún no tienes {KIND_LABEL[kind].many.toLowerCase()}. Consíguelos en la tienda.</span>}
    </div>
  );
};

/* ---------------- Editar el perfil ---------------- */

interface OwnedAchievement {
  def: AchievementDef;
  at: string;
}

const EditPublicProfile: React.FC<{ profile: ProfileRow; locked: boolean }> = ({ profile, locked }) => {
  const { catalog, inventory } = useSocial(useShallow((s) => ({ catalog: s.catalog, inventory: s.inventory })));
  const { showToast } = useToast();

  const [alias, setAlias] = useState(profile.alias);
  const [banner, setBanner] = useState(profile.banner_item);
  const [frame, setFrame] = useState(profile.frame_item);
  const [card, setCard] = useState(profile.card_item);
  const [cards, setCards] = useState<ProfileCard[]>(profile.cards ?? []);
  const [featured, setFeatured] = useState<string[]>(profile.featured_achievements ?? []);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [achievements, setAchievements] = useState<OwnedAchievement[] | null>(null);
  const aliasStatus = useAliasStatus(alias, profile.alias);

  // Logros que tiene la persona (para elegir los destacados)
  useEffect(() => {
    let active = true;
    Promise.all([getUserAchievements(profile.user_id), getAchievementDefs()])
      .then(([mine, defs]) => {
        if (!active) return;
        const byId = new Map(defs.map((d) => [d.id, d]));
        setAchievements(
          mine
            .map((m) => ({ def: byId.get(m.achievement_id), at: m.achieved_at }))
            .filter((x): x is OwnedAchievement => Boolean(x.def))
            .sort((a, b) => b.at.localeCompare(a.at)),
        );
      })
      .catch(() => active && setAchievements([]));
    return () => {
      active = false;
    };
  }, [profile.user_id]);

  const owned = useMemo(() => {
    const inv = new Set(inventory);
    const of = (kind: CatalogItem['kind']) => catalog.filter((c) => c.kind === kind && inv.has(c.id));
    return { banner: of('banner'), frame: of('frame'), card: of('card') };
  }, [catalog, inventory]);

  const orderedCards = CARD_OPTIONS.map((o) => o.id).filter((id) => cards.includes(id));
  const patch: ProfilePatch = {};
  if (alias !== profile.alias) patch.alias = alias;
  if (banner !== profile.banner_item) patch.banner_item = banner;
  if (frame !== profile.frame_item) patch.frame_item = frame;
  if (card !== profile.card_item) patch.card_item = card;
  if (!sameSet(orderedCards, profile.cards ?? [])) patch.cards = orderedCards;
  if (!sameList(featured, profile.featured_achievements ?? [])) patch.featured_achievements = featured;
  const dirty = Object.keys(patch).length > 0;
  const canSave = dirty && !locked && !busy && (patch.alias === undefined || aliasUsable(aliasStatus));

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const uid = myUserId();
    if (!canSave || !uid) return;
    setBusy(true);
    try {
      const row = await updateProfile(uid, patch);
      useSocial.getState().set({ profile: row });
      playSound.pop();
      showToast('Perfil público guardado', 'success');
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo guardar el perfil público');
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    const uid = myUserId();
    if (!uid) return;
    setBusy(true);
    const avatarPath = profile.avatar_path;
    try {
      await deleteProfile(uid);
      if (avatarPath) await removeAvatarFiles([avatarPath]).catch(() => undefined);
      useSocial.getState().set({ profile: null });
      await refreshSocialStatus();
      playSound.delete();
      showToast('Tu perfil público se eliminó', 'info');
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo eliminar el perfil público');
    } finally {
      setBusy(false);
    }
  };

  const toggleCard = (id: ProfileCard, on: boolean) => {
    setCards((prev) => (on ? [...prev.filter((c) => c !== id), id] : prev.filter((c) => c !== id)));
    playSound.toggle();
  };

  const toggleFeatured = (id: string) => {
    setFeatured((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_FEATURED ? prev : [...prev, id]));
    playSound.click();
  };

  const disabled = locked || busy;

  return (
    <form className="form" onSubmit={(e) => void onSave(e)}>
      <AliasField value={alias} onChange={setAlias} status={aliasStatus} disabled={disabled} />

      <div className="pp-section-head">
        <div>
          <div className="pp-section-title">Cosméticos</div>
          <div className="card-sub">Elige entre los que tienes. Se ven en tu perfil, en las clasificaciones y en toda la app.</div>
        </div>
        <Link to="/recompensas" className="btn btn-ghost sm">
          <ShoppingBag size={14} aria-hidden="true" /> Consigue más en la tienda
        </Link>
      </div>
      <CosmeticPicker kind="banner" items={owned.banner} value={banner} onChange={setBanner} disabled={disabled} />
      <CosmeticPicker kind="frame" items={owned.frame} value={frame} onChange={setFrame} disabled={disabled} />
      <CosmeticPicker kind="card" items={owned.card} value={card} onChange={setCard} disabled={disabled} />

      <div className="field">
        <span className="label">Tarjetas de tu perfil público</span>
        <div className="pp-switches">
          {CARD_OPTIONS.map((o) => (
            <label key={o.id} className="custom-switch pp-switch">
              <input type="checkbox" checked={cards.includes(o.id)} onChange={(e) => toggleCard(o.id, e.target.checked)} disabled={disabled} />
              <span className="custom-switch-track">
                <span className="custom-switch-thumb" />
              </span>
              <span className="pp-switch-text">
                <strong>{o.label}</strong>
                <small>{o.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="label" id="pp-featured-label">
          Logros destacados ({featured.length}/{MAX_FEATURED})
        </span>
        {achievements === null ? (
          <span className="hint">Cargando tus logros…</span>
        ) : achievements.length === 0 ? (
          <span className="hint">
            Aún no tienes logros. <Link to="/logros">Mira cómo conseguirlos</Link>.
          </span>
        ) : (
          <div className="pp-achievements" role="group" aria-labelledby="pp-featured-label">
            {achievements.map(({ def, at }) => {
              const on = featured.includes(def.id);
              const full = !on && featured.length >= MAX_FEATURED;
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`pp-achievement ${on ? 'is-on' : ''}`}
                  style={{ ['--r' as string]: RARITY[def.rarity].color }}
                  aria-pressed={on}
                  disabled={disabled || full}
                  title={`${def.description} · Conseguido el ${new Date(at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                  onClick={() => toggleFeatured(def.id)}
                >
                  <span className="pp-achievement-icon" aria-hidden="true">
                    {def.icon}
                  </span>
                  <span className="pp-achievement-name">{def.name}</span>
                  {on && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
        {achievements && achievements.length > 0 && <span className="hint">Se ven en la tarjeta «Logros destacados». Elige hasta 3.</span>}
      </div>

      <div className="pp-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          <Save size={16} aria-hidden="true" /> {busy ? 'Guardando…' : 'Guardar perfil público'}
        </button>
        <Link to={`/u/${profile.alias}`} className="btn btn-secondary">
          <ExternalLink size={15} aria-hidden="true" /> Ver mi perfil público
        </Link>
        <button type="button" className="btn btn-ghost pp-danger" onClick={() => setConfirmDelete(true)} disabled={disabled}>
          <Trash2 size={15} aria-hidden="true" /> Eliminar perfil público
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void onDelete()}
        title="Eliminar perfil público"
        message="Tu alias, tu foto y tus tarjetas dejarán de verse y saldrás de las clasificaciones. Tus hábitos y todo lo privado no cambian. Tus monedas verificadas y tus cosméticos se conservan por si vuelves."
        confirmLabel="Eliminar perfil"
        danger
      />
    </form>
  );
};

/* ---------------- Hábitos visibles ---------------- */

const VisibleHabits: React.FC<{ locked: boolean; hasProfile: boolean }> = ({ locked, hasProfile }) => {
  const habits = useStore((s) => s.habits);
  const updateHabit = useStore((s) => s.updateHabit);
  const list = habits.filter((h) => h.status !== 'archived');
  const visible = list.filter((h) => h.publicVisible).length;

  return (
    <section className="card" aria-labelledby="pp-habits-title">
      <div className="card-head">
        <div>
          <div className="card-title" id="pp-habits-title">
            Hábitos visibles
          </div>
          <div className="card-sub">
            Solo se publican el nombre, el icono y el cumplimiento por día de los que actives. Los demás nunca salen cifrados de tu
            dispositivo.
          </div>
        </div>
        <span className="badge accent">
          {visible}/{list.length}
        </span>
      </div>
      {!hasProfile && list.length > 0 && <p className="hint pp-habits-note">Se publicarán cuando crees tu perfil público.</p>}
      {list.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Aún no tienes hábitos.
        </p>
      ) : (
        <ul className="pp-habits">
          {list.map((h) => (
            <li key={h.id}>
              <label className="custom-switch pp-habit">
                <input
                  type="checkbox"
                  checked={Boolean(h.publicVisible)}
                  onChange={(e) => {
                    updateHabit(h.id, { publicVisible: e.target.checked });
                    playSound.toggle();
                  }}
                  disabled={locked}
                />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span className="pp-habit-icon" aria-hidden="true">
                  {h.icon}
                </span>
                <span className="pp-habit-name">{h.name}</span>
                {h.status === 'paused' && <span className="badge">En pausa</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/* ---------------- Tarjeta principal ---------------- */

export const PublicProfileCard: React.FC = () => {
  const { phase, available, profile, ban, error } = useSocial(
    useShallow((s) => ({ phase: s.phase, available: s.available, profile: s.profile, ban: s.ban, error: s.error })),
  );
  const [retrying, setRetrying] = useState(false);
  const enabled = socialAvailable() && available;
  const locked = Boolean(ban);
  // Si el servidor devuelve otro perfil (al guardar o desde otro dispositivo), el formulario empieza de nuevo
  const profileKey = profile ? JSON.stringify(profile) : 'none';

  let body: React.ReactNode;
  if (!enabled) {
    body = (
      <p className="pp-note">
        La comunidad todavía no está activada en el servidor. Tus hábitos y todo lo demás funcionan con normalidad; cuando se active,
        podrás crear tu perfil público aquí.
      </p>
    );
  } else if (phase === 'off' || phase === 'loading') {
    body = <p className="pp-note">Cargando tu perfil público…</p>;
  } else if (phase === 'error' && !profile) {
    body = (
      <div className="pp-note">
        <p>No se pudo consultar tu perfil público{error ? `: ${error}` : '.'}</p>
        <button
          type="button"
          className="btn btn-secondary sm"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void refreshSocialStatus().finally(() => setRetrying(false));
          }}
        >
          <RefreshCw size={14} aria-hidden="true" /> Reintentar
        </button>
      </div>
    );
  } else if (profile) {
    body = <EditPublicProfile key={profileKey} profile={profile} locked={locked} />;
  } else if (locked) {
    body = null;
  } else {
    body = <CreatePublicProfile />;
  }

  return (
    <>
      <section className="card" aria-labelledby="pp-title">
        <div className="card-head">
          <div>
            <div className="card-title" id="pp-title">
              <Globe size={16} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Perfil público
            </div>
            <div className="card-sub">Lo que ven los demás en la comunidad y en las clasificaciones</div>
          </div>
          {enabled && profile && <span className="badge success">Activo</span>}
        </div>
        {enabled && ban && (
          <div style={{ marginBottom: body ? 16 : 0 }}>
            <BanScreen compact />
          </div>
        )}
        {body}
      </section>
      {enabled && phase === 'ready' && <VisibleHabits locked={locked} hasProfile={Boolean(profile)} />}
    </>
  );
};
