import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Coins } from 'lucide-react';
import { RARITY } from '@/social/texts';
import type { Rarity } from '@/social/types';
import { celebrationEnded, currentCelebration, enqueueCelebration } from '@/lib/celebrationQueue';
import { clearConfetti, fireAchievementBurst } from '@/lib/confetti';
import { isLowPowerDevice } from '@/lib/perf';
import { playSound } from '@/lib/sound';
import './achievementUnlock.css';

export interface AchievementCelebrationData {
  name: string;
  icon: string;
  rarity: Rarity;
  description?: string;
  /** Monedas de premio (entero) */
  prize?: number;
}

const EVENT_NAME = 'pilas:achievement-celebration';

/** Común → legendaria: más destellos, rayos y confeti */
const RARITY_LEVEL: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/**
 * Momentos de la secuencia (ms desde que aparece). Deben coincidir con los retrasos de achievementUnlock.css:
 * la medalla cae girando (0.15–1.2 s) y, al asentarse, destella (FLASH_MS).
 */
const FLASH_MS = 1050;
const VISIBLE_MS = 5200;
const REDUCED_VISIBLE_MS = 4000;
const EXIT_MS = 380;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Muestra la animación de un logro. NO salta sola al conseguirlo: solo al pulsar la notificación del logro
 * (Notificaciones) o «Ver animación» en el panel del creador. Pasa por la cola de celebraciones como las demás.
 */
export function triggerAchievementCelebration(data: AchievementCelebrationData) {
  if (typeof window === 'undefined') return;
  enqueueCelebration(
    () => window.dispatchEvent(new CustomEvent<AchievementCelebrationData>(EVENT_NAME, { detail: data })),
    VISIBLE_MS + EXIT_MS + 2_000,
  );
}

/** Contorno ondulado de la medalla (roseta de 24 puntas suaves) */
const ROSETTE = Array.from({ length: 48 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 48 - Math.PI / 2;
  const r = i % 2 === 0 ? 96 : 87;
  return `${(100 + Math.cos(a) * r).toFixed(1)},${(100 + Math.sin(a) * r).toFixed(1)}`;
}).join(' ');

/** Insignia: roseta con el color de la rareza, aro interior y cara con brillo */
const MedalSvg: React.FC = () => (
  <svg className="ach-unlock-svg" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="ach-unlock-shine" cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor="#fff" stopOpacity=".55" />
        <stop offset=".45" stopColor="#fff" stopOpacity=".1" />
        <stop offset="1" stopColor="#000" stopOpacity=".18" />
      </radialGradient>
    </defs>
    <polygon className="ach-unlock-rosette" points={ROSETTE} />
    <circle className="ach-unlock-rim" cx="100" cy="100" r="78" />
    <circle className="ach-unlock-face" cx="100" cy="100" r="70" />
    <circle cx="100" cy="100" r="70" fill="url(#ach-unlock-shine)" />
    <circle className="ach-unlock-ring" cx="100" cy="100" r="62" />
  </svg>
);

/** Cintas que cuelgan por detrás de la medalla */
const Ribbons: React.FC = () => (
  <svg className="ach-unlock-ribbons" viewBox="0 0 160 120" aria-hidden="true" focusable="false">
    <path className="ach-unlock-ribbon a" d="M38 0H78L62 104L48 88L30 102Z" />
    <path className="ach-unlock-ribbon b" d="M82 0H122L130 102L112 88L98 104Z" />
  </svg>
);

/**
 * LOGRO DESBLOQUEADO: «medalla que se acuña». La insignia cae girando sobre sí misma con el icono del logro
 * y el color de su rareza, se asienta con un rebote, destella (onda de luz, rayos que giran despacio, chispas
 * de cuatro puntas y un reflejo que cruza la cara) y entran el nombre, la rareza y el premio.
 * Distinta a la de racha (llama) y a la de recompensa (regalo). Solo transform/opacity.
 * Toque, Escape o Enter: cierra.
 */
export const AchievementUnlockOverlay: React.FC = () => {
  const [data, setData] = useState<(AchievementCelebrationData & { key: number }) | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Turno de la cola de celebraciones que se está mostrando (ver lib/celebrationQueue) */
  const turnRef = useRef(0);

  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<AchievementCelebrationData>).detail;
      if (!detail) return;
      if (exitTimer.current) clearTimeout(exitTimer.current);
      closingRef.current = false;
      setClosing(false);
      setData({ ...detail, key: Date.now() });
      turnRef.current = currentCelebration();
    };
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setData(null);
      setClosing(false);
      closingRef.current = false;
      celebrationEnded(turnRef.current);
    }, EXIT_MS);
  };

  // Destello sincronizado (sonido + confeti), cierre automático y teclado
  useEffect(() => {
    if (!data) return;
    const reduced = prefersReducedMotion();
    const level = RARITY_LEVEL[data.rarity] ?? 0;
    const color = (RARITY[data.rarity] ?? RARITY.common).color;
    clearConfetti();
    const flash = setTimeout(
      () => {
        if (level >= 2) playSound.goalComplete();
        else playSound.celebration();
        fireAchievementBurst(color, level);
      },
      reduced ? 200 : FLASH_MS,
    );
    const auto = setTimeout(close, reduced ? REDUCED_VISIBLE_MS : VISIBLE_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(flash);
      clearTimeout(auto);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(
    () => () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const level = data ? (RARITY_LEVEL[data.rarity] ?? 0) : 0;
  // Chispas alrededor de la medalla: más cuanto más rara (y menos en teléfonos)
  const sparkles = useMemo(() => {
    const n = Math.round((6 + level * 3) * (isLowPowerDevice() ? 0.6 : 1));
    return Array.from({ length: n }, (_, i) => {
      const angle = (360 / n) * i + (Math.random() - 0.5) * 18;
      return {
        id: i,
        angle,
        dist: 112 + Math.random() * 46,
        size: 10 + Math.random() * (8 + level * 2),
        delay: FLASH_MS / 1000 + 0.05 + Math.random() * 0.5,
        dur: 1.4 + Math.random() * 0.9,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.key]);

  if (!data) return null;

  const rarity = RARITY[data.rarity] ?? RARITY.common;
  const prize = Math.round(Number(data.prize) || 0);

  return createPortal(
    <div
      key={data.key}
      className={`celebrate-overlay is-achievement lvl-${level} ${closing ? 'is-closing' : ''}`}
      style={{ '--r': rarity.color } as React.CSSProperties}
      onClick={close}
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Logro desbloqueado: ${data.name}. Rareza ${rarity.label}${prize > 0 ? `. Premio: ${prize} monedas` : ''}`}
    >
      <div className="ach-unlock-stage">
        <div className="ach-unlock-emblem" aria-hidden="true">
          <span className="ach-unlock-rays" />
          <span className="ach-unlock-glow" />
          <span className="ach-unlock-flash" />
          <span className="ach-unlock-flash second" />
          <div className="ach-unlock-sparkles">
            {sparkles.map((s) => (
              <span
                key={s.id}
                style={
                  {
                    '--a': `${s.angle}deg`,
                    '--d': `${s.dist}px`,
                    width: s.size,
                    height: s.size,
                    animationDelay: `${s.delay}s`,
                    animationDuration: `${s.dur}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="ach-unlock-float">
            <div className="ach-unlock-medal">
              <Ribbons />
              <MedalSvg />
              <span className="ach-unlock-face-clip">
                <span className="ach-unlock-glint" />
              </span>
              <span className="ach-unlock-icon">{data.icon || '🏅'}</span>
            </div>
          </div>
        </div>

        <div className="ach-unlock-copy">
          <div className="ach-unlock-kicker">
            <Award size={15} aria-hidden="true" /> ¡Logro desbloqueado!
          </div>
          <span className="ach-unlock-rarity">{rarity.label}</span>
          <h2 className="ach-unlock-title">{data.name}</h2>
          {data.description && <p className="ach-unlock-sub">{data.description}</p>}
          {prize > 0 && (
            <span className="ach-unlock-prize">
              <Coins size={14} aria-hidden="true" /> +{prize} monedas
            </span>
          )}
          <span className="ach-unlock-hint">Toca para continuar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
