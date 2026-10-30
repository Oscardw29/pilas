import { describe, expect, it } from 'vitest';
import voiceConfig from '../src/data/coachVoiceConfig.json';
import { GEMINI_TTS_MODEL, STYLE_PROMPT, VOICES, handle } from '../supabase/functions/pilas-ai/index';

/**
 * Función `pilas-ai`: con las claves del creador, sin dejar que salgan nunca hacia la app.
 * Supabase y los proveedores se simulan: se comprueba qué se les pide y qué vuelve a la app.
 */

const env = { url: 'https://proyecto.supabase.co', serviceKey: 'clave-de-servicio' };
const SECRET = 'clave-secreta-del-creador';

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeBackend({
  grant = { ok: true, provider: 'gemini', api_key: SECRET, model: 'modelo-a', backup_model: '', voice: '' } as Record<string, unknown>,
  provider = (_url: string, _init?: RequestInit): Response =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hola' }] } }] }), { status: 200 }),
  user = { id: 'persona-1' } as Record<string, unknown> | null,
} = {}) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return user ? new Response(JSON.stringify(user)) : new Response('{}', { status: 401 });
    if (url.endsWith('/rest/v1/rpc/ai_authorize')) return new Response(JSON.stringify(grant));
    return provider(url, init);
  }) as typeof fetch;
  return { f, calls };
}

const request = (body: unknown, token: string | null = 'token-de-sesion') =>
  new Request('https://proyecto.supabase.co/functions/v1/pilas-ai', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('función pilas-ai', () => {
  it('rechaza peticiones sin sesión válida sin tocar la clave ni al proveedor', async () => {
    const sinToken = fakeBackend();
    expect((await handle(request({ service: 'llm', prompt: 'hola' }, null), env, sinToken.f)).status).toBe(401);
    expect(sinToken.calls).toHaveLength(0);

    const invalido = fakeBackend({ user: null });
    expect((await handle(request({ service: 'llm', prompt: 'hola' }), env, invalido.f)).status).toBe(401);
    expect(invalido.calls.map((c) => c.url)).toEqual([`${env.url}/auth/v1/user`]);
  });

  it('responde con el texto y nunca devuelve la clave', async () => {
    const { f, calls } = fakeBackend();
    const res = await handle(request({ service: 'llm', prompt: 'hola', system: 'Eres Pilo', history: [{ role: 'user', text: 'antes' }] }), env, f);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ text: 'Hola' });
    expect(body).not.toContain(SECRET);

    const upstream = calls[2];
    expect(upstream.url).toContain('models/modelo-a:generateContent');
    expect((upstream.init?.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
    // El uso se autoriza para la persona de la sesión, no para lo que diga el cuerpo
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ p_user: 'persona-1', p_service: 'llm' });
  });

  it('el límite diario, el veto y la falta de clave no llegan al proveedor', async () => {
    for (const [grant, status, error] of [
      [{ ok: false, reason: 'quota', limit: 40 }, 429, 'quota'],
      [{ ok: false, reason: 'banned' }, 403, 'banned'],
      [{ ok: false, reason: 'unconfigured' }, 404, 'unconfigured'],
    ] as const) {
      const { f, calls } = fakeBackend({ grant });
      const res = await handle(request({ service: 'llm', prompt: 'hola' }), env, f);
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBe(error);
      expect(calls).toHaveLength(2);
    }
  });

  it('prueba el modelo de respaldo si falla el principal', async () => {
    const asked: string[] = [];
    const { f } = fakeBackend({
      grant: { ok: true, provider: 'openai', api_key: SECRET, model: 'principal', backup_model: 'respaldo', voice: '' },
      provider: (_url, init) => {
        const model = JSON.parse(String(init?.body)).model as string;
        asked.push(model);
        if (model === 'principal') return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Respuesta' } }] }));
      },
    });
    const res = await handle(request({ service: 'llm', prompt: 'hola' }), env, f);
    expect(await res.json()).toEqual({ text: 'Respuesta', backup: true });
    expect(asked).toEqual(['principal', 'respaldo']);
  });

  it('un error del proveedor devuelve solo su código, no su mensaje', async () => {
    const { f } = fakeBackend({ provider: () => new Response(JSON.stringify({ error: { message: `Clave ${SECRET} no válida` } }), { status: 401 }) });
    const res = await handle(request({ service: 'llm', prompt: 'hola' }), env, f);
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(body)).toEqual({ error: 'provider', status: 401 });
    expect(body).not.toContain(SECRET);
  });

  it('la voz devuelve el audio con su formato y usa la voz del personaje', async () => {
    const { f, calls } = fakeBackend({
      grant: { ok: true, provider: 'fish_audio', api_key: SECRET, model: '', backup_model: '', voice: '' },
      provider: () => new Response(new Uint8Array([1, 2, 3, 4])),
    });
    const res = await handle(request({ service: 'tts', text: 'Hola', gender: 'female' }), env, f);
    expect(res.headers.get('Content-Type')).toBe('audio/pcm;rate=24000');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(JSON.parse(String(calls[2].init?.body)).reference_id).toBe(VOICES.fish_audio.female);
  });

  it('valida la petición antes de gastar un uso', async () => {
    for (const body of ['no es json', { service: 'otro' }, { service: 'llm', prompt: '  ' }, { service: 'tts', text: '' }, { service: 'stt' }]) {
      const { f, calls } = fakeBackend();
      expect((await handle(request(body), env, f)).status).toBe(400);
      expect(calls).toHaveLength(1);
    }
  });

  it('usa la misma voz que la app con clave propia', () => {
    expect(VOICES.gemini).toEqual(voiceConfig.geminiVoices);
    expect(STYLE_PROMPT).toBe(voiceConfig.stylePrompt);
    expect(voiceConfig.geminiTtsModels).toContain(GEMINI_TTS_MODEL);
  });
});
