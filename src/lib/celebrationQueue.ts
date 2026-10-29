/**
 * COLA DE CELEBRACIONES A PANTALLA COMPLETA
 * Racha, súper racha y recompensa nunca se muestran a la vez: si llega una mientras otra está en
 * pantalla, espera su turno. Dos overlays con confeti, sonido y animaciones simultáneos eran la
 * principal causa de los tirones.
 *
 * Cada overlay llama a `celebrationEnded()` al desaparecer. Por si un overlay no llegara a
 * mostrarse (p. ej. no está montado), hay un tope de seguridad que libera la cola.
 */

const SAFETY_MS = 9_000;

const queue: (() => void)[] = [];
let busy = false;
let safety: ReturnType<typeof setTimeout> | null = null;

function runNext() {
  const next = queue.shift();
  if (!next) {
    busy = false;
    return;
  }
  busy = true;
  if (safety) clearTimeout(safety);
  safety = setTimeout(celebrationEnded, SAFETY_MS);
  next();
}

/** Pone en cola una celebración; `start` la muestra (dispara el evento del overlay) */
export function enqueueCelebration(start: () => void) {
  queue.push(start);
  if (!busy) runNext();
}

/** El overlay terminó de salir: puede empezar la siguiente */
export function celebrationEnded() {
  if (safety) clearTimeout(safety);
  safety = null;
  // Un respiro breve entre una y otra para que no se encadenen de golpe
  if (queue.length) setTimeout(runNext, 250);
  else busy = false;
}
