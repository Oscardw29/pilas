import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import type { Challenge } from '@/types';
import { todayKey } from '@/lib/dates';

interface ChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  challengeToEdit?: Challenge;
}

const CHALLENGE_ICONS = ['🌅', '📵', '🏃', '📚', '🧘', '💧', '🥗', '🎯', '💪', '🏆'];

export const ChallengeModal: React.FC<ChallengeModalProps> = ({ isOpen, onClose, challengeToEdit }) => {
  const addChallenge = useStore((s) => s.addChallenge);
  const updateChallenge = useStore((s) => s.updateChallenge);
  const { toast } = useToast();

  const [name, setName] = useState(challengeToEdit?.name ?? '');
  const [icon, setIcon] = useState(challengeToEdit?.icon ?? CHALLENGE_ICONS[0]);
  const [description, setDescription] = useState(challengeToEdit?.description ?? '');
  const [metric, setMetric] = useState(challengeToEdit?.metric ?? 'Días cumplidos');
  const [startDate, setStartDate] = useState(challengeToEdit?.startDate ?? todayKey());
  const [durationDays, setDurationDays] = useState(challengeToEdit?.durationDays ?? 30);
  const [successDays, setSuccessDays] = useState(challengeToEdit?.successDays ?? 25);
  const [rewardPoints, setRewardPoints] = useState(challengeToEdit?.rewardPoints ?? 250);
  const [rewardText, setRewardText] = useState(challengeToEdit?.rewardText ?? '');
  const [conditions, setConditions] = useState(challengeToEdit?.conditions ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      name: name.trim(),
      icon,
      description: description.trim(),
      metric: metric.trim(),
      startDate,
      durationDays: Number(durationDays) || 30,
      successDays: Number(successDays) || 25,
      rewardPoints: Number(rewardPoints) || 0,
      rewardText: rewardText.trim() || undefined,
      conditions: conditions.trim() || undefined,
    };

    if (challengeToEdit) {
      updateChallenge(challengeToEdit.id, payload);
      toast(`Reto «${name}» actualizado`, 'success');
    } else {
      addChallenge(payload);
      toast(`Reto «${name}» iniciado. ¡Mucho éxito!`, 'reward');
    }

    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={challengeToEdit ? 'Editar reto' : 'Nuevo reto temporal'} wide preventBackdropClose={true}>
      <form onSubmit={handleSubmit} className="form">
        <div className="form-row">
          <div className="field">
            <span className="label">Nombre del reto</span>
            <input
              className="input"
              required
              placeholder="Ej. Levantarme temprano, 30 días sin azúcar..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Métrica que se mide</span>
            <input
              className="input"
              required
              placeholder="Ej. Días antes de las 7:00 AM"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Icono</span>
          <div className="emoji-grid" style={{ maxHeight: 70, overflowY: 'auto' }}>
            {CHALLENGE_ICONS.map((em) => (
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
          <span className="label">Descripción o motivación</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder="¿Por qué quieres asumir este reto durante las próximas semanas?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Duración y Días de éxito */}
        <div className="form-row">
          <div className="field">
            <span className="label">Duración total (días)</span>
            <input
              type="number"
              min={7}
              max={365}
              className="input"
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
            />
          </div>

          <div className="field">
            <span className="label">Días mínimos para ganar</span>
            <input
              type="number"
              min={1}
              max={durationDays}
              className="input"
              value={successDays}
              onChange={(e) => setSuccessDays(Number(e.target.value))}
            />
            <span className="hint">Ej. 25 de 30 días cumplidos</span>
          </div>
        </div>

        {/* Recompensa */}
        <div className="form-row">
          <div className="field">
            <span className="label">Puntos de bonificación al ganar</span>
            <input
              type="number"
              min={0}
              max={5000}
              className="input"
              value={rewardPoints}
              onChange={(e) => setRewardPoints(Number(e.target.value))}
            />
          </div>

          <div className="field">
            <span className="label">Premio personal simbólico</span>
            <input
              className="input"
              placeholder="Ej. Cena especial, comprarme los tenis..."
              value={rewardText}
              onChange={(e) => setRewardText(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Condiciones y reglas claras (opcional)</span>
          <input
            className="input"
            placeholder="Ej. No vale quedarse en cama usando el móvil"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {challengeToEdit ? 'Guardar cambios' : 'Iniciar reto'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
