import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { MoodIcon, StatusIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { logKey } from '@/lib/metrics';
import type { Level5, SessionStatus } from '@/types';

interface SessionFinishModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinished?: () => void;
  zIndex?: number;
}

const MOODS: { level: Level5; label: string }[] = [
  { level: 1, label: 'Agotado' },
  { level: 2, label: 'Difícil' },
  { level: 3, label: 'Normal' },
  { level: 4, label: 'Bien' },
  { level: 5, label: 'Excelente' },
];

export const SessionFinishModal: React.FC<SessionFinishModalProps> = ({ isOpen, onClose, onFinished, zIndex }) => {
  const activeTimer = useStore((s) => s.activeTimer);
  const habits = useStore((s) => s.habits);
  const finishTimer = useStore((s) => s.finishTimer);
  const { toast } = useToast();

  const [mood, setMood] = useState<Level5>(4);
  const [difficulty, setDifficulty] = useState<Level5>(3);
  // Sin elegir = se calcula con el tiempo real. Los puntos y la racha dependen SIEMPRE del tiempo real.
  const [status, setStatus] = useState<SessionStatus | undefined>(undefined);
  const [note, setNote] = useState('');

  const habit = activeTimer ? habits.find((h) => h.id === activeTimer.habitId) : null;

  const handleFinish = (e: React.FormEvent) => {
    e.preventDefault();
    const session = finishTimer({ mood, difficulty, status, note: note.trim() || undefined });
    if (session) {
      const log = useStore.getState().logs[logKey(session.date, session.habitId)];
      const minutes = Math.round(session.durationSec / 60);
      if (log?.status === 'partial') {
        toast(`Sesión registrada: ${minutes} min en «${habit?.name ?? 'Hábito'}»`, 'info', 'Aún no alcanzas la versión mínima de hoy: sin puntos ni racha por ahora.');
      } else {
        toast(`Sesión registrada: ${minutes} min en «${habit?.name ?? 'Hábito'}»`, 'success');
      }
    }
    onFinished?.();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Terminar sesión" zIndex={zIndex ?? 1300} preventBackdropClose={true}>
      <form onSubmit={handleFinish} className="form">
        {habit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'var(--surface-2)' }}>
            <span style={{ fontSize: 24 }}>{habit.icon}</span>
            <div>
              <div style={{ fontWeight: 600 }}>{habit.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Objetivo: {habit.targetMinutes ? `${habit.targetMinutes} min` : 'Sin tiempo fijo'}
              </div>
            </div>
          </div>
        )}

        {/* Nivel de cumplimiento */}
        <div className="field">
          <span className="label">Resultado de la sesión</span>
          <div className="segmented">
            <button
              type="button"
              className={status === 'completed' ? 'active' : ''}
              aria-pressed={status === 'completed'}
              onClick={() => setStatus((cur) => (cur === 'completed' ? undefined : 'completed'))}
            >
              <StatusIcon status="full" size={14} /> Objetivo completado
            </button>
            <button
              type="button"
              className={status === 'minimum' ? 'active' : ''}
              aria-pressed={status === 'minimum'}
              onClick={() => setStatus((cur) => (cur === 'minimum' ? undefined : 'minimum'))}
            >
              <StatusIcon status="minimum" size={14} /> Versión mínima
            </button>
            <button
              type="button"
              className={status === 'abandoned' ? 'active' : ''}
              aria-pressed={status === 'abandoned'}
              onClick={() => setStatus((cur) => (cur === 'abandoned' ? undefined : 'abandoned'))}
            >
              Interrumpida / Incompleta
            </button>
          </div>
          <span className="hint">Opcional. Los puntos y la racha se calculan con el tiempo real registrado.</span>
        </div>

        {/* ¿Cómo fue? */}
        <div className="field">
          <span className="label">¿Cómo te sentiste?</span>
          <div className="level-picker">
            {MOODS.map((m) => (
              <button
                key={m.level}
                type="button"
                className={mood === m.level ? 'active' : ''}
                onClick={() => setMood(m.level)}
              >
                <span className="level-picker-icon"><MoodIcon level={m.level} size={26} /></span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Dificultad percibida */}
        <div className="field">
          <span className="label">Dificultad (1 = muy fácil, 5 = muy difícil)</span>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={lvl <= difficulty ? 'on' : ''}
                onClick={() => setDifficulty(lvl as Level5)}
                aria-label={`${lvl} estrellas`}
              >
                <Star fill={lvl <= difficulty ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div className="field">
          <span className="label">Notas (opcional)</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder="¿Qué aprendiste o qué obstáculo encontraste?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar sesión
          </button>
        </div>
      </form>
    </Modal>
  );
};
