import React, { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Check, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { ImageCropModal } from '@/components/ui/ImageCropModal';
import { useToast, type ToastType } from '@/components/ui/ToastContext';
import { DEFAULT_AVATARS, defaultAvatarSrc, effectivePreset, type DefaultAvatarId } from '@/lib/defaultAvatars';
import { useSession } from '@/store/useSession';
import { playSound } from '@/lib/sound';
import { getAchievementDefs, getUserAchievements, updateProfile, type ProfilePatch } from '@/social/api';
import { blobToDataUrl, imageDimensions, isAnimatedWebp, isWebp, readBytes } from '@/social/images';
import { myUserId } from '@/social/runtime';
import { BANNER_COLORS, KIND_LABEL, RARITY } from '@/social/texts';
import { useSocial } from '@/social/useSocial';
import type { AchievementDef, BannerColor, CatalogItem, ProfileCard, ProfileRow } from '@/social/types';
import type { Habit, Settings } from '@/types';
import { CosmeticPreview } from './CosmeticPreview';
import { reportSocialError, syncPublicAvatar } from './publicProfile';
import './profile.css';

/**
 * EDITAR EL PERFIL (modo edición de «Mi perfil»)
 * Todo perfil es público: aquí se elige cómo se ve. Foto (subida y encuadrada en el dispositivo o una de las 5 por
 * defecto), biografía, banner (o el color del banner por defecto), marco, tarjeta de ranking, tarjetas visibles,
 * logros destacados y hábitos visibles. Nada se aplica hasta «Guardar»: la cabecera de arriba muestra el borrador.
 * El alias también va en el borrador, pero se escribe en la cabecera, en el sitio del nombre (ProfileView).
 * El servidor vuelve a comprobarlo todo (profiles_guard): aquí solo se ofrece lo que la persona tiene.
 */

export const AVATAR_SIZE = 256;
export const BIO_MAX = 160;
const MAX_FEATURED = 3;

export const CARD_OPTIONS: { id: ProfileCard; label: string; hint: string }[] = [
  { id: 'streak', label: 'Racha actual', hint: 'Los días seguidos que llevas (la más alta siempre se ve)' },
  { id: 'xp_week', label: 'XP de la semana', hint: 'Barras día a día con el total debajo' },
  { id: 'member_since', label: 'Miembro desde', hint: 'La fecha en que creaste tu cuenta' },
  { id: 'habits', label: 'Hábitos visibles', hint: 'La semana de los hábitos que marques abajo' },
  { id: 'achievements', label: 'Logros destacados', hint: 'Los 3 logros que elijas' },
];

/* ---------------- Borrador ---------------- */

export interface ProfileDraft {
  /** Foto subida en este borrador o la que ya tenías (data URL) */
  upload: string | null;
  /** La foto activa es la subida (si no, la por defecto `preset`) */
  useUpload: boolean;
  preset: DefaultAvatarId | null;
  /** Vacío = sin alias (se muestra el nombre) */
  alias: string;
  bio: string;
  bannerColor: BannerColor | null;
  banner: string | null;
  frame: string | null;
  card: string | null;
  cards: ProfileCard[];
  featured: string[];
  /** Ids de los hábitos visibles en el perfil */
  visible: string[];
}

/** Foto por defecto vigente: la elegida o, si nunca se eligió, la que se deriva de la cuenta (igual que en Avatar.tsx) */
const presetOf = (n: number | undefined): DefaultAvatarId => effectivePreset(n, useSession.getState().user?.id ?? '');
const activeHabits = (habits: Habit[]) => habits.filter((h) => h.status !== 'archived');
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function draftFrom(settings: Settings, profile: ProfileRow | null, habits: Habit[]): ProfileDraft {
  return {
    upload: settings.avatarDataUrl ?? null,
    useUpload: Boolean(settings.avatarDataUrl),
    preset: presetOf(settings.avatarPreset),
    alias: profile?.alias ?? '',
    bio: profile?.bio ?? '',
    bannerColor: profile?.banner_color ?? null,
    banner: profile?.banner_item ?? null,
    frame: profile?.frame_item ?? null,
    card: profile?.card_item ?? null,
    cards: profile?.cards ?? [],
    featured: profile?.featured_achievements ?? [],
    visible: activeHabits(habits)
      .filter((h) => h.publicVisible)
      .map((h) => h.id),
  };
}

/** Qué cambia el borrador respecto a lo guardado (sin perfil, solo la foto) */
export function draftChanges(draft: ProfileDraft, settings: Settings, profile: ProfileRow | null, habits: Habit[]) {
  const photo = draft.useUpload
    ? draft.upload !== (settings.avatarDataUrl ?? null)
    : Boolean(settings.avatarDataUrl) || draft.preset !== presetOf(settings.avatarPreset);
  const patch: ProfilePatch = {};
  const habitChanges: { id: string; on: boolean }[] = [];
  if (profile) {
    if (draft.alias !== (profile.alias ?? '')) patch.alias = draft.alias || null;
    const bio = draft.bio.trim();
    if (bio !== (profile.bio ?? '')) patch.bio = bio;
    if (draft.bannerColor !== (profile.banner_color ?? null)) patch.banner_color = draft.bannerColor;
    if (draft.banner !== profile.banner_item) patch.banner_item = draft.banner;
    if (draft.frame !== profile.frame_item) patch.frame_item = draft.frame;
    if (draft.card !== profile.card_item) patch.card_item = draft.card;
    const ordered = CARD_OPTIONS.map((o) => o.id).filter((id) => draft.cards.includes(id));
    if (!sameSet(ordered, profile.cards ?? [])) patch.cards = ordered;
    if (!sameList(draft.featured, profile.featured_achievements ?? [])) patch.featured_achievements = draft.featured;
    for (const h of activeHabits(habits)) {
      const on = draft.visible.includes(h.id);
      if (on !== Boolean(h.publicVisible)) habitChanges.push({ id: h.id, on });
    }
  }
  return { photo, patch, habits: habitChanges, dirty: photo || Object.keys(patch).length > 0 || habitChanges.length > 0 };
}

/** La foto que muestra el borrador */
export const draftAvatarSrc = (d: ProfileDraft) => (d.useUpload && d.upload ? d.upload : defaultAvatarSrc(d.preset));

/**
 * Guarda el borrador: primero el perfil público (alias, cosméticos, biografía, tarjetas), después los hábitos visibles (se
 * publican solos con el resto de datos) y por último la foto, que se guarda en el dispositivo y se publica.
 * Devuelve `false` si no se pudo guardar el perfil (el borrador sigue abierto para reintentar).
 */
export async function applyProfileDraft(
  draft: ProfileDraft,
  withProfile: boolean,
  showToast: (msg: string, type?: ToastType) => void,
): Promise<boolean> {
  const { settings, habits, updateSettings, updateHabit } = useStore.getState();
  const profile = withProfile ? useSocial.getState().profile : null;
  const ch = draftChanges(draft, settings, profile, habits);
  const uid = myUserId();

  if (profile && uid && Object.keys(ch.patch).length) {
    try {
      const row = await updateProfile(uid, ch.patch);
      useSocial.getState().set({ profile: row, ...(ch.patch.alias !== undefined ? { aliasConflict: null } : {}) });
    } catch (err) {
      reportSocialError(err, showToast, 'No se pudo guardar tu perfil');
      return false;
    }
  }

  for (const h of ch.habits) updateHabit(h.id, { publicVisible: h.on });

  if (ch.photo) {
    if (draft.useUpload && draft.upload) updateSettings({ avatarDataUrl: draft.upload });
    else updateSettings({ avatarDataUrl: undefined, avatarPreset: draft.preset ?? presetOf(settings.avatarPreset) });
    if (profile) {
      try {
        await syncPublicAvatar(draft.useUpload && draft.upload ? draft.upload : undefined);
      } catch (err) {
        reportSocialError(err, showToast, 'Tu foto se guardó en este dispositivo, pero no se pudo publicar');
      }
    }
  }
  return true;
}

/* ---------------- Piezas ---------------- */

/** Flechas en un grupo de botones tipo radio: mueven la selección como en un grupo de radios nativo */
function onRadioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
  e.preventDefault();
  items[next].focus();
  items[next].click();
}

const EditCard = forwardRef<HTMLElement, { title: string; sub?: string; aside?: React.ReactNode; children: React.ReactNode }>(
  ({ title, sub, aside, children }, ref) => {
    const id = useId();
    return (
      <section ref={ref} className="card ph-edit-card" aria-labelledby={id} tabIndex={-1}>
        <div className="card-head">
          <div>
            <h2 className="card-title" id={id}>
              {title}
            </h2>
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {aside}
        </div>
        {children}
      </section>
    );
  },
);
EditCard.displayName = 'EditCard';

const CosmeticPicker: React.FC<{
  kind: 'banner' | 'frame' | 'card';
  items: CatalogItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  bannerColor?: BannerColor | null;
  disabled?: boolean;
}> = ({ kind, items, value, onChange, bannerColor, disabled }) => {
  const options: (CatalogItem | null)[] = [null, ...items];
  const noneLabel = kind === 'banner' ? 'Por defecto' : 'Ninguno';
  // Si lo equipado no está en la lista (catálogo aún sin cargar), el grupo sigue siendo alcanzable con Tab
  const anySelected = options.some((o) => (o?.id ?? null) === value);
  return (
    <>
      <div className={`cos-picker kind-${kind}`} role="radiogroup" aria-label={KIND_LABEL[kind].one} onKeyDown={onRadioKeys}>
        {options.map((item) => {
          const selected = (item?.id ?? null) === value;
          return (
            <button
              key={item?.id ?? 'none'}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (!anySelected && !item) ? 0 : -1}
              aria-label={item ? `${item.name} (${RARITY[item.rarity].label})` : noneLabel}
              className={`cos-pick ${selected ? 'is-selected' : ''}`}
              onClick={() => {
                if (!selected) playSound.click();
                onChange(item?.id ?? null);
              }}
              disabled={disabled}
            >
              <CosmeticPreview kind={kind} item={item} size="sm" bannerColor={kind === 'banner' ? bannerColor : undefined} />
              <span className="cos-pick-name">{item?.name ?? noneLabel}</span>
              {selected && (
                <span className="cos-pick-check" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {items.length === 0 && <p className="hint ph-edit-hint">Aún no tienes {KIND_LABEL[kind].many.toLowerCase()}. Consíguelos en la tienda.</p>}
    </>
  );
};

/* ---------------- Editor ---------------- */

interface OwnedAchievement {
  def: AchievementDef;
  at: string;
}

export const ProfileEditor: React.FC<{
  draft: ProfileDraft;
  onChange: (patch: Partial<ProfileDraft>) => void;
  /** `photo` = sin perfil público disponible (sin conexión, sin servidor o con veto): solo la foto */
  scope: 'full' | 'photo';
  /** Por qué solo se puede cambiar la foto */
  photoOnlyNote?: string | null;
  disabled?: boolean;
  photoRef?: React.Ref<HTMLElement>;
  bannerRef?: React.Ref<HTMLElement>;
}> = ({ draft, onChange, scope, photoOnlyNote, disabled, photoRef, bannerRef }) => {
  const { showToast } = useToast();
  const habits = useStore((s) => s.habits);
  const { catalog, inventory, profile } = useSocial(useShallow((s) => ({ catalog: s.catalog, inventory: s.inventory, profile: s.profile })));
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [achievements, setAchievements] = useState<OwnedAchievement[] | null>(null);
  const bioId = useId();
  const full = scope === 'full';

  // Logros que tiene la persona (para elegir los destacados)
  const uid = profile?.user_id;
  useEffect(() => {
    if (!full || !uid) return;
    let active = true;
    Promise.all([getUserAchievements(uid), getAchievementDefs()])
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
  }, [full, uid]);

  const owned = useMemo(() => {
    const inv = new Set(inventory);
    const of = (kind: CatalogItem['kind']) => catalog.filter((c) => c.kind === kind && inv.has(c.id));
    return { banner: of('banner'), frame: of('frame'), card: of('card') };
  }, [catalog, inventory]);

  const list = activeHabits(habits);

  /* ---------- Foto ---------- */

  const takePhoto = (dataUrl: string) => {
    onChange({ upload: dataUrl, useUpload: true });
    playSound.pop();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('El archivo no es una imagen.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('La imagen pesa demasiado (máximo 15 MB).', 'error');
      return;
    }
    setReading(true);
    try {
      const { width, height } = await imageDimensions(file);
      // Ya mide lo pedido y es WebP fijo: se usa tal cual. Si no, se encuadra (una foto animada queda fija: lo animado
      // es de los cosméticos)
      const bytes = await readBytes(file);
      if (width === AVATAR_SIZE && height === AVATAR_SIZE && isWebp(bytes) && !isAnimatedWebp(bytes) && file.size <= 1024 * 1024) {
        takePhoto(await blobToDataUrl(file));
      } else {
        setCropSource(file);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo usar esa imagen', 'error');
    } finally {
      setReading(false);
    }
  };

  const removePhoto = () => {
    onChange({ upload: null, useUpload: false, preset: draft.preset ?? presetOf(useStore.getState().settings.avatarPreset) });
    playSound.delete();
  };

  const photoSection = (
    <EditCard
      ref={photoRef}
      title="Foto de perfil"
      sub="Sube una foto (la encuadras antes de guardarla) o elige una de las fotos de ¡Pilas!"
    >
      <div className="ph-photo-options" role="radiogroup" aria-label="Foto de perfil" onKeyDown={onRadioKeys}>
        {draft.upload && (
          <button
            type="button"
            role="radio"
            aria-checked={draft.useUpload}
            tabIndex={draft.useUpload ? 0 : -1}
            aria-label="Tu foto"
            className="ph-photo-opt"
            onClick={() => onChange({ useUpload: true })}
            disabled={disabled}
          >
            <img src={draft.upload} alt="" draggable={false} />
            <span className="ph-photo-opt-label">Tu foto</span>
          </button>
        )}
        {DEFAULT_AVATARS.map((a) => {
          const on = !draft.useUpload && draft.preset === a.id;
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!draft.useUpload && !draft.preset && a.id === 1) ? 0 : -1}
              aria-label={`Foto por defecto: ${a.label}`}
              className="ph-photo-opt"
              onClick={() => {
                if (!on) playSound.click();
                onChange({ useUpload: false, preset: a.id });
              }}
              disabled={disabled}
            >
              <img src={a.src} alt="" draggable={false} />
              <span className="ph-photo-opt-label">{a.label}</span>
            </button>
          );
        })}
      </div>
      <div className="ph-photo-actions">
        <input ref={fileRef} type="file" accept="image/*" hidden tabIndex={-1} onChange={(e) => void onPickFile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
        <button type="button" className="btn btn-secondary sm" onClick={() => fileRef.current?.click()} disabled={disabled || reading}>
          <Upload aria-hidden="true" /> {reading ? 'Leyendo la imagen…' : draft.upload ? 'Subir otra foto' : 'Subir foto'}
        </button>
        {draft.upload && (
          <button type="button" className="btn btn-ghost sm ph-danger" onClick={() => setConfirmRemove(true)} disabled={disabled}>
            <Trash2 aria-hidden="true" /> Quitar foto
          </button>
        )}
      </div>
      {photoOnlyNote && <p className="hint ph-edit-hint">{photoOnlyNote}</p>}
    </EditCard>
  );

  const modals = (
    <>
      <ImageCropModal
        source={cropSource}
        shape="circle"
        width={AVATAR_SIZE}
        height={AVATAR_SIZE}
        title="Encuadra tu foto"
        hint="Foto de perfil"
        quality={0.85}
        onCancel={() => setCropSource(null)}
        onDone={async (blob) => {
          takePhoto(await blobToDataUrl(blob));
          setCropSource(null);
        }}
      />
      <ConfirmModal
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          removePhoto();
        }}
        title="¿Quitar tu foto?"
        message="Volverás a una de las fotos por defecto (puedes elegir cuál). El cambio se aplica al guardar."
        confirmLabel="Quitar foto"
        danger
      />
    </>
  );

  if (!full) {
    return (
      <div className="ph-editor">
        {photoSection}
        {modals}
      </div>
    );
  }

  /* ---------- Resto del perfil ---------- */

  const toggleCard = (id: ProfileCard, on: boolean) => {
    onChange({ cards: on ? [...draft.cards.filter((c) => c !== id), id] : draft.cards.filter((c) => c !== id) });
    playSound.toggle();
  };
  // Los destacados que ya no tienes (tras quitar la demostración o si el creador te quitó uno) no se dibujan: no
  // cuentan para el tope ni bloquean elegir otros, y al guardar se descartan
  const ownedIds = achievements ? new Set(achievements.map((a) => a.def.id)) : null;
  const featured = ownedIds ? draft.featured.filter((id) => ownedIds.has(id)) : draft.featured;
  const toggleFeatured = (id: string) => {
    const f = featured;
    onChange({ featured: f.includes(id) ? f.filter((x) => x !== id) : f.length >= MAX_FEATURED ? f : [...f, id] });
    playSound.click();
  };
  const toggleHabit = (id: string, on: boolean) => {
    onChange({ visible: on ? [...draft.visible.filter((x) => x !== id), id] : draft.visible.filter((x) => x !== id) });
    playSound.toggle();
  };

  const shopLink = (
    <Link to="/recompensas" className="btn btn-ghost sm">
      <ShoppingBag size={14} aria-hidden="true" /> Tienda
    </Link>
  );

  return (
    <div className="ph-editor">
      {photoSection}

      <EditCard title="Biografía" sub="Unas palabras sobre ti. La ve cualquiera bajo tu nombre.">
        <div className="field">
          <label className="ph-sr" htmlFor={bioId}>
            Biografía
          </label>
          <textarea
            id={bioId}
            className="textarea"
            rows={3}
            maxLength={BIO_MAX}
            value={draft.bio}
            placeholder="Ej.: Aprendiendo a correr 5 km y a leer cada noche 📚"
            onChange={(e) => onChange({ bio: e.target.value.replace(/\n{2,}/g, '\n').slice(0, BIO_MAX) })}
            aria-describedby={`${bioId}-count`}
            disabled={disabled}
          />
          <span id={`${bioId}-count`} className={`hint ph-counter ${draft.bio.length >= BIO_MAX ? 'is-full' : ''}`} aria-live="polite">
            {draft.bio.length}/{BIO_MAX}
          </span>
        </div>
      </EditCard>

      <EditCard ref={bannerRef} title="Banner" sub="La franja de arriba de tu perfil. Se ve también en la vista previa al publicar." aside={shopLink}>
        <CosmeticPicker
          kind="banner"
          items={owned.banner}
          value={draft.banner}
          bannerColor={draft.bannerColor}
          onChange={(banner) => onChange({ banner })}
          disabled={disabled}
        />
        {draft.banner === null && (
          <div className="ph-colors-wrap">
            <span className="label" id={`${bioId}-colors`}>
              Color del banner
            </span>
            <div className="ph-colors" role="radiogroup" aria-labelledby={`${bioId}-colors`} onKeyDown={onRadioKeys}>
              {BANNER_COLORS.map((c) => {
                const on = (draft.bannerColor ?? 'violet') === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    aria-label={c.label}
                    title={c.label}
                    className="ph-color"
                    style={{ '--from': c.from, '--to': c.to } as React.CSSProperties}
                    onClick={() => {
                      if (!on) playSound.click();
                      onChange({ bannerColor: c.id });
                    }}
                    disabled={disabled}
                  >
                    {on && <Check aria-hidden="true" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </EditCard>

      <EditCard title="Marco" sub="Rodea tu foto en toda la app: perfil, clasificaciones, publicaciones…" aside={shopLink}>
        <CosmeticPicker kind="frame" items={owned.frame} value={draft.frame} onChange={(frame) => onChange({ frame })} disabled={disabled} />
      </EditCard>

      <EditCard title="Tarjeta de ranking" sub="El fondo de tu fila en las clasificaciones y en tu liga." aside={shopLink}>
        <CosmeticPicker kind="card" items={owned.card} value={draft.card} onChange={(card) => onChange({ card })} disabled={disabled} />
      </EditCard>

      <EditCard title="Tarjetas visibles" sub="Qué más se ve en tu perfil. Tu nivel y tu racha más alta se ven siempre.">
        <div className="pp-switches">
          {CARD_OPTIONS.map((o) => (
            <label key={o.id} className="custom-switch pp-switch">
              <input type="checkbox" checked={draft.cards.includes(o.id)} onChange={(e) => toggleCard(o.id, e.target.checked)} disabled={disabled} />
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
      </EditCard>

      <EditCard title={`Logros destacados (${featured.length}/${MAX_FEATURED})`} sub="Se ven en la tarjeta «Logros destacados». Elige hasta 3.">
        {achievements === null ? (
          <p className="hint">Cargando tus logros…</p>
        ) : achievements.length === 0 ? (
          <p className="hint">
            Aún no tienes logros. <Link to="/logros">Mira cómo conseguirlos</Link>.
          </p>
        ) : (
          <div className="pp-achievements" role="group" aria-label="Logros destacados">
            {achievements.map(({ def, at }) => {
              const on = featured.includes(def.id);
              const isFull = !on && featured.length >= MAX_FEATURED;
              return (
                <button
                  key={def.id}
                  type="button"
                  className={`pp-achievement ${on ? 'is-on' : ''}`}
                  style={{ ['--r' as string]: RARITY[def.rarity].color, ['--r-text' as string]: RARITY[def.rarity].text }}
                  aria-pressed={on}
                  disabled={disabled || isFull}
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
      </EditCard>

      <EditCard
        title="Hábitos visibles"
        sub="Solo se publican el nombre, el icono y el cumplimiento por día de los que actives. Los demás nunca salen cifrados de tu dispositivo."
        aside={
          <span className="badge accent">
            {draft.visible.filter((id) => list.some((h) => h.id === id)).length}/{list.length}
          </span>
        }
      >
        {list.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Aún no tienes hábitos.
          </p>
        ) : (
          <ul className="pp-habits">
            {list.map((h) => (
              <li key={h.id}>
                <label className="custom-switch pp-habit">
                  <input type="checkbox" checked={draft.visible.includes(h.id)} onChange={(e) => toggleHabit(h.id, e.target.checked)} disabled={disabled} />
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
      </EditCard>
      {modals}
    </div>
  );
};
