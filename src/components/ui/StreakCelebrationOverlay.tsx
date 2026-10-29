import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Flame, Sparkles } from 'lucide-react';
import { StreakFlame, getFlamePower } from './StreakFlame';
import { fireStreakEmbers, fireSuperStreakBurst } from '@/lib/confetti';
import { playSound } from '@/lib/sound';
import { isLowPowerDevice } from '@/lib/perf';
import { celebrationEnded, enqueueCelebration } from '@/lib/celebrationQueue';

export interface StreakCelebrationPayload {
  days: number;
  isSuper: boolean;
}

const EVENT_NAME = 'constancia:streak-celebration';

/** Duración visible de cada celebración (ms) antes de empezar a salir */
const VISIBLE_MS = { streak: 3200, super: 4000 };
const EXIT_MS = 380;

/**
 * Dispara la celebración de racha a pantalla completa.
 */
export function triggerStreakCelebration(payload: StreakCelebrationPayload) {
  if (typeof window === 'undefined') return;
  // De una en una (ver lib/celebrationQueue): si hay otra en pantalla, espera
  enqueueCelebration(() => window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload })));
}

/** Partículas CSS con posición/tiempos aleatorios estables durante la animación */
const useParticles = (count: number, seed: number) =>
  useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 1.6,
        duration: 2.2 + Math.random() * 1.8,
        size: 3 + Math.random() * 5,
        drift: (Math.random() - 0.5) * 120,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, seed],
  );

/**
 * RACHA: «ignición». Una chispa sube desde abajo y prende la llama; ondas de calor,
 * brasas flotando y el contador de días que rueda al nuevo valor.
 * SÚPER RACHA: «supernova». Rayos de aurora girando, onda expansiva sincronizada con el
 * impacto del sonido, estrellas en órbita y un destello de pantalla.
 */
export const StreakCelebrationOverlay: React.FC = () => {
  const [data, setData] = useState<(StreakCelebrationPayload & { key: number }) | null>(null);
  const [closing, setClosing] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<StreakCelebrationPayload>).detail;
      if (!detail) return;
      setClosing(false);
      setData({ ...detail, key: Date.now() });
      // Más días, más potencia: el sonido y el confeti suman capas con cada nivel de la llama
      const power = getFlamePower(detail.days);
      if (detail.isSuper) {
        playSound.superStreak(power);
        fireSuperStreakBurst(power);
      } else {
        playSound.streak(power);
        fireStreakEmbers(power);
      }
    };
    window.addEventListener(EVENT_NAME, handleEvent);
    return () => window.removeEventListener(EVENT_NAME, handleEvent);
  }, []);

  const close = () => {
    if (closing) return;
    setClosing(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setData(null);
      setClosing(false);
      celebrationEnded();
    }, EXIT_MS);
  };

  // Cierre automático
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(close, data.isSuper ? VISIBLE_MS.super : VISIBLE_MS.streak);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  const power = data ? getFlamePower(data.days) : 0;
  // En teléfonos, menos partículas y estrellas en órbita para no trabar la animación
  const lite = isLowPowerDevice();
  const particles = useParticles(Math.round((data?.isSuper ? 22 : 18) * (lite ? 0.6 : 1) + power * (lite ? 8 : 18)), data?.key ?? 0);
  // Ondas y estrellas en órbita también crecen con el nivel
  const ringCount = 3 + (power >= 0.45 ? 1 : 0) + (power >= 0.75 ? 1 : 0);
  const orbitCount = 6 + Math.round(power * (lite ? 2 : 6));

  if (!data) return null;

  const { isSuper, days } = data;
  const prevDays = Math.max(0, days - 1);

  return createPortal(
    <div
      key={data.key}
      className={`celebrate-overlay ${isSuper ? 'is-super' : 'is-streak'} ${closing ? 'is-closing' : ''}`}
      onClick={close}
      role="alertdialog"
      aria-live="assertive"
      aria-label={isSuper ? `Súper racha desbloqueada: ${days} días` : `Racha encendida: ${days} días`}
    >
      {(isSuper || power >= 0.8) && <div className="celebrate-flash" aria-hidden="true" />}
      {(isSuper || power >= 0.6) && <div className="celebrate-rays" aria-hidden="true" />}

      {/* Brasas / polvo estelar ascendente */}
      <div className="celebrate-particles" aria-hidden="true">
        {particles.map((p) => (
          <span
            key={p.id}
            style={
              {
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                '--drift': `${p.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="celebrate-stage">
        <div className="celebrate-emblem">
          {/* Ondas de calor (racha) u onda expansiva (súper racha) */}
          {Array.from({ length: ringCount }, (_, i) => (
            <span key={i} className={`celebrate-ring r${i + 1}`} aria-hidden="true" />
          ))}

          {!isSuper && <span className="celebrate-spark" aria-hidden="true" />}

          {isSuper && (
            <div className="celebrate-orbit" aria-hidden="true">
              {Array.from({ length: orbitCount }, (_, i) => (
                <span key={i} style={{ '--i': i, '--n': orbitCount } as React.CSSProperties} />
              ))}
            </div>
          )}

          <div className="celebrate-flame">
            <StreakFlame days={days} size={190} isSuperStreak={isSuper} />
          </div>

          <div className="celebrate-days">
            <span className="celebrate-roll" aria-hidden="true">
              <span>{prevDays}</span>
              <span>{days}</span>
            </span>
            <span className="celebrate-days-label">{days === 1 ? 'día' : 'días'}</span>
          </div>
        </div>

        <div className="celebrate-copy">
          <div className="celebrate-kicker">
            {isSuper ? <Sparkles size={15} aria-hidden="true" /> : <Flame size={15} aria-hidden="true" />}
            {isSuper ? 'Súper racha desbloqueada' : 'Racha encendida'}
          </div>
          <h2 className="celebrate-title">{isSuper ? '¡Día impecable!' : '¡Ya estás en la jugada!'}</h2>
          <p className="celebrate-sub">
            {isSuper
              ? 'Completaste todos tus hábitos programados de hoy. Así es, ¡con toda la pila!'
              : 'Marcaste tu primer hábito del día y tu racha sigue viva. ¡Pilas, no la sueltes!'}
          </p>
          <span className="celebrate-hint">Toca para continuar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
