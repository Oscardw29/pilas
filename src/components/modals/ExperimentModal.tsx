import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { CustomDatePicker } from '@/components/ui/CustomDatePicker';
import type { Experiment, ExperimentType } from '@/types';
import { todayKey } from '@/lib/dates';

interface ExperimentModalProps {
  isOpen: boolean;
  onClose: () => void;
  experimentToEdit?: Experiment;
}

const EXP_TYPES: { type: ExperimentType; label: string; desc: string }[] = [
  { type: 'schedule', label: 'Horarios', desc: 'Comparar dos horas del día (ej. 4 PM vs 8 PM)' },
  { type: 'duration', label: 'Duraciones', desc: 'Comparar sesiones cortas vs largas' },
  { type: 'method', label: 'Métodos de estudio/trabajo', desc: 'Pomodoro 25/5 vs Bloque continuo' },
  { type: 'frequency', label: 'Frecuencia', desc: 'Todos los días vs días alternados' },
  { type: 'version', label: 'Versión del hábito', desc: 'Gimnasio vs Calistenia en casa' },
  { type: 'breaks', label: 'Descansos', desc: 'Con pausas activas vs sin pausas' },
];

export const ExperimentModal: React.FC<ExperimentModalProps> = ({ isOpen, onClose, experimentToEdit }) => {
  const addExperiment = useStore((s) => s.addExperiment);
  const activeHabits = useStore((s) => s.habits).filter((h) => h.status === 'active');
  const { toast } = useToast();

  const [name, setName] = useState(experimentToEdit?.name ?? '');
  const [hypothesis, setHypothesis] = useState(experimentToEdit?.hypothesis ?? '');
  const [type, setType] = useState<ExperimentType>(experimentToEdit?.type ?? 'schedule');
  const [habitId, setHabitId] = useState<string>(experimentToEdit?.habitId ?? (activeHabits[0]?.id ?? ''));
  const [startDate, setStartDate] = useState(experimentToEdit?.startDate ?? todayKey());
  const [durationDays, setDurationDays] = useState(experimentToEdit?.durationDays ?? 14);

  // Variantes
  const [var1Label, setVar1Label] = useState(experimentToEdit?.variants[0]?.label ?? 'Variante A (Semana 1)');
  const [var2Label, setVar2Label] = useState(experimentToEdit?.variants[1]?.label ?? 'Variante B (Semana 2)');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const mid = Math.floor(durationDays / 2);
    const variants = [
      { id: 'var-a', label: var1Label.trim(), startDay: 1, endDay: mid },
      { id: 'var-b', label: var2Label.trim(), startDay: mid + 1, endDay: durationDays },
    ];

    addExperiment({
      name: name.trim(),
      hypothesis: hypothesis.trim(),
      type,
      habitId: habitId || undefined,
      startDate,
      durationDays,
      variants,
      status: 'running',
    });

    toast(`Experimento «${name}» puesto en marcha (14 días)`, 'success');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo experimento de hábito" wide preventBackdropClose={true}>
      <form onSubmit={handleSubmit} className="form">
        <p style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
          Crea un experimento de 14 días para comparar dos condiciones y dejar que tus propios datos revelen qué método o horario te funciona mejor.
        </p>

        <div className="form-row">
          <div className="field">
            <span className="label">Nombre del experimento</span>
            <input
              className="input"
              required
              placeholder="Ej. Encontrar mi mejor horario para C#"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Hábito evaluado</span>
            <CustomSelect
              value={habitId}
              onChange={setHabitId}
              options={activeHabits.map((h) => ({
                value: h.id,
                label: h.name,
                icon: h.icon,
              }))}
            />
          </div>
        </div>

        <div className="field">
          <span className="label">Tipo de experimento</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {EXP_TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                className={`card interactive ${type === t.type ? 'highlight' : ''}`}
                style={{ padding: 12, textAlign: 'left' }}
                onClick={() => setType(t.type)}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">Hipótesis a comprobar</span>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Ej. Estudiar por la tarde me permite mayor enfoque y menos cansancio que de noche..."
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
          />
        </div>

        {/* Variantes A y B */}
        <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Condiciones que vas a comparar</div>
          <div className="form-row">
            <div className="field">
              <span className="label">Días 1 a 7 (Fase 1)</span>
              <input
                className="input"
                required
                placeholder="Ej. 4:00 PM o Pomodoro 25/5"
                value={var1Label}
                onChange={(e) => setVar1Label(e.target.value)}
              />
            </div>

            <div className="field">
              <span className="label">Días 8 a 14 (Fase 2)</span>
              <input
                className="input"
                required
                placeholder="Ej. 8:00 PM o Bloque continuo"
                value={var2Label}
                onChange={(e) => setVar2Label(e.target.value)}
              />
            </div>
          </div>
        </div>

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
            <span className="label">Duración total (días)</span>
            <input
              type="number"
              min={7}
              max={60}
              className="input"
              value={durationDays}
              onChange={(e) => setDurationDays(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Lanzar experimento
          </button>
        </div>
      </form>
    </Modal>
  );
};
