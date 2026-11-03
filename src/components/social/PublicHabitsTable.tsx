import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { StatusIcon } from '@/components/ui/icons';
import { addDaysKey, DAY_SHORT, formatMinutes, formatRange, fromKey, startOfWeekKey, todayKey } from '@/lib/dates';
import type { PublicHabit } from '@/social/types';
import './community.css';

/** Semanas que se pueden recorrer hacia atrás (la actual y las 4 anteriores) */
const WEEKS = 5;

const STATUS_LABEL = { full: 'Objetivo completo', minimum: 'Versión mínima', missed: 'No realizado', partial: 'Avance parcial' } as const;

/**
 * Hábitos visibles de una persona, semana a semana, al estilo de «Hábitos» (solo lectura).
 * Solo recibe lo que manda el servidor: los hábitos ocultos nunca llegan, así que nunca se pueden mostrar.
 * Con `weekStart` la semana la decide quien lo usa (el perfil la mueve junto con la XP de la semana) y no se
 * dibujan flechas propias; sin él, se recorren la semana actual y las 4 anteriores.
 */
export const PublicHabitsTable: React.FC<{
  habits: PublicHabit[];
  title?: string;
  emptyText?: string;
  /** Lunes de la semana que se muestra (modo controlado) */
  weekStart?: string;
  /** En lugar de la tabla, este aviso (p. ej. «Sin datos de hábitos para esa semana») */
  noDataText?: string | null;
  loading?: boolean;
}> = ({ habits, title = 'Hábitos', emptyText = 'No hay hábitos visibles.', weekStart, noDataText, loading }) => {
  const [back, setBack] = useState(0);
  const today = todayKey();
  const controlled = Boolean(weekStart);
  const start = weekStart ?? addDaysKey(startOfWeekKey(today), -7 * back);
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
  const isThisWeek = start === startOfWeekKey(today);

  const amount = (h: PublicHabit, d: { m?: number; q?: number }) => {
    if (d.m != null && d.m > 0) return formatMinutes(d.m);
    if (d.q != null && d.q > 0) return `${d.q.toLocaleString('es')}${h.unit ? ` ${h.unit}` : ''}`;
    return null;
  };

  return (
    <section className={`card flush ${loading ? 'is-loading' : ''}`} aria-label={title} aria-busy={loading || undefined}>
      <div className="pub-habits-head">
        <div className="card-title">{title}</div>
        {!controlled && (
          <div className="week-nav" style={{ flex: '0 1 auto' }}>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => setBack((b) => Math.min(WEEKS - 1, b + 1))}
              disabled={back >= WEEKS - 1}
              aria-label="Semana anterior"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
            <span className="week-nav-label" style={{ fontSize: 13.5, minWidth: '9.5em' }} aria-live="polite">
              {back === 0 ? 'Esta semana' : formatRange(fromKey(start))}
            </span>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => setBack((b) => Math.max(0, b - 1))}
              disabled={back === 0}
              aria-label="Semana siguiente"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {noDataText || habits.length === 0 ? (
        <p className="muted" style={{ padding: '18px 16px', fontSize: 13.5 }}>
          {noDataText || emptyText}
        </p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table week-matrix pub-habits">
              <caption className="c-sr">
                {title}: {isThisWeek ? 'esta semana' : formatRange(fromKey(start))}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="week-matrix-habit">
                    Hábito
                  </th>
                  {days.map((dk, i) => (
                    <th
                      key={dk}
                      scope="col"
                      className="week-matrix-day"
                      style={{ textAlign: 'center', color: dk === today ? 'var(--accent-2)' : undefined }}
                    >
                      {DAY_SHORT[i]}
                      <span style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>{fromKey(dk).getDate()}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {habits.map((h) => (
                  <tr key={h.key}>
                    <th scope="row" className="week-matrix-habit" style={{ fontWeight: 400, color: 'inherit', whiteSpace: 'normal' }}>
                      <div className="week-habit">
                        <span className="week-habit-icon" aria-hidden="true">
                          {h.icon}
                        </span>
                        <div className="week-habit-text">
                          <div className="week-habit-name">
                            <span>{h.name}</span>
                          </div>
                          {h.target != null && h.target > 0 && (
                            <div className="week-habit-meta">
                              Meta: {h.kind === 'time' ? formatMinutes(h.target) : `${h.target}${h.unit ? ` ${h.unit}` : ''}`}
                            </div>
                          )}
                        </div>
                      </div>
                    </th>
                    {days.map((dk, i) => {
                      const d = h.days?.[dk];
                      const future = dk > today;
                      const extra = d ? amount(h, d) : null;
                      const label = `${DAY_SHORT[i]} ${fromKey(dk).getDate()}: ${
                        future ? 'día futuro' : d ? `${STATUS_LABEL[d.s] ?? d.s}${extra ? `, ${extra}` : ''}` : 'sin registro'
                      }`;
                      return (
                        <td key={dk} className="week-matrix-day">
                          <span className={`pub-cell ${d ? d.s : ''} ${future ? 'future' : ''}`} title={label}>
                            {d && <StatusIcon status={d.s} size={15} strokeWidth={d.s === 'full' ? 3 : 2.6} />}
                            <span className="c-sr">{label}</span>
                          </span>
                          {d && (extra || d.s === 'minimum') && (
                            <span className="pub-amount" aria-hidden="true">
                              {extra ?? 'mín.'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pub-legend" aria-hidden="true">
            <span>
              <span className="pub-cell full">
                <StatusIcon status="full" size={10} strokeWidth={3.2} />
              </span>
              Completo
            </span>
            <span>
              <span className="pub-cell minimum">
                <StatusIcon status="minimum" size={10} strokeWidth={3} />
              </span>
              Mínimo
            </span>
            <span>
              <span className="pub-cell missed">
                <StatusIcon status="missed" size={10} strokeWidth={3} />
              </span>
              No realizado
            </span>
            <span>
              <span className="pub-cell partial">
                <StatusIcon status="partial" size={10} strokeWidth={3} />
              </span>
              Parcial
            </span>
          </div>
        </>
      )}
    </section>
  );
};
