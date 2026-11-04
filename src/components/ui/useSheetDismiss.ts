import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { MOBILE_QUERY } from '@/lib/useMediaQuery';

/**
 * CERRAR DIÁLOGOS CON GESTOS (solo móvil)
 * - Deslizar hacia abajo: el diálogo sigue al dedo y, si se suelta lejos o rápido, sale por abajo y se cierra.
 *   Solo empieza si el contenido está arriba del todo (si no, el gesto desplaza el contenido como siempre).
 * - `dismiss()`: la misma salida animada, para el toque fuera del diálogo.
 * En pantallas anchas `dismiss()` cierra directamente y no hay gesto.
 */

const DISTANCE = 120;
const VELOCITY = 0.55; // px/ms
const OUT_MS = 220;

const isMobile = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** ¿El toque empezó en algo que tiene su propio gesto o en contenido desplazado hacia abajo? */
function blocksDrag(target: EventTarget | null, dialog: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input[type="range"], textarea, select, canvas, [data-no-swipe], .hm-canvas')) return true;
  for (let el: Element | null = target; el && el !== dialog.parentElement; el = el.parentElement) {
    if (el instanceof HTMLElement && el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

export function useSheetDismiss(ref: RefObject<HTMLElement | null>, enabled: boolean, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const leaving = useRef(false);

  const reset = (el: HTMLElement) => {
    el.style.transition = '';
    el.style.transform = '';
    el.style.opacity = '';
    const backdrop = el.parentElement;
    if (backdrop) {
      backdrop.style.transition = '';
      backdrop.style.opacity = '';
    }
  };

  const animateOut = useCallback(() => {
    const el = ref.current;
    if (!el || leaving.current) return;
    if (reducedMotion()) {
      onDismissRef.current();
      return;
    }
    leaving.current = true;
    const backdrop = el.parentElement;
    el.style.transition = `transform ${OUT_MS}ms cubic-bezier(.4, 0, 1, 1), opacity ${OUT_MS}ms ease`;
    el.style.transform = `translateY(${Math.max(el.offsetHeight, 240)}px)`;
    el.style.opacity = '0.6';
    if (backdrop) {
      backdrop.style.transition = `opacity ${OUT_MS}ms ease`;
      backdrop.style.opacity = '0';
    }
    window.setTimeout(() => {
      leaving.current = false;
      onDismissRef.current();
      // Si quien lo abrió no lo cerró (p. ej. pidió confirmación), vuelve a su sitio
      window.setTimeout(() => ref.current && reset(ref.current), 30);
    }, OUT_MS);
  }, [ref]);

  /** Cierre animado en el móvil; directo en pantallas anchas */
  const dismiss = useCallback(() => (isMobile() ? animateOut() : onDismissRef.current()), [animateOut]);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let startY = 0;
    let startX = 0;
    let startT = 0;
    let dy = 0;
    let state: 'idle' | 'maybe' | 'drag' | 'off' = 'idle';

    const onStart = (e: TouchEvent) => {
      if (!isMobile() || e.touches.length !== 1 || leaving.current) {
        state = 'off';
        return;
      }
      state = blocksDrag(e.target, el) ? 'off' : 'maybe';
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      startT = performance.now();
      dy = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (state === 'off' || state === 'idle') return;
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      dy = y - startY;
      if (state === 'maybe') {
        if (Math.abs(x - startX) > Math.abs(dy) || dy < 0) {
          state = 'off'; // gesto horizontal o hacia arriba: es para el contenido
          return;
        }
        if (dy < 8) return;
        state = 'drag';
        el.style.transition = 'none';
        if (el.parentElement) el.parentElement.style.transition = 'none';
      }
      e.preventDefault();
      // Resistencia suave: el diálogo sigue al dedo un poco más lento que él
      const offset = Math.max(0, dy * 0.92);
      el.style.transform = `translateY(${offset}px)`;
      if (el.parentElement) el.parentElement.style.opacity = String(Math.max(0.35, 1 - offset / (el.offsetHeight * 1.4)));
    };

    const onEnd = () => {
      if (state !== 'drag') {
        state = 'idle';
        return;
      }
      state = 'idle';
      const velocity = dy / Math.max(1, performance.now() - startT);
      if (dy > Math.min(DISTANCE, el.offsetHeight * 0.3) || velocity > VELOCITY) {
        animateOut();
        return;
      }
      el.style.transition = 'transform .32s cubic-bezier(.16, 1, .3, 1)';
      el.style.transform = '';
      if (el.parentElement) {
        el.parentElement.style.transition = 'opacity .32s ease';
        el.parentElement.style.opacity = '';
      }
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      leaving.current = false;
    };
  }, [enabled, ref, animateOut]);

  return { dismiss };
}
