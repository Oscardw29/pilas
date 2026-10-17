import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { CustomDatePicker } from '@/components/ui/CustomDatePicker';
import type { Goal, GoalStatus, Priority } from '@/types';
import { todayKey } from '@/lib/dates';
import { fireGoalCelebration } from '@/lib/confetti';
import { playSound } from '@/lib/sound';
import { CirclePlay, CirclePause, Trophy, Ban } from 'lucide-react';

interface GoalModalProps {
  isOpen: boolean;
  onClose: () => void;
  goalToEdit?: Goal;
}

const GOAL_ICONS = ['🎯', '💻', '💪', '🧘', '🎸', '📚', '🚀', '💰', '🧠', '🌱', '🏆', '⭐', '✈️', '🏠'];
export const GOAL_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Aprendizaje', icon: '📚' },
  { name: 'Salud', icon: '💪' },
  { name: 'Bienestar', icon: '🧘' },
  { name: 'Carrera', icon: '🚀' },
  { name: 'Creatividad', icon: '🎨' },
  { name: 'Finanzas', icon: '💰' },
  { name: 'Personal', icon: '🌱' },
];

const COLORS = ['#8b5cf6', '#34d399', '#22d3ee', '#f472b6', '#fbbf24', '#f97316', '#60a5fa'];

export const GoalModal: React.FC<GoalModalProps> = ({ isOpen, onClose, goalToEdit }) => {
  const addGoal = useStore((s) => s.addGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const { toast } = useToast();

  const [name, setName] = useState(goalToEdit?.name ?? '');
  const [description, setDescription] = useState(goalToEdit?.description ?? '');
  const [category, setCategory] = useState(goalToEdit?.category ?? GOAL_CATEGORIES[0].name);
  const [icon, setIcon] = useState(goalToEdit?.icon ?? GOAL_CATEGORIES[0].icon);
  const [color, setColor] = useState(goalToEdit?.color ?? COLORS[0]);

  const handleCategoryChange = (newCat: string) => {
    setCategory(newCat);
    const matched = GOAL_CATEGORIES.find((c) => c.name === newCat);
    if (matched) {
      setIcon(matched.icon);
    }
  };
  const [priority, setPriority] = useState<Priority>(goalToEdit?.priority ?? 3);
  const [startDate, setStartDate] = useState(goalToEdit?.startDate ?? todayKey());
  const [targetDate, setTargetDate] = useState(goalToEdit?.targetDate ?? '');
  const [status, setStatus] = useState<GoalStatus>(goalToEdit?.status ?? 'active');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      name: name.trim(),
      description: description.trim(),
      category,
      icon,
      color,
      priority,
      startDate,
      targetDate: targetDate.trim() || undefined,
      status,
    };

    if (goalToEdit) {
      updateGoal(goalToEdit.id, payload);
      if (status === 'completed' && goalToEdit.status !== 'completed') {
        fireGoalCelebration();
        playSound.goalComplete();
      }
      toast(`Objetivo «${name}» actualizado`, 'success');
    } else {
      addGoal(payload);
      if (status === 'completed') {
        fireGoalCelebration();
        playSound.goalComplete();
      }
      toast(`Objetivo «${name}» creado`, 'success');
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={goalToEdit ? 'Editar objetivo' : 'Nuevo objetivo'}
      wide
      preventBackdropClose={true}
    >
      <form onSubmit={handleSubmit} className="form">
        <div className="form-row">
          <div className="field">
            <span className="label">Nombre del objetivo</span>
            <input
              className="input"
              required
              placeholder="Ej. Aprender programación, Correr un maratón..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Categoría</span>
            <CustomSelect
              value={category}
              onChange={handleCategoryChange}
              options={GOAL_CATEGORIES.map((c) => ({
                value: c.name,
                label: c.name,
                icon: c.icon,
              }))}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Descripción</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder="¿Qué significa lograr este objetivo y por qué es importante para ti?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* Icono y color */}
        <div className="form-row">
          <div className="field">
            <span className="label">Icono</span>
            <div className="emoji-grid" style={{ maxHeight: 80, overflowY: 'auto' }}>
              {GOAL_ICONS.map((em) => (
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
            <span className="label">Color</span>
            <div className="swatches" style={{ marginTop: 6 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch ${color === c ? 'active' : ''}`}
                  style={{ '--c': c } as React.CSSProperties}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Fechas */}
        <div className="form-row">
          <div className="field">
            <span className="label">Fecha de inicio</span>
            <CustomDatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Por defecto hoy..."
            />
          </div>

          <div className="field">
            <span className="label">Fecha objetivo (opcional)</span>
            <CustomDatePicker
              value={targetDate}
              onChange={setTargetDate}
              min={startDate || undefined}
              placeholder="Fecha límite acumulativa..."
            />
            <span className="hint">Si se establece, el progreso es acumulativo hasta esa fecha.</span>
          </div>
        </div>

        {/* Prioridad y Estado */}
        <div className="form-row">
          <div className="field">
            <span className="label">Prioridad</span>
            <CustomSelect<Priority>
              value={priority}
              onChange={setPriority}
              options={[
                { value: 3, label: 'Alta (enfoque principal)', badge: 'P3' },
                { value: 2, label: 'Media', badge: 'P2' },
                { value: 1, label: 'Baja', badge: 'P1' },
              ]}
            />
          </div>

          {goalToEdit && (
            <div className="field">
              <span className="label">Estado</span>
              <CustomSelect<GoalStatus>
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'active', label: 'Activo', icon: <CirclePlay size={16} color="var(--success)" /> },
                  { value: 'paused', label: 'Pausado', icon: <CirclePause size={16} color="var(--warning)" /> },
                  { value: 'completed', label: 'Completado', icon: <Trophy size={16} color="#facc15" /> },
                  { value: 'abandoned', label: 'Abandonado', icon: <Ban size={16} color="var(--danger)" /> },
                ]}
              />
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {goalToEdit ? 'Guardar cambios' : 'Crear objetivo'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
