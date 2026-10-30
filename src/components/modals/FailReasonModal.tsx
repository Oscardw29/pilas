import React, { useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import type { DateKey, FailReason, Habit } from '@/types';
import { FAIL_REASON_LABELS } from '@/lib/insights';

interface FailReasonModalProps {
  isOpen: boolean;
  onClose: () => void;
  habit: Habit;
  date: DateKey;
}

export const FailReasonModal: React.FC<FailReasonModalProps> = ({ isOpen, onClose, habit, date }) => {
  const logHabit = useStore((s) => s.logHabit);
  const { toast } = useToast();

  const [reason, setReason] = useState<FailReason>('no_time');
  const [note, setNote] = useState('');
  const reasonLabelId = useId();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    logHabit(habit.id, date, 'missed', {
      failReason: reason,
      failNote: note.trim() || undefined,
    });
    toast(`Hábito registrado como no realizado (${FAIL_REASON_LABELS[reason]})`, 'info');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="¿Por qué no pudiste realizarlo?">
      <form onSubmit={handleSave} className="form">
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          Identificar qué te impidió hacer <strong>«{habit.name}»</strong> ayuda a detectar patrones y ajustar el hábito para que no vuelva a ocurrir.
        </p>

        <div className="field">
          <span className="label" id={reasonLabelId}>
            Motivo principal
          </span>
          {/* Opciones tipo radio propias (botones con role="radio"), sin el control nativo */}
          <div role="radiogroup" aria-labelledby={reasonLabelId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(Object.keys(FAIL_REASON_LABELS) as FailReason[]).map((r) => {
              const on = reason === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setReason(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
                    cursor: 'pointer',
                    transition: 'background-color .15s, border-color .15s',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 18,
                      height: 18,
                      flexShrink: 0,
                      borderRadius: '50%',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    {on && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: on ? 600 : 400, color: 'var(--text)' }}>{FAIL_REASON_LABELS[r]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span className="label">Nota adicional (opcional)</span>
          <input
            className="input"
            placeholder="Ej. Reunión inesperada, dolor de cabeza..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar motivo
          </button>
        </div>
      </form>
    </Modal>
  );
};
