import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Flame,
  Trophy,
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  AlarmClock,
  Pause,
  Play,
  Hourglass,
} from 'lucide-react';
import { useStore, useData } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import {
  currentStreak,
  bestStreak,
  consistency,
  recoveryStats,
  isScheduled,
  getLog,
  getDayStreakStatus,
  calculateGlobalStreak,
  isDoneLog,
  isHabitPausedOnDate,
  pointsFor,
} from '@/lib/metrics';
import {
  addDaysKey,
  formatRange,
  fromKey,
  startOfWeek,
  todayKey,
  toKey,
  weekDays,
  DAY_SHORT,
  weekdayIndex,
} from '@/lib/dates';
import { HabitModal } from '@/components/modals/HabitModal';
import { FailReasonModal } from '@/components/modals/FailReasonModal';
import { HabitProgressModal } from '@/components/modals/HabitProgressModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { fireHabitPop } from '@/lib/confetti';
import { celebrateStreakChange, streakSnapshot } from '@/lib/streakCelebration';
import { playSound } from '@/lib/sound';
import { StatusIcon, StatusLabel } from '@/components/ui/icons';
import type { Habit, HabitLog } from '@/types';
import { habitCoinValue } from '@/lib/economyRules';

/** Fase de la animación al cambiar de semana: sale la semana mostrada y luego entra la nueva. */
type WeekSlide = { phase: 'idle' | 'out' | 'in'; dir: 'next' | 'prev' };

export const WeekView: React.FC = () => {
  const data = useData();
  const logHabit = useStore((s) => s.logHabit);
  const clearLog = useStore((s) => s.clearLog);
  const deleteHabit = useStore((s) => s.deleteHabit);
  const setHabitStatus = useStore((s) => s.setHabitStatus);
  const { toast } = useToast();

  const T = todayKey();
  // Semana que pinta la tabla; durante la animación de salida sigue siendo la anterior
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(startOfWeek(new Date()));
  // Semana elegida (cabecera y navegación); la tabla la alcanza al terminar la salida
  const [targetWeekStart, setTargetWeekStart] = useState<Date>(currentWeekStart);
  const [slide, setSlide] = useState<WeekSlide>({ phase: 'idle', dir: 'next' });
  const [editingHabit, setEditingHabit] = useState<Habit | undefined>();
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [failModalInfo, setFailModalInfo] = useState<{ habit: Habit; date: string } | null>(null);
  const [progressModalInfo, setProgressModalInfo] = useState<{ habit: Habit; date: string } | null>(null);
  const [habitToDelete, setHabitToDelete] = useState<Habit | null>(null);

  const days = weekDays(currentWeekStart);
  const isCurrentWeek = toKey(targetWeekStart) === toKey(startOfWeek(new Date()));
  const visibleHabits = data.habits.filter((h) => h.status === 'active' || h.status === 'paused');
  const activeHabits = data.habits.filter((h) => h.status === 'active');

  // Toda forma de cambiar de semana pasa por aquí. La dirección sale de comparar con la semana
  // que se ve: posterior → «next» (sale a la izquierda), anterior → «prev» (sale a la derecha).
  // Clics seguidos: durante la salida solo se actualiza el destino; durante la entrada se vuelve a salir.
  const goToWeek = (next: Date) => {
    const nextKey = toKey(next);
    const shownKey = toKey(currentWeekStart);
    setTargetWeekStart(next);
    if (visibleHabits.length === 0) {
      setCurrentWeekStart(next);
      setSlide({ phase: 'idle', dir: 'next' });
      return;
    }
    if (nextKey === shownKey) {
      // Se volvió a la semana que aún se está yendo: regresa por el mismo lado
      if (slide.phase === 'out') setSlide({ phase: 'in', dir: slide.dir === 'next' ? 'prev' : 'next' });
      return;
    }
    setSlide({ phase: 'out', dir: nextKey > shownKey ? 'next' : 'prev' });
  };

  const handleSlideEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // animaciones de las celdas (checkPop, etc.)
    if (slide.phase === 'out') {
      setCurrentWeekStart(targetWeekStart);
      setSlide((s) => ({ ...s, phase: 'in' }));
    } else if (slide.phase === 'in') {
      setSlide((s) => ({ ...s, phase: 'idle' }));
    }
  };

  // Red de seguridad: si no llega animationend (tabla desmontada, pestaña oculta…), se completa el cambio
  useEffect(() => {
    if (slide.phase === 'idle') return;
    const t = window.setTimeout(() => {
      setCurrentWeekStart(targetWeekStart);
      setSlide((s) => ({ ...s, phase: 'idle' }));
    }, 800);
    return () => window.clearTimeout(t);
  }, [slide, targetWeekStart]);

  const handleCellClick = (h: Habit, dateKey: string, e?: React.MouseEvent) => {
    // Si la fecha es en el futuro respecto a hoy, no permitir
    if (dateKey > T) return;

    if (h.kind === 'time' || h.kind === 'quantity') {
      setProgressModalInfo({ habit: h, date: dateKey });
      return;
    }

    const existing = getLog(data, h.id, dateKey);

    // Ciclo de clics en la celda:
    // Sin registro -> Completo -> Mínimo -> Fallo (Preguntar) -> Limpiar
    if (!existing) {
      const before = streakSnapshot();
      logHabit(h.id, dateKey, 'full');
      playSound.complete();
      toast(`+${habitCoinValue(h)} pts · «${h.name}» completado`, 'success');
      if (e) {
        fireHabitPop(e.clientX, e.clientY);
      }

      // Celebración si este registro activó la racha o la súper racha de hoy
      celebrateStreakChange(before, dateKey);
    } else if (existing.status === 'full') {
      logHabit(h.id, dateKey, 'minimum');
      playSound.pop();
      toast(`«${h.name}» marcado como versión mínima (+${pointsFor(h, 'minimum', data.settings.minimumRatio)} pts)`, 'success');
    } else if (existing.status === 'minimum') {
      if (data.settings.askFailReason) {
        setFailModalInfo({ habit: h, date: dateKey });
      } else {
        logHabit(h.id, dateKey, 'missed');
        playSound.click();
        toast(`«${h.name}» marcado como no realizado`, 'warning');
      }
    } else {
      clearLog(h.id, dateKey);
      playSound.click();
      toast(`Registro removido para «${h.name}»`, 'info');
    }
  };

  const handleDeleteHabit = (h: Habit) => {
    setHabitToDelete(h);
  };

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Matriz semanal interactiva</p>
          <h1>Mi semana</h1>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingHabit(undefined);
              setShowHabitModal(true);
            }}
          >
            <Plus size={16} /> Nuevo hábito
          </button>
        </div>
      </div>

      {/* Barra de navegación de semanas */}
      <div className="card flush">
        <div className="week-toolbar">
          <div className="week-nav">
            <button
              className="icon-btn sm"
              onClick={() => goToWeek(fromKey(addDaysKey(toKey(targetWeekStart), -7)))}
              title="Semana anterior"
              aria-label="Semana anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="week-nav-label">
              {formatRange(targetWeekStart)}
            </span>

            <button
              className="icon-btn sm"
              onClick={() => goToWeek(fromKey(addDaysKey(toKey(targetWeekStart), 7)))}
              title="Semana siguiente"
              aria-label="Semana siguiente"
            >
              <ChevronRight size={16} />
            </button>

            {/* Siempre ocupa su lugar (solo se oculta) para que la barra no cambie de tamaño */}
            <button
              className="btn btn-secondary sm week-nav-today"
              onClick={() => goToWeek(startOfWeek(new Date()))}
              disabled={isCurrentWeek}
              aria-hidden={isCurrentWeek}
              tabIndex={isCurrentWeek ? -1 : undefined}
              title="Volver a esta semana"
            >
              <span className="long">Esta semana</span>
              <span className="short">Hoy</span>
            </button>
          </div>

          <div className="week-tip">
            <span className="icon-label" style={{ gap: 6, flexWrap: 'wrap' }}>
              <strong>Tip:</strong> clic en la celda alterna
              <StatusLabel status="full">Completo</StatusLabel>→
              <StatusLabel status="minimum">Mínimo</StatusLabel>→
              <StatusLabel status="missed">No hecho</StatusLabel>
            </span>
          </div>
        </div>

        {/* Tabla matriz de hábitos o Estado Vacío */}
        {visibleHabits.length > 0 ? (
          <>
            <div
              className={`table-wrap week-slide${slide.phase === 'idle' ? '' : ` is-${slide.phase}-${slide.dir}`}`}
              onAnimationEnd={handleSlideEnd}
            >
            <table className="table week-matrix">
              <thead>
                <tr>
                  <th className="week-matrix-habit">Hábito</th>
                  {days.map((d) => {
                    const dk = toKey(d);
                    const isToday = dk === T;
                    return (
                      <th key={dk} className="week-matrix-day" style={{ textAlign: 'center', background: isToday ? 'rgba(139, 92, 246, 0.08)' : 'transparent' }}>
                        <div style={{ fontSize: 11, color: isToday ? 'var(--accent-2)' : 'var(--muted)' }}>
                          {DAY_SHORT[weekdayIndex(d)]}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--text-strong)' : 'inherit' }}>
                          {d.getDate()}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{ textAlign: 'center', minWidth: 100 }}>
                    <Flame size={14} style={{ display: 'inline', marginRight: 4, color: 'var(--warning)' }} />
                    Racha
                  </th>
                  <th style={{ textAlign: 'center', minWidth: 100 }}>
                    <CheckCircle2 size={14} style={{ display: 'inline', marginRight: 4, color: 'var(--success)' }} />
                    Consistencia
                  </th>
                  <th style={{ textAlign: 'center', minWidth: 120 }}>
                    <Clock size={14} style={{ display: 'inline', marginRight: 4, color: 'var(--info)' }} />
                    Recuperación
                  </th>
                  <th style={{ width: 80, textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleHabits.map((h) => {
                  const isPaused = h.status === 'paused';
                  const streakCur = isPaused ? 0 : currentStreak(data, h, T);
                  const streakTop = bestStreak(data, h, T);
                  const cons = consistency(data, h, 30, T);
                  const rec = recoveryStats(data, h, T);

                  return (
                    <tr key={h.id} style={{ opacity: isPaused ? 0.78 : 1 }}>
                      <td className="week-matrix-habit">
                        <div className="week-habit">
                          <span className="week-habit-icon">{h.icon}</span>
                          <div className="week-habit-text">
                            <div className="week-habit-name">
                              <span>{h.name}</span>
                              {isPaused && (
                                <span className="badge paused-badge">
                                  <Pause size={10} strokeWidth={3} aria-hidden="true" /> Pausado
                                </span>
                              )}
                            </div>
                            <div className="week-habit-meta">
                              +{habitCoinValue(h)} pts
                              {h.kind === 'time' && (h.targetMinutes ? ` · ${h.targetMinutes} min` : '')}
                              {h.kind === 'quantity' && (h.targetQuantity ? ` · ${h.targetQuantity} ${h.quantityUnit || 'reps'}` : '')}
                              {!h.kind && h.targetMinutes ? ` · ${h.targetMinutes} min` : ''}
                              {h.minimumMinutes && <span style={{ color: 'var(--minimum)' }}> (mín: {h.minimumMinutes}m)</span>}
                              {h.reminderTime && (
                                <span className="icon-label" style={{ color: 'var(--accent-2)', fontWeight: 600, marginLeft: 4 }}>
                                  · <AlarmClock size={11} aria-hidden="true" /> {h.reminderTime}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Celdas de los días */}
                      {days.map((d) => {
                        const dk = toKey(d);
                        const isToday = dk === T;
                        const isFuture = dk > T;
                        const isPausedOnDate = isHabitPausedOnDate(h, dk);

                        // Si el hábito estuvo o está en pausa en esta fecha
                        if (isPausedOnDate) {
                          if (isToday) {
                            // Hoy: celda con el mismo formato que las demás; muestra «pausa» y al pasar el ratón «reanudar»
                            return (
                              <td
                                key={dk}
                                className="week-matrix-day"
                                style={{
                                  background: 'color-mix(in srgb, var(--yellow) 6%, transparent)',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    clearLog(h.id, dk);
                                    setHabitStatus(h.id, 'active');
                                    toast(`Hábito «${h.name}» reactivado`, 'success');
                                  }}
                                  className="matrix-cell-btn resume-cell"
                                  title="Hábito en pausa. Haz clic para reanudarlo hoy"
                                  aria-label="Hábito en pausa. Haz clic para reanudarlo hoy"
                                >
                                  <Pause className="resume-cell-idle" size={15} strokeWidth={2.6} aria-hidden="true" />
                                  <Play className="resume-cell-hover" size={15} strokeWidth={2.6} aria-hidden="true" />
                                </button>
                              </td>
                            );
                          }

                          // Días pasados o futuros en pausa: guión '-'
                          return (
                            <td
                              key={dk}
                              className="week-matrix-day"
                              style={{
                                background: isToday ? 'rgba(139, 92, 246, 0.04)' : 'transparent',
                              }}
                            >
                              <span style={{ color: 'var(--yellow)', opacity: 0.5, fontSize: 14, userSelect: 'none' }} title="Hábito pausado en esta fecha">
                                —
                              </span>
                            </td>
                          );
                        }

                        const scheduled = isScheduled(h, dk);
                        const log = getLog(data, h.id, dk);

                        // Si el hábito NO está programado para este día de la semana, no mostrar botón de completado
                        if (!scheduled) {
                          return (
                            <td
                              key={dk}
                              className="week-matrix-day"
                              style={{
                                background: isToday ? 'rgba(139, 92, 246, 0.04)' : 'transparent',
                              }}
                            >
                              <span style={{ color: 'var(--muted)', opacity: 0.3, fontSize: 14, userSelect: 'none' }}>
                                —
                              </span>
                            </td>
                          );
                        }

                        let bg = 'var(--surface-2)';
                        let border = 'var(--border-2)';
                        const status: HabitLog['status'] | undefined = log?.status;
                        let color = 'inherit';

                        if (status === 'full') {
                          bg = h.color;
                          border = h.color;
                          color = '#fff';
                        } else if (status === 'minimum') {
                          bg = 'var(--minimum)';
                          border = 'var(--minimum)';
                          color = 'var(--on-status)';
                        } else if (status === 'missed') {
                          bg = 'color-mix(in srgb, var(--danger) 20%, transparent)';
                          border = 'var(--danger)';
                          color = 'var(--danger)';
                        } else if (status === 'partial') {
                          // Avance registrado que aún no alcanza el mínimo
                          bg = 'color-mix(in srgb, var(--minimum) 8%, transparent)';
                          border = 'var(--minimum)';
                          color = 'var(--minimum)';
                        }

                        return (
                          <td
                            key={dk}
                            className="week-matrix-day"
                            style={{
                              background: isToday ? 'rgba(139, 92, 246, 0.04)' : 'transparent',
                            }}
                          >
                            <button
                              type="button"
                              disabled={isFuture}
                              onClick={(e) => handleCellClick(h, dk, e)}
                              className={`matrix-cell-btn ${log?.status ? 'filled' : ''}`}
                              style={{
                                background: bg,
                                border: `1.5px solid ${border}`,
                                color,
                                opacity: isFuture ? 0.3 : 1,
                                cursor: isFuture ? 'not-allowed' : 'pointer',
                              }}
                              title={
                                isFuture
                                  ? 'Día futuro'
                                  : log?.status === 'full'
                                  ? 'Objetivo completo'
                                  : log?.status === 'minimum'
                                  ? 'Versión mínima'
                                  : log?.status === 'missed'
                                  ? `No realizado: ${log.failReason ?? ''}`
                                  : log?.status === 'partial'
                                  ? `Avance parcial: ${log.minutes ? `${log.minutes} min` : `${log.quantity ?? 0}`} (aún sin mínimo)`
                                  : 'Programado hoy - clic para completar'
                              }
                            >
                              {status && <StatusIcon status={status} size={16} strokeWidth={status === 'full' ? 3 : 2.6} />}
                            </button>
                          </td>
                        );
                      })}

                    {/* Racha actual / mejor */}
                    <td style={{ textAlign: 'center', fontSize: 13 }}>
                      <strong>{streakCur}d</strong>{' '}
                      <small style={{ color: 'var(--muted)' }}>({streakTop}d)</small>
                    </td>

                    {/* Consistencia 30d */}
                    <td style={{ textAlign: 'center', fontWeight: 600, fontSize: 13 }}>
                      {cons != null ? `${Math.round(cons * 100)}%` : '—'}
                    </td>

                    {/* Métricas de Recuperación */}
                    <td style={{ textAlign: 'center', fontSize: 12 }}>
                      {rec.average != null ? (
                        <div>
                          <div className="icon-label" style={{ justifyContent: 'center' }}>
                            <Hourglass size={12} color="var(--info)" aria-hidden="true" /> <strong>{rec.average.toFixed(1)}d</strong> prom.
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                            Mejor: {rec.best}d
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Sin fallas</span>
                      )}
                    </td>

                    {/* Acciones */}
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: 4 }}>
                        <button
                          className="icon-btn sm"
                          onClick={() => {
                            setEditingHabit(h);
                            setShowHabitModal(true);
                          }}
                          title="Editar hábito"
                          aria-label="Editar hábito"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          className="icon-btn sm danger"
                          onClick={() => handleDeleteHabit(h)}
                          title="Eliminar hábito"
                          aria-label="Eliminar hábito"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Leyenda de la tabla */}
        <div className="week-legend">
          <span className="week-legend-item">
            <span className="legend-cell" style={{ background: 'var(--accent)', color: '#fff' }}><StatusIcon status="full" size={10} strokeWidth={3.2} /></span> Objetivo completo (+100%)
          </span>
          <span className="week-legend-item">
            <span className="legend-cell" style={{ background: 'var(--minimum)', color: 'var(--on-status)' }}><StatusIcon status="minimum" size={10} strokeWidth={3} /></span> Versión mínima ({Math.round(data.settings.minimumRatio * 100)}%)
          </span>
          <span className="week-legend-item">
            <span className="legend-cell" style={{ border: '1.5px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 20%, transparent)', color: 'var(--danger)' }}><StatusIcon status="missed" size={10} strokeWidth={3} /></span> No realizado
          </span>
          <span className="week-legend-item">
            <span className="legend-cell" style={{ background: 'var(--warning)', color: '#fff' }}><StatusIcon status="paused" size={9} strokeWidth={3} className="icon-filled" /></span> En pausa
          </span>
          <span className="week-legend-item">
            <span style={{ color: 'var(--muted)', opacity: 0.5, fontWeight: 700 }}>—</span> No programado hoy
          </span>
          <span className="week-legend-note">
            <Trophy size={14} style={{ display: 'inline', marginRight: 4, color: 'var(--warning)' }} /> Volver tras una falla cuenta como victoria en <strong>Recuperación</strong>.
          </span>
        </div>
        </>
      ) : (
        <div className="card empty" style={{ padding: '60px 24px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ margin: '0 auto 16px' }}>
            <CheckCircle2 size={38} style={{ color: 'var(--accent-2)' }} />
          </div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>No hay hábitos activos todavía</h3>
          <p style={{ color: 'var(--text-2)', maxWidth: 460, margin: '0 auto 20px', fontSize: 14 }}>
            Establece tu primer hábito para comenzar tu semana y organizar tus días con consistencia.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingHabit(undefined);
              setShowHabitModal(true);
            }}
          >
            <Plus size={16} /> Establecer mi primer hábito
          </button>
        </div>
      )}
      </div>

      {showHabitModal && (
        <HabitModal
          isOpen={showHabitModal}
          onClose={() => setShowHabitModal(false)}
          habitToEdit={editingHabit}
        />
      )}

      {failModalInfo && (
        <FailReasonModal
          isOpen={!!failModalInfo}
          onClose={() => setFailModalInfo(null)}
          habit={failModalInfo.habit}
          date={failModalInfo.date}
        />
      )}

      {progressModalInfo && (
        <HabitProgressModal
          isOpen={!!progressModalInfo}
          onClose={() => setProgressModalInfo(null)}
          habit={progressModalInfo.habit}
          dateKey={progressModalInfo.date}
        />
      )}

      {/* Modal de confirmación para eliminar hábito */}
      <ConfirmModal
        isOpen={Boolean(habitToDelete)}
        onClose={() => setHabitToDelete(null)}
        onConfirm={() => {
          if (habitToDelete) {
            deleteHabit(habitToDelete.id);
            toast(`Hábito «${habitToDelete.name}» eliminado`, 'info');
            setHabitToDelete(null);
          }
        }}
        title="Eliminar hábito"
        message={
          habitToDelete
            ? `¿Estás seguro de que deseas eliminar «${habitToDelete.name}»? Los puntos y estadísticas ya obtenidos se mantendrán.`
            : ''
        }
        confirmLabel="Eliminar hábito"
        danger
      />
    </div>
  );
};
