/**
 * TEXTO PARA VOZ
 * - `toSpeechText`: convierte una respuesta (markdown, emojis, símbolos) en frases que suenan naturales al leerse.
 *   El sintetizador nunca debe decir «asterisco», «paréntesis», «comillas» ni el nombre de un emoji.
 * - `isLikelyEcho` / `detectBargeIn`: distinguen la voz del usuario del eco del propio asistente en los altavoces.
 */

// Fin de palabra con lookahead Unicode: \b de JS solo conoce ASCII y cortaría «días» en «d|ías»
const ABBREVIATIONS: [RegExp, string][] = [
  [/(\d)\s?mins?(?![\p{L}\d])\.?/giu, '$1 minutos'],
  [/(\d)\s?(?:h|hrs?)(?![\p{L}\d])\.?/giu, '$1 horas'],
  [/(\d)\s?seg(?![\p{L}\d])\.?/giu, '$1 segundos'],
  [/(\d)\s?d(?![\p{L}\d])\.?/giu, '$1 días'],
  [/(\d)\s?km(?![\p{L}\d])\.?/giu, '$1 kilómetros'],
  [/(\d)\s?kg(?![\p{L}\d])\.?/giu, '$1 kilos'],
  [/(^|[^\p{L}])pts?(?![\p{L}\d])\.?/giu, '$1puntos'],
  [/(^|[^\p{L}])prom\.\s?/giu, '$1promedio '],
  [/(^|[^\p{L}])aprox\.\s?/giu, '$1aproximadamente '],
  [/(^|[^\p{L}])p\.\s?ej\.\s?/giu, '$1por ejemplo '],
  [/(^|[^\p{L}])etc(?![\p{L}])\.?/giu, '$1etcétera'],
  [/(^|[^\p{L}])vs\.?\s/giu, '$1frente a '],
];

/** Pictogramas, banderas, selectores de variación, unión de emojis y teclas numéricas */
const EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\u{20E3})/gu;

/**
 * Limpia una respuesta para leerla en voz alta. Es idempotente: aplicarla dos veces da el mismo resultado.
 */
export function toSpeechText(input: string): string {
  let t = input ?? '';

  // Bloques de acción y de código: nunca se leen
  t = t.replace(/```action[\s\S]*?```/gi, ' ');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  // Notas técnicas añadidas por el cliente de IA, p. ej. «*(⚡ Nota: el modelo principal…)*» o «(Tip: configura tu clave…)»
  t = t.replace(/\*?\(\s*[^()]{0,4}\s*(?:nota|tip)\s*:[^)]*\)\*?/gi, ' ');

  // Enlaces e imágenes en markdown → solo el texto; URLs sueltas fuera
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\bhttps?:\/\/\S+/gi, ' ');
  t = t.replace(/\bwww\.\S+/gi, ' ');

  // Estructura markdown: encabezados, citas, separadores, tablas y viñetas pasan a ser pausas
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, ' ');
  t = t.replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, ' ');
  t = t.replace(/\s*\|\s*/g, ', ');
  t = t.replace(/^\s*(?:[-*+•·▪►]|\d{1,2}[.)])\s+/gm, '');

  // Énfasis y código en línea: se conserva el contenido
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2');
  t = t.replace(/(^|[^\w*])[*_](?!\s)(.+?)(?<!\s)[*_](?![\w*])/g, '$1$2');

  t = t.replace(EMOJI, ' ');

  // Paréntesis y corchetes → pausas con comas (nunca «abre paréntesis»)
  t = t.replace(/\s*[([{]\s*/g, ', ');
  t = t.replace(/\s*[)\]}]\s*/g, ', ');
  // Comillas de cualquier tipo: fuera
  t = t.replace(/[«»"“”„‟‹›]/g, '');
  t = t.replace(/(^|[\s,.;:¿¡])['‘’`´]+|['‘’`´]+(?=[\s,.;:!?]|$)/g, '$1');

  // Símbolos que se leen mal → palabras o pausas
  t = t.replace(/(\d)\s*%/g, '$1 por ciento');
  t = t.replace(/(\d)\s*\/\s*(\d)/g, '$1 de $2');
  t = t.replace(/\s*\/\s*(d[ií]a|mes)(?![\p{L}])/giu, ' al $1');
  t = t.replace(/\s*\/\s*(semana|hora)(?![\p{L}])/giu, ' a la $1');
  t = t.replace(/(\d)\s*[-–]\s*(\d)/g, '$1 a $2');
  t = t.replace(/(\d)\s*[x×]\s*(\d)/gi, '$1 por $2');
  t = t.replace(/(\d)\s*°/g, '$1 grados');
  t = t.replace(/\s*(?:->|=>|→|⇒|➜|➔)\s*/g, ', ');
  t = t.replace(/\s*(?:<-|←)\s*/g, ', ');
  t = t.replace(/\s*&\s*/g, ' y ');
  t = t.replace(/\s\+\s/g, ' más ');
  t = t.replace(/~\s*(\d)/g, 'unos $1');
  t = t.replace(/\s*[=≈]\s*/g, ' es ');
  t = t.replace(/\s*\/\s*/g, ' o ');
  t = t.replace(/[*_#~^<>\\|@$]/g, ' ');
  t = t.replace(/\s[-–—]\s/g, ', ');
  t = t.replace(/;/g, ',');
  t = t.replace(/…/g, '...');

  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);

  // Saltos de línea → fin de frase cuando la línea no termina en puntuación
  t = t
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/[.!?:,]$/.test(line) ? line : `${line}.`))
    .join(' ');

  // Limpieza de puntuación repetida y espacios
  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.replace(/([¿¡])\s+/g, '$1');
  t = t.replace(/,(\s*,)+/g, ',');
  t = t.replace(/,\s*([.!?:])/g, '$1');
  t = t.replace(/([.!?])\s*,/g, '$1');
  t = t.replace(/:\s*\./g, '.');
  t = t.replace(/\.{4,}/g, '...');
  t = t.replace(/(^|[^.])\.\.(?!\.)/g, '$1.');
  t = t.replace(/(^|\s)[,.;:]+(?=\s|$)/g, '$1');
  t = t.replace(/\s{2,}/g, ' ');
  t = t.replace(/^[\s,.;:]+/, '');
  return t.trim();
}

/** Minúsculas, sin tildes ni puntuación: para comparar palabras dichas con palabras oídas */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Palabras con las que el usuario suele cortar al asistente: rara vez aparecen en sus respuestas */
const INTERJECTIONS = new Set(['espera', 'esperate', 'alto', 'basta', 'detente', 'para', 'parale', 'silencio', 'callate', 'stop', 'oye', 'momento', 'ya']);

/** ¿Lo que oyó el micrófono es, sobre todo, el propio asistente sonando en los altavoces? */
export function isLikelyEcho(heard: string, spoken: string): boolean {
  const heardWords = normalizeWords(heard);
  if (heardWords.length === 0) return true;
  const spokenSet = new Set(normalizeWords(spoken));
  const echoed = heardWords.filter((w) => spokenSet.has(w)).length;
  return echoed / heardWords.length >= 0.6;
}

/**
 * Decide si el usuario está interrumpiendo mientras el asistente habla:
 * - al menos dos palabras que el asistente no está diciendo, o
 * - una interjección clara («espera», «para», «basta»…) que no forma parte de lo que dice el asistente.
 */
export function detectBargeIn(heard: string, spoken: string): boolean {
  const heardWords = normalizeWords(heard);
  if (heardWords.length === 0) return false;
  const spokenSet = new Set(normalizeWords(spoken));
  const foreign = heardWords.filter((w) => w.length > 1 && !spokenSet.has(w));
  if (foreign.length >= 2 && !isLikelyEcho(heard, spoken)) return true;
  return heardWords.some((w) => INTERJECTIONS.has(w) && !spokenSet.has(w));
}

const ACCEPT_RE = /^(si|sip|claro|dale|hazlo|hagalo|acepto|aceptar|aceptalo|de acuerdo|listo|ok|okay|okey|confirmo|confirmar|confirmalo|adelante|perfecto|va|vale|me parece bien|aplica|aplicalo|por favor)\b/;
const REJECT_RE = /^(no|nop|rechazo|rechazar|rechazalo|cancela|cancelar|cancelalo|mejor no|olvidalo|descarta|descartar|descartalo|ni hablar)\b/;

/** Palabras que convierten un «sí» en una contrapropuesta («sí, pero a las siete») */
const AMENDMENT_WORDS = new Set(['pero', 'mejor', 'cambia', 'cambialo', 'aunque', 'excepto', 'menos', 'mas']);

/**
 * Respuesta corta a «¿aplico este cambio?»:
 * - 'accept' solo para un sí breve y sin matices,
 * - 'reject' para un no (si trae más palabras, quien llama puede reenviarlas al asistente),
 * - null si es otra cosa.
 */
export function classifyConfirmation(text: string): 'accept' | 'reject' | null {
  const words = normalizeWords(text);
  if (words.length === 0 || words.length > 8) return null;
  const phrase = words.join(' ');
  if (REJECT_RE.test(phrase)) return 'reject';
  if (words.length <= 5 && ACCEPT_RE.test(phrase) && !words.some((w) => AMENDMENT_WORDS.has(w) || w === 'no')) return 'accept';
  return null;
}
