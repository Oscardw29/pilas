import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { Challenge } from '../types';
import { todayKey, addDaysKey } from '../lib/dates';
import { Trophy, Plus, CheckCircle, Gift, ArrowRight, Sparkles, Check, Trash2, TrendingUp } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { ChallengeModal } from '../components/modals/ChallengeModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';

export const ChallengesView: React.FC = () => {
  const { challenges, updateChallenge, deleteChallenge, toggleChallengeCheckin, addHabit, addPointEvent } = useStore(useShallow((s) => ({ challenges: s.challenges, updateChallenge: s.updateChallenge, deleteChallenge: s.deleteChallenge, toggleChallengeCheckin: s.toggleChallengeCheckin, addHabit: s.addHabit, addPointEvent: s.addPointEvent })));
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null);
  const [challengeToDelete, setChallengeToDelete] = useState<Challenge | null>(null);

  const currentTodayKey = todayKey();

  const handleDayToggle = (challenge: Challenge, dateStr: string) => {
    toggleChallengeCheckin(challenge.id, dateStr);
    const wasChecked = challenge.checkins.includes(dateStr);
    if (!wasChecked) {
      showToast(`¡Día registrado en «${challenge.name}»!`, 'success');
    }
  };

  const handleClaimReward = (challenge: Challenge) => {
    if (challenge.status === 'completed') return;
    addPointEvent({
      amount: Math.round(challenge.rewardPoints),
      reason: `Completar reto: ${challenge.name}`,
      source: 'challenge',
    });
    updateChallenge(challenge.id, { status: 'completed' });
    showToast(`¡Reto superado! +${Math.round(challenge.rewardPoints)} puntos otorgados.`, 'reward');
  };

  const handleConvertToHabit = (challenge: Challenge) => {
    const habit = addHabit({
      name: challenge.name,
      icon: challenge.icon || '🏆',
      color: '#8b5cf6',
      description: challenge.description,
      status: 'active',
      days: [0, 1, 2, 3, 4, 5, 6],
      points: 20,
      priority: 2,
      preferredTime: 'any',
      reminderTime: '09:00',
      goals: [],
      fromChallengeId: challenge.id,
    });
    updateChallenge(challenge.id, { convertedHabitId: habit.id });
    showToast(`«${challenge.name}» ahora forma parte de tus hábitos permanentes.`, 'success');
  };

  const handleDelete = (challenge: Challenge) => {
    setChallengeToDelete(challenge);
  };

  const confirmDelete = () => {
    if (!challengeToDelete) return;
    deleteChallenge(challengeToDelete.id);
    showToast(`Reto «${challengeToDelete.name}» eliminado.`, 'info');
    setChallengeToDelete(null);
  };

  const activeChallenges = challenges.filter((c) => c.status === 'active');
  const pastChallenges = challenges.filter((c) => c.status !== 'active');

  const challengesChartData = useMemo(() => {
    return challenges.map((c) => ({
      id: c.id,
      name: `${c.icon || '🏆'} ${c.name}`,
      diasCompletados: c.checkins.length,
      metaDias: c.durationDays || 30,
      pct: Math.min(100, Math.round((c.checkins.length / (c.durationDays || 30)) * 100)),
      status: c.status,
    }));
  }, [challenges]);

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Desafíos temporales</p>
          <h1>Retos 30 días</h1>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingChallenge(null);
              setIsModalOpen(true);
            }}
          >
            <Plus size={16} /> Nuevo reto
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Los retos temporales te permiten experimentar un cambio de rutina sin comprometerte para siempre. Si al terminar lo disfrutas, puedes convertirlo en un hábito permanente con un solo clic.
      </p>

      {/* Gráfica de avance de retos */}
      {challengesChartData.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Avance de retos (Días acumulados)</h3>
              <p className="card-sub">Días completados respecto a la meta de cada reto</p>
            </div>
            <span className="badge" style={{ background: 'color-mix(in srgb, var(--yellow) 15%, transparent)', color: 'var(--gold)', border: '1px solid color-mix(in srgb, var(--yellow) 30%, transparent)' }}>
              {challengesChartData.length} retos
            </span>
          </div>

          <div style={{ width: '100%', height: Math.max(160, challengesChartData.length * 44), overflow: 'hidden' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={challengesChartData}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
              >
                <XAxis type="number" domain={[0, 30]} unit="d" stroke="var(--muted)" fontSize={11} tickLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="var(--muted)"
                  fontSize={12}
                  tickLine={false}
                  width={150}
                  tickFormatter={(val) => (val.length > 18 ? `${val.slice(0, 17)}…` : val)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div
                          style={{
                            background: 'color-mix(in srgb, var(--popover) 96%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--tint) 12%, transparent)',
                            borderRadius: 10,
                            padding: '8px 12px',
                            boxShadow: '0 8px 24px color-mix(in srgb, var(--shadow-color) 70%, transparent)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: 'var(--popover-text)', marginBottom: 2 }}>
                            {item.name}
                          </div>
                          <div style={{ color: 'var(--gold)', fontWeight: 600 }}>
                            {item.diasCompletados} de {item.metaDias} días ({item.pct}%)
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'capitalize' }}>
                            Estado: {item.status === 'completed' ? 'Superado' : item.status === 'active' ? 'En curso' : item.status}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                  wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                />
                <Bar dataKey="diasCompletados" fill="var(--yellow-fill)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Retos activos */}
      <div className="stack" style={{ gap: 16 }}>
        <div className="row-between">
          <div className="card-title">Retos en curso</div>
          <span className="badge accent">{activeChallenges.length} activos</span>
        </div>

        {activeChallenges.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon">
              <Trophy size={24} />
            </div>
            <h3>No tienes retos en marcha</h3>
            <p>Inicia un reto de 30 días como "Levantarme temprano" o "30 días sin azúcar" para impulsar tu disciplina.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingChallenge(null);
                setIsModalOpen(true);
              }}
            >
              <Plus size={16} /> Iniciar mi primer reto
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {activeChallenges.map((challenge) => {
              const completedCount = challenge.checkins.length;
              const pct = Math.min(100, Math.round((completedCount / challenge.successDays) * 100));
              const isTargetReached = completedCount >= challenge.successDays;
              const hasCheckedToday = challenge.checkins.includes(currentTodayKey);

              const daysArray = Array.from({ length: challenge.durationDays }, (_, i) => {
                const dKey = addDaysKey(challenge.startDate, i);
                const isChecked = challenge.checkins.includes(dKey);
                const isToday = dKey === currentTodayKey;
                return { index: i + 1, dateKey: dKey, isChecked, isToday };
              });

              return (
                <div key={challenge.id} className="card highlight">
                  <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div className="row" style={{ alignItems: 'flex-start' }}>
                      <span className="entity-icon lg">{challenge.icon || '🏆'}</span>
                      <div>
                        <div className="row">
                          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{challenge.name}</h3>
                          <span className="badge accent">{challenge.durationDays} días</span>
                        </div>
                        <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 4 }}>
                          {challenge.description}
                        </p>
                        {challenge.metric && (
                          <div className="xs muted" style={{ marginTop: 2 }}>
                            Métrica: <b>{challenge.metric}</b>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleDayToggle(challenge, currentTodayKey)}
                        className={`btn ${hasCheckedToday ? 'btn-success' : 'btn-primary'}`}
                      >
                        <Check size={16} />
                        {hasCheckedToday ? 'Completado hoy' : 'Marcar hoy'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(challenge)}
                        className="icon-btn"
                        title="Eliminar reto"
                        aria-label="Eliminar reto"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Barra de progreso */}
                  <div style={{ marginTop: 18 }}>
                    <div className="row-between small" style={{ marginBottom: 6 }}>
                      <span>
                        Objetivo de victoria: <b>{completedCount} / {challenge.successDays} días cumplidos</b>
                      </span>
                      <span className="bold accent">{pct}%</span>
                    </div>
                    <div className="progress">
                      <div style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* Días del reto en cuadrícula interactiva */}
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    <div className="xs muted bold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Cuadrícula diaria (pulsa en cualquier día para marcarlo):
                    </div>
                    <div className="challenge-days-grid">
                      {daysArray.map((day) => (
                        <button
                          key={day.dateKey}
                          type="button"
                          onClick={() => handleDayToggle(challenge, day.dateKey)}
                          title={`${day.dateKey} (Día ${day.index})`}
                          aria-label={`${day.dateKey} (Día ${day.index})`}
                          className={`challenge-day-btn ${day.isChecked ? 'checked' : ''} ${day.isToday ? 'today' : ''}`}
                        >
                          {day.index}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Recompensa y conversión a hábito permanente */}
                  <div
                    className="row-between"
                    style={{
                      marginTop: 18,
                      paddingTop: 14,
                      borderTop: '1px solid var(--border)',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div className="row" style={{ color: 'var(--warning)' }}>
                      <Gift size={16} />
                      <span className="small bold">
                        +{Math.round(challenge.rewardPoints)} pts
                      </span>
                      {challenge.rewardText && (
                        <span className="small muted">({challenge.rewardText})</span>
                      )}
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      {isTargetReached && challenge.status === 'active' && (
                        <button
                          type="button"
                          className="btn btn-secondary sm"
                          style={{ color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)' }}
                          onClick={() => handleClaimReward(challenge)}
                        >
                          <Sparkles size={14} /> Reclamar victoria
                        </button>
                      )}

                      {isTargetReached && !challenge.convertedHabitId && (
                        <button
                          type="button"
                          className="btn btn-primary sm"
                          onClick={() => handleConvertToHabit(challenge)}
                        >
                          <ArrowRight size={14} /> Convertir en hábito permanente
                        </button>
                      )}

                      {challenge.convertedHabitId && (
                        <span className="badge success">
                          <CheckCircle size={13} /> Hábito permanente añadido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial de retos concluidos */}
      {pastChallenges.length > 0 && (
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div className="card-title">Retos anteriores</div>
          <div className="grid-2">
            {pastChallenges.map((c) => (
              <div key={c.id} className="card" style={{ opacity: 0.8 }}>
                <div className="row-between">
                  <div className="row">
                    <span className="entity-icon sm">{c.icon || '🏆'}</span>
                    <span className="bold">{c.name}</span>
                  </div>
                  <span className="badge">{c.status}</span>
                </div>
                <div className="small muted" style={{ marginTop: 8 }}>
                  Logrado: {c.checkins.length} de {c.successDays} días
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal para crear o editar */}
      <ChallengeModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingChallenge(null);
        }}
        challengeToEdit={editingChallenge || undefined}
      />

      <ConfirmModal
        isOpen={challengeToDelete !== null}
        onClose={() => setChallengeToDelete(null)}
        onConfirm={confirmDelete}
        title="Eliminar reto"
        message={`¿Estás seguro de que deseas eliminar el reto «${challengeToDelete?.name}»? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar reto"
        confirmVariant="danger"
      />
    </div>
  );
};
