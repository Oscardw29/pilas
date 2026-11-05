/**
 * ADJUNTOS DEL COACH (imágenes, PDF y archivos de texto)
 *
 * - Las fotos se reducen en el dispositivo (lado mayor ≤ 1600 px, JPEG) antes de enviarse: pesan poco y la IA las ve igual.
 * - Los PDF viajan tal cual (hasta 4 MB). Los archivos de texto (.txt, .csv, .md, .json…) se leen aquí y se envían como texto.
 * - En la conversación (que se sincroniza) solo se guarda el nombre, el tipo, el tamaño y una miniatura pequeña, nunca el
 *   archivo completo. El contenido se recuerda en memoria mientras la app siga abierta para poder regenerar la respuesta.
 *
 * Las funciones que arman el mensaje para cada proveedor son puras (las comprueba tests/coachAttachments.test.ts) y la función
 * del servidor `pilas-ai` repite la misma forma (no puede importar nada de la app).
 */

export type AttachmentKind = 'image' | 'pdf' | 'text';

/** Lo que se guarda en el mensaje de la conversación */
export interface StoredAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Miniatura (data URL, ≤ 160 px) para las imágenes */
  thumb?: string;
}

/** Adjunto listo para enviarse: con su contenido */
export interface CoachAttachment extends StoredAttachment {
  /** Base64 sin prefijo (imágenes y PDF) */
  data?: string;
  /** Contenido de un archivo de texto */
  text?: string;
}

export const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
/** Lo que se envía de cada archivo de texto (el resto se recorta y se avisa a la IA) */
export const MAX_TEXT_CHARS = 30_000;
const IMAGE_MAX_SIDE = 1600;
const THUMB_SIDE = 160;

const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'ics', 'html', 'htm'];

/** Para el selector de archivos */
export const ATTACHMENT_ACCEPT = ['image/*', 'application/pdf', '.pdf', ...TEXT_EXTENSIONS.map((e) => `.${e}`), 'text/plain'].join(',');

const extension = (name: string) => name.toLowerCase().split('.').pop() ?? '';

export function attachmentKind(file: { name: string; type: string }): AttachmentKind | null {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type === 'application/pdf' || extension(file.name) === 'pdf') return 'pdf';
  if (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXTENSIONS.includes(extension(file.name))) return 'text';
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.0', '')} MB`;
}

export class AttachmentError extends Error {}

const newId = () => `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new AttachmentError('No se pudo leer el archivo.'));
    reader.readAsDataURL(blob);
  });
}

async function loadImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* algunos formatos (HEIC en Safari) solo los abre <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new AttachmentError('No se pudo abrir esa imagen.');
  }
}

function drawScaled(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AttachmentError('Este dispositivo no pudo procesar la imagen.');
  // Fondo blanco: las transparencias de un PNG no se vuelven negras al pasar a JPEG
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new AttachmentError('No se pudo procesar la imagen.'))), type, quality),
  );

/** Lee un archivo elegido y lo deja listo para enviar. Lanza `AttachmentError` con un texto para el usuario */
export async function prepareAttachment(file: File): Promise<CoachAttachment> {
  const kind = attachmentKind(file);
  const name = file.name || (kind === 'image' ? 'imagen' : 'archivo');
  if (!kind) throw new AttachmentError(`«${name}» no se puede leer: adjunta imágenes, PDF o archivos de texto (.txt, .csv, .md, .json).`);

  if (kind === 'image') {
    if (file.size > MAX_IMAGE_INPUT_BYTES) throw new AttachmentError(`«${name}» pesa demasiado (máximo ${formatBytes(MAX_IMAGE_INPUT_BYTES)}).`);
    const img = await loadImage(file);
    try {
      const full = drawScaled(img.source, img.width, img.height, IMAGE_MAX_SIDE);
      const blob = await canvasBlob(full, 'image/jpeg', 0.85);
      const thumb = drawScaled(img.source, img.width, img.height, THUMB_SIDE).toDataURL('image/jpeg', 0.7);
      return { id: newId(), name, mime: 'image/jpeg', size: blob.size, kind, thumb, data: await blobToBase64(blob) };
    } finally {
      img.close();
    }
  }

  if (kind === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new AttachmentError(`«${name}» pesa demasiado (máximo ${formatBytes(MAX_PDF_BYTES)} por PDF).`);
    return { id: newId(), name, mime: 'application/pdf', size: file.size, kind, data: await blobToBase64(file) };
  }

  if (file.size > MAX_TEXT_BYTES) throw new AttachmentError(`«${name}» es demasiado largo (máximo ${formatBytes(MAX_TEXT_BYTES)}).`);
  const text = await file.text();
  return { id: newId(), name, mime: file.type || 'text/plain', size: file.size, kind, text };
}

/** Lo que se guarda en la conversación (sin el contenido) */
export const toStored = ({ id, name, mime, size, kind, thumb }: CoachAttachment): StoredAttachment => ({
  id,
  name,
  mime,
  size,
  kind,
  ...(thumb ? { thumb } : {}),
});

/* ---------------- Contenido en memoria (para regenerar) ---------------- */

const contentByMessage = new Map<string, CoachAttachment[]>();

export const rememberAttachments = (messageId: string, items: CoachAttachment[]) => {
  if (items.length) contentByMessage.set(messageId, items);
};

/** Contenido de los adjuntos de un mensaje enviado en esta sesión (tras reabrir la app ya no está) */
export const recallAttachments = (messageId: string): CoachAttachment[] => contentByMessage.get(messageId) ?? [];

/* ---------------- Mensaje para la IA ---------------- */

/** Texto de un archivo adjunto tal como lo recibe la IA */
export function textAttachmentBlock(a: Pick<CoachAttachment, 'name' | 'text'>): string {
  const full = a.text ?? '';
  const body = full.length > MAX_TEXT_CHARS ? `${full.slice(0, MAX_TEXT_CHARS)}\n[… archivo recortado: solo se envió el principio]` : full;
  return `Archivo adjunto «${a.name}»:\n"""\n${body}\n"""`;
}

/** Pregunta + archivos de texto en un solo texto */
export function promptWithTextFiles(prompt: string, attachments: readonly CoachAttachment[]): string {
  const texts = attachments.filter((a) => a.kind === 'text').map(textAttachmentBlock);
  return texts.length ? `${prompt}\n\n${texts.join('\n\n')}` : prompt;
}

/** Texto para el título automático de la conversación cuando el mensaje solo lleva archivos («rutina.csv» → «rutina») */
export const titleSeed = (items: readonly Pick<StoredAttachment, 'name'>[]) => items[0]?.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') ?? '';

/** Si el usuario solo adjuntó archivos, esta es la pregunta que se envía */
export const DEFAULT_ATTACHMENT_PROMPT = 'Revisa lo que te adjunto y dime qué te parece en relación con mis hábitos y objetivos.';

/** Línea que acompaña en el historial a un mensaje que tenía adjuntos (la IA sabe que existieron) */
export function attachmentsNote(items: readonly Pick<StoredAttachment, 'name'>[] | undefined): string {
  return items?.length ? `\n[Adjuntó: ${items.map((a) => a.name).join(', ')}]` : '';
}

/** Partes del mensaje del usuario para Gemini */
export function geminiUserParts(prompt: string, attachments: readonly CoachAttachment[]) {
  return [
    { text: promptWithTextFiles(prompt, attachments) },
    ...attachments.filter((a) => a.kind !== 'text' && a.data).map((a) => ({ inlineData: { mimeType: a.mime, data: a.data! } })),
  ];
}

/** Contenido del mensaje del usuario para las plataformas compatibles con OpenAI (texto solo si no hay archivos) */
export function openAiUserContent(prompt: string, attachments: readonly CoachAttachment[]) {
  const binary = attachments.filter((a) => a.kind !== 'text' && a.data);
  const text = promptWithTextFiles(prompt, attachments);
  if (!binary.length) return text;
  return [
    { type: 'text', text },
    ...binary.map((a) =>
      a.kind === 'image'
        ? { type: 'image_url', image_url: { url: `data:${a.mime};base64,${a.data}` } }
        : { type: 'file', file: { filename: a.name, file_data: `data:${a.mime};base64,${a.data}` } },
    ),
  ];
}
