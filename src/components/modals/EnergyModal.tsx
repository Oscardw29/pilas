import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { EnergyIcon } from '@/components/ui/icons';
import type { Level5 } from '@/types';

interface EnergyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENERGY_LEVELS: { level: Level5; label: string }[] = [
  { level: 1, label: '1 - Muy baja' },
  { level: 2, label: '2 - Baja' },
  { level: 3, label: '3 - Regular' },
  { level: 4, label: '4 - Buena' },
  { level: 5, label: '5 - Al máximo' },
];

export const EnergyModal: React.FC<EnergyModalProps> = ({ isOpen, onClose }) => {
  const addEnergy = useStore((s) => s.addEnergy);
  const { toast } = useToast();
  const [level, setLevel] = useState<Level5>(3);
  const [note, setNote] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    addEnergy(level, note.trim() || undefined);
    toast(`Nivel de energía registrado (${level}/5)`, 'success');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="¿Cómo está tu energía hoy?">
      <form onSubmit={handleSave} className="form">
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.5 }}>
          Registrar tu energía permite que la app te sugiera versiones mínimas en días difíciles o sesiones de alta prioridad cuando estés al 100%.
        </p>

        <div className="field">
          <div className="level-picker" style={{ justifyContent: 'space-between' }}>
            {ENERGY_LEVELS.map((el) => (
              <button
                key={el.level}
                type="button"
                className={level === el.level ? 'active' : ''}
                onClick={() => {
                  setLevel(el.level);
                  playSound.energy(el.level as 1 | 2 | 3 | 4 | 5);
                }}
                style={{ flex: 1 }}
              >
                <span className="level-picker-icon"><EnergyIcon level={el.level} size={28} /></span>
                <span style={{ fontSize: 11, textAlign: 'center' }}>{el.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">¿Algún factor que influyó? (opcional)</span>
          <input
            className="input"
            placeholder="Ej. Dormí 7 horas, resfriado, día con mucho trabajo..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar energía
          </button>
        </div>
      </form>
    </Modal>
  );
};
