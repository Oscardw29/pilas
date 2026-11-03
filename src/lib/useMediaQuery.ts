import { useCallback, useSyncExternalStore } from 'react';

/** ¿Se cumple la media query? Se lee al pintar (sin parpadeo) y se actualiza al girar o redimensionar */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Mismo corte que el CSS de móvil (global.css: max-width 639.98px) */
export const MOBILE_QUERY = '(max-width: 639.98px)';
