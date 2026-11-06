import { isSupabaseConfigured, supabase } from '@/sync/supabase';

/**
 * CALIFICACIÓN CON ESTRELLAS de la página de descarga (supabase/migrations/0008_calificaciones.sql).
 * Sin cuenta: un voto por equipo. El equipo se identifica con un id aleatorio guardado en este navegador; con el
 * mismo id el voto se cambia. Aquí también se recuerda el voto propio para pintarlo al volver.
 */

export interface RatingSummary {
  average: number;
  count: number;
}

const VOTER_KEY = 'pilas-rating-voter';
const MINE_KEY = 'pilas-rating-mine';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* navegador privado o sin almacenamiento: el voto vale igual, solo no se recuerda */
  }
};

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

function voterId(): string {
  const saved = read(VOTER_KEY);
  if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
  const id = uuid();
  write(VOTER_KEY, id);
  return id;
}

const parse = (raw: unknown): RatingSummary => {
  const r = (raw ?? {}) as Partial<Record<keyof RatingSummary, unknown>>;
  return { average: Number(r.average) || 0, count: Number(r.count) || 0 };
};

export const ratingsAvailable = isSupabaseConfigured;

/** El voto que dio este equipo (o null si todavía no ha calificado) */
export function myRating(): number | null {
  const n = Number(read(MINE_KEY));
  return n >= 1 && n <= 5 ? n : null;
}

export async function fetchRatingSummary(): Promise<RatingSummary> {
  if (!isSupabaseConfigured) throw new Error('Las calificaciones no están conectadas.');
  const { data, error } = await supabase().rpc('app_rating_summary');
  if (error) throw new Error(error.message);
  return parse(data);
}

export async function rateApp(stars: number): Promise<RatingSummary> {
  if (!isSupabaseConfigured) throw new Error('Las calificaciones no están conectadas.');
  const { data, error } = await supabase().rpc('rate_app', { p_voter: voterId(), p_stars: stars });
  if (error) throw new Error(error.message);
  write(MINE_KEY, String(stars));
  return parse(data);
}
