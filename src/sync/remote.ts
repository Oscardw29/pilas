import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lo que el servidor guarda de cada registro: un id opaco, el contenido cifrado y marcas de tiempo.
 * Nunca ve colecciones, ids reales ni valores.
 */
export interface RemoteRow {
  rid: string;
  ciphertext: string;
  /** ISO: cuándo se hizo el cambio en el dispositivo (decide quién gana un conflicto) */
  client_updated_at: string;
  deleted: boolean;
  /** ISO: cuándo lo recibió el servidor (cursor para descargar solo lo nuevo) */
  server_updated_at: string;
}

export type PushRow = Omit<RemoteRow, 'server_updated_at'>;

export interface PullCursor {
  ts: string | null;
  rid: string;
}

/** Transporte de sincronización (Supabase en la app; uno en memoria en las pruebas) */
export interface Remote {
  push(rows: PushRow[]): Promise<void>;
  pull(after: PullCursor, limit: number): Promise<RemoteRow[]>;
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async push(rows) {
      const { error } = await client.rpc('push_records', { rows });
      if (error) throw new Error(error.message);
    },
    async pull(after, limit) {
      const { data, error } = await client.rpc('pull_records', { after_ts: after.ts, after_rid: after.rid, max_rows: limit });
      if (error) throw new Error(error.message);
      return (data ?? []) as RemoteRow[];
    },
  };
}
