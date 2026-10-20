let lowPower: boolean | null = null;

/**
 * Teléfonos y equipos modestos (pantalla táctil, ≤ 4 núcleos o ≤ 4 GB): las celebraciones usan
 * menos partículas y menos capas de sonido para no trabarse.
 */
export function isLowPowerDevice(): boolean {
  if (lowPower !== null) return lowPower;
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  lowPower = coarse || (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return lowPower;
}
