/**
 * TARJETAS DE LOS GRÁFICOS EN PANTALLAS TÁCTILES
 * Recharts abre su tarjeta (tooltip) al tocar un punto o un sector, pero no la cierra al levantar el dedo: se quedaba
 * en pantalla hasta tocar fuera. Aquí, para todos los gráficos de la app:
 * - se cierra sola unos segundos después de levantar el dedo;
 * - se cierra al instante al tocar otro sitio o al desplazar la página;
 * - se suelta el foco que el toque deja en el gráfico (si no, Recharts la vuelve a mostrar como si fuera el teclado).
 * Para cerrarla se simula que el puntero sale del gráfico (Recharts escucha `onMouseLeave` en .recharts-wrapper).
 */

const HIDE_AFTER_MS = 3200;

let installed = false;
let active: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function hide(wrap: HTMLElement) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (active === wrap) active = null;
  if (!wrap.isConnected) return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement || focused instanceof SVGElement) {
    if (wrap.contains(focused)) (focused as HTMLElement).blur();
  }
  // React traduce «mouseout» hacia fuera del árbol en onMouseLeave del contenedor
  wrap.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }));
}

const wrapperOf = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest('.recharts-wrapper') as HTMLElement | null) : null;

export function installChartTouchDismiss() {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'touchstart',
    (e) => {
      const wrap = wrapperOf(e.target);
      if (timer) clearTimeout(timer);
      timer = null;
      // Tocar fuera (u otro gráfico) cierra la tarjeta abierta
      if (active && active !== wrap) hide(active);
      if (wrap) active = wrap;
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'touchend',
    (e) => {
      const wrap = wrapperOf(e.target) ?? active;
      if (!wrap) return;
      active = wrap;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => hide(wrap), HIDE_AFTER_MS);
    },
    { capture: true, passive: true },
  );

  // Desplazar la página (o un panel) cierra la tarjeta: ya no apunta a lo que se tocó
  window.addEventListener(
    'scroll',
    () => {
      if (active) hide(active);
    },
    { capture: true, passive: true },
  );
}
