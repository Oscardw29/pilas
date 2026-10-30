import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyData } from '@/data/seed';
import { AppAiError, useAppAi } from '@/lib/appAi';
import { resolveCoachVoice, voiceTagsEnabled } from '@/lib/coachVoice';
import { generateHabitAdvice } from '@/lib/gemini';
import { emptySecrets } from '@/store/useSecrets';

vi.mock('@/sync/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } }),
}));

/** Qué usa el coach según haya clave propia, IA de la app o ninguna de las dos */

const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proyecto.supabase.co');
  useAppAi.setState({ status: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('respuestas del coach sin clave propia', () => {
  it('sin IA de la app responde el motor local sin llamar a nadie', async () => {
    const f = respond(200, {});
    vi.stubGlobal('fetch', f);
    const reply = await generateHabitAdvice(createEmptyData(), '¿Qué hago ahora mismo?');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toMatch(/clave de IA|Nota:/);
    expect(f).not.toHaveBeenCalled();
  });

  it('con IA de la app se la pide a la función, sin ninguna clave en la petición', async () => {
    useAppAi.setState({ status: { llm: { provider: 'gemini', model: 'modelo' } } });
    const f = respond(200, { text: 'Respuesta de la IA' });
    vi.stubGlobal('fetch', f);
    expect(await generateHabitAdvice(createEmptyData(), 'Hola')).toBe('Respuesta de la IA');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proyecto.supabase.co/functions/v1/pilas-ai');
    expect(JSON.parse(String(init.body))).toMatchObject({ service: 'llm', prompt: 'Hola' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
  });

  it('si se acaba el cupo del día contesta el motor local y lo explica', async () => {
    useAppAi.setState({ status: { llm: { provider: 'gemini' } } });
    vi.stubGlobal('fetch', respond(429, { error: 'quota', limit: 40 }));
    expect(await generateHabitAdvice(createEmptyData(), 'Hola')).toMatch(/límite diario/);
  });

  it('si la función no está desplegada contesta el motor local', async () => {
    useAppAi.setState({ status: { llm: { provider: 'gemini' } } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await generateHabitAdvice(createEmptyData(), 'Hola')).toMatch(/no respondió/);
  });
});

describe('voz del coach', () => {
  const settings = { ttsPlatform: 'fish_audio', ttsModel: '', ttsVoiceId: '', aiPlatform: 'gemini' } as const;
  const appTts = { provider: 'gemini', model: '' };

  it('una clave propia manda sobre la voz de la app', () => {
    expect(resolveCoachVoice(settings, { ...emptySecrets(), fishAudioApiKey: 'clave-propia-larga' }, appTts).provider?.kind).toBe('fish');
  });

  it('sin clave propia usa la voz de la app, y sin ella no hay voz', () => {
    expect(resolveCoachVoice(settings, emptySecrets(), appTts).provider?.kind).toBe('app');
    expect(resolveCoachVoice(settings, emptySecrets(), undefined).provider).toBeNull();
  });

  it('respeta a quien eligió «sin voz» en Ajustes', () => {
    expect(resolveCoachVoice({ ...settings, ttsPlatform: 'native' }, emptySecrets(), appTts).provider).toBeNull();
  });

  it('solo pide etiquetas de expresión si la voz de la app las interpreta', () => {
    expect(voiceTagsEnabled({ provider: { kind: 'app', via: 'fish_audio', model: 's2.1-pro' }, label: '' })).toBe(true);
    expect(voiceTagsEnabled({ provider: { kind: 'app', via: 'gemini', model: '' }, label: '' })).toBe(false);
  });
});

describe('errores de la IA de la app', () => {
  it('solo reintenta fallos pasajeros del proveedor', () => {
    expect(new AppAiError('provider', 503).retryable).toBe(true);
    expect(new AppAiError('provider', 429).retryable).toBe(true);
    expect(new AppAiError('provider', 401).retryable).toBe(false);
    expect(new AppAiError('quota').retryable).toBe(false);
  });
});
