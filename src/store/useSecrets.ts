import { create } from 'zustand';
import type { Secrets } from '@/types';
import { deviceDelete, deviceGet, deviceSet } from '@/db/localDb';
import { generateDeviceKey, openJson, sealJson } from '@/crypto/keys';

/**
 * ALMACÉN DE CLAVES DE API
 * - Pertenecen a este dispositivo: nunca se sincronizan ni viajan en los respaldos.
 * - Se guardan en IndexedDB (`pilas-device`) **siempre cifradas**: por defecto con una clave del
 *   dispositivo AES-GCM no extraíble (el código puede usarla, pero nadie puede copiarla).
 * - Versiones anteriores podían cifrarlas además con una contraseña (AES-GCM 256 + PBKDF2). Ya no se ofrece: quien las
 *   tenga así las recupera una vez con su contraseña (components/settings/LockedKeysCard) y quedan como las demás.
 */

/** Versiones anteriores guardaban las claves aquí (texto plano o cifradas con contraseña) */
const LEGACY_STORAGE_KEY = 'constancia-secrets';
const SECRETS_KEY = 'secrets';
const DEVICE_KEY = 'deviceKey';
const PBKDF2_ITERATIONS = 250_000;

export const emptySecrets = (): Secrets => ({
  geminiApiKey: '',
  ttsApiKey: '',
  fishAudioApiKey: '',
  elevenLabsApiKey: '',
  openaiTtsApiKey: '',
  deepgramApiKey: '',
});

type PasswordSealed = { v: 1; mode: 'enc'; salt: string; iv: string; data: string };
type StoredSecrets = { v: 2; mode: 'plain'; data: string } | PasswordSealed;
type LegacyStored = { v: 1; mode: 'plain'; keys: Partial<Secrets> } | PasswordSealed;

export type SecretsMode = 'plain' | 'enc';

interface SecretsState {
  keys: Secrets;
  mode: SecretsMode;
  /** true si las claves están cifradas con contraseña y aún no se han desbloqueado */
  locked: boolean;
  setKeys: (patch: Partial<Secrets>) => Promise<void>;
  forgetAll: () => void;
  disableEncryption: () => void;
  unlock: (password: string) => Promise<boolean>;
  /** Mueve claves de versiones antiguas (guardadas dentro de settings) solo si aún no hay claves propias */
  importLegacy: (legacy: Partial<Secrets>) => void;
}

/* ---------------- Utilidades de cifrado con contraseña ---------------- */

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

/** Clave derivada de la contraseña en memoria (nunca se persiste) y su salt, para volver a cifrar al editar */
let sessionKey: { key: CryptoKey; salt: Uint8Array } | null = null;

async function encryptWithPassword(keys: Secrets, key: CryptoKey, salt: Uint8Array): Promise<PasswordSealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(keys)));
  return { v: 1, mode: 'enc', salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

/* ---------------- Persistencia ---------------- */

/** Copia en memoria de lo guardado (para desbloquear sin volver a leer la base) */
let stored: StoredSecrets | null = null;
/** Las escrituras van en cola para que nunca se adelante una versión vieja */
let writes: Promise<void> = Promise.resolve();

async function deviceKey(): Promise<CryptoKey> {
  const existing = await deviceGet<CryptoKey>(DEVICE_KEY);
  if (existing) return existing;
  const key = await generateDeviceKey();
  await deviceSet(DEVICE_KEY, key);
  return key;
}

function persist(build: () => Promise<StoredSecrets | null>) {
  writes = writes
    .then(async () => {
      const value = await build();
      stored = value;
      if (value) await deviceSet(SECRETS_KEY, value);
      else await deviceDelete(SECRETS_KEY);
    })
    .catch((err) => console.warn('[Secrets] No se pudieron guardar las claves:', err));
  return writes;
}

const sealPlain = async (keys: Secrets): Promise<StoredSecrets> => ({ v: 2, mode: 'plain', data: await sealJson(await deviceKey(), keys) });

const hasAnyKey = (k: Partial<Secrets>) => Object.values(k).some((v) => typeof v === 'string' && v.trim() !== '');

export const useSecrets = create<SecretsState>()((set, get) => ({
  keys: emptySecrets(),
  mode: 'plain',
  locked: false,

  setKeys: async (patch) => {
    const { mode, locked } = get();
    if (mode === 'enc' && locked) throw new Error('Las claves están bloqueadas. Desbloquéalas primero.');
    const keys = { ...get().keys, ...patch };
    set({ keys });
    const pw = sessionKey;
    await persist(() => (mode === 'enc' && pw ? encryptWithPassword(keys, pw.key, pw.salt) : sealPlain(keys)));
  },

  forgetAll: () => {
    sessionKey = null;
    void persist(async () => null);
    set({ keys: emptySecrets(), mode: 'plain', locked: false });
  },

  disableEncryption: () => {
    if (get().locked) return;
    sessionKey = null;
    const keys = get().keys;
    void persist(() => sealPlain(keys));
    set({ mode: 'plain' });
  },

  unlock: async (password) => {
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

  importLegacy: (legacy) => {
    if (stored || hasAnyKey(get().keys) || !hasAnyKey(legacy)) return;
    const keys = { ...emptySecrets() };
    for (const k of Object.keys(keys) as (keyof Secrets)[]) {
      const v = legacy[k];
      if (typeof v === 'string') keys[k] = v.trim();
    }
    set({ keys, mode: 'plain', locked: false });
    void persist(() => sealPlain(keys));
  },
}));

/**
 * Carga las claves guardadas al arrancar (antes de mostrar la app). Si vienen de una versión anterior
 * (localStorage), las pasa a IndexedDB cifradas y borra la copia vieja.
 */
export async function initSecrets(): Promise<void> {
  let value = await deviceGet<StoredSecrets>(SECRETS_KEY).catch(() => undefined);

  if (!value) {
    let legacy: LegacyStored | null = null;
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      legacy = raw ? (JSON.parse(raw) as LegacyStored) : null;
    } catch {
      legacy = null;
    }
    if (legacy?.mode === 'enc') {
      await persist(async () => legacy as PasswordSealed);
      value = legacy;
    } else if (legacy?.mode === 'plain' && hasAnyKey(legacy.keys ?? {})) {
      const keys = { ...emptySecrets(), ...legacy.keys };
      await persist(() => sealPlain(keys));
      value = stored ?? undefined;
    }
    try {
      if (legacy) localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* noop */
    }
  }

  stored = value ?? null;
  if (!value) return;
  if (value.mode === 'enc') {
    useSecrets.setState({ keys: emptySecrets(), mode: 'enc', locked: true });
    return;
  }
  try {
    const keys = { ...emptySecrets(), ...(await openJson<Partial<Secrets>>(await deviceKey(), value.data)) };
    useSecrets.setState({ keys, mode: 'plain', locked: false });
  } catch (err) {
    // La clave del dispositivo se perdió (datos del sitio borrados a medias): no se pueden recuperar
    console.warn('[Secrets] No se pudieron descifrar las claves guardadas:', err);
    await persist(async () => null);
  }
}

/** Acceso a las claves desde código no-React (lib/gemini, lib/coachVoice) */
export const getSecrets = (): Secrets => useSecrets.getState().keys;

/** Campos de claves que versiones antiguas guardaban dentro de `settings` */
export const LEGACY_SECRET_FIELDS: (keyof Secrets)[] = [
  'geminiApiKey', 'ttsApiKey', 'fishAudioApiKey', 'elevenLabsApiKey', 'openaiTtsApiKey', 'deepgramApiKey',
];
