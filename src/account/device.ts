import { deviceGet, deviceSet } from '@/db/localDb';
import { randomBytes, toB64 } from '@/crypto/keys';
import { platformKind } from '@/platform';

/**
 * IDENTIDAD DE ESTE DISPOSITIVO
 * Un identificador secreto y aleatorio que se crea la primera vez y no cambia al cerrar sesión. El servidor solo
 * guarda su SHA-256 (tabla trusted_devices): los datos de la cuenta solo se leen o escriben desde un dispositivo
 * verificado con un código del correo. Borrar los datos del navegador o reinstalar la app cuenta como dispositivo nuevo.
 */

const TOKEN_KEY = 'device:token';
let cached: Promise<string> | null = null;

export function deviceToken(): Promise<string> {
  cached ??= (async () => {
    const saved = await deviceGet<string>(TOKEN_KEY);
    if (typeof saved === 'string' && saved.length >= 32) return saved;
    const token = toB64(randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await deviceSet(TOKEN_KEY, token);
    return token;
  })().catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

/** Nombre legible del dispositivo (p. ej. «Android · app» o «Windows · Chrome») */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux'
    : 'Otro';
  if (platformKind !== 'web') return `${os} · app`;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Navegador';
  return `${os} · ${browser}`;
}
