/**
 * RESPALDOS PARA NAVEGADORES ANTIGUOS
 * Se importa lo primero en main.tsx.
 * - `AbortSignal.timeout` no existe en Safari/iOS anteriores a la 16: todas las peticiones con tiempo límite (voz del coach,
 *   IA de la app, comprobación de claves) fallaban al instante y el coach se quedaba sin voz en esos iPhone y Mac.
 */

if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout !== 'function') {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => {
      const err = typeof DOMException === 'function' ? new DOMException('Tiempo de espera agotado', 'TimeoutError') : new Error('TimeoutError');
      controller.abort(err);
    }, ms);
    return controller.signal;
  };
}

export {};
