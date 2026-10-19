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
 * keyframes del regalo en global.css (giftDrop, giftShake1-3, lidPop, prizeRise…).
 */
const LAND_MS = 350;
const SHAKE_MS = [900, 1420, 2000] as const;
const OPEN_MS = 2560;
const COST_COUNT_MS = 2900;
/** Todo quieto: el premio ya salió y los textos terminaron de entrar */
const REVEAL_MS = 3900;
const VISIBLE_MS = 6000;
/** Tras saltar con un toque, el premio se queda un momento antes de cerrarse solo */
const SKIP_LINGER_MS = 2200;
const REDUCED_VISIBLE_MS = 4200;
const COUNT_MS = 600;
const EXIT_MS = 380;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/** Caja del regalo: cara plana con «labio» inferior más oscuro, cinta y brillos */
const GiftBox: React.FC = () => (
  <svg className="reward-gift-box" viewBox="0 0 150 104" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="rg-box-clip">
        <path d="M0 0H150V88Q150 104 134 104H16Q0 104 0 88Z" />
      </clipPath>
    </defs>
    <g clipPath="url(#rg-box-clip)">
      <rect width="150" height="104" fill="var(--box-lip)" />
      <path d="M0 0H150V76Q150 92 134 92H16Q0 92 0 76Z" fill="var(--box-face)" />
      {/* Cinta vertical */}
      <rect x="59" width="32" height="104" fill="var(--rib-lip)" />
      <rect x="59" width="32" height="92" fill="var(--rib-face)" />
      <rect x="64" y="14" width="6" height="66" rx="3" fill="#fff" opacity=".35" />
      {/* Sombra de la tapa */}
      <rect width="150" height="9" fill="#000" opacity=".16" />
    </g>
    {/* Brillos */}
    <rect x="13" y="20" width="10" height="40" rx="5" fill="#fff" opacity=".28" />
    <rect x="13" y="66" width="10" height="10" rx="5" fill="#fff" opacity=".28" />
  </svg>
);

/** Tapa con el lazo encima */
const GiftLid: React.FC = () => (
  <svg className="reward-gift-lid" viewBox="0 0 170 90" aria-hidden="true" focusable="false">
    {/* Lazo: dos lazadas con su sombra interior y el nudo */}
    <path d="M85 50C66 14 26 10 30 38C33 54 68 56 85 50Z" fill="var(--rib-face)" />
    <path d="M85 50C104 14 144 10 140 38C137 54 102 56 85 50Z" fill="var(--rib-face)" />
    <path d="M84 49C70 32 48 26 46 37C46 46 68 50 84 49Z" fill="var(--rib-lip)" />
    <path d="M86 49C100 32 122 26 124 37C124 46 102 50 86 49Z" fill="var(--rib-lip)" />
    <ellipse cx="42" cy="27" rx="7" ry="3.8" transform="rotate(-30 42 27)" fill="#fff" opacity=".45" />
    {/* Tapa */}
    <rect y="48" width="170" height="42" rx="12" fill="var(--lid-lip)" />
    <rect y="48" width="170" height="33" rx="12" fill="var(--lid-face)" />
    <rect x="69" y="48" width="32" height="42" fill="var(--rib-lip)" />
    <rect x="69" y="48" width="32" height="33" fill="var(--rib-face)" />
    <rect x="12" y="55" width="36" height="7" rx="3.5" fill="#fff" opacity=".32" />
    <rect x="74" y="55" width="6" height="18" rx="3" fill="#fff" opacity=".35" />
    {/* Nudo */}
    <rect x="73" y="38" width="24" height="20" rx="8" fill="var(--rib-lip)" />
    <rect x="73" y="38" width="24" height="15" rx="7.5" fill="var(--rib-face)" />
    <rect x="78" y="41" width="7" height="4" rx="2" fill="#fff" opacity=".5" />
  </svg>
);

/**
 * CANJE DE RECOMPENSA: «regalo que se abre». La caja cae y rebota, da tres saltitos cada vez más
 * fuertes mientras se escapa luz por la rendija, la tapa sale volando, el premio sube desde dentro,
 * estallan monedas (o cristales de hielo para el protector) y el costo se descuenta con un contador.
 * El overlay reproduce los sonidos y el confeti sincronizados.
 *
 * Primer toque durante la animación: salta a la recompensa ya afuera y la deja un momento.
 * Toque con la recompensa ya visible: cierra.
 */
export const RewardCelebrationOverlay: React.FC = () => {
  const [active, setActive] = useState<(RewardCelebrationData & { key: number }) | null>(null);
  const [closing, setClosing] = useState(false);
  const [shownCost, setShownCost] = useState(0);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const revealed = useRef(false);
  const opened = useRef(false);
  const countStart = useRef(0);
  const openEffects = useRef<() => void>(() => {});
  const closingRef = useRef(false);

  const clearSequence = () => {
    seqTimers.current.forEach(clearTimeout);
    seqTimers.current = [];
  };

  const scheduleClose = (ms: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(close, ms);
  };

  useEffect(() => {
    const handler = (data: RewardCelebrationData) => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      closingRef.current = false;
      setClosing(false);
      setActive({ ...data, key: Date.now() });
    };
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    clearSequence();
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setClosing(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setActive(null);
      setClosing(false);
      closingRef.current = false;
    }, EXIT_MS);
  };

  /** Lleva todas las animaciones al instante en que el premio ya está afuera */
  const skipToReveal = () => {
    revealed.current = true;
    clearSequence();
    if (!opened.current) openEffects.current();
    overlayRef.current?.getAnimations({ subtree: true }).forEach((a) => {
      const t = Number(a.currentTime ?? 0);
      if (t < REVEAL_MS) a.currentTime = REVEAL_MS;
    });
    // El contador termina de inmediato
    countStart.current = performance.now() - COUNT_MS;
    scheduleClose(SKIP_LINGER_MS);
  };

  const handleTap = () => {
    if (closingRef.current) return;
    const isOut = revealed.current || performance.now() - shownAt.current >= REVEAL_MS;
    if (isOut) close();
    else skipToReveal();
  };

  useEffect(() => {
    if (!active) return;
    const reduced = prefersReducedMotion();
    shownAt.current = performance.now();
    revealed.current = reduced;
    opened.current = false;

    const at = (ms: number, fn: () => void) => {
      seqTimers.current.push(setTimeout(fn, ms));
    };

    openEffects.current = () => {
      opened.current = true;
      if (active.isFreeze) {
        playSound.freeze();
        fireIceFreezeCelebration(0);
      } else {
        playSound.redeemReward();
        fireRewardCelebration(0);
      }
    };

    if (reduced) {
      // Sin caída ni saltos: el regalo aparece abierto con un fundido
      openEffects.current();
    } else {
      at(LAND_MS, () => playSound.giftLand());
      SHAKE_MS.forEach((ms, i) => at(ms, () => playSound.giftShake((i + 1) as 1 | 2 | 3)));
      at(OPEN_MS, () => openEffects.current());
    }
    scheduleClose(reduced ? REDUCED_VISIBLE_MS : VISIBLE_MS);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKey);

    // Contador del costo: de 0 a -costo cuando aparece la insignia
    let raf = 0;
    const cost = active.cost ?? 0;
    setShownCost(0);
    if (cost > 0) {
      countStart.current = performance.now() + (reduced ? 150 : COST_COUNT_MS);
      const tick = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - countStart.current) / COUNT_MS));
        setShownCost(Math.round(cost * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      clearSequence();
      if (closeTimer.current) clearTimeout(closeTimer.current);
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    clearSequence();
  }, []);

  // Monedas / cristales que salen disparados del regalo en abanico al abrirse
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

  // Chispas que escapan por la rendija con cada salto (más en cada uno)
  const motes = useMemo(
    () =>
      SHAKE_MS.flatMap((ms, step) =>
        Array.from({ length: step + 2 }, (_, i) => ({
          id: `${step}-${i}`,
          x: (Math.random() - 0.5) * 120,
          drift: (Math.random() - 0.5) * 40,
          rise: 34 + step * 14 + Math.random() * 18,
          size: 5 + Math.random() * 3,
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
      ref={overlayRef}
      className={`celebrate-overlay is-reward ${isFreeze ? 'is-freeze' : ''} ${closing ? 'is-closing' : ''}`}
      onClick={handleTap}
      role="alertdialog"
      aria-live="assertive"
      aria-label={isFreeze ? `Protector de racha activado` : `Recompensa canjeada: ${active.name}`}
    >
      <div className="celebrate-rays reward" aria-hidden="true" />

      <div className="celebrate-stage">
        <div className="reward-gift" aria-hidden="true">
          <span className="reward-gift-shadow" />
          <div className="reward-gift-rig">
            <div className="reward-beam" />
            <div className="reward-prize">
              {isFreeze ? <Shield size={64} strokeWidth={1.6} /> : <span className="reward-prize-emoji">{active.icon}</span>}
            </div>
            <GiftBox />
            <GiftLid />
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
