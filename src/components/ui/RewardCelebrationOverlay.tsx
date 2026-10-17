import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gift, Shield, Snowflake, Coins } from 'lucide-react';

export interface RewardCelebrationData {
  name: string;
  icon: string;
  cost?: number;
  isFreeze?: boolean;
}

type Listener = (data: RewardCelebrationData) => void;
const listeners = new Set<Listener>();

export function triggerRewardCelebration(data: RewardCelebrationData) {
  listeners.forEach((fn) => fn(data));
}

const VISIBLE_MS = 3400;
const EXIT_MS = 380;

/**
 * CANJE DE RECOMPENSA: «cofre que se abre». La caja cae y rebota, la tapa se abre con un
 * haz de luz, el premio sube desde dentro, estallan monedas (o cristales de hielo para el
 * protector) y el costo se descuenta con un contador.
 */
export const RewardCelebrationOverlay: React.FC = () => {
  const [active, setActive] = useState<(RewardCelebrationData & { key: number }) | null>(null);
  const [closing, setClosing] = useState(false);
  const [shownCost, setShownCost] = useState(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (data: RewardCelebrationData) => {
      setClosing(false);
      setActive({ ...data, key: Date.now() });
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const close = () => {
    setClosing(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setActive(null);
      setClosing(false);
    }, EXIT_MS);
  };

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(close, VISIBLE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKey);

    // Contador del costo: de 0 a -costo cuando aparece la insignia
    let raf = 0;
    const cost = active.cost ?? 0;
    setShownCost(0);
    if (cost > 0) {
      const start = performance.now() + 1100;
      const tick = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - start) / 600));
        setShownCost(Math.round(cost * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  // Monedas / cristales que salen disparados desde el cofre en abanico
  const burst = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (-160 + (140 / 15) * i + (Math.random() - 0.5) * 10) * (Math.PI / 180);
        const dist = 150 + Math.random() * 110;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          delay: 0.9 + Math.random() * 0.25,
          rot: (Math.random() - 0.5) * 540,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.key],
  );

  if (!active) return null;

  const isFreeze = Boolean(active.isFreeze);

  return createPortal(
    <div
      key={active.key}
      className={`celebrate-overlay is-reward ${isFreeze ? 'is-freeze' : ''} ${closing ? 'is-closing' : ''}`}
      onClick={close}
      role="alertdialog"
      aria-live="assertive"
      aria-label={isFreeze ? `Protector de racha activado` : `Recompensa canjeada: ${active.name}`}
    >
      <div className="celebrate-rays reward" aria-hidden="true" />

      <div className="celebrate-stage">
        <div className="reward-chest" aria-hidden="true">
          <div className="reward-beam" />
          <div className="reward-prize">
            {isFreeze ? <Shield size={64} strokeWidth={1.6} /> : <span className="reward-prize-emoji">{active.icon}</span>}
          </div>
          <div className="reward-chest-body">
            <span className="reward-chest-ribbon" />
          </div>
          <div className="reward-chest-lid">
            <span className="reward-chest-ribbon" />
          </div>

          <div className="reward-burst">
            {burst.map((b) => (
              <span
                key={b.id}
                style={
                  {
                    '--dx': `${b.dx}px`,
                    '--dy': `${b.dy}px`,
                    '--rot': `${b.rot}deg`,
                    animationDelay: `${b.delay}s`,
                  } as React.CSSProperties
                }
              >
                {isFreeze ? <Snowflake size={16} /> : <Coins size={16} />}
              </span>
            ))}
          </div>
        </div>

        <div className="celebrate-copy">
          <div className="celebrate-kicker">
            {isFreeze ? <Snowflake size={15} aria-hidden="true" /> : <Gift size={15} aria-hidden="true" />}
            {isFreeze ? 'Escudo activo' : '¡Recompensa reclamada!'}
          </div>
          <h2 className="celebrate-title">{active.name}</h2>
          <p className="celebrate-sub">
            {isFreeze
              ? 'Tu racha queda protegida por 1 día si no completas hábitos.'
              : 'Te lo ganaste a punta de constancia. ¡Disfrútalo!'}
          </p>
          {typeof active.cost === 'number' && (
            <span className="reward-cost">
              <Coins size={14} aria-hidden="true" /> −{shownCost} pts
            </span>
          )}
          <span className="celebrate-hint">Toca para continuar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
