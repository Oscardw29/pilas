import Dexie, { type Table } from 'dexie';

/**
 * BASES DE DATOS LOCALES (IndexedDB vía Dexie)
 * Funcionan igual en el navegador (PWA), en el WebView de Android (Capacitor) y en los de Tauri.
 *
 * - `pilas-device`: lo que pertenece al equipo y no a una cuenta: clave del dispositivo, claves API
 *   cifradas, sesión de Supabase y claves de cifrado de la cuenta (como CryptoKey no extraíbles).
 * - `pilas-u-<userId>`: los datos de cada cuenta (registros + metadatos de sincronización).
 *   Al cerrar sesión se borra entera.
 */

export interface LocalRecord {
  /** `colección:id` (ver db/records.ts) */
  key: string;
  value: unknown;
  /** Posición dentro de su lista (solo colecciones de lista) */
  order?: number;
  /** Último cambio (ms epoch, reloj del dispositivo que lo hizo) */
  updatedAt: number;
  /** 1 = borrado (lápida que también se sincroniza) */
  deleted: 0 | 1;
  /** 1 = cambio local pendiente de subir */
  dirty: 0 | 1;
}

export interface KV {
  key: string;
  value: unknown;
}

class DeviceDb extends Dexie {
  kv!: Table<KV, string>;
  constructor() {
    super('pilas-device');
    this.version(1).stores({ kv: '&key' });
  }
}

export class UserDb extends Dexie {
  records!: Table<LocalRecord, string>;
  meta!: Table<KV, string>;
  constructor(userId: string) {
    super(userDbName(userId));
    this.version(1).stores({ records: '&key, dirty', meta: '&key' });
  }
}

export const userDbName = (userId: string) => `pilas-u-${userId}`;

let device: DeviceDb | null = null;
export const deviceDb = (): DeviceDb => (device ??= new DeviceDb());

/* ---------------- Clave-valor del dispositivo ---------------- */

export async function deviceGet<T>(key: string): Promise<T | undefined> {
  return (await deviceDb().kv.get(key))?.value as T | undefined;
}

export async function deviceSet(key: string, value: unknown): Promise<void> {
  await deviceDb().kv.put({ key, value });
}

export async function deviceDelete(key: string): Promise<void> {
  await deviceDb().kv.delete(key);
}

/* ---------------- Base de la cuenta ---------------- */

let current: { userId: string; db: UserDb } | null = null;

export function openUserDb(userId: string): UserDb {
  if (current?.userId === userId) return current.db;
  current?.db.close();
  current = { userId, db: new UserDb(userId) };
  return current.db;
}

export const currentUserDb = (): UserDb | null => current?.db ?? null;

export async function metaGet<T>(db: UserDb, key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function metaSet(db: UserDb, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** Borra todos los datos locales de una cuenta (cerrar sesión / eliminar cuenta) */
export async function deleteUserDb(userId: string): Promise<void> {
  if (current?.userId === userId) {
    current.db.close();
    current = null;
  }
  await Dexie.delete(userDbName(userId));
}

/** Pide al navegador que no borre IndexedDB por falta de espacio (sobre todo en la PWA de iOS/macOS) */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.();
    }
  } catch {
    /* no disponible: la copia en la nube cubre un posible borrado */
  }
}
