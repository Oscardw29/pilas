import React from 'react';
import { addDaysKey, DAY_SHORT, todayKey } from '@/lib/dates';
import './community.css';

/**
 * XP de la semana día a día (lunes a domingo) con el total debajo. Solo CSS: las barras crecen con transform.
 * La XP siempre es entera (la economía la redondea); aquí se redondea igualmente por si llega algún decimal.
 */
export const WeekXpBars: React.FC<{ weekStart: string; week: { day: string; xp: number }[]; loading?: boolean }> = ({
  weekStart,
  week,
  loading,
}) => {
  const byDay = new Map(week.map((d) => [String(d.day).slice(0, 10), Number(d.xp) || 0]));
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysKey(weekStart, i);
    return { key, label: DAY_SHORT[i], xp: Math.round(byDay.get(key) ?? 0) };
  });
  const max = Math.max(1, ...days.map((d) => d.xp));
  const total = days.reduce((a, d) => a + d.xp, 0);
  const fmt = (n: number) => n.toLocaleString('es');

  return (
    <div className={loading ? 'is-loading' : undefined} aria-busy={loading || undefined}>
      <ul className="xp-bars" aria-label={days.some((d) => d.key === today) ? 'XP ganada cada día de esta semana' : 'XP ganada cada día de la semana'}>
        {days.map((d) => (
          <li key={d.key} className={`xp-bar ${d.key === today ? 'is-today' : ''}`} aria-label={`${d.label}: ${fmt(d.xp)} XP`}>
            <span className="xp-bar-value" aria-hidden="true">
              {d.xp > 0 ? fmt(d.xp) : ''}
            </span>
            <span className="xp-bar-track" aria-hidden="true">
              <span className="xp-bar-fill" style={{ '--h': d.xp / max } as React.CSSProperties} />
            </span>
            <span className="xp-bar-day" aria-hidden="true">
              {d.label}
            </span>
          </li>
        ))}
      </ul>
      <div className="xp-total">
        <span>Total de la semana</span>
        <strong>{fmt(total)} XP</strong>
      </div>
    </div>
  );
};
