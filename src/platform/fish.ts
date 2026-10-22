import { isNativeApp, platformFetch } from './index';

/**
 * Síntesis de Fish Audio. Su API no admite CORS:
 * - web/PWA → relay del mismo dominio (`/api/fish-tts`, ver api/_fishRelay.ts);
 * - Android / Tauri → directo a Fish Audio con el fetch nativo, con la misma petición que hace el relay.
 * En ambos casos la respuesta es PCM 16 bits a 24 kHz.
 */

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts';
const SAMPLE_RATE = 24_000;
const DEFAULT_MODEL = 's2.1-pro';

export interface FishRequest {
  text: string;
  model?: string;
  reference_id?: string;
}

export async function fishTts(key: string, req: FishRequest, timeoutMs: number): Promise<Response> {
  if (!isNativeApp) {
    return fetch('/api/fish-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fish-key': key },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  const res = await platformFetch(FISH_TTS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: req.model || DEFAULT_MODEL },
    body: JSON.stringify({
      text: req.text,
      reference_id: req.reference_id,
      format: 'pcm',
      sample_rate: SAMPLE_RATE,
      latency: 'balanced',
      language: 'es',
      normalize: true,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return res;
  return new Response(await res.arrayBuffer(), { status: 200, headers: { 'Content-Type': `audio/pcm;rate=${SAMPLE_RATE}` } });
}
