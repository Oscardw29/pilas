import { fromB64, openBytes, randomBytes, sealBytes, toB64 } from './keys';

/**
 * Respaldos cifrados con contraseña (PBKDF2-SHA256 + AES-GCM 256). El archivo es JSON:
 * { pilasEncryptedBackup: 1, iterations, salt, data }
 */

const ITERATIONS = 600_000;

export interface EncryptedBackup {
  pilasEncryptedBackup: 1;
  iterations: number;
  salt: string;
  data: string;
}

export const isEncryptedBackup = (v: unknown): v is EncryptedBackup =>
  typeof v === 'object' && v !== null && (v as EncryptedBackup).pilasEncryptedBackup === 1 && typeof (v as EncryptedBackup).data === 'string';

async function keyFor(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(json: string, password: string): Promise<EncryptedBackup> {
  const salt = randomBytes(16);
  const key = await keyFor(password, salt, ITERATIONS);
  return { pilasEncryptedBackup: 1, iterations: ITERATIONS, salt: toB64(salt), data: await sealBytes(key, new TextEncoder().encode(json)) };
}

/** Lanza un error si la contraseña no es correcta */
export async function decryptBackup(file: EncryptedBackup, password: string): Promise<unknown> {
  const iterations = Math.min(Math.max(file.iterations || ITERATIONS, 100_000), 5_000_000);
  const key = await keyFor(password, fromB64(file.salt), iterations);
  const plain = await openBytes(key, file.data).catch(() => {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  });
  return JSON.parse(new TextDecoder().decode(plain));
}
