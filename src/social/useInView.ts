import { useEffect, useState } from 'react';

const reducedMotion = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * ¿El elemento está en pantalla? Lo animado (WebP animados, nombres con brillo) solo se reproduce mientras se ve,
 * para no repetir los bajones de FPS de la F2. Con «reducir movimiento» nunca se anima.
 */
export function useInView(ref: React.RefObject<Element | null>, enabled = true, rootMargin = '80px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!enabled || reducedMotion()) {
      setInView(false);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, rootMargin]);
  return inView;
}
