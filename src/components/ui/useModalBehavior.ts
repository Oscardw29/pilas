import { useEffect, useRef, type RefObject } from 'react';

/**
 * COMPORTAMIENTO COMÚN DE DIÁLOGOS
 * - Pila de modales: Escape solo afecta al de arriba (antes un Escape cerraba todos los apilados).
 * - Foco: al abrir se enfoca el primer control del diálogo; Tab queda atrapado dentro; al cerrar vuelve al disparador.
 * - Bloqueo de scroll compatible con iOS (position: fixed), con contador para modales anidados.
 */

const stack: symbol[] = [];

/** ¿Hay algún diálogo abierto? (el botón «Atrás» de Android lo cierra antes de navegar) */
export const hasOpenModal = () => stack.length > 0;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Lo que tarda la hoja inferior en subir (sheetIn, .24 s en global.css) más un margen */
const SHEET_SETTLE_MS = 300;

let lockCount = 0;
let savedScrollY = 0;

function lockScroll() {
  if (lockCount++ > 0) return;
  savedScrollY = window.scrollY;
  const body = document.body.style;
  body.position = 'fixed';
  body.top = `-${savedScrollY}px`;
  body.left = '0';
  body.right = '0';
  body.overflow = 'hidden';
}

function unlockScroll() {
  if (--lockCount > 0) return;
  lockCount = 0;
  const body = document.body.style;
  body.position = '';
  body.top = '';
  body.left = '';
  body.right = '';
  body.overflow = '';
  window.scrollTo(0, savedScrollY);
}

export function useModalBehavior(isOpen: boolean, containerRef: RefObject<HTMLElement | null>, onEscape: () => void) {
  // Siempre la versión más reciente del callback, sin re-suscribir listeners
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol('modal');
    stack.push(id);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    lockScroll();

    // Foco inicial: primer control marcado con data-autofocus, o el primero enfocable, o el propio diálogo.
    // En pantallas táctiles enfocar un campo de texto abre el teclado: primero sube la hoja y, cuando ya está
    // en su sitio, se enfoca el campo marcado (el teclado sale después del modal, no antes). Sin campo marcado
    // se enfoca el propio diálogo, así ningún teclado aparece sin pedirlo.
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    let focusTimer = 0;
    const focusInitial = () => {
      const el = containerRef.current;
      if (!el) return;
      // Si la persona ya tocó un control del diálogo, no se le quita el foco (el propio diálogo no cuenta)
      const active = document.activeElement;
      if (active && active !== el && el.contains(active)) return;
      const preferred = el.querySelector<HTMLElement>('[data-autofocus]');
      if (touch) {
        (preferred ?? el).focus({ preventScroll: true });
        return;
      }
      const first = preferred ?? el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus({ preventScroll: true });
    };
    if (touch) {
      // Mantiene el foco fuera de los campos mientras sube la hoja (algún control podría robarlo al montarse)
      focusTimer = window.setTimeout(() => {
        const el = containerRef.current;
        if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
        focusTimer = window.setTimeout(focusInitial, SHEET_SETTLE_MS);
      }, 0);
    } else {
      focusTimer = window.setTimeout(focusInitial, 30);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = containerRef.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // En window (fase de burbuja): los desplegables internos pueden detener su Escape antes de llegar aquí
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown);
      const idx = stack.indexOf(id);
      if (idx >= 0) stack.splice(idx, 1);
      unlockScroll();
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [isOpen, containerRef]);
}
