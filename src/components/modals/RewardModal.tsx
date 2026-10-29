import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import type { Reward } from '@/types';
import { rewardDays } from '@/lib/economy';

interface RewardModalProps {
  isOpen: boolean;
  onClose: () => void;
  rewardToEdit?: Reward;
}

const REWARD_ICONS = ['🎮', '🛍️', '🍕', '🎬', '☕', '🍦', '🎧', '📱', '🏖️', '🛋️', '🎁', '🍫', '📺', '🎟️', '✈️', '💆'];

export const RewardModal: React.FC<RewardModalProps> = ({ isOpen, onClose, rewardToEdit }) => {
  const addReward = useStore((s) => s.addReward);
  const updateReward = useStore((s) => s.updateReward);
  const { toast } = useToast();
  const econData = useStore(
    useShallow((s) => ({
      habits: s.habits, logs: s.logs, pointEvents: s.pointEvents, redemptions: s.redemptions, streakFreezes: s.streakFreezes,
      xpBoosts: s.xpBoosts, settings: s.settings,
    })),
  );

  const [name, setName] = useState(rewardToEdit?.name ?? '');
  const [icon, setIcon] = useState(rewardToEdit?.icon ?? REWARD_ICONS[0]);
  const [cost, setCost] = useState(rewardToEdit?.cost ?? 150);
  const [description, setDescription] = useState(rewardToEdit?.description ?? '');

  React.useEffect(() => {
    if (isOpen) {
      setName(rewardToEdit?.name ?? '');
      setIcon(rewardToEdit?.icon ?? REWARD_ICONS[0]);
      setCost(rewardToEdit?.cost ?? 150);
      setDescription(rewardToEdit?.description ?? '');
    }
  }, [isOpen, rewardToEdit]);

  // «Este premio equivale a N días de tu ritmo actual» (se actualiza mientras se escribe el precio; nunca bloquea)
  const equivalence = useMemo(() => rewardDays(econData, cost > 0 ? cost : 0), [econData, cost]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !(cost > 0)) return;

    if (rewardToEdit) {
      updateReward(rewardToEdit.id, { name: name.trim(), icon, cost, description: description.trim() || undefined });
      toast(`Recompensa «${name}» actualizada`, 'success');
    } else {
      addReward({ name: name.trim(), icon, cost, description: description.trim() || undefined });
      toast(`Recompensa «${name}» creada`, 'success');
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={rewardToEdit ? 'Editar recompensa' : 'Nueva recompensa'} preventBackdropClose={true}>
      <form onSubmit={handleSubmit} className="form">
        <div className="field">
          <span className="label">¿Qué te quieres regalar?</span>
          <input
            className="input"
            required
            placeholder="Ej. Jugar 2 horas, Pedir sushi..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <label className="field">
          <span className="label">Descripción (opcional)</span>
          <textarea
            className="textarea"
            rows={2}
            maxLength={160}
            placeholder="Ej. Una tarde libre de videojuegos sin culpa, después de cumplir mis hábitos."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span className="hint">Se muestra en la tarjeta del premio. Si la dejas vacía se usa un texto genérico.</span>
        </label>

        <div className="field">
          <span className="label">Icono</span>
          <div className="emoji-grid">
            {REWARD_ICONS.map((em) => (
              <button
                key={em}
                type="button"
                className={`emoji-opt ${icon === em ? 'active' : ''}`}
                onClick={() => setIcon(em)}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Costo en puntos</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              max={100000}
              className="input"
              style={{ width: 120 }}
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
            />
            <div className="chips">
              {[50, 100, 250, 500, 1000].map((v) => (
                <button key={v} type="button" className="chip" onClick={() => setCost(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <span className="hint" role="status" aria-live="polite">
            {equivalence.kind === 'no-history'
              ? 'Aún no hay suficiente historial para estimar los días.'
              : `Este premio equivale a ${equivalence.days} ${equivalence.days === 1 ? 'día' : 'días'} de tu ritmo actual.`}
          </span>
          {equivalence.kind === 'too-easy' && (
            <span className="hint" style={{ color: 'var(--warning)' }}>
              Es muy fácil de conseguir, ¿seguro que motiva?
            </span>
          )}
          {equivalence.kind === 'too-far' && (
            <span className="hint" style={{ color: 'var(--warning)' }}>
              Puede tardar demasiado, considera bajarlo.
            </span>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {rewardToEdit ? 'Guardar cambios' : 'Crear recompensa'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
