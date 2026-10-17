import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { Experiment, ExperimentVariant } from '../types';
import { addDaysKey } from '../lib/dates';
import {
  FlaskConical,
  Plus,
  Trophy,
  Sparkles,
  Trash2,
  TrendingUp,
  Pause,
  Play,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ExperimentModal } from '../components/modals/ExperimentModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { PausedBadge } from '../components/ui/icons';

export const ExperimentsView: React.FC = () => {
  const { experiments, habits, sessions, updateExperiment, deleteExperiment, addPointEvent, setHabitStatus } = useStore(useShallow((s) => ({ experiments: s.experiments, habits: s.habits, sessions: s.sessions, updateExperiment: s.updateExperiment, deleteExperiment: s.deleteExperiment, addPointEvent: s.addPointEvent, setHabitStatus: s.setHabitStatus })));
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExp, setEditingExp] = useState<Experiment | null>(null);
  const [hoveredExpId, setHoveredExpId] = useState<string | null>(null);
  const [expIdToDelete, setExpIdToDelete] = useState<string | null>(null);

  const activeExperiments = experiments.filter((e) => e.status === 'running' || e.status === 'planned');
  const finishedExperiments = experiments.filter((e) => e.status === 'finished');

  const handleSelectWinner = (exp: Experiment, variant: ExperimentVariant) => {
    updateExperiment(exp.id, {
      status: 'finished',
      winnerVariantId: variant.id,
      conclusion: `La variante «${variant.label}» demostró mayor adherencia y menor fricción percibida.`,
    });
    addPointEvent({
      amount: 100,
      reason: `Experimento concluido: ${exp.name}`,
      source: 'experiment',
    });
    showToast(`¡Variante «${variant.label}» adoptada con éxito! +100 pts.`, 'reward');
  };

  const handleDelete = (id: string) => {
    setExpIdToDelete(id);
  };

  const getVariantStats = (exp: Experiment, variant: ExperimentVariant) => {
    const startKey = addDaysKey(exp.startDate, variant.startDay - 1);
    const endKey = addDaysKey(exp.startDate, variant.endDay - 1);
    const daysCount = Math.max(1, variant.endDay - variant.startDay + 1);

    const relatedSessions = sessions.filter(
      (s) =>
        s.date >= startKey &&
        s.date <= endKey &&
        (s.experimentId === exp.id || (exp.habitId && s.habitId === exp.habitId))
    );

    const completedSessions = relatedSessions.filter((s) => s.status === 'completed');
    const completionPct = Math.min(100, Math.round((completedSessions.length / daysCount) * 100));

    const totalDuration = relatedSessions.reduce((acc, s) => acc + s.durationSec / 60, 0);
    const avgDuration = relatedSessions.length ? Math.round(totalDuration / relatedSessions.length) : 0;

    const energyVals = relatedSessions
      .map((s) => s.energy)
      .filter((e): e is NonNullable<typeof e> => e !== undefined && e !== null);
    const avgEnergy = energyVals.length
      ? (energyVals.reduce((acc, val) => acc + Number(val), 0) / energyVals.length).toFixed(1)
      : '-';

    const diffVals = relatedSessions
      .map((s) => s.difficulty)
      .filter((d): d is NonNullable<typeof d> => d !== undefined && d !== null);
    const avgDiff = diffVals.length
      ? (diffVals.reduce((acc, val) => acc + Number(val), 0) / diffVals.length).toFixed(1)
      : '-';

    return { completionPct, avgDuration, avgEnergy, avgDiff };
  };

  const experimentsChartData = useMemo(() => {
    const list: { name: string; adherencia: number; duracion: number; expName: string }[] = [];
    experiments.forEach((exp) => {
      exp.variants.forEach((v) => {
        const stats = getVariantStats(exp, v);
        list.push({
          name: `${v.label} (${exp.name.length > 14 ? exp.name.slice(0, 13) + '…' : exp.name})`,
          expName: exp.name,
          adherencia: stats.completionPct,
          duracion: stats.avgDuration,
        });
      });
    });
    return list;
  }, [experiments, sessions]);

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Pruebas A/B controladas</p>
          <h1>Experimentos de hábitos</h1>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditingExp(null);
              setIsModalOpen(true);
            }}
          >
            <Plus size={16} /> Nuevo experimento
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Descubre empíricamente cuál es tu mejor horario, duración ideal o técnica de trabajo comparando dos condiciones durante 14 días. Los datos decidirán la estrategia ganadora.
      </p>

      {/* Gráfica de rendimiento comparativo de variantes */}
      {experimentsChartData.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Comparativa de adherencia entre variantes</h3>
              <p className="card-sub">Tasa de cumplimiento de sesiones por cada variante A/B</p>
            </div>
            <span
              className="badge"
              style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '1px solid rgba(168, 85, 247, 0.3)' }}
            >
              {experimentsChartData.length} variantes
            </span>
          </div>

          <div style={{ width: '100%', height: Math.max(160, experimentsChartData.length * 44), overflow: 'hidden' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={experimentsChartData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <XAxis type="number" domain={[0, 100]} unit="%" stroke="var(--muted)" fontSize={11} tickLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="var(--muted)"
                  fontSize={12}
                  tickLine={false}
                  width={150}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                />
                <Tooltip
                  content={({ active, payload }: any) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div
                          style={{
                            background: 'rgba(20, 21, 33, 0.96)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: 10,
                            padding: '8px 12px',
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#fff', marginBottom: 2 }}>{item.expName}</div>
                          <div style={{ color: '#c084fc', fontWeight: 600 }}>Adherencia: {item.adherencia}%</div>
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>Duración media: {item.duracion} min</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                  isAnimationActive={false}
                  wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                />
                <Bar dataKey="adherencia" fill="#c084fc" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Experimentos en curso */}
      <div className="stack" style={{ gap: 16 }}>
        <div className="row-between">
          <div className="card-title">Experimentos en curso</div>
          <span className="badge accent">{activeExperiments.length} activos</span>
        </div>

        {activeExperiments.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon">
              <FlaskConical size={24} />
            </div>
            <h3>No tienes experimentos activos</h3>
            <p>¿No sabes si te conviene estudiar a las 4 PM o a las 8 PM? Inicia un experimento y compara resultados reales.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditingExp(null);
                setIsModalOpen(true);
              }}
            >
              <Plus size={16} /> Crear mi primer experimento
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            {activeExperiments.map((exp) => {
              const habit = habits.find((h) => h.id === exp.habitId);
              const variantA = exp.variants[0];
              const variantB = exp.variants[1];
              const statsA = variantA ? getVariantStats(exp, variantA) : null;
              const statsB = variantB ? getVariantStats(exp, variantB) : null;
              const isPausedHabit = habit?.status === 'paused';
              const isHovered = hoveredExpId === exp.id;

              return (
                <div
                  key={exp.id}
                  className="card highlight"
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    ...(isPausedHabit ? { border: '1.5px solid #eab308' } : {}),
                  }}
                  onMouseEnter={() => setHoveredExpId(exp.id)}
                  onMouseLeave={() => setHoveredExpId(null)}
                >
                  {/* Capa para reanudar el hábito en pausa al pasar el ratón */}
                  {isPausedHabit && isHovered && (
                    <div
                      className="resume-overlay"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(10, 10, 16, 0.85)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        zIndex: 10,
                        padding: 16,
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#eab308', fontWeight: 600, fontSize: 15 }}>
                        <Pause size={16} strokeWidth={2.6} aria-hidden="true" />
                        <span>Hábito pausado («{habit?.name}»)</span>
                      </div>
                      <p style={{ color: 'var(--text-2)', fontSize: 13, maxWidth: 360, margin: 0 }}>
                        Este experimento está asociado a un hábito en pausa. Puedes reanudarlo para continuar registrando sesiones.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary sm resume-btn-animated"
                        style={{ background: '#eab308', color: '#000', borderColor: '#eab308', fontWeight: 700 }}
                        onClick={() => {
                          if (habit) {
                            setHabitStatus(habit.id, 'active');
                            showToast(`Hábito «${habit.name}» reanudado`, 'success');
                          }
                        }}
                      >
                        <Play size={14} strokeWidth={2.6} aria-hidden="true" /> Reanudar hábito
                      </button>
                    </div>
                  )}

                  <div className="row-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div className="row">
                        <span className="entity-icon sm">
                          <FlaskConical size={16} aria-hidden="true" />
                        </span>
                        <h3 style={{ fontSize: 17, fontWeight: 700 }}>{exp.name}</h3>
                        {habit && (
                          <span className="badge accent">
                            {habit.icon} {habit.name}
                          </span>
                        )}
                        {isPausedHabit && <PausedBadge />}
                      </div>
                      <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 6 }}>
                        <b>Hipótesis:</b> {exp.hypothesis}
                      </p>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <span className="small muted">
                        {exp.durationDays} días (inicio: {exp.startDate})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(exp.id)}
                        className="icon-btn"
                        title="Eliminar experimento"
                        aria-label="Eliminar experimento"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Comparativa A/B */}
                  <div className="grid-2" style={{ marginTop: 18 }}>
                    {variantA && (
                      <div className="variant-card">
                        <div className="row-between">
                          <span className="badge accent">Variante A</span>
                          <span className="xs muted">Días {variantA.startDay} a {variantA.endDay}</span>
                        </div>
                        <div className="bold" style={{ fontSize: 15 }}>{variantA.label}</div>

                        <div className="variant-metric-grid">
                          <div className="variant-metric-box">
                            <span className="num success">{statsA?.completionPct ?? 0}%</span>
                            <span className="label">Completado</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num">{statsA?.avgDuration ?? 0}m</span>
                            <span className="label">Duración prom.</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num warning">{statsA?.avgEnergy} / 5</span>
                            <span className="label">Energía media</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num danger">{statsA?.avgDiff} / 5</span>
                            <span className="label">Dificultad</span>
                          </div>
                        </div>

                        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn-secondary sm"
                            onClick={() => handleSelectWinner(exp, variantA)}
                          >
                            <Trophy size={14} style={{ color: 'var(--warning)' }} />
                            Adoptar Variante A
                          </button>
                        </div>
                      </div>
                    )}

                    {variantB && (
                      <div className="variant-card">
                        <div className="row-between">
                          <span className="badge warning">Variante B</span>
                          <span className="xs muted">Días {variantB.startDay} a {variantB.endDay}</span>
                        </div>
                        <div className="bold" style={{ fontSize: 15 }}>{variantB.label}</div>

                        <div className="variant-metric-grid">
                          <div className="variant-metric-box">
                            <span className="num success">{statsB?.completionPct ?? 0}%</span>
                            <span className="label">Completado</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num">{statsB?.avgDuration ?? 0}m</span>
                            <span className="label">Duración prom.</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num warning">{statsB?.avgEnergy} / 5</span>
                            <span className="label">Energía media</span>
                          </div>
                          <div className="variant-metric-box">
                            <span className="num danger">{statsB?.avgDiff} / 5</span>
                            <span className="label">Dificultad</span>
                          </div>
                        </div>

                        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn-secondary sm"
                            onClick={() => handleSelectWinner(exp, variantB)}
                          >
                            <Trophy size={14} style={{ color: 'var(--warning)' }} />
                            Adoptar Variante B
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {exp.conclusion && (
                    <div className="callout positive" style={{ marginTop: 16 }}>
                      <Sparkles />
                      <div>
                        <div className="title">Conclusión empírica</div>
                        <div className="detail">{exp.conclusion}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial de experimentos concluidos */}
      {finishedExperiments.length > 0 && (
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div className="card-title">Experimentos concluidos</div>
          <div className="grid-2">
            {finishedExperiments.map((exp) => (
              <div key={exp.id} className="card" style={{ opacity: 0.85 }}>
                <div className="row-between">
                  <span className="bold">{exp.name}</span>
                  <span className="badge success">Concluido</span>
                </div>
                <p className="small muted" style={{ marginTop: 8 }}>
                  {exp.conclusion || 'Experimento completado.'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      <ExperimentModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingExp(null);
        }}
        experimentToEdit={editingExp || undefined}
      />

      {/* Modal de confirmación para eliminar experimento */}
      <ConfirmModal
        isOpen={Boolean(expIdToDelete)}
        onClose={() => setExpIdToDelete(null)}
        onConfirm={() => {
          if (expIdToDelete) {
            deleteExperiment(expIdToDelete);
            setExpIdToDelete(null);
            showToast('Experimento eliminado.', 'info');
          }
        }}
        title="Eliminar experimento"
        message="¿Estás seguro de que deseas eliminar este experimento? Los datos de sesiones previas no se borrarán."
        confirmLabel="Eliminar"
        danger
      />
    </div>
  );
};
