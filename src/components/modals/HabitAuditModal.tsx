import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useStore, useData } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { consistency } from '@/lib/metrics';
import type { Habit, HabitReviewDecision } from '@/types';
import { HabitModal } from './HabitModal';
import { Check, Pause, Play, PencilLine, Trash2 } from 'lucide-react';
import { PausedBadge } from '@/components/ui/icons';

interface HabitAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HabitAuditModal: React.FC<HabitAuditModalProps> = ({ isOpen, onClose }) => {
  const data = useData();
  const setHabitStatus = useStore((s) => s.setHabitStatus);
  const deleteHabit = useStore((s) => s.deleteHabit);
  const addHabitReview = useStore((s) => s.addHabitReview);
  const { toast } = useToast();

  const [habitToEdit, setHabitToEdit] = useState<Habit | null>(null);
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);

  // Mostrar tanto activos como pausados
  const habitsToAudit = data.habits.filter((h) => h.status === 'active' || h.status === 'paused');
  const activeCount = habitsToAudit.filter((h) => h.status === 'active').length;

  const handleDecision = (habit: Habit, decision: HabitReviewDecision) => {
    addHabitReview({ habitId: habit.id, decision });

    if (decision === 'pause') {
      setHabitStatus(habit.id, 'paused');
      toast(`«${habit.name}» pausado (no afectará tus métricas ni rachas)`, 'info');
    } else if (decision === 'delete') {
      setHabitToDelete(habit);
    } else if (decision === 'modify') {
      setHabitToEdit(habit);
    } else {
      toast(`«${habit.name}» confirmado en tu rutina`, 'success');
    }
  };

  const handleResume = (habit: Habit) => {
    setHabitStatus(habit.id, 'active');
    toast(`«${habit.name}» reanudado y activo en tu rutina`, 'success');
  };

  const handleConfirmDelete = () => {
    if (!habitToDelete) return;
    deleteHabit(habitToDelete.id);
    toast(`«${habitToDelete.name}» eliminado`, 'info');
    setHabitToDelete(null);
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Auditoría inteligente de hábitos" wide>
        <div className="stack">
          <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
            Tienes <strong>{activeCount} hábitos activos</strong> y{' '}
            <strong>{habitsToAudit.length - activeCount} pausados</strong>. Los hábitos pausados no afectan
            tus rachas ni análisis. Revisa cuáles mantener, pausar o reanudar.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
            {habitsToAudit.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--muted)' }}>
                No tienes hábitos registrados para auditar.
              </div>
            ) : (
              habitsToAudit.map((h) => {
                const isPaused = h.status === 'paused';
                const c = consistency(data, h, 30);
                const cPct = c != null ? Math.round(c * 100) : null;
                const isLow = !isPaused && cPct != null && cPct < 40;

                return (
                  <div
                    key={h.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      borderRadius: 14,
                      background: isPaused ? 'rgba(23, 23, 31, 0.65)' : 'var(--surface-2)',
                      border: isPaused
                        ? '1px dashed rgba(234, 179, 8, 0.35)'
                        : `1px solid ${isLow ? 'rgba(248, 113, 113, 0.3)' : 'var(--border-2)'}`,
                      gap: 12,
                      flexWrap: 'wrap',
                      opacity: isPaused ? 0.85 : 1,
                      transition: 'all .2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{h.icon}</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{h.name}</span>
                          {isPaused && (
                            <PausedBadge />
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {isPaused ? (
                            <span style={{ color: 'var(--warning)' }}>En pausa · No cuenta para rachas ni insights</span>
                          ) : (
                            <>
                              Consistencia 30d:{' '}
                              <strong style={{ color: isLow ? 'var(--danger)' : 'var(--text)' }}>
                                {cPct != null ? `${cPct}%` : 'Reciente'}
                              </strong>
                              {isLow && ' · Rendimiento problemático'}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {isPaused ? (
                        <button
                          type="button"
                          className="btn btn-secondary sm"
                          style={{ color: 'var(--success)', borderColor: 'rgba(34, 197, 94, 0.4)' }}
                          onClick={() => handleResume(h)}
                        >
                          <Play size={13} strokeWidth={2.6} aria-hidden="true" /> Reanudar
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary sm"
                            onClick={() => handleDecision(h, 'keep')}
                          >
                            <Check size={13} strokeWidth={2.8} aria-hidden="true" /> Mantener
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary sm"
                            onClick={() => handleDecision(h, 'pause')}
                          >
                            <Pause size={13} strokeWidth={2.6} aria-hidden="true" /> Pausar
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        className="btn btn-secondary sm"
                        onClick={() => handleDecision(h, 'modify')}
                      >
                        <PencilLine size={13} aria-hidden="true" /> Modificar
                      </button>

                      <button
                        type="button"
                        className="icon-btn sm danger"
                        title="Eliminar"
                        aria-label="Eliminar"
                        onClick={() => handleDecision(h, 'delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="modal-foot">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Finalizar revisión
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal para editar hábito sobre el modal de auditoría (con zIndex superior) */}
      {habitToEdit && (
        <HabitModal
          isOpen={!!habitToEdit}
          onClose={() => setHabitToEdit(null)}
          habitToEdit={habitToEdit}
          zIndex={1150}
        />
      )}

      {/* Confirmación personalizada para eliminar hábito */}
      {habitToDelete && (
        <ConfirmModal
          isOpen={!!habitToDelete}
          onClose={() => setHabitToDelete(null)}
          onConfirm={handleConfirmDelete}
          title="¿Eliminar hábito definitivamente?"
          message={`¿Estás seguro de que deseas eliminar «${habitToDelete.name}»? Tus registros y puntos acumulados se conservarán.`}
          confirmLabel="Eliminar definitivamente"
          confirmVariant="danger"
        />
      )}
    </>
  );
};
