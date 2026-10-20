import React, { useEffect, useState } from 'react';
import { Sparkles, Sprout, LayoutDashboard } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useStore, isFirstRun } from '@/store/useStore';
import { playSound } from '@/lib/sound';
import { CoachAvatar } from '@/components/coach/CoachAvatar';
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
 * Bienvenida del primer uso: el usuario elige empezar vacío o explorar con datos de ejemplo,
 * en lugar de encontrarse directamente con hábitos y rachas ficticias.
 */
export const WelcomeModal: React.FC = () => {
  const [open, setOpen] = useState(isFirstRun);
  const [preview, setPreview] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<UserGender | undefined>(undefined);
  const persona = personaFor(gender);
  const updateSettings = useStore((s) => s.updateSettings);
  const resetEmpty = useStore((s) => s.resetEmpty);

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

  const finish = (mode: 'empty' | 'demo') => {
    if (preview) {
      setOpen(false);
      setPreview(false);
      return;
    }
    if (mode === 'empty') resetEmpty();
    updateSettings({ userName: name.trim(), userGender: gender });
    playSound.celebration();
    setOpen(false);
  };

  return (
    <Modal isOpen={open} onClose={() => finish('demo')} title="Bienvenido a ¡Pilas!" preventBackdropClose>
      <div className="form">
        <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="empty-icon" style={{ marginBottom: 0 }} aria-hidden="true">
            <Sparkles />
          </div>
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
            Vista previa: elegir una opción solo cierra esta ventana, no cambia tus datos ni tus ajustes.
          </span>
        )}

        <div className="welcome-options">
          <button type="button" className="welcome-option" onClick={() => finish('empty')}>
            <Sprout aria-hidden="true" />
            <span className="welcome-option-title">Empezar desde cero</span>
            <span className="welcome-option-sub">Crea tus propios objetivos y hábitos.</span>
          </button>
          <button type="button" className="welcome-option" onClick={() => finish('demo')}>
            <LayoutDashboard aria-hidden="true" />
            <span className="welcome-option-title">Explorar con datos de ejemplo</span>
            <span className="welcome-option-sub">~9 semanas de historial para ver todas las métricas. Puedes borrarlos en Ajustes.</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
