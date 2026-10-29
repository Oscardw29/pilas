import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Zap, Clock, Sparkles, TrendingUp, Flame, Snowflake } from 'lucide-react';
import { StatusLabel } from '@/components/ui/icons';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useData } from '@/store/useStore';
import { daySummary, getDayStreakStatus, pointsFor } from '@/lib/metrics';
import {
  fromKey,
  toKey,
  todayKey,
  longDate,
  formatMinutes,
  DAY_LETTER,
  weekdayIndex,
  MONTHS,
} from '@/lib/dates';
import { FAIL_REASON_LABELS } from '@/lib/insights';
import { habitCoinValue } from '@/lib/economyRules';

export const CalendarView: React.FC = () => {
  const data = useData();
  const T = todayKey();

  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const [selectedDate, setSelectedDate] = useState<string>(T);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Días del mes actual
  const firstDayIndex = weekdayIndex(new Date(year, month, 1));
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Datos para gráfico de tendencia del mes actual
  const monthlyTrendData = useMemo(() => {
    const res = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const dk = toKey(d);
      const isPastOrToday = dk <= T;
      const status = isPastOrToday ? getDayStreakStatus(data, dk) : null;
      const dayLogsPts = Object.values(data.logs)
        .filter((l) => l.date === dk)
        .reduce((sum, l) => sum + (l.points || 0), 0);
      const dayBonusPts = (data.pointEvents || [])
        .filter((e) => e.at && toKey(new Date(e.at)) === dk)
        .reduce((sum, e) => sum + e.amount, 0);

      res.push({
        day: `${day}`,
        fullDate: dk,
        completed: status ? status.completedCount : 0,
        scheduled: status ? status.scheduledCount : 0,
        points: dayLogsPts + dayBonusPts,
        isSuper: Boolean(status?.isSuperStreak),
      });
    }
    return res;
  }, [year, month, daysInMonth, data.logs, data.pointEvents, data.habits, T]);

  const calendarSlots: (string | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) calendarSlots.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    calendarSlots.push(toKey(new Date(year, month, d)));
  }

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  // Resumen del día seleccionado
  const summary = daySummary(data, selectedDate, T);

  return (
    <div className="stack fade-up">
      <div className="page-head">
        <div>
          <p className="eyebrow">Historial visual continuo</p>
          <h1>Calendario histórico</h1>
        </div>
      </div>

      <div className="grid-main">
        {/* CALENDARIO MENSUAL */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, textTransform: 'capitalize' }}>
              {MONTHS[month]} {year}
            </h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="icon-btn sm" onClick={prevMonth} title="Mes anterior" aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <button className="icon-btn sm" onClick={nextMonth} title="Mes siguiente" aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          {/* Días de la semana */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center', marginBottom: 6 }}>
            {DAY_LETTER.map((dl, idx) => (
              <span key={idx} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)' }}>
                {dl}
              </span>
            ))}
          </div>

          {/* Grid de días */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {calendarSlots.map((dk, idx) => {
              if (!dk) return <div key={`empty-${idx}`} />;

              const dayNum = fromKey(dk).getDate();
              const isSelected = dk === selectedDate;
              const isToday = dk === T;
              const isPastOrToday = dk <= T;
              const streakInfo = isPastOrToday ? getDayStreakStatus(data, dk) : null;
              const isFrozenDay = Boolean(data.streakFreezes && data.streakFreezes.includes(dk));

              // Acento violeta (el rojo se reserva para errores y fallos)
              let border = isSelected ? 'var(--accent-2)' : isToday ? 'var(--accent)' : 'var(--border)';
              let bg = isSelected ? 'rgba(139, 92, 246, 0.18)' : isToday ? 'rgba(139, 92, 246, 0.08)' : 'var(--surface-2)';
              let flameElement: React.ReactNode = null;

              if (isFrozenDay) {
                flameElement = (
                  <span className="cal-streak-mark" style={{ color: '#38bdf8' }} title="Racha protegida: Día congelado con Escudo de Hielo">
                    <Snowflake size={13} strokeWidth={2.4} aria-hidden="true" />
                  </span>
                );
              } else if (streakInfo?.isSuperStreak) {
                flameElement = (
                  <span className="cal-streak-mark" style={{ color: '#c084fc' }} title="¡Súper Racha! Todos los hábitos completados">
                    <Flame size={13} strokeWidth={2.4} fill="currentColor" fillOpacity={0.35} aria-hidden="true" />
                  </span>
                );
              } else if (streakInfo?.hasStreak) {
                flameElement = (
                  <span className="cal-streak-mark" style={{ color: '#fb923c' }} title="Racha activa: Al menos un hábito completado">
                    <Flame size={13} strokeWidth={2.4} fill="currentColor" fillOpacity={0.35} aria-hidden="true" />
                  </span>
                );
              } else if (isPastOrToday) {
                flameElement = (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'rgba(255, 255, 255, 0.2)',
                    }}
                  />
                );
              }

              return (
                <button
                  key={dk}
                  type="button"
                  onClick={() => setSelectedDate(dk)}
                  className={`calendar-day-hover ${isSelected ? 'selected' : ''}`}
                  style={{
                    height: 54,
                    borderRadius: 12,
                    background: bg,
                    border: isSelected
                      ? '1.5px solid #ef4444'
                      : isToday
                      ? '1.5px solid #ef4444'
                      : `1px solid ${border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    boxShadow: isSelected
                      ? '0 0 10px rgba(239, 68, 68, 0.45)'
                      : isToday
                      ? '0 0 6px rgba(239, 68, 68, 0.25)'
                      : 'none',
                    transform: isSelected ? 'scale(1.02)' : 'none',
                    transition: 'all .15s ease',
                  }}
                  title={
                    isFrozenDay
                      ? `${dayNum}: Racha protegida (Día congelado)`
                      : streakInfo?.isSuperStreak
                      ? `${dayNum}: ¡Súper Racha! (${streakInfo.completedCount}/${streakInfo.scheduledCount} hábitos)`
                      : streakInfo?.hasStreak
                      ? `${dayNum}: Racha activa (${streakInfo.completedCount} completado)`
                      : `${dayNum}`
                  }
                >
                  <span style={{ fontSize: 13.5, fontWeight: isToday ? 800 : 600 }}>
                    {dayNum}
                  </span>
                  {flameElement}
                </button>
              );
            })}
          </div>

          {/* Leyenda de racha y llamas */}
          <div style={{ display: 'flex', gap: 18, marginTop: 18, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="cal-streak-mark" style={{ color: '#fb923c' }}><Flame size={13} fill="currentColor" fillOpacity={0.35} aria-hidden="true" /></span> Racha activa (hábito completado)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="cal-streak-mark" style={{ color: '#c084fc' }}><Flame size={13} fill="currentColor" fillOpacity={0.35} aria-hidden="true" /></span> Súper racha (todos completados)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="cal-streak-mark" style={{ color: '#38bdf8' }}><Snowflake size={13} aria-hidden="true" /></span> Día congelado (protegido)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} /> Sin registros
            </span>
          </div>
        </div>

        {/* PANEL DETALLE DEL DÍA SELECCIONADO */}
        <div key={selectedDate} className="card day-detail-panel">
          <div className="card-head">
            <div>
              <h3 className="card-title">{longDate(selectedDate)}</h3>
              <p className="card-sub">
                {selectedDate === T ? 'Hoy' : `Detalle de actividad registrada`}
              </p>
            </div>
            {summary.value != null && (
              <span className={`badge ${summary.value >= 0.7 ? 'success' : summary.value >= 0.4 ? 'warning' : 'danger'}`}>
                {Math.round(summary.value * 100)}% consistencia
              </span>
            )}
          </div>

          {/* Métricas rápidas del día */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Energía del día</div>
              <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Zap size={15} style={{ color: 'var(--warning)' }} />
                {summary.energy ? `${summary.energy.toFixed(1)} / 5` : 'No registrada'}
              </div>
            </div>

            <div style={{ padding: 10, borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Tiempo invertido</div>
              <div style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <Clock size={15} style={{ color: 'var(--info)' }} />
                {formatMinutes(summary.minutes)} ({summary.sessions.length} ses.)
              </div>
            </div>
          </div>

          {/* Desglose de Hábitos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {summary.full.length > 0 && (
              <div>
                <span className="label">
                  <StatusLabel status="full">Completados ({summary.full.length})</StatusLabel>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {summary.full.map((h) => (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span>{h.icon}</span>
                      <span>{h.name}</span>
                      <span className="badge sm success" style={{ marginLeft: 'auto' }}>+{habitCoinValue(h)} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.minimum.length > 0 && (
              <div>
                <span className="label">
                  <StatusLabel status="minimum">Mínimos cumplidos ({summary.minimum.length})</StatusLabel>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {summary.minimum.map((h) => (
                    <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span>{h.icon}</span>
                      <span>{h.name}</span>
                      <span className="badge sm warning" style={{ marginLeft: 'auto' }}>
                        +{pointsFor(h, 'minimum', data.settings.minimumRatio)} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.missed.length > 0 && (
              <div>
                <span className="label">
                  <StatusLabel status="missed">No realizados ({summary.missed.length})</StatusLabel>
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {summary.missed.map((h) => {
                    const l = data.logs[`${selectedDate}|${h.id}`];
                    return (
                      <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span>{h.icon}</span>
                        <span>{h.name}</span>
                        {l?.failReason && (
                          <span className="badge sm danger" style={{ marginLeft: 'auto' }}>
                            {FAIL_REASON_LABELS[l.failReason]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {data.habits.length === 0 ? (
              <p className="muted small">Aún no tienes hábitos registrados en el sistema.</p>
            ) : summary.scheduled.length === 0 ? (
              <p className="muted small">No hubo hábitos programados en esta fecha.</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Gráfica de actividad y puntos del mes */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">Tendencia de actividad ({MONTHS[month]} {year})</h3>
            <p className="card-sub">Puntos diarios acumulados a lo largo del mes</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <TrendingUp size={15} style={{ color: '#34d399' }} />
            <span>Progreso diario</span>
          </div>
        </div>

        <div style={{ width: '100%', height: 210, overflow: 'hidden' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyTrendData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="monthAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#34d399" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} tickLine={false} />
              <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(20, 21, 33, 0.96)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: '#fff',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
                }}
                formatter={(val: any) => [`${val} pts`, 'Puntos']}
                labelFormatter={(lbl) => `Día ${lbl} de ${MONTHS[month]}`}
              />
              <Area
                type="monotone"
                dataKey="points"
                stroke="#34d399"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#monthAreaGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
