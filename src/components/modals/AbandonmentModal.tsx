import React from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import type { CheckinAnswer } from '@/types';
import type { AbandonmentAlert } from '@/lib/insights';

interface AbandonmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  alert: AbandonmentAlert;
}

const CHECKIN_OPTIONS: { key: CheckinAnswer; label: string; desc: string }[] = [
  { key: 'tired', label: 'Estoy cansado / baja energía', desc: 'Sugeriremos priorizar versiones mínimas o descanso.' },
  { key: 'too_much_work', label: 'Tengo demasiado trabajo', desc: 'Podemos reducir temporalmente la duración de las sesiones.' },
  { key: 'needs_change', label: 'Necesito modificar mis hábitos', desc: 'Ajustemos horarios o dificultades sin culpa.' },
  { key: 'not_interested', label: 'El hábito ya no me interesa', desc: 'Es válido pausar o eliminar lo que ya no te suma.' },
  { key: 'all_good', label: 'Fue una semana atípica, todo está bien', desc: 'Retomaremos el ritmo habitual sin cambios.' },
];

export const AbandonmentModal: React.FC<AbandonmentModalProps> = ({ isOpen, onClose, alert }) => {
  const addCheckin = useStore((s) => s.addCheckin);
  const { toast } = useToast();

  const handleSelect = (answer: CheckinAnswer) => {
    addCheckin({ answer, habitId: alert.habitId });
    toast('Respuesta registrada. Adaptaremos tus recomendaciones.', 'info');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Parece que estás perdiendo el ritmo">
      <div className="stack">
        <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.5 }}>
          {alert.type === 'habit' ? (
            <>Tu consistencia en <strong>«{alert.habitName}»</strong> ha caído un <strong>{alert.dropPercentage}%</strong> recientemente.</>
          ) : (
            <>Tu actividad general disminuyó un <strong>{alert.dropPercentage}%</strong> durante la última semana.</>
          )}
          {' '}Esto no es un regaño; queremos ayudarte a ajustar el sistema para que vuelva a ser sostenible.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
            ¿Qué está pasando actualmente?
          </span>

          {CHECKIN_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className="card interactive"
              style={{ padding: '12px 16px', textAlign: 'left' }}
              onClick={() => handleSelect(opt.key)}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
};
