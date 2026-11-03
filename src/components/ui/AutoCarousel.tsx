import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MOBILE_QUERY, useMediaQuery } from '@/lib/useMediaQuery';
import './autoCarousel.css';

interface Props {
  /** Clases del contenedor (en pantallas anchas se pinta tal cual, como cuadrícula) */
  className: string;
  /** Cada cuánto pasa a la siguiente tarjeta (ms) */
  interval?: number;
  label?: string;
  children: React.ReactNode;
}

/** Tras tocar el carrusel, cuánto espera antes de volver a moverse solo */
const RESUME_AFTER_MS = 8_000;

/**
 * En el móvil: carrusel infinito que avanza solo (una tarjeta cada `interval` ms) y se puede deslizar a mano.
 * Al final hay una copia de la primera tarjeta: al llegar a ella se salta sin animación a la original, así el
 * recorrido nunca «rebobina». En pantallas anchas es un contenedor normal.
 */
export const AutoCarousel: React.FC<Props> = ({ className, interval = 5_000, label = 'Resumen', children }) => {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const items = React.Children.toArray(children);
  const count = items.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const pausedUntil = useRef(0);

  const slideWidth = () => trackRef.current?.clientWidth ?? 1;

  const goTo = useCallback((i: number, smooth = true) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Posición actual al desplazarse (a mano o sola). En la copia final se vuelve a la primera sin animación.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !isMobile) return;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / slideWidth());
      setIndex(i % count);
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        if (Math.round(el.scrollLeft / slideWidth()) >= count) goTo(0, false);
      }, 120);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (settle) clearTimeout(settle);
    };
  }, [isMobile, count, goTo]);

  // Avance automático (se detiene un rato si la persona lo toca y mientras la pestaña no se ve)
  useEffect(() => {
    if (!isMobile || count < 2) return;
    const t = setInterval(() => {
      const el = trackRef.current;
      if (!el || document.hidden || Date.now() < pausedUntil.current) return;
      const current = Math.round(el.scrollLeft / slideWidth());
      goTo(current + 1);
    }, interval);
    return () => clearInterval(t);
  }, [isMobile, count, interval, goTo]);

  if (!isMobile || count < 2) return <div className={className}>{children}</div>;

  const pause = () => (pausedUntil.current = Date.now() + RESUME_AFTER_MS);

  return (
    <div className={`auto-carousel ${className}`} role="region" aria-roledescription="carrusel" aria-label={label}>
      <div className="auto-carousel-track" ref={trackRef} onPointerDown={pause} onTouchStart={pause} onFocusCapture={pause}>
        {items.map((child, i) => (
          <div className="auto-carousel-slide" key={i} role="group" aria-roledescription="diapositiva" aria-label={`${i + 1} de ${count}`}>
            {child}
          </div>
        ))}
        {/* Copia de la primera para que el paso de la última a la primera sea continuo */}
        <div className="auto-carousel-slide" aria-hidden="true" inert>
          {items[0]}
        </div>
      </div>
      <div className="auto-carousel-dots" role="tablist" aria-label="Elegir tarjeta">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Tarjeta ${i + 1}`}
            className={i === index ? 'is-active' : ''}
            onClick={() => {
              pause();
              goTo(i);
            }}
          />
        ))}
      </div>
    </div>
  );
};
