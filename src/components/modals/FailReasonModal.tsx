import React, { useState } from 'react';
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
          <span className="label">Motivo principal</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(Object.keys(FAIL_REASON_LABELS) as FailReason[]).map((r) => (
              <label
                key={r}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 10,
                  background: reason === r ? 'var(--accent-soft)' : 'var(--surface-2)',
                  border: `1px solid ${reason === r ? 'var(--accent)' : 'var(--border-2)'}`,
                  cursor: 'pointer',
                  transition: '.15s',
                }}
              >
                <input
                  type="radio"
                  name="failReason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: 13.5, fontWeight: reason === r ? 600 : 400 }}>
                  {FAIL_REASON_LABELS[r]}
                </span>
              </label>
            ))}
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
