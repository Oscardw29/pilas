import type { SupabaseClient } from '@supabase/supabase-js';

/** Contenido de cada registro en el servidor (JSON legible, protegido por RLS) */
export interface RecordBody {
  /** Clave del registro (`colección:id`) */
  k: string;
  v: unknown;
  o?: number;
  /** updatedAt (ms) */
  t: number;
  /** borrado */
  d: boolean;
}

/**
 * Lo que el servidor guarda de cada registro. `rid` es la clave del registro (`colección:id`).
 * `ciphertext` solo aparece en filas de antes (cifradas de extremo a extremo) que aún no se convirtieron.
 */
export interface RemoteRow {
  rid: string;
  body: RecordBody | null;
  ciphertext?: string | null;
  /** ISO: cuándo se hizo el cambio en el dispositivo (decide quién gana un conflicto) */
  client_updated_at: string;
  deleted: boolean;
  /** ISO: cuándo lo recibió el servidor (cursor para descargar solo lo nuevo) */
  server_updated_at: string;
}

export interface PushRow {
  rid: string;
  body: RecordBody;
  client_updated_at: string;
  deleted: boolean;
}

export interface PullCursor {
  ts: string | null;
  rid: string;
}

/** Transporte de sincronización (Supabase en la app; uno en memoria en las pruebas) */
export interface Remote {
  push(rows: PushRow[]): Promise<void>;
  pull(after: PullCursor, limit: number): Promise<RemoteRow[]>;
}

/** El servidor rechazó la petición porque este dispositivo no está verificado con un código del correo */
export class UntrustedDeviceError extends Error {
  constructor() {
    super('Este dispositivo no está verificado.');
  }
}

export const isUntrustedDevice = (err: { hint?: string; message?: string } | null | undefined) =>
  Boolean(err && (err.hint === 'pilas:untrusted_device' || /dispositivo no verificado/i.test(err.message ?? '')));

function remoteError(err: { hint?: string; message?: string }): Error {
  return isUntrustedDevice(err) ? new UntrustedDeviceError() : new Error(err.message);
}

/** `device`: identificador secreto de este dispositivo (ver account/device.ts) */
export function supabaseRemote(client: SupabaseClient, device: () => Promise<string>): Remote {
  return {
    async push(rows) {
      const { error } = await client.rpc('push_records', { rows, device: await device() });
      if (error) throw remoteError(error);
    },
    async pull(after, limit) {
      const { data, error } = await client.rpc('pull_records', {
        after_ts: after.ts,
        after_rid: after.rid,
        max_rows: limit,
        device: await device(),
      });
      if (error) throw remoteError(error);
      return (data ?? []) as RemoteRow[];
    },
  };
}
