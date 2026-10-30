import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PersonAvatar } from '@/components/profile/Avatar';
import { getLeaderboard, getPodium } from '@/social/api';
import { useInView } from '@/social/useInView';
import type { Person } from '@/social/types';
import './social.css';
import './leaderboard.css';

/**
 * PODIO SEMANAL (docs/plan-social.md, F5): los 3 primeros de la XP de la semana.
 * El 1.º va al centro, más grande, con el nombre con brillo y una corona; 2.º a la izquierda y 3.º a la derecha.
 * Los lunes (hora de Colombia) muestra a los ganadores de la semana que acaba de cerrar.
 * Solo se anima con transform/opacity y se pausa fuera de pantalla.
 */

type Entry = Person & { xp: number };

const DAY_MS = 86_400_000;
/** «Ahora» en Colombia (UTC−5, sin horario de verano), leído con los getters UTC */
const coNow = () => new Date(Date.now() - 5 * 3_600_000);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Lunes de la semana en curso en Colombia, como 'YYYY-MM-DD' */
export function coWeekMonday(offsetWeeks = 0): string {
  const now = coNow();
  const back = (now.getUTCDay() + 6) % 7;
  return isoDay(new Date(now.getTime() - (back - offsetWeeks * 7) * DAY_MS));
}

export const isCoMonday = () => coNow().getUTCDay() === 1;

export const fmtNum = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** En pantallas estrechas el podio usa avatares algo más pequeños para no desbordar */
function useNarrow(query = '(max-width: 420px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

export const Podium: React.FC = () => {
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  // Se observa cuando la tarjeta ya existe (antes de cargar no hay nada que observar)
  const inView = useInView(ref, Boolean(entries?.length));
  const [past, setPast] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      // Lunes: los ganadores de la semana pasada (si el cierre ya los guardó)
      if (isCoMonday()) {
        try {
          const rows = await getPodium(coWeekMonday(-1));
          if (rows?.length) {
            const sorted = [...rows].sort((a, b) => a.pos - b.pos).slice(0, 3);
            return { list: sorted.map((r) => ({ ...r, xp: Number(r.xp) || 0 })), past: true };
          }
        } catch {
          // Se cae al podio en vivo
        }
      }
      const rows = await getLeaderboard('xp_week', 0, 3);
      return { list: rows.map((r) => ({ ...r, xp: Number(r.xp) || 0 })), past: false };
    };
    load()
      .then((r) => {
        if (!active) return;
        setEntries(r.list);
        setPast(r.past);
      })
      .catch(() => active && setEntries([]));
    return () => {
      active = false;
    };
  }, []);

  if (!entries || entries.length === 0) return null;

  const big = narrow ? 76 : 88;
  const small = narrow ? 62 : 72;
  // Orden visual: 2.º, 1.º, 3.º
  const slots: { place: 1 | 2 | 3; entry?: Entry }[] = [
    { place: 2, entry: entries[1] },
    { place: 1, entry: entries[0] },
    { place: 3, entry: entries[2] },
  ];

  return (
    <section ref={ref} className="card podium-card" aria-label={past ? 'Ganadores de la semana pasada' : 'Podio de la semana'}>
      <div className="card-head">
        <div>
          <h3 className="card-title">{past ? 'Ganadores de la semana pasada' : 'Podio de la semana'}</h3>
          <p className="card-sub">{past ? 'Así cerró la semana. ¡Felicitaciones!' : 'Los 3 con más XP desde el lunes'}</p>
        </div>
      </div>
      <ol className="podium">
        {slots.map(({ place, entry }) => (
          <li key={place} className={`podium-slot place-${place}`}>
            {entry ? (
              <button
                type="button"
                className="podium-person"
                onClick={() => navigate(`/u/${entry.alias}`)}
                aria-label={`${place}.º lugar: @${entry.alias}, ${fmtNum(entry.xp)} XP. Ver perfil`}
              >
                <span className="podium-avatar">
                  {place === 1 && (
                    <>
                      <span className={`podium-halo ${inView ? 'is-playing' : ''}`} aria-hidden="true" />
                      <span className={`podium-crown ${inView ? 'is-playing' : ''}`} aria-hidden="true">
                        👑
                      </span>
                    </>
                  )}
                  <PersonAvatar person={entry} size={place === 1 ? big : small} />
                </span>
                <span className="podium-name">
                  {place === 1 ? (
                    <span className={`shine-name ${inView ? 'is-playing' : ''}`}>@{entry.alias}</span>
                  ) : (
                    `@${entry.alias}`
                  )}
                </span>
                <span className="podium-xp">{fmtNum(entry.xp)} XP</span>
              </button>
            ) : (
              <div className="podium-person is-empty" aria-label={`${place}.º lugar libre`}>
                <span className="podium-free" style={{ width: small, height: small }} aria-hidden="true">
                  ?
                </span>
                <span className="podium-name muted">Libre</span>
              </div>
            )}
            <div className="podium-step" aria-hidden="true">
              {place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}
              <span>{place}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};
