import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import type { Reward } from '@/types';

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

  const [name, setName] = useState(rewardToEdit?.name ?? '');
  const [icon, setIcon] = useState(rewardToEdit?.icon ?? REWARD_ICONS[0]);
  const [cost, setCost] = useState(rewardToEdit?.cost ?? 150);

  React.useEffect(() => {
    if (isOpen) {
      setName(rewardToEdit?.name ?? '');
      setIcon(rewardToEdit?.icon ?? REWARD_ICONS[0]);
      setCost(rewardToEdit?.cost ?? 150);
    }
  }, [isOpen, rewardToEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !(cost > 0)) return;

    if (rewardToEdit) {
      updateReward(rewardToEdit.id, { name: name.trim(), icon, cost });
      toast(`Recompensa «${name}» actualizada`, 'success');
    } else {
      addReward({ name: name.trim(), icon, cost });
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
