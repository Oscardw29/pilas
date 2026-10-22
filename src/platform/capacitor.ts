import { CapacitorHttp } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { NativeBridge, NotifyPermission } from './index';

/**
 * Android (Capacitor). El WebView de Android no admite `new Notification` ni Service Workers con
 * notificaciones, así que se usan notificaciones locales del sistema. El canal es «privado»:
 * en la pantalla de bloqueo no se muestra el texto (nombres de hábitos).
 */

const CHANNEL_ID = 'pilas-recordatorios';
let channelReady: Promise<void> | null = null;

function ensureChannel() {
  channelReady ??= LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Recordatorios',
    description: 'Recordatorios de hábitos y del coach',
    importance: 4,
    visibility: 0,
  }).catch(() => undefined);
  return channelReady;
}

const mapPermission = (p: string): NotifyPermission => (p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default');

/** Id numérico estable por etiqueta (repetir la etiqueta reemplaza el aviso en vez de duplicarlo) */
function idFor(tag?: string) {
  const s = tag || String(Date.now());
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => (out[key] = value));
  return out;
}

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * El fetch nativo se salta CORS y el CSP: solo se permite hacia los proveedores que lo necesitan
 * (igual que la lista de src-tauri/capabilities/default.json).
 */
const NATIVE_FETCH_HOSTS = new Set(['api.fish.audio']);

export const capacitorBridge: NativeBridge = {
  async fetch(url, init) {
    const host = new URL(url).host;
    if (!NATIVE_FETCH_HOSTS.has(host)) throw new Error(`Host no permitido para fetch nativo: ${host}`);
    const headers = headersToObject(init.headers);
    const body = typeof init.body === 'string' ? init.body : undefined;
    const res = await CapacitorHttp.request({
      url,
      method: init.method ?? 'GET',
      headers,
      data: body,
      responseType: 'arraybuffer',
      connectTimeout: 15_000,
      readTimeout: 45_000,
    });
    // Con responseType 'arraybuffer' el plugin devuelve el cuerpo en base64
    const bytes = typeof res.data === 'string' ? fromB64(res.data) : new TextEncoder().encode(JSON.stringify(res.data ?? ''));
    return new Response(bytes, { status: res.status, headers: res.headers });
  },

  async notify({ title, body, tag }) {
    try {
      await ensureChannel();
      await LocalNotifications.schedule({
        notifications: [{ id: idFor(tag), title, body, channelId: CHANNEL_ID }],
      });
      return true;
    } catch (err) {
      console.warn('[Notificaciones] Android:', err);
      return false;
    }
  },

  async permission() {
    try {
      return mapPermission((await LocalNotifications.checkPermissions()).display);
    } catch {
      return 'unsupported';
    }
  },

  async requestPermission() {
    try {
      return mapPermission((await LocalNotifications.requestPermissions()).display);
    } catch {
      return 'unsupported';
    }
  },
};
