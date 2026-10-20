/**
 * RELAY DE VOZ PARA FISH AUDIO
 * La API de Fish Audio no admite llamadas desde el navegador (sin CORS), así que la app le pide
 * el audio a este relay del mismo dominio y el relay lo reenvía. No guarda nada: la clave llega
 * en la cabecera `x-fish-key` de cada petición (sigue viviendo solo en el navegador del usuario),
 * no se registra y solo se reenvía a api.fish.audio.
 *
 * Usa solo Request/Response/fetch estándar: lo ejecutan igual Vercel (Edge) y el servidor de Vite.
 */

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';
/** Modelos válidos según la documentación de Fish Audio; cualquier otro se cambia por el recomendado */
export const FISH_MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1', 'drama-3'];
const DEFAULT_MODEL = 's2.1-pro';
const MAX_TEXT_CHARS = 2000;
const UPSTREAM_TIMEOUT_MS = 30_000;
export const FISH_SAMPLE_RATE = 24_000;

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ status, message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function handleFishTts(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, 'Solo POST');

  // Solo la propia app: una petición desde otra web trae su Origin y se rechaza
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return json(403, 'Origen no permitido');
    } catch {
      return json(403, 'Origen no permitido');
    }
  }

  const key = req.headers.get('x-fish-key')?.trim();
  if (!key) return json(401, 'Falta la clave de Fish Audio');

  let body: { text?: unknown; model?: unknown; reference_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, 'Cuerpo JSON no válido');
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_TEXT_CHARS) return json(400, `El texto debe tener entre 1 y ${MAX_TEXT_CHARS} caracteres`);
  const model = typeof body.model === 'string' && FISH_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL;
  const referenceId =
    typeof body.reference_id === 'string' && /^[\w-]{1,64}$/.test(body.reference_id) ? body.reference_id : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(FISH_TTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model },
      body: JSON.stringify({
        text,
        reference_id: referenceId,
        format: 'pcm',
        sample_rate: FISH_SAMPLE_RATE,
        latency: 'balanced',
        language: 'es',
        normalize: true,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return json(504, 'Fish Audio no respondió');
  }

  if (!upstream.ok) {
    // Se devuelve el mismo código (401 clave, 402 sin saldo, 429 límite…) para que la app sepa si reintentar
    const detail = (await upstream.text().catch(() => '')).slice(0, 300);
    return json(upstream.status, `Fish Audio HTTP ${upstream.status}${detail ? `: ${detail}` : ''}`);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': `audio/pcm;rate=${FISH_SAMPLE_RATE}`, 'Cache-Control': 'no-store' },
  });
}
