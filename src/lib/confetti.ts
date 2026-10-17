import confetti from 'canvas-confetti';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Dispara confeti festivo para celebrar el cumplimiento de objetivos o hitos importantes.
 */
export function fireGoalCelebration() {
  if (reducedMotion()) return;
  const count = 200;
  const defaults = {
    origin: { y: 0.7 },
    zIndex: 9999,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    confetti({
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
  if (reducedMotion()) return;
  const nx = x > 1 ? x / window.innerWidth : x;
  const ny = y > 1 ? y / window.innerHeight : y;
  confetti({
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

/**
 * Racha encendida: brasas que suben desde la parte baja de la pantalla (gravedad negativa),
 * sincronizadas con la «ignición» del sonido.
 */
export function fireStreakEmbers() {
  if (reducedMotion()) return;
  const colors = ['#fb923c', '#f97316', '#fbbf24', '#fde68a', '#ef4444'];
  const shot = (x: number, delay: number) =>
    setTimeout(
      () =>
        confetti({
          particleCount: 28,
          angle: 90,
          spread: 40,
          startVelocity: 38,
          gravity: -0.25,
          drift: (Math.random() - 0.5) * 0.6,
          ticks: 220,
          decay: 0.93,
          scalar: 0.6,
          shapes: ['circle'],
          origin: { x, y: 1.05 },
          colors,
          zIndex: 2100,
        }),
      delay,
    );
  shot(0.5, 250);
  shot(0.3, 420);
  shot(0.7, 520);
}

/**
 * Súper racha: estallido radial de estrellas en el centro (al impacto del sonido, 0.5 s)
 * y dos cañones laterales con destellos violeta y dorado.
 */
export function fireSuperStreakBurst() {
  if (reducedMotion()) return;
  const colors = ['#c084fc', '#a855f7', '#e879f9', '#fbbf24', '#ffffff'];
  setTimeout(() => {
    confetti({
      particleCount: 90,
      spread: 360,
      startVelocity: 42,
      gravity: 0.55,
      decay: 0.92,
      ticks: 220,
      scalar: 1.15,
      shapes: ['star'],
      origin: { x: 0.5, y: 0.42 },
      colors,
      zIndex: 2100,
    });
  }, 500);
  setTimeout(() => {
    confetti({ particleCount: 60, angle: 60, spread: 60, startVelocity: 60, origin: { x: 0, y: 0.8 }, colors, zIndex: 2100 });
    confetti({ particleCount: 60, angle: 120, spread: 60, startVelocity: 60, origin: { x: 1, y: 0.8 }, colors, zIndex: 2100 });
  }, 700);
}

/**
 * Explosión festiva al canjear una recompensa: sale del cofre cuando se abre la tapa (~0.9 s).
 */
export function fireRewardCelebration() {
  if (reducedMotion()) return;
  setTimeout(() => {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.5 },
      colors: ['#fbbf24', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'],
      startVelocity: 35,
      zIndex: 100000,
    });
  }, 900);
}

/**
 * Explosión de cristales de hielo al adquirir el Protector de Racha.
 */
export function fireIceFreezeCelebration() {
  if (reducedMotion()) return;
  setTimeout(() => {
    confetti({
      particleCount: 140,
      spread: 90,
      origin: { y: 0.5 },
      colors: ['#38bdf8', '#0ea5e9', '#67e8f9', '#a5f3fc', '#ffffff'],
      startVelocity: 40,
      scalar: 1.1,
      zIndex: 100000,
    });
  }, 900);
}
