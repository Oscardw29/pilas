import React, { useEffect, useRef, useState } from 'react';
import { Globe, Lock } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { playSound } from '@/lib/sound';
import { effectivePreset, type DefaultAvatarId } from '@/lib/defaultAvatars';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
import { BrandMark } from '@/components/ui/BrandMark';
import { useToast } from '@/components/ui/ToastContext';
import { personaFor } from '@/components/coach/coachPersona';
import { ImageCropModal } from '@/components/ui/ImageCropModal';
import { blobToDataUrl, imageDimensions, isAnimatedWebp, isWebp, readBytes } from '@/social/images';
import { AliasInput, useAliasCheck } from '@/components/settings/AliasInput';
import { AvatarPresetPicker, type AvatarChoice } from '@/components/settings/AvatarPresetPicker';
import { useSocial } from '@/social/useSocial';
import type { UserGender } from '@/types';
import '@/components/settings/settings.css';

const GENDERS: { value: UserGender; label: string }[] = [
  { value: 'male', label: 'Hombre' },
  { value: 'female', label: 'Mujer' },
  { value: 'other', label: 'Otro' },
];

const PREVIEW_EVENT = 'constancia:welcome-preview';
/** La foto de perfil se guarda a 256×256 (igual que en Mi perfil) */
const AVATAR_SIZE = 256;

/** Vuelve a abrir la bienvenida como vista previa (desde Ajustes): no borra datos ni cambia ajustes */
export function openWelcomePreview() {
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT));
}

/** Foto por defecto ya elegida o, si no hay, la que corresponde a la cuenta (la misma que ya se ve en la app) */
const presetFrom = (n: number | undefined): DefaultAvatarId => effectivePreset(n, useSession.getState().user?.id ?? '');

/**
 * Bienvenida del primer uso: nombre (obligatorio), alias (opcional, comprobado en vivo), género (el coach será Pilo o
 * Pila) y foto (una de las 5 por defecto, preseleccionada la que ya corresponde a tu cuenta, o la tuya). Siempre se empieza desde cero (los datos
 * de ejemplo se pueden cargar después desde Ajustes). Con esto se crea solo el perfil público (social/runtime.ts).
 */
export const WelcomeModal: React.FC = () => {
  // Primer uso = la cuenta no tenía datos ni en este dispositivo ni en la nube al iniciar sesión
  const [open, setOpen] = useState(() => useSession.getState().firstRun);
  const [preview, setPreview] = useState(false);
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [gender, setGender] = useState<UserGender | undefined>(undefined);
  const [preset, setPreset] = useState<DefaultAvatarId>(() => presetFrom(useStore.getState().settings.avatarPreset));
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [choice, setChoice] = useState<AvatarChoice>(() => preset);
  const [uploading, setUploading] = useState(false);
  const [cropSource, setCropSource] = useState<Blob | null>(null);
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const persona = personaFor(gender);
  const updateSettings = useStore((s) => s.updateSettings);
  const profileAlias = useSocial((s) => s.profile?.alias ?? null);
  const { showToast } = useToast();
  const aliasCheck = useAliasCheck(alias, preview ? profileAlias : null);
  const nameOk = name.trim().length > 0;
  const canFinish = nameOk && aliasCheck.ok;

  useEffect(() => {
    const onPreview = () => {
      const { userName, userGender, avatarPreset, avatarDataUrl, pendingAlias } = useStore.getState().settings;
      const p = presetFrom(avatarPreset);
      setName(userName || '');
      setAlias(useSocial.getState().profile?.alias ?? pendingAlias ?? '');
      setGender(userGender);
      setPreset(p);
      setPhoto(avatarDataUrl);
      setChoice(avatarDataUrl ? 'own' : p);
      setTouched(false);
      setPreview(true);
      setOpen(true);
    };
    window.addEventListener(PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(PREVIEW_EVENT, onPreview);
  }, []);

  const onChoose = (c: AvatarChoice) => {
    setChoice(c);
    if (c !== 'own') setPreset(c);
    playSound.pop();
  };

  const takePhoto = (dataUrl: string) => {
    setPhoto(dataUrl);
    setChoice('own');
    playSound.pop();
  };

  // Si la imagen no mide justo 256×256 (WebP), se abre el recorte en círculo, igual que en Mi perfil
  const onUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('El archivo no es una imagen.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('La imagen pesa demasiado (máximo 15 MB).', 'error');
      return;
    }
    setUploading(true);
    try {
      const { width, height } = await imageDimensions(file);
      const bytes = await readBytes(file);
      if (width === AVATAR_SIZE && height === AVATAR_SIZE && isWebp(bytes) && !isAnimatedWebp(bytes) && file.size <= 1024 * 1024) {
        takePhoto(await blobToDataUrl(file));
      } else {
        setCropSource(file);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'No se pudo usar esa imagen', 'error');
    } finally {
      setUploading(false);
    }
  };

  const close = () => {
    setOpen(false);
    setPreview(false);
  };

  const finish = () => {
    if (preview) return close();
    if (!canFinish) {
      setTouched(true);
      if (!nameOk) nameRef.current?.focus();
      return;
    }
    updateSettings({
      userName: name.trim(),
      userGender: gender,
      avatarPreset: preset,
      // La foto propia solo si quedó elegida (si después eligió una por defecto, se descarta)
      ...(choice === 'own' && photo ? { avatarDataUrl: photo } : {}),
      // El alias llega al perfil público cuando se crea (si sigue libre)
      pendingAlias: alias || undefined,
    });
    useSession.getState().set({ firstRun: false });
    playSound.celebration();
    close();
  };

  const greetName = alias || name.trim();

  return (
    <>
      <Modal isOpen={open} onClose={finish} title="Bienvenido a ¡Pilas!" preventBackdropClose>
        <div className="form">
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <BrandMark size={44} className="welcome-logo" />
            <p style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
              Construye hábitos con versiones mínimas, rachas que perdonan días libres y un coach que analiza tus datos.
            </p>
          </div>

          <label className="field">
            <span className="label">¿Cómo te llamas?</span>
            <input
              ref={nameRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="given-name"
              data-autofocus
              maxLength={40}
              required
              aria-invalid={touched && !nameOk}
              aria-describedby="welcome-name-hint"
            />
            <span id="welcome-name-hint" className="hint" style={touched && !nameOk ? { color: 'var(--danger)' } : undefined}>
              {touched && !nameOk ? 'Escribe tu nombre para empezar.' : 'Así te llama tu coach. En la comunidad se ve si no eliges alias.'}
            </span>
          </label>

          <AliasInput value={alias} onChange={setAlias} check={aliasCheck} />

          <div className="field">
            <span className="label" id="welcome-photo-label">
              Tu foto
            </span>
            <AvatarPresetPicker
              value={choice}
              onChange={onChoose}
              ownPhoto={photo}
              onUpload={(f) => void onUpload(f)}
              uploading={uploading}
              labelledBy="welcome-photo-label"
            />
          </div>

          <div className="field">
            <span className="label" id="welcome-gender-label">
              ¿Con qué te identificas?
            </span>
            <div className="gender-options" role="radiogroup" aria-labelledby="welcome-gender-label">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  role="radio"
                  aria-checked={gender === g.value}
                  className="gender-option"
                  onClick={() => setGender(g.value)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="welcome-coach">
            <CoachAvatar
              gender={persona.gender}
              size={96}
              expression={gender ? 'happy' : 'neutral'}
              gesture={gender ? 'bounce' : null}
              gestureKey={gender ? GENDERS.findIndex((g) => g.value === gender) + 1 : 0}
            />
            <p className="welcome-coach-text" aria-live="polite">
              <strong>
                ¡Hola{greetName ? `, ${greetName}` : ''}! Soy {persona.name}
              </strong>
              , tu {persona.role}. Te acompaño con tus hábitos y, si configuras mi voz en Ajustes, te leo mis consejos en voz alta.
            </p>
          </div>

          <div className="privacy-note" role="note" aria-label="Privacidad">
            <p className="is-public">
              <Globe aria-hidden />
              <span>
                <strong>Público en la comunidad:</strong> tu nombre o alias, tu foto y tus cifras (racha, XP, logros y ligas).
              </span>
            </p>
            <p className="is-private">
              <Lock aria-hidden />
              <span>
                <strong>Cifrado, solo para ti:</strong> tus registros, tus notas y los hábitos que no marques como visibles.
              </span>
            </p>
          </div>

          {preview && (
            <span className="hint" style={{ textAlign: 'center' }}>
              Vista previa: empezar solo cierra esta ventana, no cambia tus datos ni tus ajustes.
            </span>
          )}

          <button type="button" className="btn btn-primary lg" onClick={finish} aria-disabled={!preview && !canFinish}>
            Empezar
          </button>
        </div>
      </Modal>
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
    </>
  );
};
