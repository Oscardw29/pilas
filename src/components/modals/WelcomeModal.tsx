import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useSession } from '@/store/useSession';
import { playSound } from '@/lib/sound';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
import { BrandMark } from '@/components/ui/BrandMark';
import { personaFor } from '@/components/coach/coachPersona';
import type { UserGender } from '@/types';

const GENDERS: { value: UserGender; label: string }[] = [
  { value: 'male', label: 'Hombre' },
  { value: 'female', label: 'Mujer' },
  { value: 'other', label: 'Otro' },
];

const PREVIEW_EVENT = 'constancia:welcome-preview';

/** Vuelve a abrir la bienvenida como vista previa (desde Ajustes): no borra datos ni cambia ajustes */
export function openWelcomePreview() {
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT));
}

/**
 * Bienvenida del primer uso: nombre y género para el coach. Siempre se empieza desde cero
 * (los datos de ejemplo se pueden cargar después desde Ajustes).
 */
export const WelcomeModal: React.FC = () => {
  // Primer uso = la cuenta no tenía datos ni en este dispositivo ni en la nube al iniciar sesión
  const [open, setOpen] = useState(() => useSession.getState().firstRun);
  const [preview, setPreview] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<UserGender | undefined>(undefined);
  const persona = personaFor(gender);
  const updateSettings = useStore((s) => s.updateSettings);

  useEffect(() => {
    const onPreview = () => {
      const { userName, userGender } = useStore.getState().settings;
      setName(userName || '');
      setGender(userGender);
      setPreview(true);
      setOpen(true);
    };
    window.addEventListener(PREVIEW_EVENT, onPreview);
    return () => window.removeEventListener(PREVIEW_EVENT, onPreview);
  }, []);

  const finish = () => {
    if (preview) {
      setOpen(false);
      setPreview(false);
      return;
    }
    updateSettings({ userName: name.trim(), userGender: gender });
    useSession.getState().set({ firstRun: false });
    playSound.celebration();
    setOpen(false);
  };

  return (
    <Modal isOpen={open} onClose={finish} title="Bienvenido a ¡Pilas!" preventBackdropClose>
      <div className="form">
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <BrandMark size={44} className="welcome-logo" />
          <p style={{ color: 'var(--text-2)', lineHeight: 1.55 }}>
            Construye hábitos con versiones mínimas, rachas que perdonan días libres y un coach que analiza tus datos.
            Todo se guarda solo en este dispositivo.
          </p>
        </div>

        <label className="field">
          <span className="label">¿Cómo quieres que te llame?</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre o alias (opcional)"
            autoComplete="given-name"
            data-autofocus
            maxLength={40}
          />
        </label>

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
          <CoachAvatar gender={persona.gender} size={96} expression={gender ? 'happy' : 'neutral'} gesture={gender ? 'bounce' : null} gestureKey={gender ? GENDERS.findIndex((g) => g.value === gender) + 1 : 0} />
          <p className="welcome-coach-text" aria-live="polite">
            <strong>
              ¡Hola{name.trim() ? `, ${name.trim()}` : ''}! Soy {persona.name}
            </strong>
            , tu {persona.role}. Te acompaño con tus hábitos y te leo mis consejos en voz alta (me puedes silenciar).
          </p>
        </div>

        {preview && (
          <span className="hint" style={{ textAlign: 'center' }}>
            Vista previa: empezar solo cierra esta ventana, no cambia tus datos ni tus ajustes.
          </span>
        )}

        <button type="button" className="btn btn-primary lg" onClick={finish}>
          Empezar
        </button>
      </div>
    </Modal>
  );
};
