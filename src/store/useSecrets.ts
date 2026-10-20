import { create } from 'zustand';
import type { Secrets } from '@/types';

/**
 * ALMACÉN DE CLAVES DE API
 * - Vive en su propia entrada de localStorage (`constancia-secrets`), separada de los datos de la app,
 *   así los respaldos exportados nunca incluyen claves.
 * - Cifrado opcional con contraseña local: AES-GCM 256 con clave derivada por PBKDF2 (SHA-256).
 *   En modo cifrado las claves solo existen descifradas en memoria tras desbloquear.
 */

const STORAGE_KEY = 'constancia-secrets';
const PBKDF2_ITERATIONS = 250_000;

export const emptySecrets = (): Secrets => ({
  geminiApiKey: '',
  ttsApiKey: '',
  fishAudioApiKey: '',
  elevenLabsApiKey: '',
  openaiTtsApiKey: '',
  deepgramApiKey: '',
});

type StoredSecrets =
  | { v: 1; mode: 'plain'; keys: Partial<Secrets> }
  | { v: 1; mode: 'enc'; salt: string; iv: string; data: string };

export type SecretsMode = 'plain' | 'enc';

interface SecretsState {
  keys: Secrets;
  mode: SecretsMode;
  /** true si las claves están cifradas y aún no se han desbloqueado */
  locked: boolean;
  setKeys: (patch: Partial<Secrets>) => Promise<void>;
  forgetAll: () => void;
  enableEncryption: (password: string) => Promise<void>;
  disableEncryption: () => void;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  /** Mueve claves de versiones antiguas (guardadas dentro de settings) solo si aún no hay claves propias */
  importLegacy: (legacy: Partial<Secrets>) => void;
}

/* ---------------- Utilidades de cifrado ---------------- */

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Clave derivada en memoria (nunca se persiste) y su salt, para volver a cifrar al editar */
let sessionKey: { key: CryptoKey; salt: Uint8Array } | null = null;

async function encryptKeys(keys: Secrets, key: CryptoKey, salt: Uint8Array): Promise<StoredSecrets> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(keys)));
  return { v: 1, mode: 'enc', salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

/* ---------------- Persistencia ---------------- */

function readStored(): StoredSecrets | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.mode === 'plain' || parsed?.mode === 'enc') return parsed as StoredSecrets;
  } catch {
    /* almacenamiento no disponible o corrupto */
  }
  return null;
}

function writeStored(value: StoredSecrets | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[Secrets] No se pudieron guardar las claves:', err);
  }
}

const hasAnyKey = (k: Partial<Secrets>) => Object.values(k).some((v) => typeof v === 'string' && v.trim() !== '');

function initialState(): Pick<SecretsState, 'keys' | 'mode' | 'locked'> {
  const stored = readStored();
  if (stored?.mode === 'enc') return { keys: emptySecrets(), mode: 'enc', locked: true };
  return { keys: { ...emptySecrets(), ...(stored?.keys || {}) }, mode: 'plain', locked: false };
}

export const useSecrets = create<SecretsState>()((set, get) => ({
  ...initialState(),

  setKeys: async (patch) => {
    const { mode, locked } = get();
    if (mode === 'enc' && locked) throw new Error('Las claves están bloqueadas. Desbloquéalas primero.');
    const keys = { ...get().keys, ...patch };
    set({ keys });
    if (mode === 'enc' && sessionKey) {
      writeStored(await encryptKeys(keys, sessionKey.key, sessionKey.salt));
    } else {
      writeStored({ v: 1, mode: 'plain', keys });
    }
  },

  forgetAll: () => {
    sessionKey = null;
    writeStored(null);
    set({ keys: emptySecrets(), mode: 'plain', locked: false });
  },

  enableEncryption: async (password) => {
    if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    sessionKey = { key, salt };
    writeStored(await encryptKeys(get().keys, key, salt));
    set({ mode: 'enc', locked: false });
  },

  disableEncryption: () => {
    if (get().locked) return;
    sessionKey = null;
    writeStored({ v: 1, mode: 'plain', keys: get().keys });
    set({ mode: 'plain' });
  },

  unlock: async (password) => {
    const stored = readStored();
    if (stored?.mode !== 'enc') return true;
    try {
      const salt = fromB64(stored.salt);
      const key = await deriveKey(password, salt);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv) as BufferSource }, key, fromB64(stored.data) as BufferSource);
      const keys = { ...emptySecrets(), ...JSON.parse(new TextDecoder().decode(plain)) } as Secrets;
      sessionKey = { key, salt };
      set({ keys, locked: false });
      return true;
    } catch {
      return false;
    }
  },

  lock: () => {
    if (get().mode !== 'enc') return;
    sessionKey = null;
    set({ keys: emptySecrets(), locked: true });
  },

  importLegacy: (legacy) => {
    if (readStored() || !hasAnyKey(legacy)) return;
    const keys = { ...emptySecrets() };
    for (const k of Object.keys(keys) as (keyof Secrets)[]) {
      const v = legacy[k];
      if (typeof v === 'string') keys[k] = v.trim();
    }
    writeStored({ v: 1, mode: 'plain', keys });
    set({ keys, mode: 'plain', locked: false });
  },
}));

/** Acceso a las claves desde código no-React (lib/gemini) */
export const getSecrets = (): Secrets => useSecrets.getState().keys;

/** Campos de claves que versiones antiguas guardaban dentro de `settings` */
export const LEGACY_SECRET_FIELDS: (keyof Secrets)[] = [
  'geminiApiKey', 'ttsApiKey', 'fishAudioApiKey', 'elevenLabsApiKey', 'openaiTtsApiKey', 'deepgramApiKey',
];
