/**
 * CAPA DE PLATAFORMA
 * Un solo código para tres entornos:
 * - `web`: navegador / PWA (iOS, macOS y cualquier navegador)
 * - `android`: app de Capacitor (APK)
 * - `tauri`: app de escritorio de Tauri 2 (Windows / Linux)
 *
 * Aquí se decide qué implementación usar para lo que cambia entre ellos: peticiones HTTP sin CORS,
 * notificaciones del sistema y el Service Worker. Los plugins nativos se cargan con `import()`
 * dinámico para que la versión web no los descargue.
 */

export type PlatformKind = 'web' | 'android' | 'tauri';

export interface NotifyPayload {
  title: string;
  body: string;
  tag?: string;
}

export type NotifyPermission = NotificationPermission | 'unsupported';

export interface NativeBridge {
  /** fetch nativo: sin CORS (para proveedores que no lo permiten, como Fish Audio) */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  notify: (p: NotifyPayload) => Promise<boolean>;
  permission: () => Promise<NotifyPermission>;
  requestPermission: () => Promise<NotifyPermission>;
}

function detect(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.__TAURI_INTERNALS__) return 'tauri';
  if (w.Capacitor?.isNativePlatform?.()) return 'android';
  return 'web';
}

export const platformKind: PlatformKind = detect();
export const isNativeApp = platformKind !== 'web';

let bridge: Promise<NativeBridge> | null = null;

/** Puente a las APIs nativas (solo en Capacitor / Tauri) */
export function nativeBridge(): Promise<NativeBridge> {
  if (!isNativeApp) return Promise.reject(new Error('No es una app nativa'));
  bridge ??= platformKind === 'tauri'
    ? import('./tauri').then((m) => m.tauriBridge)
    : import('./capacitor').then((m) => m.capacitorBridge);
  return bridge;
}

/** fetch que en las apps nativas no está sujeto a CORS; en la web es el fetch normal */
export async function platformFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isNativeApp) return fetch(url, init);
  return (await nativeBridge()).fetch(url, init);
}
