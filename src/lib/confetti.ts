import confetti from 'canvas-confetti';
import { isLowPowerDevice } from './perf';
import { isCelebrating } from './celebrationQueue';

/**
 * Todas las ráfagas pasan por aquí: hay un tope de partículas vivas a la vez para que varias
 * explosiones seguidas (o una celebración larga) no saturen el dibujo.
 * El confeti se dibuja en un worker (OffscreenCanvas) cuando el CSP lo permite (`worker-src blob:`).
 *
 * Nada se solapa con una celebración a pantalla completa (lib/celebrationQueue):
 * - El confeti «suelto» (hábito, meta, temporizador) no se dispara mientras hay una en pantalla.
 * - Cada overlay empieza con `clearConfetti()`: borra lo que quedara en el aire (p. ej. el confeti del hábito
 *   que acaba de encender la racha) y el lienzo se vuelve a crear con la capa (z-index) de esa celebración.
 */
const maxLive = () => (isLowPowerDevice() ? 220 : 520);
/** ms aproximados por «tick» de canvas-confetti (≈ un fotograma a 60 Hz) */
const TICK_MS = 17;
let live: { n: number; until: number }[] = [];

function shoot(opts: confetti.Options) {
  const now = performance.now();
  live = live.filter((b) => b.until > now);
  const used = live.reduce((sum, b) => sum + b.n, 0);
  const n = Math.min(opts.particleCount ?? 50, maxLive() - used);
  if (n < 4) return;
  live.push({ n, until: now + (opts.ticks ?? 200) * TICK_MS });
  void confetti({ ...opts, particleCount: n });
}

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Capa del confeti de las celebraciones: por encima de su overlay (z-index 2000) */
const CELEBRATION_Z = 2100;

/** Borra todo el confeti en el aire (lo llama cada overlay al empezar) */
export function clearConfetti() {
  live = [];
  try {
    confetti.reset();
  } catch {
    /* sin lienzo todavía: nada que borrar */
  }
}

/** Confeti suelto (fuera de un overlay): no se dibuja encima de una celebración a pantalla completa */
const blocked = () => reducedMotion() || isCelebrating();

/**
 * Prepara el confeti en un momento libre: la primera ráfaga crea el worker y su lienzo, y eso
 * costaba un tirón de más de 100 ms justo al empezar la primera celebración. Se dispara una sola
 * partícula fuera de la pantalla para que esa preparación ocurra antes, sin que se vea nada.
 */
export function prewarmConfetti() {
  if (reducedMotion() || typeof window === 'undefined') return;
  const run = () => void confetti({ particleCount: 1, ticks: 2, startVelocity: 0, origin: { x: -0.2, y: -0.2 }, zIndex: CELEBRATION_Z });
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2500);
}

/**
 * Dispara confeti festivo para celebrar el cumplimiento de objetivos o hitos importantes.
 */
export function fireGoalCelebration() {
  if (blocked()) return;
  const count = 200;
  const defaults = {
    origin: { y: 0.7 },
    zIndex: 9999,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    shoot({
      ...defaults,
      ...opts,
      particleCount: Math.floor(count * particleRatio),
    });
  }

  fire(0.25, {
    spread: 26,
    startVelocity: 55,
    colors: ['#8b5cf6', '#a78bfa', '#34d399', '#fbbf24'],
  });
  fire(0.2, {
    spread: 60,
    colors: ['#8b5cf6', '#6366f1', '#ec4899', '#22d3ee'],
  });
  fire(0.35, {
    spread: 100,
    decay: 0.91,
    scalar: 0.8,
    colors: ['#34d399', '#10b981', '#fbbf24', '#f59e0b'],
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 25,
    decay: 0.92,
    scalar: 1.2,
    colors: ['#8b5cf6', '#c084fc', '#ffffff'],
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 45,
    colors: ['#fbbf24', '#34d399', '#8b5cf6'],
  });
}

/**
 * Mini explosión sutil para hábitos o pequeñas victorias.
 * Acepta coordenadas de pantalla en píxeles (p. ej. `e.clientX`) o normalizadas (0-1).
 * Antes se pasaban píxeles directamente y el confeti salía fuera de la pantalla.
 */
export function fireHabitPop(x = 0.5, y = 0.5) {
  if (blocked()) return;
  const nx = x > 1 ? x / window.innerWidth : x;
  const ny = y > 1 ? y / window.innerHeight : y;
  shoot({
    particleCount: 35,
    spread: 50,
    origin: { x: nx, y: ny },
    colors: ['#34d399', '#8b5cf6', '#fbbf24'],
    startVelocity: 25,
    gravity: 1.2,
    scalar: 0.7,
    ticks: 60,
    zIndex: 9999,
  });
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** En teléfonos, menos de la mitad de partículas (canvas-confetti dibuja cada una en el hilo principal) */
const scaled = (n: number) => Math.max(6, Math.round(n * (isLowPowerDevice() ? 0.45 : 1)));

/**
 * Racha encendida: brasas que suben desde la parte baja de la pantalla (gravedad negativa),
 * sincronizadas con la «ignición» del sonido. Con más `power` (0-1, ver getFlamePower) hay más
 * columnas y brasas, luego un estallido de estrellas doradas y, en lo más alto, cañones laterales.
 */
export function fireStreakEmbers(power = 0) {
  if (reducedMotion()) return;
  const p = clamp01(power);
  const colors = ['#fb923c', '#f97316', '#fbbf24', '#fde68a', '#ef4444'];
  const shot = (x: number, delay: number) =>
    setTimeout(
      () =>
        shoot({
          particleCount: scaled(Math.round(28 + p * 30)),
          angle: 90,
          spread: 40 + p * 20,
          startVelocity: 38 + p * 14,
          gravity: -0.25,
          drift: (Math.random() - 0.5) * 0.6,
          ticks: 220,
          decay: 0.93,
          scalar: 0.6 + p * 0.3,
          shapes: ['circle'],
          origin: { x, y: 1.05 },
          colors,
          zIndex: CELEBRATION_Z,
        }),
      delay,
    );
  // De 3 a 7 columnas de brasas repartidas a lo ancho
  const columns = 3 + Math.round(p * (isLowPowerDevice() ? 2 : 4));
  for (let i = 0; i < columns; i++) {
    const x = columns === 1 ? 0.5 : 0.15 + (0.7 * i) / (columns - 1);
    shot(x, 250 + i * (300 / columns) + Math.random() * 80);
  }

  // Desde 14 días: estallido de estrellas doradas al prender la llama
  if (p >= 0.3) {
    setTimeout(() => {
      shoot({
        particleCount: scaled(Math.round(30 + p * 70)),
        spread: 360,
        startVelocity: 22 + p * 22,
        gravity: 0.5,
        decay: 0.92,
        ticks: 200,
        scalar: 0.8 + p * 0.4,
        shapes: ['star'],
        origin: { x: 0.5, y: 0.42 },
        colors: ['#fde68a', '#fbbf24', '#f97316', '#ffffff'],
        zIndex: CELEBRATION_Z,
      });
    }, 320);
  }
  // Desde 100 días: cañones laterales
  if (p >= 0.6) {
    setTimeout(() => {
      const count = Math.round(40 + p * 40);
      shoot({ particleCount: scaled(count), angle: 60, spread: 55, startVelocity: 55, origin: { x: 0, y: 0.85 }, colors, zIndex: CELEBRATION_Z });
      shoot({ particleCount: scaled(count), angle: 120, spread: 55, startVelocity: 55, origin: { x: 1, y: 0.85 }, colors, zIndex: CELEBRATION_Z });
    }, 650);
  }
  // Desde 250 días: lluvia de chispas doradas desde arriba
  if (p >= 0.8) rainFromTop(['#fde68a', '#fbbf24', '#ffffff'], Math.round(60 + p * 60), 1050);
}

/** Lluvia de destellos que cae desde el borde superior */
function rainFromTop(colors: string[], particleCount: number, delay: number) {
  setTimeout(() => {
    [0.2, 0.5, 0.8].forEach((x) =>
      shoot({
        particleCount: scaled(Math.round(particleCount / 3)),
        angle: 270,
        spread: 70,
        startVelocity: 18,
        gravity: 0.7,
        ticks: 260,
        scalar: 0.9,
        shapes: ['star', 'circle'],
        origin: { x, y: -0.05 },
        colors,
        zIndex: CELEBRATION_Z,
      }),
    );
  }, delay);
}

/**
 * Súper racha: estallido radial de estrellas en el centro (al impacto del sonido, 0.5 s)
 * y dos cañones laterales con destellos violeta y azul. Con más `power` (0-1) el estallido es
 * mayor, llega una segunda oleada (con el segundo impacto del sonido), lluvia de estrellas
 * y, en lo más alto, fuegos artificiales repartidos por la pantalla.
 */
export function fireSuperStreakBurst(power = 0) {
  if (reducedMotion()) return;
  const p = clamp01(power);
  const colors = ['#c084fc', '#a855f7', '#818cf8', '#60a5fa', '#ffffff'];
  setTimeout(() => {
    shoot({
      particleCount: scaled(Math.round(90 + p * 110)),
      spread: 360,
      startVelocity: 42 + p * 14,
      gravity: 0.55,
      decay: 0.92,
      ticks: 220,
      scalar: 1.15 + p * 0.35,
      shapes: ['star'],
      origin: { x: 0.5, y: 0.42 },
      colors,
      zIndex: CELEBRATION_Z,
    });
  }, 500);
  setTimeout(() => {
    const count = Math.round(60 + p * 60);
    shoot({ particleCount: scaled(count), angle: 60, spread: 60, startVelocity: 60, origin: { x: 0, y: 0.8 }, colors, zIndex: CELEBRATION_Z });
    shoot({ particleCount: scaled(count), angle: 120, spread: 60, startVelocity: 60, origin: { x: 1, y: 0.8 }, colors, zIndex: CELEBRATION_Z });
  }, 700);

  // Desde 50 días: segunda oleada (coincide con el segundo impacto del sonido)
  if (p >= 0.4) {
    setTimeout(() => {
      shoot({
        particleCount: scaled(Math.round(50 + p * 70)),
        spread: 360,
        startVelocity: 32 + p * 16,
        gravity: 0.6,
        decay: 0.91,
        ticks: 200,
        scalar: 0.9,
        shapes: ['star', 'circle'],
        origin: { x: 0.5, y: 0.42 },
        colors: ['#a5f3fc', '#60a5fa', '#c4b5fd', '#ffffff'],
        zIndex: CELEBRATION_Z,
      });
    }, 1100);
  }
  // Desde 100 días: lluvia de estrellas
  if (p >= 0.6) rainFromTop(['#c4b5fd', '#a5f3fc', '#ffffff'], Math.round(60 + p * 60), 1300);
  // Desde 200 días: fuegos artificiales en distintos puntos
  if (p >= 0.75) {
    const bursts = isLowPowerDevice() ? 2 : 3 + Math.round((p - 0.75) * 12);
    for (let i = 0; i < bursts; i++) {
      setTimeout(() => {
        shoot({
          particleCount: scaled(45),
          spread: 360,
          startVelocity: 26,
          gravity: 0.5,
          decay: 0.9,
          ticks: 160,
          scalar: 0.8,
          shapes: ['star'],
          origin: { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.35 },
          colors,
          zIndex: CELEBRATION_Z,
        });
      }, 1450 + i * 260);
    }
  }
}

/**
 * Explosión festiva al canjear una recompensa: sale del cofre cuando se abre la tapa.
 * El overlay del cofre la lanza en el momento de la apertura con delayMs = 0 e `inOverlay`.
 * Fuera del overlay (p. ej. al terminar el temporizador) no sale si hay una celebración en pantalla.
 */
export function fireRewardCelebration(delayMs = 900, inOverlay = false) {
  if (inOverlay ? reducedMotion() : blocked()) return;
  setTimeout(() => {
    if (!inOverlay && isCelebrating()) return;
    shoot({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#fbbf24', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'],
      startVelocity: 35,
      zIndex: 100000,
    });
  }, delayMs);
}

/**
 * Explosión de cristales de hielo al adquirir el Protector de Racha.
 */
export function fireIceFreezeCelebration(delayMs = 900, inOverlay = false) {
  if (inOverlay ? reducedMotion() : blocked()) return;
  setTimeout(() => {
    if (!inOverlay && isCelebrating()) return;
    shoot({
      particleCount: 140,
      spread: 90,
      origin: { y: 0.5 },
      colors: ['#38bdf8', '#0ea5e9', '#67e8f9', '#a5f3fc', '#ffffff'],
      startVelocity: 40,
      scalar: 1.1,
      zIndex: 100000,
    });
  }, delayMs);
}

/**
 * Logro desbloqueado: destello de estrellas desde la medalla con el color de su rareza.
 * `level` 0–3 (común → legendaria) suma partículas y, en épica y legendaria, una lluvia de destellos.
 * Lo lanza el overlay del logro en el momento del destello.
 */
export function fireAchievementBurst(color: string, level = 0) {
  if (reducedMotion()) return;
  const l = Math.min(3, Math.max(0, level));
  const colors = [color, color, '#ffffff', '#fde68a'];
  shoot({
    particleCount: scaled(50 + l * 30),
    spread: 360,
    startVelocity: 26 + l * 6,
    gravity: 0.55,
    decay: 0.91,
    ticks: 190,
    scalar: 0.9 + l * 0.12,
    shapes: ['star'],
    origin: { x: 0.5, y: 0.36 },
    colors,
    zIndex: CELEBRATION_Z,
  });
  if (l >= 2) rainFromTop([color, '#ffffff', '#fde68a'], 40 + l * 20, 380);
}
