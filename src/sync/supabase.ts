import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deviceDb, deviceDelete, deviceGet, deviceSet } from '@/db/localDb';

/**
 * CLIENTE DE SUPABASE
 * - Solo se usa la clave pública (publishable/anon): la seguridad la ponen las políticas RLS
 *   (ver supabase/migrations). La clave `service_role` nunca debe estar en la app.
 * - La sesión (tokens) se guarda en IndexedDB del dispositivo, no en localStorage.
 */

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(URL && KEY);

const authStorage = {
  getItem: async (key: string) => (await deviceGet<string>(`auth:${key}`)) ?? null,
  setItem: (key: string, value: string) => deviceSet(`auth:${key}`, value),
  removeItem: (key: string) => deviceDelete(`auth:${key}`),
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error('Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).');
  client ??= createClient(URL!, KEY!, {
    auth: {
      storage: authStorage,
      storageKey: 'pilas-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/**
 * Cierra la sesión en este dispositivo y borra los tokens guardados. Se borran a mano además de
 * llamar a signOut: si había una renovación de token en curso (p. ej. sin red), podría volver a guardarlos.
 */
export async function clearLocalSession(): Promise<void> {
  if (isSupabaseConfigured) {
    await Promise.race([
      supabase().auth.signOut({ scope: 'local' }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await deviceDb().kv.where('key').startsWith('auth:').delete();
}
