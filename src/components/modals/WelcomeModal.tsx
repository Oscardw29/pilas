import React, { useState } from 'react';
import { Sparkles, Sprout, LayoutDashboard } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useStore, isFirstRun } from '@/store/useStore';
import { playSound } from '@/lib/sound';

/**
 * Bienvenida del primer uso: el usuario elige empezar vacío o explorar con datos de ejemplo,
 * en lugar de encontrarse directamente con hábitos y rachas ficticias.
 */
export const WelcomeModal: React.FC = () => {
  const [open, setOpen] = useState(isFirstRun);
  const [name, setName] = useState('');
  const updateSettings = useStore((s) => s.updateSettings);
  const resetEmpty = useStore((s) => s.resetEmpty);

  const finish = (mode: 'empty' | 'demo') => {
    if (mode === 'empty') resetEmpty();
    updateSettings({ userName: name.trim() });
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
