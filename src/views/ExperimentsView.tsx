import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { Experiment, ExperimentVariant } from '../types';
import { addDaysKey, diffDays, todayKey } from '../lib/dates';
import {
  FlaskConical,
  Plus,
  Trophy,
  Sparkles,
  Trash2,
  Pause,
  Play,
  Microscope,
  Archive,
  NotebookPen,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ExperimentModal } from '../components/modals/ExperimentModal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { PausedBadge } from '../components/ui/icons';
import { CoachAvatar } from '../components/coach/CoachAvatar';
import { useCoachPersona } from '../components/coach/coachPersona';
import { Beaker, LabShelfArt, TubeProgress } from '../components/lab/LabArt';
import '../components/lab/lab.css';

/** Colores de cada variante: A violeta, B ámbar (como sus etiquetas) */
const SLOT = [
  { name: 'A', color: '#a78bfa', shade: '#7c3aed' },
  { name: 'B', color: '#fbbf24', shade: '#d97706' },
];

const expCode = (exp: Experiment, all: Experiment[]) => {
  const n = [...all].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).findIndex((e) => e.id === exp.id) + 1;
  return `EXP-${String(n).padStart(2, '0')}`;
};

export const ExperimentsView: React.FC = () => {
  const { experiments, habits, sessions, updateExperiment, deleteExperiment, addPointEvent, setHabitStatus } = useStore(useShallow((s) => ({ experiments: s.experiments, habits: s.habits, sessions: s.sessions, updateExperiment: s.updateExperiment, deleteExperiment: s.deleteExperiment, addPointEvent: s.addPointEvent, setHabitStatus: s.setHabitStatus })));
  const { showToast } = useToast();
  const persona = useCoachPersona();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExp, setEditingExp] = useState<Experiment | null>(null);
  const [hoveredExpId, setHoveredExpId] = useState<string | null>(null);
  const [expIdToDelete, setExpIdToDelete] = useState<string | null>(null);
  /** El coach celebra cada variante adoptada */
  const [cheerKey, setCheerKey] = useState(0);

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
    setCheerKey((k) => k + 1);
    showToast(`¡Variante «${variant.label}» adoptada con éxito! +100 pts.`, 'reward');
  };

  const openNew = () => {
    setEditingExp(null);
    setIsModalOpen(true);
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
    const list: { name: string; adherencia: number; duracion: number; expName: string; slot: number }[] = [];
    experiments.forEach((exp) => {
      exp.variants.forEach((v, i) => {
        const stats = getVariantStats(exp, v);
        list.push({
          name: `${v.label} (${exp.name.length > 14 ? exp.name.slice(0, 13) + '…' : exp.name})`,
          expName: exp.name,
          adherencia: stats.completionPct,
          duracion: stats.avgDuration,
          slot: i % 2,
        });
      });
    });
    return list;
  }, [experiments, sessions]);

  const avgAdherence = useMemo(() => {
    const vals = activeExperiments.flatMap((exp) => exp.variants.map((v) => getVariantStats(exp, v).completionPct));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }, [activeExperiments, sessions]);

  const today = todayKey();

  return (
    <div className="stack fade-up lab-page">
      {/* CABECERA: el laboratorio con el coach en bata detrás de la mesa */}
      <section className="lab-hero">
        <div className="lab-hero-copy">
          <p className="lab-eyebrow">
            <Microscope size={14} aria-hidden="true" /> Pruebas A/B controladas
          </p>
          <h1>Laboratorio de hábitos</h1>
          <p className="lab-hero-sub">
            Compara dos condiciones durante 14 días (horario, duración o técnica) y deja que los datos elijan la estrategia ganadora.
          </p>

          <div className="lab-readouts" aria-label="Resumen del laboratorio">
            <div className="lab-lcd">
              <span className="lab-lcd-label">En curso</span>
              <span className="lab-lcd-value">{String(activeExperiments.length).padStart(2, '0')}</span>
            </div>
            <div className="lab-lcd">
              <span className="lab-lcd-label">Concluidos</span>
              <span className="lab-lcd-value">{String(finishedExperiments.length).padStart(2, '0')}</span>
            </div>
            <div className="lab-lcd">
              <span className="lab-lcd-label">Adherencia</span>
              <span className="lab-lcd-value">{avgAdherence === null ? '--' : `${avgAdherence}%`}</span>
            </div>
          </div>

          <button type="button" className="btn-3d btn-3d-lab" onClick={openNew}>
            <Plus size={17} /> Nuevo experimento
          </button>
        </div>

        <div className="lab-hero-scene" aria-hidden="true">
          <LabShelfArt />
          <div className="lab-hero-coach">
            <CoachAvatar
              gender={persona.gender}
              crop="bust"
              size={170}
              outfit="lab"
              expression={cheerKey ? 'excited' : 'happy'}
              gesture={cheerKey ? 'cheer' : 'nod'}
              gestureKey={cheerKey || 1}
            />
          </div>
          <div className="lab-bench">
            <span className="lab-bench-note">{persona.name} · investigación</span>
          </div>
        </div>
      </section>

      {/* MONITOR: comparativa de adherencia de todas las variantes */}
      {experimentsChartData.length > 0 && (
        <div className="lab-monitor">
          <div className="lab-monitor-head">
            <div>
              <h3 className="card-title">Monitor de adherencia</h3>
              <p className="card-sub">Tasa de cumplimiento de sesiones por cada variante A/B</p>
            </div>
            <span className="lab-live">
              <i aria-hidden="true" /> {experimentsChartData.length} muestras
            </span>
          </div>

          <div className="lab-screen" style={{ height: Math.max(160, experimentsChartData.length * 44) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={experimentsChartData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                <XAxis type="number" domain={[0, 100]} unit="%" stroke="#5eead4" fontSize={11} tickLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#5eead4"
                  fontSize={12}
                  tickLine={false}
                  width={150}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(94, 234, 212, 0.06)' }}
                  content={({ active, payload }: any) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div className="lab-tooltip">
                          <div className="lab-tooltip-title">{item.expName}</div>
                          <div style={{ color: SLOT[item.slot].color, fontWeight: 700 }}>
                            Variante {SLOT[item.slot].name}: {item.adherencia}%
                          </div>
                          <div className="lab-tooltip-sub">Duración media: {item.duracion} min</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                  isAnimationActive={false}
                  wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                />
                <Bar dataKey="adherencia" radius={[0, 6, 6, 0]}>
                  {experimentsChartData.map((d, i) => (
                    <Cell key={i} fill={SLOT[d.slot].color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* MESA DE TRABAJO: experimentos en curso */}
      <div className="stack" style={{ gap: 16 }}>
        <div className="row-between lab-section-head">
          <div className="lab-section-title">
            <FlaskConical size={18} aria-hidden="true" /> Mesa de trabajo
          </div>
          <span className="badge accent">{activeExperiments.length} activos</span>
        </div>

        {activeExperiments.length === 0 ? (
          <div className="lab-empty">
            <Beaker level={0} color="#2dd4bf" shade="#0f766e" size={86} />
            <h3>La mesa está vacía</h3>
            <p>¿No sabes si te conviene estudiar a las 4 PM o a las 8 PM? Monta un experimento y compara resultados reales.</p>
            <button type="button" className="btn-3d btn-3d-lab" onClick={openNew}>
              <Plus size={16} /> Crear mi primer experimento
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            {activeExperiments.map((exp) => {
              const habit = habits.find((h) => h.id === exp.habitId);
              const variants = exp.variants.slice(0, 2);
              const stats = variants.map((v) => getVariantStats(exp, v));
              const leader =
                stats.length === 2 && stats[0].completionPct !== stats[1].completionPct
                  ? stats[0].completionPct > stats[1].completionPct
                    ? 0
                    : 1
                  : -1;
              const isPausedHabit = habit?.status === 'paused';
              const isHovered = hoveredExpId === exp.id;
              const day = Math.max(0, Math.min(exp.durationDays, diffDays(exp.startDate, today) + 1));
              const planned = exp.status === 'planned' || day === 0;

              return (
                <article
                  key={exp.id}
                  className={`lab-card${isPausedHabit ? ' paused' : ''}`}
                  onMouseEnter={() => setHoveredExpId(exp.id)}
                  onMouseLeave={() => setHoveredExpId(null)}
                >
                  {/* Capa para reanudar el hábito en pausa al pasar el ratón */}
                  {isPausedHabit && isHovered && (
                    <div className="resume-overlay lab-resume">
                      <div className="lab-resume-title">
                        <Pause size={16} strokeWidth={2.6} aria-hidden="true" />
                        <span>Hábito pausado («{habit?.name}»)</span>
                      </div>
                      <p>Este experimento está asociado a un hábito en pausa. Puedes reanudarlo para continuar registrando sesiones.</p>
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

                  <header className="lab-card-head">
                    <div className="lab-card-title">
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span className="lab-code">{expCode(exp, experiments)}</span>
                        <span className={`lab-status ${planned ? 'planned' : 'running'}`}>
                          <i aria-hidden="true" /> {planned ? 'Preparado' : 'En curso'}
                        </span>
                        {habit && (
                          <span className="badge accent">
                            {habit.icon} {habit.name}
                          </span>
                        )}
                        {isPausedHabit && <PausedBadge />}
                      </div>
                      <h3>{exp.name}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpIdToDelete(exp.id)}
                      className="icon-btn"
                      title="Eliminar experimento"
                      aria-label="Eliminar experimento"
                    >
                      <Trash2 size={16} />
                    </button>
                  </header>

                  <div className="lab-timeline">
                    <span className="lab-timeline-label">
                      Día <b>{day}</b> de {exp.durationDays}
                    </span>
                    <TubeProgress value={(day / Math.max(1, exp.durationDays)) * 100} label={`Avance del experimento: día ${day} de ${exp.durationDays}`} />
                    <span className="lab-timeline-date">Inicio: {exp.startDate}</span>
                  </div>

                  <div className="lab-note">
                    <span className="lab-note-tag">
                      <NotebookPen size={13} aria-hidden="true" /> Hipótesis
                    </span>
                    <p>{exp.hypothesis}</p>
                  </div>

                  {/* Comparativa A/B: un vaso por variante que se llena con su adherencia */}
                  <div className="lab-variants">
                    {variants.map((v, i) => {
                      const st = stats[i];
                      const slot = SLOT[i];
                      return (
                        <React.Fragment key={v.id}>
                          {i === 1 && (
                            <span className="lab-vs" aria-hidden="true">
                              VS
                            </span>
                          )}
                          <div className={`lab-variant slot-${slot.name.toLowerCase()}${leader === i ? ' leading' : ''}`}>
                            {leader === i && <span className="lab-leading">Va ganando</span>}
                            <div className="lab-variant-top">
                              <Beaker level={st.completionPct} color={slot.color} shade={slot.shade} />
                              <div className="lab-variant-info">
                                <span className="lab-variant-tag">Variante {slot.name}</span>
                                <div className="lab-variant-name">{v.label}</div>
                                <span className="xs muted">
                                  Días {v.startDay} a {v.endDay}
                                </span>
                                <div className="lab-variant-pct">{st.completionPct}%</div>
                              </div>
                            </div>

                            <div className="lab-metrics">
                              <div className="lab-metric">
                                <span>{st.avgDuration}m</span>
                                <small>Duración</small>
                              </div>
                              <div className="lab-metric">
                                <span>{st.avgEnergy}</span>
                                <small>Energía /5</small>
                              </div>
                              <div className="lab-metric">
                                <span>{st.avgDiff}</span>
                                <small>Dificultad /5</small>
                              </div>
                            </div>

                            <button type="button" className={`btn-3d sm btn-3d-${slot.name.toLowerCase()}`} onClick={() => handleSelectWinner(exp, v)}>
                              <Trophy size={14} /> Adoptar variante {slot.name}
                            </button>
                          </div>
                        </React.Fragment>
                      );
                    })}
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
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* ARCHIVO: experimentos concluidos */}
      {finishedExperiments.length > 0 && (
        <div className="stack" style={{ gap: 12, marginTop: 12 }}>
          <div className="lab-section-title">
            <Archive size={18} aria-hidden="true" /> Archivo de resultados
          </div>
          <div className="grid-2">
            {finishedExperiments.map((exp) => {
              const winner = exp.variants.find((v) => v.id === exp.winnerVariantId);
              const slotIdx = winner ? exp.variants.indexOf(winner) % 2 : -1;
              return (
                <div key={exp.id} className="lab-report">
                  <span className="lab-stamp" aria-hidden="true">
                    Concluido
                  </span>
                  <span className="lab-code">{expCode(exp, experiments)}</span>
                  <div className="lab-report-name">{exp.name}</div>
                  {winner && (
                    <div className="lab-report-winner" style={{ color: SLOT[slotIdx].color }}>
                      <Trophy size={14} aria-hidden="true" /> Ganó la variante {SLOT[slotIdx].name}: {winner.label}
                    </div>
                  )}
                  <p className="small muted">{exp.conclusion || 'Experimento completado.'}</p>
                </div>
              );
            })}
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
