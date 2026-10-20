/**
 * ETIQUETAS DE EXPRESIÓN PARA LA VOZ
 * Con una voz que las interpreta (Fish Audio S2), el modelo de chat intercala etiquetas como
 * [excited] o [chuckling] para que la lectura tenga tono y no suene plana. Son solo para la voz:
 * el texto del chat, lo que se copia y cualquier otra voz las reciben ya quitadas.
 */

/** Tono emocional: afecta a la frase que sigue */
const TONE_TAGS = ['angry', 'sad', 'embarrassed', 'emphasis', 'whispering', 'soft', 'breathy', 'excited'];
/** Efectos de audio */
const EFFECT_TAGS = [
  'laughing', 'chuckling', 'moaning', 'clear throat', 'sobbing', 'crying loudly', 'sighing', 'panting',
  'groaning', 'crowd laughing', 'background laughter', 'audience laughing', 'pause', 'long pause',
];
const ALL_TAGS = [...TONE_TAGS, ...EFFECT_TAGS];

/** Las que se le sugieren al coach: sin las que no pegan con un entrenador (gemidos, llanto, público) */
const SUGGESTED_TONE = ['excited', 'emphasis', 'soft', 'whispering', 'breathy', 'sad', 'embarrassed', 'angry'];
const SUGGESTED_EFFECTS = ['chuckling', 'laughing', 'sighing', 'clear throat', 'pause', 'long pause'];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Una etiqueta conocida, sin distinguir mayúsculas */
const TAG = `\\[(?:${ALL_TAGS.map(escape).join('|')})\\]`;
/** Al principio de una línea (se conserva la sangría de listas) junto con el espacio que la sigue */
const LINE_START_TAG_RE = new RegExp(`^([ \\t]*(?:[-*+]|\\d+[.)])?[ \\t]*)${TAG}[ \\t]*`, 'gim');
const TAG_RE = new RegExp(TAG, 'gi');
/** Etiqueta a medio escribir al final (la animación de escritura muestra el texto por palabras) */
const PARTIAL_TAG_RE = /\[[a-z ]*$/i;

/** Quita las etiquetas de voz del texto (chat, copiar, voces que no las interpretan) */
export function stripVoiceTags(text: string): string {
  let out = text;
  if (TAG_RE.test(out)) {
    TAG_RE.lastIndex = 0;
    out = out
      .replace(LINE_START_TAG_RE, '$1')
      .replace(TAG_RE, '')
      // Espacios dobles o finales que dejan las etiquetas quitadas a mitad de frase
      .replace(/(\S)[ \t]{2,}(?=\S)/g, '$1 ')
      .replace(/[ \t]+$/gm, '');
  }
  TAG_RE.lastIndex = 0;
  const partial = out.match(PARTIAL_TAG_RE);
  if (partial) {
    const typed = partial[0].slice(1).toLowerCase();
    if (ALL_TAGS.some((t) => t.startsWith(typed))) out = out.slice(0, partial.index).trimEnd();
  }
  return out;
}

/** Instrucción que se añade al prompt del coach cuando su voz interpreta las etiquetas */
export const VOICE_TAGS_PROMPT = `VOZ EXPRESIVA (tu respuesta se lee en voz alta con una voz que interpreta etiquetas):
- Intercala de 1 a 4 etiquetas entre corchetes justo antes de la frase o palabra a la que afectan, para dar emoción y ritmo.
- Tono: ${SUGGESTED_TONE.map((t) => `[${t}]`).join(' ')}. Efectos: ${SUGGESTED_EFFECTS.map((t) => `[${t}]`).join(' ')}.
- Que encajen con lo que dices: [excited] al celebrar una racha o un logro, [soft] al hablar de un fallo o de cansancio, [emphasis] en el dato clave, [chuckling] ante algo gracioso, [pause] antes de una pregunta importante.
- Escríbelas exactamente así, en inglés y minúsculas. Nunca dentro de tablas, de listas de datos ni del bloque \`\`\`action.
- No las expliques ni las menciones: el usuario no las ve en el chat.`;
