/**
 * COLA DE CELEBRACIONES A PANTALLA COMPLETA
 * Racha, súper racha, recompensa y logro nunca se muestran a la vez: si llega una mientras otra está en
 * pantalla, espera su turno. Dos overlays con confeti, sonido y animaciones simultáneos eran la
 * principal causa de los tirones.
 *
 * Cada overlay llama a `celebrationEnded(turno)` al desaparecer, con el turno que leyó al empezar
 * (`currentCelebration()`). Por si un overlay no llegara a mostrarse (p. ej. no está montado), hay un tope de
 * seguridad que libera la cola; si ese overlay termina después, su aviso tardío no corta la celebración siguiente.
 *
 * Mientras hay una celebración (o hay otras esperando) `isCelebrating()` es verdadero: el confeti suelto
 * (hábitos, metas, temporizador) no se dispara encima y los avisos (toasts) nuevos esperan a que termine.
 */

const SAFETY_MS = 9_000;

const queue: { start: () => void; maxMs: number }[] = [];
let busy = false;
let safety: ReturnType<typeof setTimeout> | null = null;
/** Turno de la celebración en pantalla (0 = ninguna) */
let current = 0;
let seq = 0;

type BusyListener = (busy: boolean) => void;
const busyListeners = new Set<BusyListener>();

function setBusy(next: boolean) {
  if (busy === next) return;
  busy = next;
  busyListeners.forEach((fn) => fn(next));
}

function runNext() {
  const next = queue.shift();
  if (!next) {
    setBusy(false);
    return;
  }
  setBusy(true);
  if (safety) clearTimeout(safety);
  const turn = ++seq;
  current = turn;
  safety = setTimeout(() => celebrationEnded(turn), next.maxMs);
  next.start();
}

/**
 * Pone en cola una celebración; `start` la muestra (dispara el evento del overlay).
 * `maxMs`: tope de seguridad propio si la animación dura más que el general.
 */
export function enqueueCelebration(start: () => void, maxMs = SAFETY_MS) {
  queue.push({ start, maxMs });
  if (!busy) runNext();
}

/** Turno de la celebración que está empezando: el overlay lo guarda al mostrarse y lo devuelve al terminar */
export const currentCelebration = () => current;

/** El overlay terminó de salir: puede empezar la siguiente. Un turno que ya no es el actual se ignora */
export function celebrationEnded(turn?: number) {
  if (turn !== undefined && turn !== current) return;
  current = 0;
  if (safety) clearTimeout(safety);
  safety = null;
  // Un respiro breve entre una y otra para que no se encadenen de golpe (la cola sigue «ocupada» mientras tanto)
  if (queue.length) setTimeout(runNext, 250);
  else setBusy(false);
}

/** ¿Hay una celebración a pantalla completa en curso (o esperando su turno)? */
export const isCelebrating = () => busy;

/** Avisa cuando empieza o termina la racha de celebraciones. Devuelve la función para dejar de escuchar */
export function onCelebrationChange(fn: BusyListener): () => void {
  busyListeners.add(fn);
  return () => {
    busyListeners.delete(fn);
  };
}
