import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Pause, Square, X, Clock, Flame, Star, Zap, Plus, Maximize2, ChevronDown, Sparkles, TrendingUp, Sprout } from 'lucide-react';
import { EnergyIcon, MoodIcon, StatusIcon } from '@/components/ui/icons';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useStore, useData, minimumMinutesFor } from '@/store/useStore';
import { formatClock, formatMinutes, shortDate, timeHM, todayKey, addDaysKey } from '@/lib/dates';
import { getLog } from '@/lib/metrics';
import { SessionFinishModal } from '@/components/modals/SessionFinishModal';
import { CustomTimerModal } from '@/components/modals/CustomTimerModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { fireRewardCelebration } from '@/lib/confetti';
import { useElapsed } from '@/lib/timer';
import { playSound } from '@/lib/sound';
import type { Level5 } from '@/types';

export const TimerView: React.FC = () => {
  const navigate = useNavigate();
  const data = useData();
  const activeTimer = useStore((s) => s.activeTimer);
  const minimumRatio = useStore((s) => s.settings.minimumRatio);
  const isTimerModalOpen = useStore((s) => s.isTimerModalOpen);
  const setTimerModalOpen = useStore((s) => s.setTimerModalOpen);
  const startTimer = useStore((s) => s.startTimer);
  const pauseTimer = useStore((s) => s.pauseTimer);
  const resumeTimer = useStore((s) => s.resumeTimer);
  const cancelTimer = useStore((s) => s.cancelTimer);
  const finishTimer = useStore((s) => s.finishTimer);
  const { toast } = useToast();

  // Solo hábitos activos de tipo tiempo (excluye estrictamente acción, cantidad y pausados)
  const activeTimeHabits = data.habits.filter(
    (h) =>
      h.status === 'active' &&
      h.kind !== 'action' &&
      h.kind !== 'quantity' &&
      (h.kind === 'time' || (!h.kind && Boolean(h.targetMinutes && h.targetMinutes > 0)))
  );

  const [selectedHabitId, setSelectedHabitId] = useState<string>(
    activeTimeHabits.find((h) => h.targetMinutes)?.id ?? (activeTimeHabits[0]?.id ?? ''),
  );
  const [preEnergy, setPreEnergy] = useState<Level5>(4);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);

  const isCustom = Boolean(activeTimer?.isCustom);
  const activeHabit = !isCustom && activeTimer ? data.habits.find((h) => h.id === activeTimer.habitId) : null;
  const currentSelectedHabit = data.habits.find((h) => h.id === selectedHabitId);

  // Reloj en tiempo real (por diferencia de tiempo: no deriva)
  const seconds = useElapsed(activeTimer);

  const timerTitle = isCustom ? (activeTimer?.customTitle || 'Temporizador libre') : (activeHabit?.name ?? 'Sesión');
  const timerIcon = isCustom ? (activeTimer?.customIcon || '⏱️') : (activeHabit?.icon ?? '⏱️');
  const customMin = activeTimer?.customMinutes ?? 25;
  const habitTargetMin = isCustom ? customMin : (activeHabit?.targetMinutes ?? 25);
  const todayLog = activeHabit ? getLog(data, activeHabit.id, todayKey()) : undefined;
  const alreadyLoggedMin = isCustom ? 0 : (todayLog?.minutes || 0);
  const remainingTargetMin = isCustom ? customMin : Math.max(0, habitTargetMin - alreadyLoggedMin);
  const sessionTargetSec = (isCustom ? customMin : (remainingTargetMin > 0 ? remainingTargetMin : habitTargetMin)) * 60;
  const remainingSec = Math.max(0, sessionTargetSec - seconds);
  const isCompleted = remainingSec === 0 || seconds >= sessionTargetSec;

  const minMin = isCustom || !activeHabit ? 0 : minimumMinutesFor({ ...activeHabit, targetMinutes: habitTargetMin }, minimumRatio);
  const totalMinDoneToday = alreadyLoggedMin + Math.floor(seconds / 60);
  const hasReachedMinimum = !isCustom && minMin > 0 && totalMinDoneToday >= minMin;

  const fractionRemaining = sessionTargetSec > 0 ? Math.max(0, Math.min(1, remainingSec / sessionTargetSec)) : 0;
  const size = 300;
  const strokeWidth = 10;
  const radius = (size - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - fractionRemaining);

  const activeStrokeColor = isCustom
    ? '#eab308'
    : hasReachedMinimum
    ? '#f97316'
    : (activeHabit?.color || 'var(--accent)');
  const strokeGlow = isCustom
    ? 'rgba(234, 179, 8, 0.6)'
    : hasReachedMinimum
    ? 'rgba(249, 115, 22, 0.7)'
    : `${activeStrokeColor}66`;

  // Muesca en la posición de la versión mínima dentro de la meta
  const showTick = !isCustom && minMin > 0;
  const tickAngleDeg = Math.min(1, minMin / Math.max(1, habitTargetMin)) * 360;
  const tickRad = (tickAngleDeg * Math.PI) / 180;
  const tickX1 = size / 2 + (radius - 8) * Math.cos(tickRad);
  const tickY1 = size / 2 + (radius - 8) * Math.sin(tickRad);
  const tickX2 = size / 2 + (radius + 8) * Math.cos(tickRad);
  const tickY2 = size / 2 + (radius + 8) * Math.sin(tickRad);

  // Datos para gráfico de minutos de enfoque en los últimos 7 días
  const timerChartData = useMemo(() => {
    const list = [];
    const tk = todayKey();
    for (let i = 6; i >= 0; i--) {
      const dk = addDaysKey(tk, -i);
      const daySessionsMin = data.sessions
        .filter((s) => s.date === dk)
        .reduce((sum, s) => sum + s.durationSec / 60, 0);
      const dayLogsMin = Object.values(data.logs)
        .filter((l) => l.date === dk)
        .reduce((sum, l) => sum + (l.minutes || 0), 0);
      const total = Math.round(Math.max(daySessionsMin, dayLogsMin));
      list.push({
        day: shortDate(dk),
        dateKey: dk,
        minutes: total,
      });
    }
    return list;
  }, [data.sessions, data.logs]);
  const totalWeeklyFocusMin = timerChartData.reduce((acc, d) => acc + d.minutes, 0);

  return (
    <div className="stack fade-up">
      <div className="page-head">
        <div>
          <p className="eyebrow">Enfoque y medición precisa</p>
          <h1>Temporizador de sesiones</h1>
        </div>
      </div>

      {/* SALA PRINCIPAL DEL TEMPORIZADOR */}
      <div className="card highlight" style={{ textAlign: 'center', padding: '36px 20px', position: 'relative' }}>
        {activeTimer && (activeHabit || isCustom) ? (
          <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {/* Botón para abrir el temporizador en modal flotante */}
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={() => setTimerModalOpen(true)}
                title="Maximizar en pantalla completa"
                aria-label="Maximizar en pantalla completa"
              >
                <Maximize2 size={15} /> Ampliar temporizador
              </button>
            </div>

            {/* CÍRCULO SVG DEL TEMPORIZADOR */}
            {/* Anillo escalable: nunca más ancho que la pantalla */}
            <div style={{ position: 'relative', width: `min(${size}px, 78vw)`, aspectRatio: '1' }}>
              <svg
                viewBox={`0 0 ${size} ${size}`}
                width="100%"
                height="100%"
                style={{
                  transform: 'rotate(-90deg)',
                  pointerEvents: 'none',
                  transformOrigin: '50% 50%',
                  overflow: 'visible',
                }}
              >
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.06)"
                  strokeWidth={strokeWidth}
                />
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={activeStrokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  style={{
                    transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease',
                    filter: `drop-shadow(0 0 12px ${strokeGlow})`,
                  }}
                />
                {showTick && (
                  <line
                    x1={tickX1}
                    y1={tickY1}
                    x2={tickX2}
                    y2={tickY2}
                    stroke="#f97316"
                    strokeWidth={4}
                    strokeLinecap="round"
                    style={{ filter: 'drop-shadow(0 0 4px #f97316)' }}
                  />
                )}
              </svg>

              {/* CONTENIDO CENTRADO */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '24px',
                  pointerEvents: 'none',
                }}
              >
                <span style={{ fontSize: 'clamp(28px, 8vw, 40px)', lineHeight: 1, marginBottom: 4 }}>{timerIcon}</span>

                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 17,
                    letterSpacing: '-0.02em',
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: '#fff',
                  }}
                  title={timerTitle}
                >
                  {timerTitle}
                </div>

                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, marginBottom: 6 }}>
                  {isCustom
                    ? (activeTimer?.customDescription || `${customMin} minutos de enfoque directo`)
                    : alreadyLoggedMin > 0
                    ? `Hecho: ${alreadyLoggedMin}m · Faltan ${remainingTargetMin}m`
                    : `Objetivo: ${habitTargetMin} min`}
                  {!isCustom && minMin > 0 && (
                    <span style={{ color: hasReachedMinimum ? '#f97316' : 'var(--minimum)' }}>
                      {' '}· mín: {minMin}m
                    </span>
                  )}
                </div>

                <div
                  style={{
                    fontSize: 'clamp(32px, 9vw, 44px)',
                    fontWeight: 800,
                    letterSpacing: '-0.03em',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    color: activeTimer.pausedAt
                      ? 'var(--warning)'
                      : isCompleted
                      ? 'var(--success)'
                      : hasReachedMinimum
                      ? '#f97316'
                      : '#fff',
                    textShadow: '0 2px 14px rgba(0, 0, 0, 0.8)',
                  }}
                >
                  {formatClock(remainingSec)}
                </div>

                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginTop: 6,
                    color: activeTimer.pausedAt
                      ? 'var(--warning)'
                      : isCompleted
                      ? 'var(--success)'
                      : hasReachedMinimum
                      ? '#f97316'
                      : 'var(--accent-2)',
                  }}
                >
                  <span className="icon-label">
                    {activeTimer.pausedAt ? (
                      <><Pause size={13} strokeWidth={2.6} aria-hidden="true" /> En pausa</>
                    ) : isCompleted ? (
                      <><Sparkles size={13} aria-hidden="true" /> Meta alcanzada</>
                    ) : hasReachedMinimum ? (
                      <><Sprout size={13} aria-hidden="true" /> Modo mínimo logrado</>
                    ) : (
                      <><Play size={13} strokeWidth={2.6} aria-hidden="true" /> En progreso</>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Controles de la sesión */}
            <div style={{ display: 'flex', gap: 12, marginTop: 4, width: '100%', maxWidth: 360, justifyContent: 'center' }}>
              {activeTimer.pausedAt ? (
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resumeTimer}>
                  <Play size={16} /> Reanudar
                </button>
              ) : (
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={pauseTimer}>
                  <Pause size={16} /> Pausar
                </button>
              )}

              <button
                className="btn btn-primary"
                style={{ flex: 1, background: 'linear-gradient(135deg, #10b981, #059669)', borderColor: '#10b981' }}
                onClick={() => {
                  if (isCustom) {
                    finishTimer();
                    fireRewardCelebration();
                    toast('¡Temporizador finalizado! Has completado tu sesión de enfoque.', 'success');
                  } else {
                    setShowFinishModal(true);
                  }
                }}
              >
                <Square size={16} /> Terminar
              </button>

              <button
                type="button"
                className="btn btn-ghost sm danger"
                onClick={() => setShowCancelConfirm(true)}
                title="Descartar sesión"
                aria-label="Descartar sesión"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          /* Selector para iniciar nueva sesión */
          <div style={{ maxWidth: 440, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Cabecera con botón de temporizador de un solo uso */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Hábito para la sesión</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Elige el hábito a registrar hoy</div>
              </div>

              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={() => setShowCustomModal(true)}
                disabled={Boolean(activeTimer)}
                style={{
                  background: 'rgba(234, 179, 8, 0.12)',
                  borderColor: 'rgba(234, 179, 8, 0.4)',
                  color: '#eab308',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                title="Temporizador libre sin alterar estadísticas ni crear hábitos"
                aria-label="Temporizador libre sin alterar estadísticas ni crear hábitos"
              >
                <Zap size={14} aria-hidden="true" /> Temporizador libre
              </button>
            </div>

            {/* Selector Desplegable de Hábitos de Tiempo */}
            {activeTimeHabits.length > 0 ? (
              <CustomSelect
                value={selectedHabitId}
                onChange={(val) => setSelectedHabitId(val)}
                options={activeTimeHabits.map((h) => ({
                  value: h.id,
                  label: h.name,
                  icon: h.icon,
                  sublabel: `${h.targetMinutes ?? 30} min ${h.minimumMinutes ? `· mín ${h.minimumMinutes}m` : ''}`,
                }))}
                placeholder="Selecciona un hábito..."
                size="lg"
              />
            ) : (
              <div style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)', textAlign: 'left' }}>
                No tienes hábitos de tiempo programados. Puedes crear uno en Objetivos o pulsar el botón <strong>Temporizador libre</strong> para una sesión puntual.
              </div>
            )}

            {/* Selector de energía antes de empezar */}
            {activeTimeHabits.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <span className="label" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
                  ¿Cuál es tu nivel de energía en este momento?
                </span>
                <div className="level-picker" style={{ justifyContent: 'center' }}>
                  {([1, 2, 3, 4, 5] as Level5[]).map((lvl) => ({ lvl })).map((e) => (
                    <button
                      key={e.lvl}
                      type="button"
                      className={preEnergy === e.lvl ? 'active' : ''}
                      onClick={() => {
                        setPreEnergy(e.lvl as Level5);
                        playSound.energy(e.lvl as 1 | 2 | 3 | 4 | 5);
                      }}
                      style={{ minWidth: 46 }}
                    >
                      <span className="level-picker-icon" title={`Energía ${e.lvl}/5`}><EnergyIcon level={e.lvl} size={24} /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTimeHabits.length > 0 && (
              <button
                className="btn btn-primary lg"
                style={{ marginTop: 6 }}
                disabled={Boolean(activeTimer) || !selectedHabitId}
                onClick={() => {
                  startTimer(selectedHabitId, preEnergy);
                  playSound.startTimerCountdown();
                }}
              >
                <Play size={18} /> Iniciar temporizador de hábito
              </button>
            )}
          </div>
        )}
      </div>

      {/* GRÁFICA DE ENFOQUE SEMANAL */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-head">
          <div>
            <h3 className="card-title">Minutos de enfoque (Últimos 7 días)</h3>
            <p className="card-sub">Tiempo acumulado en sesiones y cronómetros diarios</p>
          </div>
          <span className="badge" style={{ background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
            {formatMinutes(totalWeeklyFocusMin)} esta semana
          </span>
        </div>

        <div style={{ width: '100%', height: 180, overflow: 'hidden' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={timerChartData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
              <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} tickLine={false} />
              <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} unit="m" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(20, 21, 33, 0.96)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: '#fff',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
                }}
                formatter={(val: any) => [`${val} min`, 'Enfoque total']}
                labelFormatter={(lbl) => `${lbl}`}
              />
              <Bar dataKey="minutes" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* HISTORIAL RECIENTE DE SESIONES */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Historial de sesiones</h3>
            <p className="card-sub">Sesiones completadas, energía y dificultad registrada</p>
          </div>
          <span className="badge">{data.sessions.length} sesiones en total</span>
        </div>

        {data.sessions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.sessions.slice(-10).reverse().map((s) => {
              const habit = data.habits.find((h) => h.id === s.habitId);
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 14,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>{habit?.icon ?? '⏱️'}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{habit?.name ?? 'Hábito eliminado'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {shortDate(s.date)} · {timeHM(s.startedAt)} - {timeHM(s.endedAt)}
                        {s.note && <span> · "{s.note}"</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Duración */}
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {formatMinutes(s.durationSec / 60)}
                      </div>
                      <span className={`badge sm ${s.status === 'completed' ? 'success' : s.status === 'minimum' ? 'warning' : 'danger'}`}>
                        {s.status === 'completed' ? <><StatusIcon status="full" size={11} /> Completa</> : s.status === 'minimum' ? <><StatusIcon status="minimum" size={11} /> Mínima</> : 'Abandonada'}
                      </span>
                    </div>

                    {/* Ánimo y dificultad */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 18 }}>
                      {s.mood && (
                        <span title={`Ánimo: ${s.mood}/5`} style={{ display: 'inline-flex' }}>
                          <MoodIcon level={s.mood} size={18} />
                        </span>
                      )}
                      {s.difficulty && (
                        <span style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', alignItems: 'center' }} title={`Dificultad: ${s.difficulty}/5`}>
                          <Star size={13} fill="currentColor" /> {s.difficulty}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted small">Aún no has registrado sesiones con el temporizador.</p>
        )}
      </div>

      {showFinishModal && (
        <SessionFinishModal
          isOpen={showFinishModal}
          onClose={() => setShowFinishModal(false)}
          zIndex={1300}
        />
      )}

      {showCancelConfirm && (
        <ConfirmModal
          isOpen={showCancelConfirm}
          onClose={() => setShowCancelConfirm(false)}
          zIndex={1300}
          onConfirm={() => {
            cancelTimer();
            setShowCancelConfirm(false);
          }}
          title={isCustom ? '¿Cancelar temporizador libre?' : '¿Cancelar sesión actual?'}
          message={
            isCustom
              ? '¿Estás seguro de que deseas cancelar este temporizador puntual? No se registrará ningún progreso ni cambios.'
              : 'No se guardará el tiempo transcurrido en el registro de hoy ni se otorgarán puntos.'
          }
          confirmLabel={isCustom ? 'Cancelar temporizador' : 'Cancelar sesión'}
          confirmVariant="danger"
        />
      )}

      <CustomTimerModal
        isOpen={showCustomModal}
        onClose={() => setShowCustomModal(false)}
      />
    </div>
  );
};
