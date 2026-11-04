import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutoCarousel } from '@/components/ui/AutoCarousel';
import { CountUp } from '@/components/ui/CountUp';
import {
  Sparkles,
  Zap,
  Flame,
  CheckCircle2,
  Calendar,
  Gift,
  ArrowRight,
  ArrowUpRight,
  TrendingUp,
  Play,
  RotateCcw,
  AlertTriangle,
  Lightbulb,
  Plus,
  Snowflake,
  Sprout,
  AlarmClock,
  X,
  Check,
  CircleDashed,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { StatusLabel } from '@/components/ui/icons';
import { StreakFlame } from '@/components/ui/StreakFlame';
import { fireHabitPop } from '@/lib/confetti';
import { playSound } from '@/lib/sound';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useStore, useData } from '@/store/useStore';
import { clickableProps } from '@/lib/a11y';
import { useToast } from '@/components/ui/ToastContext';
import {
  calculateGlobalStreak,
  getDayStreakStatus,
  isScheduled,
  getLog,
  isDoneLog,
  weekSummary,
  pointsFor,
  consistency,
} from '@/lib/metrics';
import { celebrateStreakChange, streakSnapshot } from '@/lib/streakCelebration';
import { todayKey, toKey, longDate, startOfWeekKey, addDaysKey, DAY_SHORT, formatMinutes } from '@/lib/dates';
import { recommendWhatToDo } from '@/lib/recommendations';
import { ABANDONMENT_DISMISS_ID, detectAbandonment } from '@/lib/insights';
import { FailReasonModal } from '@/components/modals/FailReasonModal';
import { AbandonmentModal } from '@/components/modals/AbandonmentModal';
import { HabitProgressModal } from '@/components/modals/HabitProgressModal';
import type { Habit } from '@/types';
import { useEconomy } from '@/store/useEconomy';
import { habitCoinValue } from '@/lib/economyRules';

const QUOTES = [
  'La constancia vence lo que la dicha no alcanza.',
  'No tienes que ser extremo, solo constante.',
  'Pequeños pasos cada día construyen grandes cambios.',
  'La disciplina es elegir entre lo que quieres ahora y lo que más quieres.',
  'Cada hábito completado es un voto por la persona que quieres ser.',
  'Si fallas un día, no falles dos.',
  'Un 1% mejor cada día suma muchísimo al final del año.',
  'Tu yo del futuro te lo va a agradecer.',
];

interface DonutItem {
  id: string;
  name: string;
  icon: string;
  value: number;
  targetMinutes: number;
  color: string;
  /** Minutos en los últimos 7 días y en los 7 anteriores (tendencia) */
  last7: number;
  prev7: number;
  /** Promedio de minutos en los días con actividad (últimos 30) */
  avgActiveDay: number | null;
  /** Días con actividad en los últimos 30 */
  activeDays30: number;
  consistency30: number | null;
}

/**
 * Tarjeta del donut: no repite el total (ya está en la lista de abajo); muestra
 * la tendencia semanal, el promedio real frente a la meta y la consistencia.
 */
const CustomDonutTooltip = ({ active, payload, estimated }: any) => {
  if (!active || !payload || !payload.length) return null;
  const d: DonutItem = payload[0].payload;

  const trendPct = d.prev7 > 0 ? Math.round(((d.last7 - d.prev7) / d.prev7) * 100) : d.last7 > 0 ? 100 : 0;
  const trendColor = trendPct > 0 ? 'var(--success)' : trendPct < 0 ? 'var(--danger)' : 'var(--muted)';
  const TrendIcon = trendPct > 0 ? TrendingUp : trendPct < 0 ? TrendingDown : Minus;
  const vsTarget = d.avgActiveDay != null && d.targetMinutes > 0 ? Math.round((d.avgActiveDay / d.targetMinutes) * 100) : null;

  return (
    <div className="donut-tip">
      <div className="donut-tip-head">
        <span className="donut-tip-dot" style={{ background: d.color }} />
        {d.icon && <span style={{ fontSize: 15 }}>{d.icon}</span>}
        <span className="truncate">{d.name}</span>
      </div>

      {estimated ? (
        <div className="donut-tip-row">
          <div className="donut-tip-line">
            <span>Meta diaria</span>
            <strong>{d.targetMinutes} min</strong>
          </div>
          <div className="donut-tip-note">Aún sin minutos registrados</div>
        </div>
      ) : (
        <>
          <div className="donut-tip-row">
            <div className="donut-tip-line">
              <span>Últimos 7 días</span>
              <strong>{formatMinutes(d.last7)}</strong>
            </div>
            <div className="donut-tip-note" style={{ color: trendColor }}>
              <TrendIcon size={12} strokeWidth={2.6} aria-hidden="true" />
              {d.prev7 === 0 && d.last7 === 0 ? 'Sin actividad en 2 semanas' : `${trendPct > 0 ? '+' : ''}${trendPct}% frente a la semana anterior`}
            </div>
          </div>
          <div className="donut-tip-row">
            <div className="donut-tip-line">
              <span>Promedio por día activo</span>
              <strong>{d.avgActiveDay != null ? `${Math.round(d.avgActiveDay)} min` : '—'}</strong>
            </div>
            {vsTarget != null && (
              <div className="donut-tip-note">
                <span className="donut-tip-meter" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, vsTarget)}%`,
                      background: vsTarget >= 100 ? 'var(--success)' : vsTarget >= 60 ? 'var(--warning)' : 'var(--danger)',
                    }}
                  />
                </span>
                {vsTarget}% de la meta de {d.targetMinutes} min
              </div>
            )}
          </div>
        </>
      )}

      <div className="donut-tip-row">
        <div className="donut-tip-line">
          <span>Consistencia 30 días</span>
          <strong>{d.consistency30 != null ? `${Math.round(d.consistency30 * 100)}%` : '—'}</strong>
        </div>
        <div className="donut-tip-note">
          {d.activeDays30} {d.activeDays30 === 1 ? 'día con actividad' : 'días con actividad'}
        </div>
      </div>
    </div>
  );
};

export const DashboardView: React.FC = () => {
  const navigate = useNavigate();
  const data = useData();
  const logHabit = useStore((s) => s.logHabit);
  const clearLog = useStore((s) => s.clearLog);
  const startTimer = useStore((s) => s.startTimer);
  const { toast } = useToast();

  const T = todayKey();
  const [quoteIdx, setQuoteIdx] = useState(0);
  const [quoteFade, setQuoteFade] = useState(true);

  // Rotación automática de frase motivacional cada 15 segundos con transición suave
  useEffect(() => {
    const timer = setInterval(() => {
      setQuoteFade(false);
      setTimeout(() => {
        setQuoteIdx((prev) => (prev + 1) % QUOTES.length);
        setQuoteFade(true);
      }, 350);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleNextQuote = () => {
    setQuoteFade(false);
    setTimeout(() => {
      setQuoteIdx((prev) => (prev + 1) % QUOTES.length);
      setQuoteFade(true);
    }, 200);
  };

  // Estados de "¿Qué debería hacer ahora?"
  const [availableMin, setAvailableMin] = useState(40);

  // Modales interactivos
  const [failModalHabit, setFailModalHabit] = useState<Habit | null>(null);
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const dismissInsight = useStore((s) => s.dismissInsight);
  const [progressModalHabit, setProgressModalHabit] = useState<Habit | null>(null);

  // Cálculos principales
  const pts = useEconomy();
  const thisWeek = weekSummary(data, startOfWeekKey(T));
  const activeHabits = useMemo(() => data.habits.filter((h) => h.status === 'active'), [data.habits]);

  // Posición de la tarjeta del donut: sigue al cursor sin re-renderizar la vista (variables CSS)
  const donutWrapRef = useRef<HTMLDivElement>(null);
  const moveDonutTip = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = donutWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const TIP_W = 244;
    // A la derecha del cursor si cabe; si no, a la izquierda
    const x = mx + 16 + TIP_W <= rect.width ? mx + 16 : Math.max(0, mx - 16 - TIP_W);
    el.style.setProperty('--tip-x', `${Math.round(x)}px`);
    el.style.setProperty('--tip-y', `${Math.round(Math.max(0, my + 14))}px`);
  };
  const todayHabits = activeHabits.filter((h) => isScheduled(h, T));

  const completedTodayCount = todayHabits.filter((h) => isDoneLog(getLog(data, h.id, T))).length;
  const globalStreak = useMemo(() => {
    return calculateGlobalStreak(data, T);
  }, [data, T]);

  const { streakCardTheme, nextStreakMilestone, streakMilestonePercent } = useMemo(() => {
    const milestones = [3, 7, 14, 21, 30, 50, 60, 100, 150, 200, 250, 350, 365, 500, 730, 1000];
    // Después de 1000 días, el siguiente hito es el próximo aniversario
    const nextMilestone = milestones.find((m) => m > globalStreak.streak) ?? Math.ceil((globalStreak.streak + 1) / 365) * 365;
    const percent = Math.min(100, Math.max(6, Math.round((globalStreak.streak / nextMilestone) * 100)));

    if (globalStreak.isFrozen) {
      return {
        nextStreakMilestone: nextMilestone,
        streakMilestonePercent: percent,
        streakCardTheme: {
          bg: 'linear-gradient(145deg, rgba(56, 189, 248, 0.12) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          shadow: '0 8px 24px -6px rgba(56, 189, 248, 0.18)',
          glow: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 70%)',
          accent: 'var(--freeze)',
          iconBg: 'rgba(56, 189, 248, 0.18)',
          iconBorder: '1px solid rgba(56, 189, 248, 0.35)',
          barGradient: 'linear-gradient(90deg, #0284c7, #38bdf8)',
          badgeIcon: Snowflake,
          badgeText: 'Escudo activo',
          badgeBg: 'rgba(56, 189, 248, 0.16)',
        },
      };
    }

    if (globalStreak.isSuperStreak && globalStreak.streak > 0) {
      return {
        nextStreakMilestone: nextMilestone,
        streakMilestonePercent: percent,
        streakCardTheme: {
          bg: 'linear-gradient(145deg, rgba(168, 85, 247, 0.13) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.32)',
          shadow: '0 8px 24px -6px rgba(168, 85, 247, 0.2)',
          glow: 'radial-gradient(circle, rgba(168, 85, 247, 0.28) 0%, transparent 70%)',
          accent: 'var(--super)',
          iconBg: 'rgba(168, 85, 247, 0.18)',
          iconBorder: '1px solid rgba(168, 85, 247, 0.35)',
          barGradient: 'linear-gradient(90deg, #9333ea, #c084fc)',
          badgeIcon: Sparkles,
          badgeText: 'Súper racha',
          badgeBg: 'rgba(168, 85, 247, 0.18)',
        },
      };
    }

    if (globalStreak.streak > 0) {
      return {
        nextStreakMilestone: nextMilestone,
        streakMilestonePercent: percent,
        streakCardTheme: {
          bg: 'linear-gradient(145deg, rgba(249, 115, 22, 0.12) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
          border: '1px solid rgba(249, 115, 22, 0.3)',
          shadow: '0 8px 24px -6px rgba(249, 115, 22, 0.18)',
          glow: 'radial-gradient(circle, rgba(249, 115, 22, 0.25) 0%, transparent 70%)',
          accent: 'var(--streak)',
          iconBg: 'rgba(249, 115, 22, 0.18)',
          iconBorder: '1px solid rgba(249, 115, 22, 0.35)',
          barGradient: 'linear-gradient(90deg, #ea580c, #fb923c)',
          badgeIcon: Flame,
          badgeText: 'En racha',
          badgeBg: 'rgba(249, 115, 22, 0.16)',
        },
      };
    }

    return {
      nextStreakMilestone: nextMilestone,
      streakMilestonePercent: percent,
      streakCardTheme: {
        bg: 'linear-gradient(145deg, color-mix(in srgb, var(--text) 4%, transparent) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
        border: '1px solid var(--border)',
        shadow: 'none',
        glow: 'none',
        accent: 'var(--muted)',
        iconBg: 'color-mix(in srgb, var(--text) 6%, transparent)',
        iconBorder: '1px solid var(--border)',
        barGradient: 'linear-gradient(90deg, #64748b, #94a3b8)',
        badgeIcon: CircleDashed,
        badgeText: 'Sin iniciar',
        badgeBg: 'color-mix(in srgb, var(--text) 6%, transparent)',
      },
    };
  }, [globalStreak]);

  // Alerta de abandono
  const abandonment = useMemo(() => detectAbandonment(data, T), [data, T]);

  // Recomendación "¿Qué debería hacer ahora?"
  const whatToDo = useMemo(() => {
    return recommendWhatToDo(data, { availableMinutes: availableMin });
  }, [data, availableMin]);

  // Datos para gráfico de actividad de la semana actual (lunes a domingo con puntos reales)
  const currentWeekStart = startOfWeekKey(T);
  const weekDaysData = useMemo(() => {
    return DAY_SHORT.map((dayLabel, idx) => {
      const dayDateKey = addDaysKey(currentWeekStart, idx);
      const dayLogsPts = Object.values(data.logs)
        .filter((l) => l.date === dayDateKey)
        .reduce((sum, l) => sum + (l.points || 0), 0);
      const dayBonusPts = (data.pointEvents || [])
        .filter((e) => e.at && toKey(new Date(e.at)) === dayDateKey)
        .reduce((sum, e) => sum + e.amount, 0);
      return {
        day: dayLabel,
        points: Math.round(dayLogsPts + dayBonusPts),
      };
    });
  }, [data.logs, data.pointEvents, currentWeekStart]);

  // Datos para gráfico donut de distribución de hábitos (incluye todos los hábitos activos)
  const { donutData, totalDonutMinutes, isDonutEstimated } = useMemo(() => {
    const allLogs = Object.values(data.logs);
    const from7 = addDaysKey(T, -6);
    const from14 = addDaysKey(T, -13);
    const from30 = addDaysKey(T, -29);

    const items: DonutItem[] = activeHabits.map((h) => {
      // Minutos por día: el mayor entre sesiones cronometradas y registro manual (no se suman dos veces)
      const perDay = new Map<string, number>();
      const sessionByDay = new Map<string, number>();
      data.sessions
        .filter((s) => s.habitId === h.id)
        .forEach((s) => sessionByDay.set(s.date, (sessionByDay.get(s.date) ?? 0) + s.durationSec / 60));
      const logByDay = new Map<string, number>();
      allLogs.filter((l) => l.habitId === h.id && l.minutes).forEach((l) => logByDay.set(l.date, l.minutes || 0));
      new Set([...sessionByDay.keys(), ...logByDay.keys()]).forEach((day) =>
        perDay.set(day, Math.max(sessionByDay.get(day) ?? 0, logByDay.get(day) ?? 0)),
      );

      const sumRange = (from: string, to: string) =>
        [...perDay].filter(([day]) => day >= from && day <= to).reduce((a, [, m]) => a + m, 0);
      const days30 = [...perDay].filter(([day, m]) => day >= from30 && day <= T && m > 0);
      const totalMin = Math.round([...perDay.values()].reduce((a, m) => a + m, 0));

      return {
        id: h.id,
        name: h.name,
        icon: h.icon || '🎯',
        value: totalMin,
        targetMinutes: h.targetMinutes || (h.kind === 'time' ? 30 : 15),
        color: h.color || '#8b5cf6',
        last7: Math.round(sumRange(from7, T)),
        prev7: Math.round(sumRange(from14, addDaysKey(T, -7))),
        avgActiveDay: days30.length > 0 ? days30.reduce((a, [, m]) => a + m, 0) / days30.length : null,
        activeDays30: days30.length,
        consistency30: consistency(data, h, 30, T),
      };
    });

    const realTotal = items.reduce((acc, d) => acc + d.value, 0);

    if (realTotal > 0) {
      const valid = items.filter((x) => x.value > 0);
      return { donutData: valid, totalDonutMinutes: realTotal, isDonutEstimated: false };
    }

    // Si aún no hay minutos invertidos, proyectar el tiempo objetivo solo de los hábitos de tiempo
    const timeIds = new Set(activeHabits.filter((h) => h.kind === 'time' || (!h.kind && h.targetMinutes)).map((h) => h.id));
    const estimatedItems = items.filter((x) => timeIds.has(x.id)).map((x) => ({
      ...x,
      value: x.targetMinutes,
    }));
    const estimatedTotal = estimatedItems.reduce((acc, d) => acc + d.value, 0);
    return { donutData: estimatedItems, totalDonutMinutes: estimatedTotal, isDonutEstimated: true };
  }, [activeHabits, data, T]);

  // Siguiente recompensa disponible
  const nextReward = [...data.rewards].sort((a, b) => a.cost - b.cost).find((r) => r.cost > pts.balance);

  const handleToggleHabit = (h: Habit, mode: 'full' | 'minimum', e?: React.MouseEvent) => {
    if (h.kind === 'time' || h.kind === 'quantity') {
      setProgressModalHabit(h);
      return;
    }

    const existing = getLog(data, h.id, T);
    if (existing?.status === mode) {
      clearLog(h.id, T);
      playSound.click();
      toast(`Registro removido para «${h.name}»`, 'info');
    } else {
      const before = streakSnapshot();
      logHabit(h.id, T, mode);

      if (mode === 'full') {
        fireHabitPop(e?.clientX, e?.clientY);
        playSound.complete();
      } else {
        playSound.pop();
      }

      // Celebración si este registro activó la racha o la súper racha de hoy
      celebrateStreakChange(before, T);

      toast(
        mode === 'full' ? `+${habitCoinValue(h)} pts · ¡${h.name} completado!` : `+${pointsFor(h, 'minimum', data.settings.minimumRatio)} pts · Versión mínima de «${h.name}»`,
        'success',
      );
    }
  };

  const handleMarkMissed = (h: Habit) => {
    const existing = getLog(data, h.id, T);
    if (existing?.status === 'missed') {
      clearLog(h.id, T);
      toast(`Registro removido para «${h.name}»`, 'info');
      return;
    }
    if (data.settings.askFailReason) {
      setFailModalHabit(h);
    } else {
      logHabit(h.id, T, 'missed');
      toast(`«${h.name}» marcado como no realizado`, 'warning');
    }
  };

  return (
    <div className="stack fade-up">
      {/* Alerta de abandono */}
      {abandonment && (
        <div
          className="callout attention"
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          {...clickableProps(() => setShowAbandonModal(true))}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle />
            <div>
              <div className="title">Parece que estás perdiendo el ritmo</div>
              <div className="detail">
                Tu consistencia cayó un {abandonment.dropPercentage}%. Pulsa aquí para responder un chequeo rápido y ajustar tus hábitos.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="btn btn-secondary sm">Revisar</button>
            <button
              type="button"
              className="btn btn-ghost sm"
              aria-label="Omitir aviso"
              title="Omitir"
              onClick={(e) => {
                e.stopPropagation();
                dismissInsight(ABANDONMENT_DISMISS_ID);
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">{longDate(T)}</p>
          <h1>Hola, {data.settings.userName || 'Constante'}</h1>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => navigate('/temporizador')}>
            <Play size={15} /> Iniciar sesión
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/semana')}>
            <Calendar size={15} /> Ver semana
          </button>
        </div>
      </div>

      {/* Banner motivacional */}
      <div className="card highlight dash-hero" style={{ position: 'relative' }}>
        {data.habits.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Bienvenido a ¡Pilas!</h2>
                <p style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 4 }}>
                  Aún no tienes hábitos registrados. Establece tu primer hábito para encender tu racha y acumular puntos canjeables.
                </p>
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => navigate('/semana')}>
              <Plus size={15} /> Establecer primer hábito
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: '4px solid var(--accent)',
                  display: 'grid',
                  placeContent: 'center',
                  textAlign: 'center',
                  background: 'var(--surface-2)',
                }}
              >
                <span style={{ fontSize: 18, fontWeight: 700 }}>
                  {completedTodayCount}/{todayHabits.length}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>hoy</span>
              </div>

              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>
                  {completedTodayCount === todayHabits.length && todayHabits.length > 0
                    ? '¡Excelente! Completaste todos tus hábitos de hoy'
                    : completedTodayCount > 0
                    ? `Llevas ${completedTodayCount} de ${todayHabits.length} hábitos hoy. ¡Sigue así!`
                    : 'Aún estás a tiempo de sumar puntos hoy'}
                </h2>
                <p
                  style={{
                    color: 'var(--text-2)',
                    fontStyle: 'italic',
                    marginTop: 4,
                    opacity: quoteFade ? 1 : 0,
                    transform: quoteFade ? 'translateY(0)' : 'translateY(4px)',
                    transition: 'opacity 0.35s ease, transform 0.35s ease',
                  }}
                >
                  “{QUOTES[quoteIdx]}”
                </p>
                {nextReward && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12.5, color: 'var(--accent-2)' }}>
                    <Gift size={14} /> Te faltan <strong>{nextReward.cost - pts.balance} pts</strong> para «{nextReward.name}»
                  </div>
                )}
              </div>
            </div>

            <button
              className="icon-btn sm"
              onClick={handleNextQuote}
              title="Cambiar frase motivacional"
              aria-label="Cambiar frase motivacional"
            >
              <RotateCcw size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Cuadrícula de estadísticas clave con diseño visual premium (tira deslizable en móvil) */}
      <AutoCarousel className="grid-4 dash-kpis" label="Resumen de tu progreso">
        {/* Puntos disponibles */}
        <div
          className="card stat"
          style={{
            background: 'linear-gradient(145deg, rgba(139, 92, 246, 0.1) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
            border: '1px solid rgba(139, 92, 246, 0.28)',
            boxShadow: '0 8px 24px -6px rgba(139, 92, 246, 0.15)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -20,
              right: -20,
              width: 90,
              height: 90,
              background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, transparent 70%)',
              filter: 'blur(14px)',
              pointerEvents: 'none',
            }}
          />
          <div className="stat-top">
            <span className="stat-label" style={{ color: 'var(--text-2)', fontWeight: 600 }}>Puntos disponibles</span>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(139, 92, 246, 0.18)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--lilac)',
              }}
            >
              <Sparkles size={18} />
            </div>
          </div>
          <div className="dash-kpi-body">
            <div className="stat-value"><CountUp value={pts.balance} /></div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(139, 92, 246, 0.16)',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                padding: '3px 9px',
                borderRadius: 99,
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--orchid)',
              }}
            >
              <TrendingUp size={12} /> +{thisWeek.points} pts esta semana
            </span>
          </div>
        </div>

        {/* Consistencia semanal */}
        <div
          className="card stat"
          style={{
            background: 'linear-gradient(145deg, rgba(16, 185, 129, 0.1) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.28)',
            boxShadow: '0 8px 24px -6px rgba(16, 185, 129, 0.15)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -20,
              right: -20,
              width: 90,
              height: 90,
              background: 'radial-gradient(circle, rgba(16, 185, 129, 0.25) 0%, transparent 70%)',
              filter: 'blur(14px)',
              pointerEvents: 'none',
            }}
          />
          <div className="stat-top">
            <span className="stat-label" style={{ color: 'var(--text-2)', fontWeight: 600 }}>Consistencia semanal</span>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(16, 185, 129, 0.18)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--mint)',
              }}
            >
              <CheckCircle2 size={18} />
            </div>
          </div>
          <div className="dash-kpi-body">
            <div className="stat-value">{thisWeek.consistency != null ? <CountUp value={Math.round(thisWeek.consistency * 100)} suffix="%" /> : '—'}</div>
            <div style={{ width: '100%', height: 4, background: 'color-mix(in srgb, var(--text) 8%, transparent)', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round((thisWeek.consistency || 0) * 100)}%`,
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                  borderRadius: 99,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>
              {thisWeek.done} de {thisWeek.scheduled} programados
            </span>
          </div>
        </div>

        {/* Tarjeta de Racha Global Rediseñada con estética Glassmorphic idéntica a las métricas */}
        <div
          className="card stat"
          style={{
            background: streakCardTheme.bg,
            border: streakCardTheme.border,
            boxShadow: streakCardTheme.shadow,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            transition: 'transform 0.25s ease, border-color 0.25s ease',
          }}
        >
          {/* Luz ambiental en la esquina */}
          {streakCardTheme.glow !== 'none' && (
            <div
              style={{
                position: 'absolute',
                top: -20,
                right: -20,
                width: 90,
                height: 90,
                background: streakCardTheme.glow,
                filter: 'blur(14px)',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Fila superior: etiqueta + insignia de estado */}
          <div className="stat-top" style={{ gap: 8 }}>
            <span className="stat-label" style={{ color: 'var(--text-2)', fontWeight: 600 }}>
              Racha de constancia
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 99,
                background: streakCardTheme.badgeBg,
                color: streakCardTheme.accent,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <streakCardTheme.badgeIcon size={11} strokeWidth={2.6} aria-hidden="true" />
              {streakCardTheme.badgeText}
            </span>
          </div>

          {/* Llama grande al centro con los días justo debajo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 6, position: 'relative' }}>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 4,
                width: 84,
                height: 84,
                borderRadius: '50%',
                background: streakCardTheme.iconBg,
                border: streakCardTheme.iconBorder,
                pointerEvents: 'none',
              }}
            />
            <StreakFlame
              days={globalStreak.streak}
              isSuperStreak={globalStreak.isSuperStreak}
              isFrozen={globalStreak.isFrozen}
              size={92}
            />
            <div
              className="stat-value"
              style={{
                fontSize: 40,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                color: 'var(--text)',
                marginTop: 2,
                textShadow: streakCardTheme.glow !== 'none' ? `0 0 18px color-mix(in srgb, ${streakCardTheme.accent} 40%, transparent)` : 'none',
              }}
            >
              <CountUp value={globalStreak.streak} />
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: streakCardTheme.accent, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 3 }}>
              {globalStreak.streak === 1 ? 'día' : 'días'}
            </span>
          </div>

          {/* Barra de progreso de hito + estado contextual */}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ width: '100%', height: 4, background: 'color-mix(in srgb, var(--text) 8%, transparent)', borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${streakMilestonePercent}%`,
                  background: streakCardTheme.barGradient,
                  borderRadius: 99,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>
              <span>
                {globalStreak.streak === 0
                  ? 'Completa 1 hábito hoy'
                  : `${globalStreak.streak}/${nextStreakMilestone} días para hito`}
              </span>
              <span style={{ color: globalStreak.todayHasStreak ? 'var(--success)' : streakCardTheme.accent, fontWeight: 600 }}>
                {globalStreak.todayHasStreak ? (
                  <span className="icon-label"><Check size={12} strokeWidth={3} aria-hidden="true" /> Racha de hoy activa</span>
                ) : globalStreak.isFrozen ? (
                  <span className="icon-label"><Snowflake size={12} aria-hidden="true" /> Escudo activo</span>
                ) : (
                  'Pendiente hoy'
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Objetivos activos */}
        <div
          className="card stat"
          style={{
            background: 'linear-gradient(145deg, rgba(6, 182, 212, 0.1) 0%, color-mix(in srgb, var(--surface) 85%, transparent) 100%)',
            border: '1px solid rgba(6, 182, 212, 0.28)',
            boxShadow: '0 8px 24px -6px rgba(6, 182, 212, 0.15)',
            position: 'relative',
            overflow: 'hidden',
            cursor: 'pointer',
            transition: 'transform 0.25s ease, border-color 0.25s ease',
          }}
          {...clickableProps(() => navigate('/objetivos'), 'Ver objetivos activos')}
        >
          <div
            style={{
              position: 'absolute',
              top: -20,
              right: -20,
              width: 90,
              height: 90,
              background: 'radial-gradient(circle, rgba(6, 182, 212, 0.25) 0%, transparent 70%)',
              filter: 'blur(14px)',
              pointerEvents: 'none',
            }}
          />
          <div className="stat-top">
            <span className="stat-label" style={{ color: 'var(--text-2)', fontWeight: 600 }}>Objetivos activos</span>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(6, 182, 212, 0.18)',
                border: '1px solid rgba(6, 182, 212, 0.35)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--aqua)',
              }}
            >
              <Zap size={18} />
            </div>
          </div>
          <div className="dash-kpi-body">
            <div className="stat-value"><CountUp value={data.goals.filter((g) => g.status === 'active').length} /></div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'rgba(6, 182, 212, 0.14)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                padding: '3px 9px',
                borderRadius: 99,
                fontSize: 11.5,
                fontWeight: 600,
                color: 'var(--aqua-2)',
              }}
            >
              {data.goals.length === 0
                ? 'Comienza a trazar tus metas'
                : `${data.habits.filter((h) => h.status === 'active').length} hábitos vinculados`}
            </span>
            <span style={{ color: 'var(--info)', display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 600 }}>
              Ver todos <ArrowUpRight size={14} />
            </span>
          </div>
        </div>
      </AutoCarousel>

      {/* "¿QUÉ PUEDO HACER AHORA?" */}
      <div className="card dash-reco" style={{ background: 'linear-gradient(145deg, var(--surface-2), var(--surface))', border: '1px solid var(--accent)' }}>
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent-soft)', color: 'var(--accent-2)', display: 'grid', placeItems: 'center' }}>
              <Zap size={18} />
            </div>
            <div>
              <h3 className="card-title">¿Qué debería hacer ahora?</h3>
              <p className="card-sub">Recomendación inteligente según tu tiempo disponible</p>
            </div>
          </div>
          <span className="badge accent">Motor de decisiones</span>
        </div>

        {/* Filtro de tiempo libre disponible */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18, marginTop: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Tiempo libre:</span>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[15, 30, 45, 60, 90].map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${availableMin === m ? 'active' : ''}`}
                style={{
                  padding: '7px 16px',
                  fontSize: 13,
                  fontWeight: availableMin === m ? 700 : 500,
                  borderRadius: '20px',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setAvailableMin(m)}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>

        <p style={{ color: 'var(--text-2)', fontSize: 13.5, marginBottom: 14 }}>
          {whatToDo.message}
        </p>

        {/* Lista de sugerencias */}
        {data.habits.length === 0 ? (
          <div className="empty" style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', marginBottom: 12 }}>
              Aún no tienes hábitos registrados. Agrega tus hábitos para recibir recomendaciones inteligentes según tu tiempo disponible.
            </p>
            <button className="btn btn-primary sm" onClick={() => navigate('/semana')} style={{ margin: '0 auto' }}>
              <Plus size={14} /> Establecer mi primer hábito
            </button>
          </div>
        ) : whatToDo.items.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {whatToDo.items.map((it, idx) => (
              <div
                key={it.habit.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 14,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)' }}>{idx + 1}.</span>
                  <span style={{ fontSize: 24 }}>{it.habit.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {it.habit.name}{' '}
                      {it.mode === 'minimum' && (
                        <span className="badge" style={{ color: 'var(--minimum)', background: 'var(--minimum-soft)' }}>
                          <Sprout size={11} aria-hidden="true" /> versión mínima
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{it.reason}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="badge">{it.estimatedMinutes} min</span>
                  <button
                    className="btn btn-primary sm"
                    onClick={() => {
                      startTimer(it.habit.id);
                      navigate('/temporizador');
                    }}
                  >
                    <Play size={13} /> Iniciar reloj
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ padding: '20px 0' }}>
            <p>¡No tienes hábitos pendientes que se ajusten a este criterio!</p>
          </div>
        )}
      </div>

      {/* HÁBITOS DE HOY (primero en móvil: es la tarea principal del día) */}
      <div className="grid-main dash-today">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Hábitos para hoy</h3>
              <p className="card-sub">{completedTodayCount} de {todayHabits.length} completados</p>
            </div>
            <button className="btn btn-ghost sm" onClick={() => navigate('/semana')}>
              Ver matriz semanal <ArrowRight size={13} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.habits.length === 0 ? (
              <div className="card empty" style={{ padding: '36px 16px', textAlign: 'center', border: '1px dashed var(--border-2)' }}>
                <Sparkles size={32} style={{ color: 'var(--accent-2)', margin: '0 auto 12px', opacity: 0.8 }} />
                <h4 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No hay hábitos registrados aún</h4>
                <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.5 }}>
                  Establece tu primer hábito para organizar tus semanas, mantener tu racha activa y ganar puntos canjeables.
                </p>
                <button className="btn btn-primary sm" onClick={() => navigate('/semana')} style={{ margin: '0 auto' }}>
                  <Plus size={14} /> Establecer mi primer hábito
                </button>
              </div>
            ) : todayHabits.length > 0 ? (
              todayHabits.map((h) => {
                const log = getLog(data, h.id, T);
                const isFull = log?.status === 'full';
                const isMin = log?.status === 'minimum';
                const isMissed = log?.status === 'missed';

                const isTimed = h.kind === 'time' || (!h.kind && Boolean(h.targetMinutes));
                return (
                  <div
                    key={h.id}
                    className={`today-habit${isFull ? ' is-full' : isMin ? ' is-min' : isMissed ? ' is-missed' : ''}`}
                  >
                    <div className="today-habit-main">
                      <span className="today-habit-icon" aria-hidden="true">{h.icon}</span>
                      <div className="today-habit-text">
                        <div className="today-habit-name" title={h.name}>
                          {h.name}
                        </div>
                        <div className="today-habit-meta">
                          +{habitCoinValue(h)} pts
                          {h.kind === 'time' && <span> · {h.targetMinutes || 30} min</span>}
                          {h.kind === 'quantity' && <span> · {h.targetQuantity || 100} {h.quantityUnit || 'reps'}</span>}
                          {!h.kind && h.targetMinutes && <span> · {h.targetMinutes} min</span>}
                          {h.reminderTime && (
                            <span className="icon-label" style={{ color: 'var(--accent-2)', fontWeight: 600, marginLeft: 4 }}>
                              · <AlarmClock size={11} aria-hidden="true" /> {h.reminderTime}
                            </span>
                          )}
                          {isFull && <span style={{ marginLeft: 6 }}><StatusLabel status="full" size={12}>Completo</StatusLabel></span>}
                          {isMin && <span style={{ marginLeft: 6 }}><StatusLabel status="minimum" size={12}>Mínimo alcanzado</StatusLabel></span>}
                          {isMissed && <span style={{ marginLeft: 6 }}><StatusLabel status="missed" size={12}>No realizado</StatusLabel></span>}
                        </div>
                      </div>
                    </div>

                    <div className="today-habit-actions">
                      {isTimed && (
                        <button
                          className="icon-btn sm today-habit-play"
                          onClick={() => {
                            startTimer(h.id);
                            navigate('/temporizador');
                          }}
                          title="Iniciar cronómetro"
                          aria-label="Iniciar cronómetro"
                        >
                          <Play size={14} />
                        </button>
                      )}

                      {/* Botón específico para hábitos de Tiempo o Cantidad */}
                      {(h.kind === 'time' || h.kind === 'quantity') ? (
                        <button
                          className={`btn-habit-check ${isFull ? 'active' : isMin ? 'active-min' : ''}`}
                          onClick={() => setProgressModalHabit(h)}
                          title="Registrar avance de hoy"
                          aria-label="Registrar avance de hoy"
                        >
                          {isFull ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : isMin ? <Sprout size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                          <span>
                            {isFull
                              ? (h.kind === 'time' ? `${log?.minutes || h.targetMinutes}m` : `${log?.quantity || h.targetQuantity}`)
                              : isMin
                              ? (h.kind === 'time' ? `${log?.minutes || 0}m` : `${log?.quantity || 0}`)
                              : 'Registrar'}
                          </span>
                          {!isFull && !isMin && (
                            <span className="today-habit-count">
                              {h.kind === 'time' ? `${log?.minutes || 0}/${h.targetMinutes || 30}m` : `${log?.quantity || 0}/${h.targetQuantity || 100}`}
                            </span>
                          )}
                        </button>
                      ) : (
                        <>
                          <button
                            className={`btn-habit-check ${isMin ? 'active-min' : ''}`}
                            onClick={(e) => handleToggleHabit(h, 'minimum', e)}
                            title="Registrar versión mínima"
                            aria-label="Registrar versión mínima"
                          >
                            <Sprout size={14} className="check-preview" style={isMin ? { opacity: 1 } : {}} aria-hidden="true" />
                            <span>Mínimo</span>
                          </button>

                          <button
                            className={`btn-habit-check ${isFull ? 'active' : ''}`}
                            onClick={(e) => handleToggleHabit(h, 'full', e)}
                            title="Marcar objetivo completo"
                            aria-label="Marcar objetivo completo"
                          >
                            <CheckCircle2 size={14} className="check-preview" style={isFull ? { opacity: 1, color: '#fff' } : {}} />
                            <span>{isFull ? 'Completado' : 'Completar'}</span>
                          </button>
                        </>
                      )}
                    </div>

                    <button
                      className={`icon-btn sm today-habit-miss ${isMissed ? 'danger active' : 'danger'}`}
                      onClick={() => handleMarkMissed(h)}
                      title={
                        isMissed
                          ? 'Quitar registro de no realizado'
                          : data.settings.askFailReason
                          ? 'Registrar motivo por el cual no se pudo hacer'
                          : 'Marcar como no realizado'
                      }
                      aria-label={isMissed ? 'Quitar registro de no realizado' : 'Marcar como no realizado'}
                    >
                      <X size={15} strokeWidth={2.6} />
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="muted small">No hay hábitos programados para hoy. ¡Disfruta tu día libre!</p>
            )}
          </div>
        </div>

        {/* GRÁFICA DE DISTRIBUCIÓN DE HÁBITOS (TIEMPO) */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Distribución de tiempo</h3>
              <p className="card-sub">
                {isDonutEstimated ? 'Tiempo objetivo planificado por hábito' : 'Minutos reales invertidos por hábito'}
              </p>
            </div>
            {totalDonutMinutes > 0 && (
              <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--lilac)', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
                {formatMinutes(totalDonutMinutes)} total
              </span>
            )}
          </div>

          {activeHabits.length === 0 ? (
            <div className="empty" style={{ padding: '40px 16px', textAlign: 'center' }}>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                No hay hábitos activos para calcular la distribución de tiempo.
              </p>
            </div>
          ) : donutData.length === 0 ? (
            <div className="empty" style={{ padding: '40px 16px', textAlign: 'center' }}>
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>
                Aún no tienes hábitos de tiempo ni minutos registrados. Crea un hábito de tiempo o usa el temporizador.
              </p>
            </div>
          ) : (
            <>
              <div ref={donutWrapRef} onMouseMove={moveDonutTip} style={{ width: '100%', height: 230, position: 'relative' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={86}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="var(--surface)"
                      strokeWidth={2}
                      isAnimationActive={true}
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={<CustomDonutTooltip estimated={isDonutEstimated} />}
                      // Recharts no da coordenadas fiables en el donut y la tarjeta «volaba» desde la esquina
                      // superior izquierda: posición fija en 0,0 y desplazamiento con variables CSS que sigue al cursor
                      isAnimationActive={false}
                      position={{ x: 0, y: 0 }}
                      wrapperStyle={{ pointerEvents: 'none', zIndex: 60, transition: 'none', left: 'var(--tip-x, 0px)', top: 'var(--tip-y, 0px)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Etiqueta central elegante en el hueco del donut */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.02em' }}>
                    {formatMinutes(totalDonutMinutes)}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                    {isDonutEstimated ? 'meta diaria' : 'invertido'}
                  </span>
                </div>
              </div>

              {/* Lista desglosada con todos los hábitos activos */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  marginTop: 8,
                  maxHeight: 180,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {donutData.map((d) => {
                  const pct = totalDonutMinutes > 0 ? Math.round((d.value / totalDonutMinutes) * 100) : 0;
                  return (
                    <div
                      key={d.id || d.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 12,
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'color-mix(in srgb, var(--text) 3%, transparent)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                        {d.icon && <span style={{ fontSize: 14 }}>{d.icon}</span>}
                        <span className="truncate" style={{ fontWeight: 500, color: 'var(--text)' }}>{d.name}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 11 }}>{pct}%</span>
                        <strong>{d.value} min</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ACTIVIDAD DE LA SEMANA */}
      <div className="card dash-week">
        <div className="card-head">
          <div>
            <h3 className="card-title">Actividad de la semana actual</h3>
            <p className="card-sub">Puntos reales de lunes a domingo</p>
          </div>
          <span className={`badge ${thisWeek.points > 0 ? 'success' : ''}`}>+{thisWeek.points} pts esta semana</span>
        </div>

        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={weekDaysData}>
              <XAxis dataKey="day" stroke="var(--muted)" fontSize={12} tickLine={false} />
              <YAxis stroke="var(--muted)" fontSize={12} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 12,
                  color: 'var(--text)',
                  fontSize: 13,
                  boxShadow: '0 12px 32px color-mix(in srgb, var(--shadow-color) 85%, transparent)',
                  padding: '8px 12px',
                }}
                itemStyle={{ color: 'var(--accent-2)', fontWeight: 600 }}
                labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
                formatter={(value) => [`${value} pts`, 'Puntos']}
              />
              <Area type="monotone" dataKey="points" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ACCESO A INSIGHTS & COACH */}
      <div className="card interactive highlight dash-insights" {...clickableProps(() => navigate('/insights'))}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lightbulb size={24} style={{ color: 'var(--accent-2)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Revisar Insights y Decisiones</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                Descubre tus mejores horarios, días débiles y qué hábitos conviene mantener o pausar.
              </div>
            </div>
          </div>
          <ArrowRight size={18} />
        </div>
      </div>

      {/* MODAL DE RAZÓN DE FALLO */}
      {failModalHabit && (
        <FailReasonModal
          isOpen={!!failModalHabit}
          onClose={() => setFailModalHabit(null)}
          habit={failModalHabit}
          date={T}
        />
      )}

      {/* MODAL DE ALERTA DE ABANDONO */}
      {showAbandonModal && abandonment && (
        <AbandonmentModal
          isOpen={showAbandonModal}
          onClose={() => setShowAbandonModal(false)}
          alert={abandonment}
        />
      )}

      {/* MODAL DE PROGRESO DE HÁBITO (TIEMPO O CANTIDAD) */}
      {progressModalHabit && (
        <HabitProgressModal
          isOpen={!!progressModalHabit}
          onClose={() => setProgressModalHabit(null)}
          habit={progressModalHabit}
          dateKey={T}
        />
      )}
    </div>
  );
};
