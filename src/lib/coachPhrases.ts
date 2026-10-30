import catalog from '@/data/coachPhrases.json';
import type { CoachGender } from '@/components/coach/coachPersona';

/**
 * FRASES FIJAS DEL COACH
 * El catálogo (src/data/coachPhrases.json) guarda cada frase con un id estable y, si el texto cambia según
 * el personaje, una variante para Pilo y otra para Pila. Lo usan el motor de respuestas local (lib/coachLocal)
 * y los textos por defecto del chat (bienvenidas, prueba de voz de Ajustes).
 *
 * Esas frases tienen voz aunque no haya clave de TTS: scripts/generate-coach-voice.mjs las graba con la voz
 * original del coach (public/coach-voice) y lib/coachVoice reproduce el audio cuando una línea del mensaje
 * coincide con el texto grabado. Por eso cada frase va sola en su línea y sin markdown ni emojis.
 *
 * Las frases de un mismo grupo (el id sin su último tramo: «saludo.apertura.2» → «saludo.apertura»)
 * son variaciones intercambiables: `pickPhrase` elige una distinta a las últimas para no repetirse.
 */

export interface CoachPhrase {
  id: string;
  /** Mismo texto para los dos personajes */
  text?: string;
  /** Variante de Pilo (entrenador) */
  pilo?: string;
  /** Variante de Pila (entrenadora) */
  pila?: string;
}

export const COACH_PHRASES: readonly CoachPhrase[] = (catalog as { phrases: CoachPhrase[] }).phrases;

const BY_ID = new Map(COACH_PHRASES.map((p) => [p.id, p]));

/** «saludo.apertura.2» → «saludo.apertura» */
export const phraseGroup = (id: string) => id.slice(0, id.lastIndexOf('.'));

const GROUPS = new Map<string, string[]>();
for (const p of COACH_PHRASES) {
  const g = phraseGroup(p.id);
  GROUPS.set(g, [...(GROUPS.get(g) ?? []), p.id]);
}

/** Texto exacto de una frase para el personaje indicado ('' si el id no existe) */
export function phraseText(id: string, gender: CoachGender): string {
  const p = BY_ID.get(id);
  if (!p) {
    if (import.meta.env.DEV) console.warn(`[coachPhrases] Frase desconocida: ${id}`);
    return '';
  }
  return (gender === 'female' ? p.pila : p.pilo) ?? p.text ?? '';
}

/** Ids de las últimas frases usadas por grupo: la siguiente elección evita repetirlas */
const recent = new Map<string, string[]>();

/** Una variación al azar del grupo, distinta de las usadas hace poco */
export function pickPhrase(group: string, gender: CoachGender): string {
  const ids = GROUPS.get(group);
  if (!ids?.length) {
    if (import.meta.env.DEV) console.warn(`[coachPhrases] Grupo sin frases: ${group}`);
    return '';
  }
  const last = recent.get(group) ?? [];
  const fresh = ids.filter((id) => !last.includes(id));
  const pool = fresh.length ? fresh : ids;
  const id = pool[Math.floor(Math.random() * pool.length)];
  // Recuerda la mitad del grupo: con 4 variaciones no se repite ninguna de las 2 últimas
  recent.set(group, [...last, id].slice(-Math.max(1, Math.floor(ids.length / 2))));
  return phraseText(id, gender);
}

/** ¿Existe el grupo? (para intenciones con variaciones opcionales, como el saludo según la hora) */
export const hasPhraseGroup = (group: string) => GROUPS.has(group);
