/**
 * IA DE LA APP (función de Supabase `pilas-ai`)
 * Atiende el chat, la voz y el dictado con las claves que el creador puso en su panel. La clave se queda aquí, en el
 * servidor: la app solo recibe el texto o el audio. Cada petición comprueba la sesión y descuenta un uso diario
 * (`ai_authorize`, migración 0004). No se guarda ni se registra nada de lo que se envía.
 *
 * Para desplegarla: Supabase → Edge Functions → Deploy a new function → nombre `pilas-ai` → pegar este archivo (ver
 * docs/supabase.md). No usa dependencias: solo `fetch` y las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, que
 * Supabase ya le da a toda función.
 */

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

const LLM_TIMEOUT_MS = 40_000;
const TTS_TIMEOUT_MS = 30_000;
const STT_TIMEOUT_MS = 30_000;
/** Topes de lo que acepta cada petición: el chat cabe de sobra y evita usar la función como una IA de propósito general */
const MAX_BODY_CHARS = 2_500_000;
const MAX_SYSTEM_CHARS = 30_000;
const MAX_PROMPT_CHARS = 8_000;
const MAX_HISTORY_TURNS = 6;
const MAX_TTS_CHARS = 700;
const MAX_AUDIO_BASE64_CHARS = 2_000_000;

/** Misma voz que la app con clave propia (src/lib/coachVoice.ts y src/data/coachVoiceConfig.json; lo comprueba tests/appAi.function.test.ts) */
export const VOICES = {
  gemini: { male: 'Puck', female: 'Zephyr' },
  openai: { male: 'ash', female: 'coral' },
  elevenlabs: { male: 'ErXwobaYiN019PkySvjV', female: 'EXAVITQu4vr4xnSDxMaL' },
  fish_audio: { male: 'ec0718028a2445fb9be8e8bfb56a0150', female: '35929683c49c4ec0bf779dc07d22620b' },
};
export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const STYLE_PROMPT = 'Lee en español latino, con voz cálida y enérgica de entrenador personal que anima sin exagerar';
const DEFAULT_MODELS: Record<string, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  groq: 'llama-3.1-8b-instant',
  openrouter: 'google/gemini-2.5-flash-lite',
};
const OPENAI_COMPATIBLE: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};
const FISH_MODELS = ['s2.1-pro', 's2.1-pro-free', 's2-pro', 's1', 'drama-3'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** El proveedor respondió con error: solo se devuelve su código (su mensaje podría citar parte de la clave) */
class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

interface ServiceConfig {
  provider: string;
  api_key: string;
  model: string;
  backup_model: string;
  voice: string;
}

type Turn = { role: 'user' | 'model'; text: string };

/* ---------------- Proveedores ---------------- */

async function complete(cfg: ServiceConfig, model: string, system: string, history: Turn[], prompt: string, temperature: number, f: typeof fetch): Promise<string> {
  if (cfg.provider === 'gemini') {
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.api_key },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: [...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })), { role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) throw new UpstreamError(res.status);
    const body = await res.json();
    const parts: { text?: string }[] = body.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (!text) throw new UpstreamError(502);
    return text;
  }

  const res = await f(OPENAI_COMPATIBLE[cfg.provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api_key}`,
      ...(cfg.provider === 'openrouter' ? { 'X-Title': 'Pilas' } : {}),
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...history.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) throw new UpstreamError(res.status);
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new UpstreamError(502);
  return text;
}

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function synthesize(cfg: ServiceConfig, text: string, gender: 'male' | 'female', f: typeof fetch): Promise<{ data: BodyInit; mime: string }> {
  const signal = AbortSignal.timeout(TTS_TIMEOUT_MS);
  const voice = cfg.voice || VOICES[cfg.provider as keyof typeof VOICES]?.[gender] || '';

  if (cfg.provider === 'gemini') {
    const model = cfg.model || GEMINI_TTS_MODEL;
    const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.api_key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${STYLE_PROMPT}: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
      signal,
    });
    if (!res.ok) throw new UpstreamError(res.status);
    const body = await res.json();
    const parts: { inlineData?: { data?: string; mimeType?: string } }[] = body.candidates?.[0]?.content?.parts ?? [];
    const audio = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new UpstreamError(502);
    return { data: base64ToBytes(audio.data), mime: audio.mimeType || 'audio/pcm;rate=24000' };
  }

  if (cfg.provider === 'openai') {
    const model = cfg.model || 'gpt-4o-mini-tts';
    const res = await f('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        ...(model.startsWith('gpt-4o') ? { instructions: STYLE_PROMPT } : {}),
        response_format: 'pcm',
      }),
      signal,
    });
    if (!res.ok) throw new UpstreamError(res.status);
    return { data: await res.arrayBuffer(), mime: 'audio/pcm;rate=24000' };
  }

  if (cfg.provider === 'elevenlabs') {
    const model = cfg.model.startsWith('eleven_') ? cfg.model : 'eleven_multilingual_v2';
    const res = await f(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': cfg.api_key },
      body: JSON.stringify({ text, model_id: model, language_code: model.includes('v2_5') ? 'es' : undefined }),
      signal,
    });
    if (!res.ok) throw new UpstreamError(res.status);
    return { data: await res.arrayBuffer(), mime: 'audio/pcm;rate=24000' };
  }

  // Fish Audio
  const model = FISH_MODELS.includes(cfg.model) ? cfg.model : 's2.1-pro';
  const res = await f('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json', model },
    body: JSON.stringify({ text, reference_id: voice, format: 'pcm', sample_rate: 24_000, latency: 'balanced', language: 'es', normalize: true }),
    signal,
  });
  if (!res.ok) throw new UpstreamError(res.status);
  return { data: await res.arrayBuffer(), mime: 'audio/pcm;rate=24000' };
}

async function transcribe(cfg: ServiceConfig, audioBase64: string, mime: string, f: typeof fetch): Promise<string> {
  const res = await f(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(cfg.model || 'nova-3')}&language=es&smart_format=true`, {
    method: 'POST',
    headers: { Authorization: `Token ${cfg.api_key}`, 'Content-Type': mime },
    body: base64ToBytes(audioBase64),
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  if (!res.ok) throw new UpstreamError(res.status);
  const body = await res.json();
  return body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
}

/* ---------------- Petición ---------------- */

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function readHistory(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(-MAX_HISTORY_TURNS)
    .filter((t) => t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string')
    .map((t) => ({ role: t.role, text: str(t.text, MAX_PROMPT_CHARS) }));
}

export async function handle(req: Request, env: { url: string; serviceKey: string }, f: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  // Sesión: solo personas con cuenta (Supabase valida el token)
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'auth' }, 401);
  const who = await f(`${env.url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.serviceKey } });
  if (!who.ok) return json({ error: 'auth' }, 401);
  const uid = ((await who.json()) as { id?: string }).id;
  if (!uid) return json({ error: 'auth' }, 401);

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: 'too_large' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const service = body.service;
  if (service !== 'llm' && service !== 'tts' && service !== 'stt') return json({ error: 'bad_request' }, 400);
  const prompt = str(body.prompt, MAX_PROMPT_CHARS).trim();
  const text = str(body.text, MAX_TTS_CHARS).trim();
  const audio = str(body.audio, MAX_AUDIO_BASE64_CHARS + 1);
  if (service === 'llm' && !prompt) return json({ error: 'bad_request' }, 400);
  if (service === 'tts' && !text) return json({ error: 'bad_request' }, 400);
  if (service === 'stt' && (!audio || audio.length > MAX_AUDIO_BASE64_CHARS)) return json({ error: 'bad_request' }, 400);

  // Autoriza y descuenta el uso. Es lo único que entrega la clave, y solo a esta función
  const auth = await f(`${env.url}/rest/v1/rpc/ai_authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` },
    body: JSON.stringify({ p_user: uid, p_service: service }),
  });
  if (!auth.ok) return json({ error: 'server' }, 500);
  const grant = (await auth.json()) as ({ ok: true } & ServiceConfig) | { ok: false; reason: string; limit?: number };
  if (!grant.ok) {
    const status = grant.reason === 'quota' ? 429 : grant.reason === 'banned' ? 403 : 404;
    return json({ error: grant.reason, limit: grant.limit }, status);
  }

  try {
    if (service === 'llm') {
      const system = str(body.system, MAX_SYSTEM_CHARS);
      const history = readHistory(body.history);
      const temperature = Math.min(1, Math.max(0, Number(body.temperature ?? 0.7) || 0));
      const primary = grant.model || DEFAULT_MODELS[grant.provider];
      try {
        return json({ text: await complete(grant, primary, system, history, prompt, temperature, f) });
      } catch (err) {
        const backup = grant.backup_model;
        if (!backup || backup === primary) throw err;
        return json({ text: await complete(grant, backup, system, history, prompt, temperature, f), backup: true });
      }
    }
    if (service === 'tts') {
      const gender = body.gender === 'female' ? 'female' : 'male';
      const { data, mime } = await synthesize(grant, text, gender, f);
      return new Response(data, { headers: { ...CORS, 'Content-Type': mime, 'Cache-Control': 'no-store' } });
    }
    return json({ text: await transcribe(grant, audio, str(body.mime, 60) || 'audio/webm', f) });
  } catch (err) {
    if (err instanceof UpstreamError) return json({ error: 'provider', status: err.status }, 502);
    return json({ error: 'provider', status: 504 }, 502);
  }
}

// Fuera de Deno (las pruebas) no hay servidor que arrancar
if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handle(req, { url: Deno.env.get('SUPABASE_URL') ?? '', serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' }));
}
