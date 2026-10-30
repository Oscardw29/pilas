/**
 * IMÁGENES DE LA CAPA PÚBLICA (todo en el dispositivo)
 * - Solo WebP (estático o animado), como pide el plan. Lo comprueba el servidor (bucket) y aquí, por los bytes.
 * - Para los WebP animados se genera un fotograma fijo: es lo que se ve en tamaños pequeños y fuera de pantalla.
 * - `muxAnimatedWebp` arma un WebP animado a partir de fotogramas WebP (para las muestras del creador).
 */

const ascii = (b: Uint8Array, at: number, len = 4) => String.fromCharCode(...b.subarray(at, at + len));
// Sin signo: un tamaño ≥ 2 GB (archivo dañado) haría retroceder el recorrido de los bloques
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export async function readBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** ¿Es un WebP de verdad? (cabecera RIFF…WEBP, no solo la extensión) */
export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length > 16 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WEBP';
}

/** ¿WebP animado? (bit de animación en VP8X o un bloque ANIM) */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (!isWebp(bytes)) return false;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = ascii(bytes, at);
    const size = u32(bytes, at + 4);
    if (id === 'VP8X' && (bytes[at + 8] & 0x02) !== 0) return true;
    if (id === 'ANIM' || id === 'ANMF') return true;
    at += 8 + size + (size & 1);
  }
  return false;
}

export function canvasToWebp(canvas: HTMLCanvasElement, quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        if (b && b.type === 'image/webp') resolve(b);
        else reject(new Error('Este dispositivo no puede crear imágenes WebP.'));
      },
      'image/webp',
      quality,
    ),
  );
}

/** Fotograma fijo (el primero) de una imagen, reducido a `maxSide` píxeles por lado */
export async function stillFrame(blob: Blob, maxSide = 256): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvasToWebp(canvas, 0.85);
}

/** Foto de perfil: recorte cuadrado centrado, 256×256, WebP */
export async function photoToWebp(file: Blob, size = 256): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  if (file.size > 15 * 1024 * 1024) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('No se pudo leer la imagen.');
  });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return canvasToWebp(canvas, 0.85);
}

/** data URL → Blob sin `fetch` (el CSP no permite `data:` en connect-src) */
export async function dataUrlToBlob(url: string): Promise<Blob> {
  const [head, body = ''] = url.split(',', 2);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (!head.includes(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Comprueba un archivo del catálogo: WebP real y ≤ 2 MB. Devuelve si es animado */
export async function checkCatalogFile(file: Blob, maxBytes = 2 * 1024 * 1024): Promise<{ animated: boolean }> {
  if (file.size > maxBytes) throw new Error(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB (máximo ${maxBytes / 1024 / 1024} MB).`);
  const bytes = await readBytes(file);
  if (!isWebp(bytes)) throw new Error('Solo se aceptan imágenes WebP (estáticas o animadas).');
  return { animated: isAnimatedWebp(bytes) };
}

/* ---------------- WebP animado a partir de fotogramas ---------------- */

interface Chunk {
  id: string;
  data: Uint8Array;
}

function chunksOf(bytes: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = u32(bytes, at + 4);
    out.push({ id: ascii(bytes, at), data: bytes.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size & 1);
  }
  return out;
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Une fotogramas WebP del mismo tamaño en un WebP animado que se repite sin fin.
 * Cada fotograma conserva su compresión (solo se copian sus bloques ALPH / VP8 / VP8L).
 */
export async function muxAnimatedWebp(frames: Blob[], width: number, height: number, frameMs: number): Promise<Blob> {
  const anmf: Uint8Array[] = [];
  let alpha = false;
  for (const f of frames) {
    const parts = chunksOf(await readBytes(f)).filter((c) => c.id === 'ALPH' || c.id === 'VP8 ' || c.id === 'VP8L');
    if (parts.some((c) => c.id === 'ALPH' || c.id === 'VP8L')) alpha = true;
    const header = new Uint8Array([...u24(0), ...u24(0), ...u24(width - 1), ...u24(height - 1), ...u24(frameMs), 0x02]);
    anmf.push(chunk('ANMF', concat([header, ...parts.map((c) => chunk(c.id, c.data))])));
  }
  const vp8x = chunk('VP8X', new Uint8Array([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]));
  const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 0, 0, 0]));
  const body = concat([new TextEncoder().encode('WEBP'), vp8x, anim, ...anmf]);
  const riff = new Uint8Array(8);
  riff.set(new TextEncoder().encode('RIFF'));
  new DataView(riff.buffer).setUint32(4, body.length, true);
  return new Blob([concat([riff, body]) as BlobPart], { type: 'image/webp' });
}
