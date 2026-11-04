/**
 * CLAVES (Web Crypto)
 *
 * contraseña ──PBKDF2(salt = correo)──► masterKey ──HKDF──┬─► authSecret  (lo único que recibe Supabase)
 *                                                          └─► kek         (abría la clave de las cuentas de antes)
 *
 * Hasta la migración 0006 los datos se cifraban de extremo a extremo con una clave por cuenta (rootKey → encKey):
 * se conserva lo necesario para abrirla una vez y convertir esos datos a legibles (sync/engine.ts: migrateLegacy).
 * También se usa para cifrar datos que solo viven en este equipo (claves API) y las copias de seguridad.
 */

export const KDF_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

/* ---------------- Utilidades ---------------- */

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromB64 = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const toB64Url = (bytes: ArrayBuffer | Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function hkdfBits(base: CryptoKey, info: string, salt: Uint8Array<ArrayBuffer> = new Uint8Array(32)): Promise<ArrayBuffer> {
  return subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, 256);
}

const importHkdf = (raw: BufferSource) => subtle().importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);

const importAes = (raw: BufferSource, extractable = false) =>
  subtle().importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);

/* ---------------- Cifrado simétrico ---------------- */

/**
 * Cifra bytes con AES-GCM. Formato: base64(iv[12] ‖ ciphertext).
 * `aad` (datos asociados): se autentican sin cifrar; descifrar con otro `aad` falla.
 */
export async function sealBytes(key: CryptoKey, plain: Uint8Array<ArrayBuffer>, aad?: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, plain));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function openBytes(key: CryptoKey, sealed: string, aad?: string): Promise<Uint8Array<ArrayBuffer>> {
  const all = fromB64(sealed);
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: all.subarray(0, 12), ...(aad ? { additionalData: enc.encode(aad) } : {}) },
    key,
    all.subarray(12),
  );
  return new Uint8Array(plain);
}

export const sealJson = (key: CryptoKey, value: unknown, aad?: string) => sealBytes(key, enc.encode(JSON.stringify(value)), aad);

export async function openJson<T>(key: CryptoKey, sealed: string, aad?: string): Promise<T> {
  return JSON.parse(dec.decode(await openBytes(key, sealed, aad))) as T;
}

/* ---------------- Contraseña → claves ---------------- */

export interface PasswordKeys {
  /** Va a Supabase como «contraseña» (base64url, 43 caracteres) */
  authSecret: string;
  /** Envuelve la clave raíz de la cuenta */
  kek: CryptoKey;
}

export async function derivePasswordKeys(email: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordKeys> {
  const base = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const master = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`pilas:${normalizeEmail(email)}`), iterations },
    base,
    256,
  );
  const masterKey = await importHkdf(master);
  const authSecret = toB64Url(await hkdfBits(masterKey, 'pilas-auth-v1'));
  const kek = await importAes(await hkdfBits(masterKey, 'pilas-kek-v1'));
  return { authSecret, kek };
}

/* ---------------- Clave raíz de la cuenta ---------------- */

export const generateRootKey = () => randomBytes(32);

export const wrapRootKey = (root: Uint8Array<ArrayBuffer>, wrappingKey: CryptoKey) => sealBytes(wrappingKey, root);

export async function unwrapRootKey(wrapped: string, wrappingKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const root = await openBytes(wrappingKey, wrapped);
  if (root.length !== 32) throw new Error('Clave de cuenta no válida');
  return root;
}

export interface AccountKeys {
  /** AES-GCM no extraíble: cifra y descifra los registros */
  encKey: CryptoKey;
  /** HMAC no extraíble: convierte `colección:id` en un id opaco */
  ridKey: CryptoKey;
}

export async function deriveAccountKeys(root: Uint8Array<ArrayBuffer>): Promise<AccountKeys> {
  const base = await importHkdf(root);
  const encKey = await importAes(await hkdfBits(base, 'pilas-records-v1'));
  const ridKey = await subtle().importKey(
    'raw',
    await hkdfBits(base, 'pilas-rid-v1'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return { encKey, ridKey };
}

/** Id opaco de un registro: el servidor no puede saber a qué colección ni a qué elemento corresponde */
export async function opaqueId(ridKey: CryptoKey, key: string): Promise<string> {
  return toB64Url(await subtle().sign('HMAC', ridKey, enc.encode(key)));
}

/* ---------------- Clave del dispositivo ---------------- */

/** AES-GCM no extraíble para cifrar datos que solo viven en este equipo (claves API) */
export function generateDeviceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as Promise<CryptoKey>;
}
