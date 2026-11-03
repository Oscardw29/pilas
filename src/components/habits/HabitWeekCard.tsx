import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Edit,
  Flame,
  Hourglass,
  MoreVertical,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import type { AppData, Habit, HabitLog } from '@/types';
import {
  bestStreak,
  consistency,
  currentStreak,
  getLog,
  isHabitPausedOnDate,
  isScheduled,
  recoveryStats,
} from '@/lib/metrics';
import { DAY_LONG, DAY_SHORT, toKey, weekdayIndex } from '@/lib/dates';
import { habitCoinValue } from '@/lib/economyRules';
import './habitCard.css';

/** Días del hábito en palabras: «Todos los días», «Lunes a viernes» o «Lun · Mié · Vie» */
export function scheduleLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Todos los días';
  if (sorted.length === 0) return 'Sin días';
  if (sorted.join() === '0,1,2,3,4') return 'Lunes a viernes';
  if (sorted.join() === '5,6') return 'Fines de semana';
  return sorted.map((d) => DAY_SHORT[d]).join(' · ');
}

const STATUS_TEXT: Record<HabitLog['status'], string> = {
  full: 'completo',
  minimum: 'versión mínima',
  missed: 'no realizado',
  partial: 'avance parcial',
};

interface Props {
  habit: Habit;
  data: AppData;
  /** Los 7 días de la semana mostrada (lunes a domingo) */
  days: Date[];
  today: string;
  onCellClick: (h: Habit, dateKey: string, e: React.MouseEvent) => void;
  onResume: (h: Habit, dateKey: string) => void;
  onEdit: (h: Habit) => void;
  onTogglePause: (h: Habit) => void;
  onDelete: (h: Habit) => void;
}

/**
 * Tarjeta de un hábito en la vista Hábitos del móvil: nombre, días programados, la semana en 7 casillas
 * (se tocan igual que las celdas de la tabla de escritorio) y abajo racha, consistencia y acciones.
 */
export const HabitWeekCard: React.FC<Props> = ({ habit: h, data, days, today, onCellClick, onResume, onEdit, onTogglePause, onDelete }) => {
  const navigate = useNavigate();
  const [showStats, setShowStats] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const statsId = useId();

  const isPaused = h.status === 'paused';
  const streakCur = isPaused ? 0 : currentStreak(data, h, today);
  const cons = consistency(data, h, 30, today);

  // Menú «más opciones»: se cierra al tocar fuera o con Escape
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const pick = (fn: (h: Habit) => void) => () => {
    setMenuOpen(false);
    fn(h);
  };

  return (
    <article
      className={`habit-card${isPaused ? ' is-paused' : ''}`}
      style={{ '--habit': h.color } as React.CSSProperties}
      aria-label={h.name}
    >
      <header className="habit-card-head">
        <div className="habit-card-title">
          <h3>{h.name}</h3>
          <div className="habit-card-chips">
            <span className="habit-card-chip">{scheduleLabel(h.days)}</span>
            {h.reminderTime && (
              <span className="habit-card-chip subtle">
                <AlarmClock size={11} aria-hidden="true" /> {h.reminderTime}
              </span>
            )}
            {isPaused && (
              <span className="badge paused-badge">
                <Pause size={10} strokeWidth={3} aria-hidden="true" /> Pausado
              </span>
            )}
          </div>
        </div>
        <span className="habit-card-icon" aria-hidden="true">{h.icon}</span>
      </header>

      <div className="habit-card-week" role="group" aria-label={`Semana de ${h.name}`}>
        {days.map((d) => {
          const dk = toKey(d);
          const wd = weekdayIndex(d);
          const isToday = dk === today;
          const isFuture = dk > today;
          const label = (
            <span className={`habit-day-label${isToday ? ' today' : ''}`} aria-hidden="true">
              {DAY_SHORT[wd]}
            </span>
          );
          const dayName = `${DAY_LONG[wd]} ${d.getDate()}`;

          if (isHabitPausedOnDate(h, dk)) {
            return (
              <div key={dk} className="habit-day">
                {label}
                {isToday ? (
                  <button
                    type="button"
                    className="habit-day-btn is-paused is-today resume"
                    onClick={() => onResume(h, dk)}
                    aria-label={`${dayName}: en pausa. Toca para reanudar el hábito`}
                    title="Hábito en pausa. Toca para reanudarlo hoy"
                  >
                    <Pause className="resume-idle" size={14} strokeWidth={2.6} aria-hidden="true" />
                    <Play className="resume-hover" size={14} strokeWidth={2.6} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="habit-day-btn is-paused" aria-label={`${dayName}: en pausa`} role="img">
                    {d.getDate()}
                  </span>
                )}
              </div>
            );
          }

          if (!isScheduled(h, dk)) {
            return (
              <div key={dk} className="habit-day">
                {label}
                <span className={`habit-day-btn is-off${isToday ? ' is-today' : ''}`} aria-label={`${dayName}: no programado`} role="img">
                  {d.getDate()}
                </span>
              </div>
            );
          }

          const status = getLog(data, h.id, dk)?.status;
          const state = status ? `is-${status}` : isFuture ? 'is-future' : isToday ? 'is-pending' : 'is-due';
          return (
            <div key={dk} className="habit-day">
              {label}
              <button
                type="button"
                className={`habit-day-btn ${state}${isToday ? ' is-today' : ''}`}
                disabled={isFuture}
                onClick={(e) => onCellClick(h, dk, e)}
                aria-label={`${dayName}: ${status ? STATUS_TEXT[status] : isFuture ? 'día futuro' : 'sin registrar'}`}
              >
                {d.getDate()}
              </button>
            </div>
          );
        })}
      </div>

      {showStats && (
        <dl className="habit-card-stats" id={statsId}>
          <div>
            <dt><Flame size={13} aria-hidden="true" /> Racha</dt>
            <dd>
              {streakCur}d <small>(mejor {bestStreak(data, h, today)}d)</small>
            </dd>
          </div>
          <div>
            <dt><CheckCircle2 size={13} aria-hidden="true" /> Consistencia 30d</dt>
            <dd>{cons != null ? `${Math.round(cons * 100)}%` : '—'}</dd>
          </div>
          <div>
            <dt><Hourglass size={13} aria-hidden="true" /> Recuperación</dt>
            <dd>
              {(() => {
                const rec = recoveryStats(data, h, today);
                return rec.average != null ? (
                  <>
                    {rec.average.toFixed(1)}d <small>(mejor {rec.best}d)</small>
                  </>
                ) : (
                  <small>Sin fallas</small>
                );
              })()}
            </dd>
          </div>
          <div>
            <dt>Puntos</dt>
            <dd>+{habitCoinValue(h)}</dd>
          </div>
        </dl>
      )}

      <footer className="habit-card-foot">
        <div className="habit-card-metrics">
          <span className="habit-metric streak" title="Racha actual">
            <Flame size={15} aria-hidden="true" />
            <strong>{streakCur}</strong>
            <span className="sr-only">días de racha</span>
          </span>
          <span className="habit-metric cons" title="Consistencia de los últimos 30 días">
            <CheckCircle2 size={15} aria-hidden="true" />
            <strong>{cons != null ? `${Math.round(cons * 100)}%` : '—'}</strong>
            <span className="sr-only">de consistencia</span>
          </span>
        </div>
        <div className="habit-card-actions">
          <button type="button" className="icon-btn ghost" onClick={() => navigate('/calendario')} title="Ver en el calendario" aria-label="Ver en el calendario">
            <CalendarDays size={18} />
          </button>
          <button
            type="button"
            className={`icon-btn ghost${showStats ? ' active' : ''}`}
            onClick={() => setShowStats((v) => !v)}
            title="Estadísticas"
            aria-label="Estadísticas"
            aria-expanded={showStats}
            aria-controls={showStats ? statsId : undefined}
          >
            <BarChart3 size={18} />
          </button>
          <div className="habit-card-more">
            <button
              ref={menuBtnRef}
              type="button"
              className="icon-btn ghost"
              onClick={() => setMenuOpen((v) => !v)}
              title="Más opciones"
              aria-label="Más opciones"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <div ref={menuRef} className="profile-menu habit-card-menu" role="menu" aria-label={`Opciones de ${h.name}`}>
                <button type="button" role="menuitem" className="profile-menu-item" onClick={pick(onEdit)}>
                  <Edit aria-hidden="true" /> Editar
                </button>
                <button type="button" role="menuitem" className="profile-menu-item" onClick={pick(onTogglePause)}>
                  {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />} {isPaused ? 'Reanudar' : 'Pausar'}
                </button>
                <div className="profile-menu-sep" role="separator" />
                <button type="button" role="menuitem" className="profile-menu-item danger" onClick={pick(onDelete)}>
                  <Trash2 aria-hidden="true" /> Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </footer>
    </article>
  );
};
