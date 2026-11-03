import React, { useEffect, useRef, useState } from 'react';

/**
 * Número que «cuenta» hasta su valor al aparecer y al cambiar (≈0,8 s, frena al final).
 * Con movimiento reducido muestra el valor directamente.
 */
export const CountUp: React.FC<{ value: number; suffix?: string; duration?: number }> = ({ value, suffix = '', duration = 800 }) => {
  const [shown, setShown] = useState(() => (prefersReduced() ? value : 0));
  const from = useRef(shown);

  useEffect(() => {
    if (prefersReduced()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(origin + (value - origin) * eased);
      from.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <>
      {/* Los lectores de pantalla leen el valor final, no la cuenta */}
      <span aria-hidden="true">{shown.toLocaleString('es')}{suffix}</span>
      <span className="sr-only-count">{value.toLocaleString('es')}{suffix}</span>
    </>
  );
};

function prefersReduced() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
