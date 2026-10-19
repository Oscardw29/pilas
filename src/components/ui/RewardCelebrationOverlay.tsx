import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gift, Shield, Snowflake, Coins } from 'lucide-react';
import { fireRewardCelebration, fireIceFreezeCelebration } from '@/lib/confetti';
import { playSound } from '@/lib/sound';

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

/**
 * Momentos de la secuencia (ms desde que aparece). Deben coincidir con los retrasos de los
 * keyframes del cofre en global.css (chestDrop, chestShake1-3, lidOpen, prizeRise…).
 */
const LAND_MS = 380;
const SHAKE_MS = [900, 1420, 2000] as const;
const OPEN_MS = 2560;
const COST_COUNT_MS = 2900;
const VISIBLE_MS = 6000;
const REDUCED_VISIBLE_MS = 4200;
const EXIT_MS = 380;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Degradados compartidos por la tapa y el cuerpo. Los colores salen de variables CSS (violeta/oro o hielo). */
const ChestDefs: React.FC = () => (
  <svg className="reward-chest-defs" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="rc-wood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--wood-1)' }} />
        <stop offset=".55" style={{ stopColor: 'var(--wood-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--wood-3)' }} />
      </linearGradient>
      <linearGradient id="rc-lid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--wood-hi)' }} />
        <stop offset=".5" style={{ stopColor: 'var(--wood-1)' }} />
        <stop offset="1" style={{ stopColor: 'var(--wood-2)' }} />
      </linearGradient>
      <linearGradient id="rc-inner" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--wood-3)' }} />
        <stop offset="1" style={{ stopColor: 'var(--wood-2)' }} />
      </linearGradient>
      {/* Metal: bandas verticales con brillo cilíndrico y molduras horizontales */}
      <linearGradient id="rc-metal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" style={{ stopColor: 'var(--metal-3)' }} />
        <stop offset=".35" style={{ stopColor: 'var(--metal-1)' }} />
        <stop offset=".7" style={{ stopColor: 'var(--metal-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--metal-3)' }} />
      </linearGradient>
      <linearGradient id="rc-metal-h" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--metal-1)' }} />
        <stop offset=".45" style={{ stopColor: 'var(--metal-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--metal-3)' }} />
      </linearGradient>
      <radialGradient id="rc-plate" cx=".38" cy=".3" r=".8">
        <stop offset="0" style={{ stopColor: 'var(--metal-1)' }} />
        <stop offset=".55" style={{ stopColor: 'var(--metal-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--metal-3)' }} />
      </radialGradient>
      <linearGradient id="rc-gem" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--gem-1)' }} />
        <stop offset=".45" style={{ stopColor: 'var(--gem-2)' }} />
        <stop offset="1" style={{ stopColor: 'var(--gem-3)' }} />
      </linearGradient>
      <linearGradient id="rc-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: 'var(--metal-1)', stopOpacity: 0.85 }} />
        <stop offset=".6" style={{ stopColor: 'var(--metal-2)', stopOpacity: 0.25 }} />
        <stop offset="1" style={{ stopColor: 'var(--metal-2)', stopOpacity: 0 }} />
      </linearGradient>
      <linearGradient id="rc-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity=".45" />
      </linearGradient>
      <linearGradient id="rc-sheen" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0" />
        <stop offset=".5" stopColor="#fff" stopOpacity=".38" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="rc-inner-glow" cx=".5" cy="1" r=".9">
        <stop offset="0" style={{ stopColor: 'var(--glow)', stopOpacity: 0.75 }} />
        <stop offset="1" style={{ stopColor: 'var(--glow)', stopOpacity: 0 }} />
      </radialGradient>
      <clipPath id="rc-body-clip">
        <path d="M2 2H174V82Q174 94 162 94H14Q2 94 2 82Z" />
      </clipPath>
      <clipPath id="rc-lid-clip">
        <path d="M2 58V30C2 12 18 3 40 3H136C158 3 174 12 174 30V58Z" />
      </clipPath>
    </defs>
  </svg>
);

/** Cuerpo del cofre: tablas, bandas con remaches, molduras y la cerradura con su ojo */
const ChestBody: React.FC = () => (
  <svg className="reward-chest-body" viewBox="0 0 176 96" aria-hidden="true" focusable="false">
    <path d="M2 2H174V82Q174 94 162 94H14Q2 94 2 82Z" fill="url(#rc-wood)" />
    <g clipPath="url(#rc-body-clip)">
      {/* Juntas de las tablas */}
      <path d="M2 34H174M2 62H174" stroke="#000" strokeOpacity=".32" strokeWidth="1.6" />
      <path d="M2 36H174M2 64H174" stroke="#fff" strokeOpacity=".07" strokeWidth="1" />
      <rect x="0" y="60" width="176" height="36" fill="url(#rc-shade)" />
      {/* Bandas de metal */}
      <rect x="18" y="0" width="16" height="96" fill="url(#rc-metal)" />
      <rect x="142" y="0" width="16" height="96" fill="url(#rc-metal)" />
      {[18, 48, 76].map((y) => (
        <React.Fragment key={y}>
          <circle cx="26" cy={y} r="2.3" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth=".8" />
          <circle cx="150" cy={y} r="2.3" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth=".8" />
        </React.Fragment>
      ))}
      {/* Brillo que barre el cofre al aterrizar */}
      <path className="chest-sheen" d="M-50 0H-6L-36 96H-80Z" fill="url(#rc-sheen)" />
    </g>
    {/* Molduras superior e inferior */}
    <rect x="0" y="0" width="176" height="7" rx="2" fill="url(#rc-metal-h)" />
    <rect x="0" y="85" width="176" height="11" rx="5" fill="url(#rc-metal-h)" />
    {/* Brillo de bordes */}
    <path d="M3.5 9V80" stroke="#fff" strokeOpacity=".22" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M2 2H174V82Q174 94 162 94H14Q2 94 2 82Z" fill="none" stroke="var(--wood-edge)" strokeWidth="1.5" />
    {/* Cerradura: placa en escudo con ojo de llave */}
    <path d="M71 3H105V29Q105 44 88 51Q71 44 71 29Z" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth="1.3" />
    <path d="M74.5 6.5H101.5V28.5Q101.5 41 88 47Q74.5 41 74.5 28.5Z" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".9" />
    <circle cx="77.5" cy="10" r="1.6" fill="var(--metal-3)" />
    <circle cx="98.5" cy="10" r="1.6" fill="var(--metal-3)" />
    <circle cx="88" cy="23" r="4.4" fill="#12061f" />
    <path d="M86 25L84.4 35.5H91.6L90 25Z" fill="#12061f" />
    <path className="chest-keyhole-glow" d="M86.6 25.5L85.4 34.5H90.6L89.4 25.5Z" fill="var(--glow)" />
  </svg>
);

/** Cara exterior de la tapa (abombada) con bandas, medallón con gema y la aldaba */
const ChestLidFront: React.FC = () => (
  <svg className="reward-lid-face lid-front" viewBox="0 0 176 58" aria-hidden="true" focusable="false">
    <path d="M2 58V30C2 12 18 3 40 3H136C158 3 174 12 174 30V58Z" fill="url(#rc-lid)" />
    <g clipPath="url(#rc-lid-clip)">
      <ellipse cx="62" cy="14" rx="52" ry="10" fill="#fff" opacity=".12" />
      <path d="M2 30H174" stroke="#000" strokeOpacity=".22" strokeWidth="1.3" />
      <rect x="18" y="0" width="16" height="58" fill="url(#rc-metal)" />
      <rect x="142" y="0" width="16" height="58" fill="url(#rc-metal)" />
      <circle cx="26" cy="22" r="2.3" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth=".8" />
      <circle cx="150" cy="22" r="2.3" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth=".8" />
      <path className="chest-sheen" d="M-40 0H4L-14 58H-58Z" fill="url(#rc-sheen)" />
    </g>
    <rect x="0" y="50" width="176" height="8" rx="2" fill="url(#rc-metal-h)" />
    {/* Brillo de bordes del domo */}
    <path d="M2 58V30C2 12 18 3 40 3H136C158 3 174 12 174 30V58" fill="none" stroke="url(#rc-rim)" strokeWidth="2" />
    <path d="M30 6.5Q88 1 146 6.5" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" strokeLinecap="round" />
    {/* Medallón con gema */}
    <circle cx="88" cy="24" r="13" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth="1.2" />
    <path d="M88 14.5L97 24L88 33.5L79 24Z" fill="url(#rc-gem)" stroke="var(--gem-3)" strokeWidth=".8" />
    <path d="M88 14.5L92 24L88 33.5" fill="#fff" opacity=".18" />
    <circle cx="85.3" cy="20.2" r="1.5" fill="#fff" opacity=".85" />
    {/* Aldaba que baja hasta la cerradura */}
    <path d="M81 40H95V58H81Z" fill="url(#rc-plate)" stroke="var(--metal-3)" strokeWidth="1.1" />
    <circle cx="88" cy="47" r="1.8" fill="var(--metal-3)" />
  </svg>
);

/** Cara interior de la tapa: se ve cuando la tapa gira y queda abierta, iluminada desde el cofre */
const ChestLidInner: React.FC = () => (
  <svg className="reward-lid-face lid-inner" viewBox="0 0 176 58" aria-hidden="true" focusable="false">
    <path d="M2 0V28C2 46 18 55 40 55H136C158 55 174 46 174 28V0Z" fill="url(#rc-inner)" />
    <path d="M2 0V28C2 46 18 55 40 55H136C158 55 174 46 174 28V0Z" fill="url(#rc-inner-glow)" />
    <rect x="0" y="0" width="176" height="7" rx="2" fill="url(#rc-metal-h)" />
    <path d="M2 0V28C2 46 18 55 40 55H136C158 55 174 46 174 28V0" fill="none" stroke="var(--metal-2)" strokeOpacity=".6" strokeWidth="1.6" />
  </svg>
);

/**
 * CANJE DE RECOMPENSA: «cofre que se abre». El cofre cae y rebota, hace tres sacudidas cada vez
 * más fuertes mientras crece la luz que se escapa por la rendija, la tapa salta con un haz de luz,
 * el premio sube desde dentro, estallan monedas (o cristales de hielo para el protector) y el
 * costo se descuenta con un contador. El overlay reproduce los sonidos y el confeti sincronizados.
 */
export const RewardCelebrationOverlay: React.FC = () => {
  const [active, setActive] = useState<(RewardCelebrationData & { key: number }) | null>(null);
  const [closing, setClosing] = useState(false);
  const [shownCost, setShownCost] = useState(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearSequence = () => {
    seqTimers.current.forEach(clearTimeout);
    seqTimers.current = [];
  };

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
    // Al saltar la animación no deben sonar sacudidas ni aperturas pendientes
    clearSequence();
    setClosing(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setActive(null);
      setClosing(false);
    }, EXIT_MS);
  };

  useEffect(() => {
    if (!active) return;
    const reduced = prefersReducedMotion();
    const at = (ms: number, fn: () => void) => {
      seqTimers.current.push(setTimeout(fn, ms));
    };

    const openEffects = () => {
      if (active.isFreeze) {
        playSound.freeze();
        fireIceFreezeCelebration(0);
      } else {
        playSound.redeemReward();
        fireRewardCelebration(0);
      }
    };

    if (reduced) {
      // Sin caída ni sacudidas: el cofre aparece abierto con un fundido
      openEffects();
    } else {
      at(LAND_MS, () => playSound.chestLand());
      SHAKE_MS.forEach((ms, i) => at(ms, () => playSound.chestShake((i + 1) as 1 | 2 | 3)));
      at(OPEN_MS, openEffects);
    }
    at(reduced ? REDUCED_VISIBLE_MS : VISIBLE_MS, close);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKey);

    // Contador del costo: de 0 a -costo cuando aparece la insignia
    let raf = 0;
    const cost = active.cost ?? 0;
    setShownCost(0);
    if (cost > 0) {
      const start = performance.now() + (reduced ? 150 : COST_COUNT_MS);
      const tick = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - start) / 600));
        setShownCost(Math.round(cost * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      clearSequence();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    clearSequence();
  }, []);

  // Monedas / cristales que salen disparados desde el cofre en abanico al abrirse
  const burst = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => {
        const angle = (-160 + (140 / 15) * i + (Math.random() - 0.5) * 10) * (Math.PI / 180);
        const dist = 150 + Math.random() * 110;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          delay: OPEN_MS / 1000 + 0.1 + Math.random() * 0.25,
          rot: (Math.random() - 0.5) * 540,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.key],
  );

  // Motas de luz que escapan por la rendija con cada sacudida (más en cada una)
  const motes = useMemo(
    () =>
      SHAKE_MS.flatMap((ms, step) =>
        Array.from({ length: step + 2 }, (_, i) => ({
          id: `${step}-${i}`,
          x: (Math.random() - 0.5) * 130,
          drift: (Math.random() - 0.5) * 40,
          rise: 34 + step * 14 + Math.random() * 18,
          size: 3 + Math.random() * 2.5,
          delay: ms / 1000 + 0.04 + Math.random() * 0.18,
        })),
      ),
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
          <ChestDefs />
          <span className="reward-chest-shadow" />
          <div className="reward-chest-rig">
            <div className="reward-beam" />
            <div className="reward-chest-lid">
              <ChestLidFront />
              <ChestLidInner />
            </div>
            <div className="reward-prize">
              {isFreeze ? <Shield size={64} strokeWidth={1.6} /> : <span className="reward-prize-emoji">{active.icon}</span>}
            </div>
            <ChestBody />
            <span className="reward-crack-halo" />
            <span className="reward-crack" />
            <div className="reward-motes">
              {motes.map((m) => (
                <span
                  key={m.id}
                  style={
                    {
                      '--x': `${m.x}px`,
                      '--drift': `${m.drift}px`,
                      '--rise': `${-m.rise}px`,
                      width: m.size,
                      height: m.size,
                      animationDelay: `${m.delay}s`,
                    } as React.CSSProperties
                  }
                />
              ))}
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
