import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { NativeBridge, NotifyPermission } from './index';

/**
 * Escritorio (Tauri 2: Windows / Linux). Las notificaciones son las del sistema (centro de
 * actividades de Windows, libnotify en Linux). El fetch nativo solo puede llegar a los hosts
 * permitidos en src-tauri/capabilities/default.json.
 */
export const tauriBridge: NativeBridge = {
  fetch: (url, init) => tauriFetch(url, init),

  async notify({ title, body }) {
    try {
      if (!(await isPermissionGranted())) return false;
      sendNotification({ title, body });
      return true;
    } catch (err) {
      console.warn('[Notificaciones] Tauri:', err);
      return false;
    }
  },

  async permission(): Promise<NotifyPermission> {
    try {
      return (await isPermissionGranted()) ? 'granted' : 'default';
    } catch {
      return 'unsupported';
    }
  },

  async requestPermission(): Promise<NotifyPermission> {
    try {
      return await requestPermission();
    } catch {
      return 'unsupported';
    }
  },
};
