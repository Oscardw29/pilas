import React, { useState, useMemo } from 'react';
import { useStore, useData } from '../store/useStore';
import {
  startOfWeek,
  weekDays,
  toKey,
  addDays,
  formatRange,
  formatMinutes,
} from '../lib/dates';
import { weekSummary, getLog, isDoneLog } from '../lib/metrics';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Save,
  Target,
  Brain,
} from 'lucide-react';
import { useToast } from '../components/ui/ToastContext';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { PausedBadge } from '../components/ui/icons';

export const ReviewView: React.FC = () => {
  const store = useData();
  const { habits, logs, sessions, weeklyReviews } = store;
  const saveWeeklyReview = useStore((s) => s.saveWeeklyReview);
  const addPointEvent = useStore((s) => s.addPointEvent);
  const { showToast } = useToast();

  const [currentWeekMonday, setCurrentWeekMonday] = useState<Date>(() => startOfWeek(new Date()));
  const [planningNote, setPlanningNote] = useState<string>('');
  const [adjustedHabitFocus, setAdjustedHabitFocus] = useState<string>('');

  const mondayKey = toKey(currentWeekMonday);
  const currentWeekDays = useMemo(() => weekDays(currentWeekMonday), [currentWeekMonday]);

  const prevWeekMonday = useMemo(() => addDays(currentWeekMonday, -7), [currentWeekMonday]);
  const prevMondayKey = toKey(prevWeekMonday);

  const savedReview = useMemo(() => {
    return weeklyReviews.find((r) => r.weekStart === mondayKey);
  }, [weeklyReviews, mondayKey]);

  React.useEffect(() => {
    if (savedReview) {
      setPlanningNote(savedReview.changes || '');
      setAdjustedHabitFocus(savedReview.notes || '');
    } else {
      setPlanningNote('');
      setAdjustedHabitFocus('');
    }
  }, [savedReview, mondayKey]);

  const currentSummary = useMemo(() => weekSummary(store, mondayKey), [store, mondayKey]);
  const prevSummary = useMemo(() => weekSummary(store, prevMondayKey), [store, prevMondayKey]);

  const consistencyPct = Math.round((currentSummary.consistency ?? 0) * 100);
  const prevConsistencyPct = Math.round((prevSummary.consistency ?? 0) * 100);
  const consistencyDelta = consistencyPct - prevConsistencyPct;

  const rankedHabits = useMemo(() => {
    const list = currentSummary.perHabit.map((item) => ({
      habit: item.habit,
      scorePct: Math.round((item.score ?? 0) * 100),
      done: item.done,
      scheduled: item.scheduled,
    }));
    return list.sort((a, b) => b.scorePct - a.scorePct);
  }, [currentSummary]);

  const bestHabit = rankedHabits.length > 0 ? rankedHabits[0] : null;
  const worstHabit = rankedHabits.length > 1 ? rankedHabits[rankedHabits.length - 1] : null;

  const dailyData = useMemo(() => {
    return currentWeekDays.map((d) => {
      const dk = toKey(d);
      const daySessions = sessions.filter((s) => s.date === dk && s.status === 'completed');
      const mins = Math.round(daySessions.reduce((acc, s) => acc + s.durationSec / 60, 0));

      let completedCount = 0;
      habits.forEach((h) => {
        const l = getLog(store, h.id, dk);
        if (isDoneLog(l)) completedCount++;
      });

      const dayName = d.toLocaleDateString('es-ES', { weekday: 'short' });
      return {
        day: dayName.charAt(0).toUpperCase() + dayName.slice(1),
        minutos: mins,
        completados: completedCount,
      };
    });
  }, [currentWeekDays, sessions, habits, store]);

  const failReasons = useMemo(() => {
    const counts: Record<string, number> = {};
    const dayKeys = currentWeekDays.map(toKey);
    Object.values(logs).forEach((l) => {
      if (dayKeys.includes(l.date) && l.failReason) {
        counts[l.failReason] = (counts[l.failReason] || 0) + 1;
      }
    });

    let topReason = '';
    let max = 0;
    Object.entries(counts).forEach(([r, count]) => {
      if (count > max) {
        max = count;
        topReason = r;
      }
    });

    const labels: Record<string, string> = {
      no_time: 'falta de tiempo',
      no_energy: 'falta de energía',
      distracted: 'distracción',
      forgot: 'olvido',
      too_hard: 'demasiada dificultad',
      not_interested: 'pérdida de interés',
      other: 'otros factores',
    };

    return { topReason: labels[topReason] || topReason, count: max };
  }, [currentWeekDays, logs]);

  const handlePrevWeek = () => setCurrentWeekMonday((prev) => addDays(prev, -7));
  const handleNextWeek = () => setCurrentWeekMonday((prev) => addDays(prev, 7));
  const handleCurrentWeek = () => setCurrentWeekMonday(startOfWeek(new Date()));

  const handleSaveReview = () => {
    const isNew = !savedReview;

    saveWeeklyReview({
      weekStart: mondayKey,
      consistency: currentSummary.consistency ?? 0,
      changes: planningNote,
      notes: adjustedHabitFocus,
    });

    if (isNew) {
      addPointEvent({
        amount: 50,
        reason: `Completar revisión semanal (${mondayKey})`,
        source: 'review',
      });
      showToast('¡Revisión semanal guardada! Ganaste +50 pts de reflexión.', 'reward');
    } else {
      showToast('Revisión semanal actualizada correctamente.', 'info');
    }
  };

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Semana: {formatRange(currentWeekMonday)}</p>
          <h1>Revisión semanal</h1>
        </div>

        <div className="actions">
          <div className="segmented review-week-switch">
            <button type="button" onClick={handlePrevWeek} title="Semana anterior" aria-label="Semana anterior">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={handleCurrentWeek} className="active">
              Semana actual
            </button>
            <button type="button" onClick={handleNextWeek} title="Semana siguiente" aria-label="Semana siguiente">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Evalúa tu constancia semanal, descubre qué hábitos te costaron más esfuerzo y planifica ajustes para la próxima semana.
      </p>

      {habits.length === 0 && (
        <div className="card empty" style={{ padding: '36px 16px', textAlign: 'center' }}>
          <Sparkles size={32} style={{ color: 'var(--accent-2)', margin: '0 auto 12px', opacity: 0.8 }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No tienes hábitos registrados aún</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, maxWidth: 400, margin: '0 auto' }}>
            Crea tus hábitos y regístralos durante la semana para generar comparativas, métricas de constancia y revisiones periódicas.
          </p>
        </div>
      )}

      {/* Grid de 4 KPIs con estilo del sistema */}
      <div className="grid-4 review-kpis">
        <div className="card">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Consistencia semanal</span>
              {consistencyDelta !== 0 && (
                <span className={`badge ${consistencyDelta > 0 ? 'success' : 'danger'}`}>
                  {consistencyDelta > 0 ? `+${consistencyDelta}%` : `${consistencyDelta}%`}
                </span>
              )}
            </div>
            <div className="stat-value" style={{ color: 'var(--accent-2)' }}>
              {consistencyPct}%
            </div>
            <div className="progress thin" style={{ marginTop: 8 }}>
              <div style={{ width: `${consistencyPct}%` }} />
            </div>
            <span className="stat-sub" style={{ marginTop: 4 }}>
              vs {prevConsistencyPct}% semana previa
            </span>
          </div>
        </div>

        <div className="card">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Hábitos completados</span>
              <span className="badge accent">{currentSummary.done} / {currentSummary.scheduled}</span>
            </div>
            <div className="stat-value">
              {currentSummary.done}
              <small> de {currentSummary.scheduled}</small>
            </div>
            <span className="stat-sub">
              {currentSummary.full} completos · {currentSummary.minimum} mínimos
            </span>
          </div>
        </div>

        <div className="card">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Sesiones de foco</span>
              <Clock size={16} style={{ color: 'var(--accent-2)' }} />
            </div>
            <div className="stat-value" style={{ color: 'var(--warning)' }}>
              {currentSummary.sessions}
              <small> sesiones</small>
            </div>
            <span className="stat-sub">Con temporizador integrado</span>
          </div>
        </div>

        <div className="card">
          <div className="stat">
            <div className="stat-top">
              <span className="stat-label">Tiempo total invertido</span>
              <Sparkles size={16} style={{ color: 'var(--success)' }} />
            </div>
            <div className="stat-value">
              {formatMinutes(currentSummary.minutes)}
            </div>
            <span className="stat-sub">Tiempo acumulado de enfoque</span>
          </div>
        </div>
      </div>

      {/* Mejor y más difícil hábito */}
      <div className="grid-2 review-highlights">
        <div className="card" style={{ borderLeft: '3px solid var(--success)' }}>
          <div className="row-between">
            <span className="badge success">
              <CheckCircle2 size={13} /> Hábito más consistente
            </span>
            {bestHabit && <span className="bold accent">{bestHabit.scorePct}%</span>}
          </div>
          {bestHabit ? (
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <span className="entity-icon sm">{bestHabit.habit.icon}</span>
                <div>
                  <div className="bold">{bestHabit.habit.name}</div>
                  <div className="small muted">
                    {bestHabit.done} de {bestHabit.scheduled} días cumplidos
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 12 }}>Sin registros en esta semana</div>
          )}
        </div>

        <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}>
          <div className="row-between">
            <span className="badge warning">
              <AlertTriangle size={13} /> Mayor esfuerzo / dificultad
            </span>
            {worstHabit && <span className="bold warning">{worstHabit.scorePct}%</span>}
          </div>
          {worstHabit ? (
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <span className="entity-icon sm">{worstHabit.habit.icon}</span>
                <div>
                  <div className="bold">{worstHabit.habit.name}</div>
                  <div className="small muted">
                    {worstHabit.done} de {worstHabit.scheduled} días cumplidos
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 12 }}>Rendimiento parejo en todos tus hábitos</div>
          )}
        </div>
      </div>

      {/* Conclusiones automáticas */}
      <div className="callout positive">
        <Brain />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="title">Conclusiones del sistema para esta semana</div>
          <div className="detail" style={{ lineHeight: 1.6 }}>
            <div>
              • {consistencyDelta >= 0 ? (
                <>Tu consistencia <b>aumentó un +{consistencyDelta}%</b> respecto a la semana previa ({prevConsistencyPct}% → {consistencyPct}%).</>
              ) : (
                <>Tu consistencia tuvo una disminución de <b>{consistencyDelta}%</b> respecto a la semana anterior.</>
              )}
            </div>
            {failReasons.topReason && (
              <div>
                • Principal motivo de omisión reportado: <b>{failReasons.topReason}</b> ({failReasons.count} veces). Te sugerimos apoyarte en las versiones mínimas.
              </div>
            )}
            <div>
              • Sumaste un total de <b>{formatMinutes(currentSummary.minutes)}</b> de trabajo enfocado a lo largo de {currentSummary.sessions} sesiones.
            </div>
          </div>
        </div>
      </div>

      {/* Gráfico de actividad diaria */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Distribución diaria de la semana</div>
            <div className="card-sub">Minutos de foco y hábitos logrados cada día</div>
          </div>
        </div>
        <div className="review-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} />
              <YAxis stroke="var(--muted)" fontSize={12} width={36} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface-2)',
                  borderColor: 'var(--border-2)',
                  borderRadius: 10,
                  color: 'var(--text)',
                }}
              />
              <Bar dataKey="minutos" name="Minutos de foco" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completados" name="Hábitos completados" fill="var(--success)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabla detallada de hábitos */}
      <div className="card flush">
        <div className="card-flush-head">
          <div className="card-title">Desglose por hábito</div>
          <div className="card-sub">Detalle de cumplimiento en la semana seleccionada</div>
        </div>
        <div className="table-wrap">
          <table className="table review-table">
            <thead>
              <tr>
                <th>Hábito</th>
                <th className="num">Cumplidos</th>
                <th className="num">Programados</th>
                <th className="num">Consistencia</th>
              </tr>
            </thead>
            <tbody>
              {rankedHabits.map((item) => {
                const isPaused = item.habit.status === 'paused';
                return (
                  <tr
                    key={item.habit.id}
                    style={
                      isPaused
                        ? {
                            background: 'rgba(234, 179, 8, 0.05)',
                            borderLeft: '3px solid #eab308',
                          }
                        : undefined
                    }
                  >
                    <td>
                      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                        <span className="entity-icon sm">{item.habit.icon}</span>
                        <span className="bold" style={{ color: isPaused ? '#eab308' : undefined }}>
                          {item.habit.name}
                        </span>
                        {isPaused && (
                          <PausedBadge />
                        )}
                      </div>
                    </td>
                    <td className="num bold success">{item.done}</td>
                    <td className="num muted">{item.scheduled}</td>
                    <td className="num">
                      <span
                        className={`badge ${
                          isPaused
                            ? 'warning'
                            : item.scorePct >= 70
                            ? 'success'
                            : item.scorePct >= 40
                            ? 'warning'
                            : 'danger'
                        }`}
                      >
                        {item.scorePct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Planificar próxima semana */}
      <div className="card highlight review-plan">
        <div className="card-head">
          <div className="row">
            <Target size={18} style={{ color: 'var(--accent-2)' }} />
            <div>
              <div className="card-title">Planificar la próxima semana</div>
              <div className="card-sub">Define qué quieres cambiar o ajustar para consolidar tu consistencia</div>
            </div>
          </div>
          {savedReview && <span className="badge accent">Plan guardado</span>}
        </div>

        <div className="form">
          <div className="field">
            <span className="label">¿Qué quieres cambiar o ajustar la siguiente semana?</span>
            <textarea
              className="textarea"
              rows={3}
              value={planningNote}
              onChange={(e) => setPlanningNote(e.target.value)}
              placeholder="Ejemplo: Reducir la sesión de ejercicio a 20 min los lunes; adelantar lectura a las 9 PM..."
            />
          </div>

          <div className="field">
            <span className="label">Hábito prioritario en foco</span>
            <input
              className="input"
              value={adjustedHabitFocus}
              onChange={(e) => setAdjustedHabitFocus(e.target.value)}
              placeholder="Ejemplo: Proteger mi racha de programación con versión mínima"
            />
          </div>

          <div className="row review-plan-actions">
            <button type="button" className="btn btn-primary" onClick={handleSaveReview}>
              <Save size={16} />
              {savedReview ? 'Actualizar plan semanal' : 'Guardar y reclamar +50 pts'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
