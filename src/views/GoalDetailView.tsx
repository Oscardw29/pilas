import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Flame,
  CheckCircle2,
  TrendingUp,
  Edit,
  Trash2,
  Plus,
  Trophy,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useStore, useData } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { fireGoalCelebration } from '@/lib/confetti';
import { playSound } from '@/lib/sound';
import {
  goalProgress,
  goalHabits,
  goalProgressHistory,
  consistency,
  bestStreak,
  lastActivity,
} from '@/lib/metrics';
import { formatMinutes, relativeDay, todayKey } from '@/lib/dates';
import { GoalModal } from '@/components/modals/GoalModal';
import { HabitModal } from '@/components/modals/HabitModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { PausedBadge } from '@/components/ui/icons';

export const GoalDetailView: React.FC = () => {
  const { id, goalId } = useParams<{ id?: string; goalId?: string }>();
  const targetId = id || goalId;
  const navigate = useNavigate();
  const data = useData();
  const deleteGoal = useStore((s) => s.deleteGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const { toast } = useToast();

  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddHabitModal, setShowAddHabitModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);

  const goal = data.goals.find((g) => g.id === targetId);
  if (!goal) {
    return (
      <div className="card empty">
        <h3>Objetivo no encontrado</h3>
        <button className="btn btn-secondary" onClick={() => navigate('/objetivos')}>
          Volver a Objetivos
        </button>
      </div>
    );
  }

  const T = todayKey();
  const currentProg = Math.round(goalProgress(data, goal, T) * 100);
  const weightedHabits = goalHabits(data, goal.id);

  // Estadísticas agregadas del objetivo
  const associatedHabitIds = weightedHabits.map((w) => w.habit.id);
  const goalSessions = data.sessions.filter((s) => associatedHabitIds.includes(s.habitId));
  const totalDurationMin = goalSessions.reduce((a, s) => a + s.durationSec / 60, 0);

  const activeDaysSet = new Set(goalSessions.map((s) => s.date));
  const activeDaysCount = activeDaysSet.size;

  const maxBestStreak = Math.max(...weightedHabits.map((w) => bestStreak(data, w.habit, T)), 0);

  // Consistencia promedio ponderada
  const avgConsistency = Math.round(
    weightedHabits.reduce((acc, w) => acc + (consistency(data, w.habit, 30, T) ?? 0) * w.weight, 0) * 100,
  );

  // Última actividad
  const lastDates = weightedHabits
    .map((w) => lastActivity(data, w.habit.id))
    .filter((d): d is string => !!d);
  const latestActivity = lastDates.length ? [...lastDates].sort().reverse()[0] : null;

  // Historial de progreso semanal para el gráfico
  const history = goalProgressHistory(data, goal, 8, T).map((h, i) => ({
    semana: `Sem ${i + 1}`,
    progreso: Math.round(h.progress * 100),
  }));

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    deleteGoal(goal.id);
    playSound.delete();
    toast(`Objetivo «${goal.name}» eliminado`, 'info');
    navigate('/objetivos');
  };

  const handleToggleComplete = () => {
    if (goal.status === 'completed') {
      setShowReopenConfirm(true);
    } else {
      updateGoal(goal.id, { status: 'completed' });
      fireGoalCelebration();
      playSound.goalComplete();
      toast(`¡Felicidades! Objetivo «${goal.name}» completado`, 'reward');
    }
  };

  const confirmReopen = () => {
    updateGoal(goal.id, { status: 'active' });
    toast(`Objetivo «${goal.name}» reactivado`, 'info');
    setShowReopenConfirm(false);
  };

  return (
    <div className="stack fade-up">
      {/* Botón Volver */}
      <button className="btn btn-ghost sm" onClick={() => navigate('/objetivos')} style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={16} /> Volver a Objetivos
      </button>

      {/* Cabecera del Objetivo */}
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 44 }}>{goal.icon}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge sm">{goal.category}</span>
              <span className="badge accent">Prioridad {goal.priority === 3 ? 'Alta' : goal.priority === 2 ? 'Media' : 'Baja'}</span>
              <span className={`badge ${goal.status === 'completed' ? 'success' : 'info'}`}>
                {goal.status === 'completed' ? <><Trophy size={11} aria-hidden="true" /> Completado</> : goal.status === 'active' ? 'Activo' : goal.status === 'paused' ? 'Pausado' : 'Abandonado'}
              </span>
            </div>
            <h1 style={{ marginTop: 4 }}>{goal.name}</h1>
          </div>
        </div>

        <div className="actions">
          <button
            className={`btn ${goal.status === 'completed' ? 'btn-secondary' : 'btn-primary'} sm`}
            onClick={handleToggleComplete}
          >
            <CheckCircle2 size={15} />
            {goal.status === 'completed' ? 'Reabrir objetivo' : 'Marcar como completado'}
          </button>
          <button className="btn btn-secondary sm" onClick={() => setShowEditModal(true)}>
            <Edit size={14} /> Editar
          </button>
          <button className="btn btn-ghost sm danger" onClick={handleDelete}>
            <Trash2 size={14} /> Eliminar
          </button>
        </div>
      </div>

      {goal.description && (
        <p style={{ color: 'var(--text-2)', fontSize: 14.5 }}>{goal.description}</p>
      )}

      {/* PROGRESO GENERAL DESTACADO */}
      <div className="card highlight">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>PROGRESO ACTUAL</div>
            <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)' }}>
              {currentProg}%
            </div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {goal.targetDate ? `Meta fijada para ${goal.targetDate}` : 'Seguimiento continuo a 30 días'}
          </span>
        </div>

        <div className="progress thick">
          <div style={{ width: `${currentProg}%`, background: goal.color }} />
        </div>
      </div>

      {/* ESTADÍSTICAS DEL OBJETIVO */}
      <div className="grid-4">
        <div className="card stat">
          <div className="stat-top">
            <span className="stat-label">Horas invertidas</span>
            <span className="stat-icon" style={{ '--c': 'var(--success)' } as React.CSSProperties}>
              <Clock />
            </span>
          </div>
          <div className="stat-value">{formatMinutes(totalDurationMin)}</div>
          <div className="stat-sub">{goalSessions.length} sesiones realizadas</div>
        </div>

        <div className="card stat">
          <div className="stat-top">
            <span className="stat-label">Días activos</span>
            <span className="stat-icon" style={{ '--c': 'var(--info)' } as React.CSSProperties}>
              <Calendar />
            </span>
          </div>
          <div className="stat-value">{activeDaysCount}</div>
          <div className="stat-sub">Días con avance registrado</div>
        </div>

        <div className="card stat">
          <div className="stat-top">
            <span className="stat-label">Consistencia media</span>
            <span className="stat-icon" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
              <CheckCircle2 />
            </span>
          </div>
          <div className="stat-value">{avgConsistency}%</div>
          <div className="stat-sub">Últimos 30 días ponderados</div>
        </div>

        <div className="card stat">
          <div className="stat-top">
            <span className="stat-label">Mejor racha</span>
            <span className="stat-icon" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
              <Flame />
            </span>
          </div>
          <div className="stat-value">
            {maxBestStreak} <small>días</small>
          </div>
          <div className="stat-sub">
            {latestActivity ? `Última actividad: ${relativeDay(latestActivity)}` : 'Sin registros aún'}
          </div>
        </div>
      </div>

      {/* HÁBITOS ASOCIADOS Y SU PESO PONDERADO */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Hábitos asociados</h3>
            <p className="card-sub">Cada hábito aporta al objetivo según su peso de impacto</p>
          </div>
          <button className="btn btn-secondary sm" onClick={() => setShowAddHabitModal(true)}>
            <Plus size={14} /> Nuevo hábito para esta meta
          </button>
        </div>

        {weightedHabits.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {weightedHabits.map(({ habit, weight, rawWeight }) => {
              const hConsistency = Math.round((consistency(data, habit, 30, T) ?? 0) * 100);
              const isPaused = habit.status === 'paused';

              return (
                <div
                  key={habit.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '14px 16px',
                    borderRadius: 14,
                    background: isPaused ? 'color-mix(in srgb, var(--yellow) 5%, transparent)' : 'var(--surface-2)',
                    border: isPaused ? '1.5px solid var(--yellow)' : '1px solid var(--border)',
                    boxShadow: isPaused ? '0 0 12px color-mix(in srgb, var(--yellow) 15%, transparent)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 22 }}>{habit.icon}</span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 14 }}>{habit.name}</strong>
                          {isPaused && (
                            <PausedBadge />
                          )}
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Peso: <strong>{rawWeight}%</strong> ({Math.round(weight * 100)}% efectivo)
                        </span>
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: isPaused ? 'var(--yellow)' : 'var(--accent-2)' }}>
                      {hConsistency}%
                    </div>
                  </div>

                  <div className="progress">
                    <div style={{ width: `${hConsistency}%`, background: isPaused ? 'var(--yellow)' : habit.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted small">
            Este objetivo no tiene hábitos asignados todavía. Crea o edita un hábito para vincularlo aquí.
          </p>
        )}
      </div>

      {/* HISTORIAL DE EVOLUCIÓN */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Evolución histórica</h3>
            <p className="card-sub">Cómo ha progresado el objetivo semana a semana</p>
          </div>
          <span className="badge info">
            <TrendingUp size={13} /> Tendencia acumulada
          </span>
        </div>

        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history}>
              <XAxis dataKey="semana" stroke="var(--muted)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted)" fontSize={12} tickLine={false} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--popover)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 12,
                  color: 'var(--popover-text)',
                  fontSize: 13,
                  boxShadow: '0 12px 32px color-mix(in srgb, var(--shadow-color) 85%, transparent)',
                  padding: '8px 14px',
                }}
                itemStyle={{ color: 'var(--popover-text)', fontWeight: 600 }}
                labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
                formatter={(value) => [`${value}%`, 'Progreso']}
              />
              <Line
                type="monotone"
                dataKey="progreso"
                stroke={goal.color || '#8b5cf6'}
                strokeWidth={3}
                dot={{ r: 4, fill: goal.color }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {showEditModal && (
        <GoalModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          goalToEdit={goal}
        />
      )}

      {showAddHabitModal && (
        <HabitModal
          isOpen={showAddHabitModal}
          onClose={() => setShowAddHabitModal(false)}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        title="Eliminar objetivo"
        message={`¿Estás seguro de que deseas eliminar el objetivo «${goal.name}»? Los hábitos asociados no se borrarán.`}
        confirmLabel="Eliminar objetivo"
        confirmVariant="danger"
      />

      <ConfirmModal
        isOpen={showReopenConfirm}
        onClose={() => setShowReopenConfirm(false)}
        onConfirm={confirmReopen}
        title="¿Reabrir objetivo completado?"
        message={`¿Deseas volver a marcar «${goal.name}» como activo para continuar registrando progreso?`}
        confirmLabel="Sí, reabrir objetivo"
      />
    </div>
  );
};
