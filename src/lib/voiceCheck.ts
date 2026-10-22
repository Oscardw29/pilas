import type { TtsPlatform } from '@/types';
import { PRESET_TTS_MODELS, type TtsModelOption } from './ttsPresets';
import { platformFetch } from '@/platform';

/**
 * COMPROBACIÓN DE CLAVES DE VOZ (Ajustes)
 * Valida las claves de TTS y STT contra cada proveedor y, cuando su API lo permite desde el
 * navegador, lista los modelos disponibles (como la tarjeta de IA con los modelos de chat).
 * Fish Audio (modelos fijos) y Deepgram no dejan listar modelos desde el navegador: se confirma la clave.
 */

export interface VoiceCheckResult {
  state: 'ok' | 'invalid' | 'error';
  /** Texto corto para la insignia de la tarjeta */
  message: string;
  /** Modelos de voz detectados (si el proveedor los lista) */
  models?: TtsModelOption[];
}

const TIMEOUT_MS = 12_000;

const authFailed = (status: number) => status === 401 || status === 403;

export async function checkTtsKey(platform: TtsPlatform, key: string): Promise<VoiceCheckResult> {
  try {
    if (platform === 'native') return await checkNativeVoices();

    if (platform === 'elevenlabs') {
      const res = await fetch('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (authFailed(res.status)) return { state: 'invalid', message: 'Clave de ElevenLabs no válida' };
      if (!res.ok) return { state: 'error', message: `ElevenLabs respondió ${res.status}` };
      const list = (await res.json()) as { model_id: string; name?: string; can_do_text_to_speech?: boolean }[];
      const models = list
        .filter((m) => m.can_do_text_to_speech !== false)
        .map((m) => ({ id: m.model_id, name: m.name || m.model_id }));
      return { state: 'ok', message: `${models.length} modelos detectados para ElevenLabs`, models };
    }

    if (platform === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (authFailed(res.status)) return { state: 'invalid', message: 'Clave de OpenAI no válida' };
      if (!res.ok) return { state: 'error', message: `OpenAI respondió ${res.status}` };
      const { data } = (await res.json()) as { data: { id: string }[] };
      const models = data
        .filter((m) => /tts/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { state: 'ok', message: `${models.length} modelos de voz detectados para OpenAI`, models };
    }

    // Fish Audio: no tiene lista de modelos en su API (son fijos) pero el saldo sí se puede consultar
    // Fish Audio no admite CORS: en la web esta consulta falla (la clave se valida al probar la voz);
    // en las apps nativas va por el fetch del sistema
    const res = await platformFetch('https://api.fish.audio/wallet/self/api-credit', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (authFailed(res.status)) return { state: 'invalid', message: 'Clave de Fish Audio no válida' };
    if (!res.ok) return { state: 'error', message: `Fish Audio respondió ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { credit?: number | string };
    const credit = Number(body.credit);
    const models = PRESET_TTS_MODELS.fish_audio;
    const base = `Clave válida · ${models.length} modelos disponibles`;
    return { state: 'ok', message: Number.isFinite(credit) ? `${base} · saldo ${credit.toFixed(2)} USD` : base, models };
  } catch (err) {
    const msg = err instanceof Error && err.name === 'TimeoutError' ? 'no respondió a tiempo' : 'sin conexión';
    return { state: 'error', message: `No se pudo comprobar (${msg})` };
  }
}

async function checkNativeVoices(): Promise<VoiceCheckResult> {
  if (!('speechSynthesis' in window)) return { state: 'error', message: 'Este navegador no tiene voz' };
  const synth = window.speechSynthesis;
  let voices = synth.getVoices();
  if (!voices.length) {
    voices = await new Promise((resolve) => {
      const done = () => resolve(synth.getVoices());
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }
  const spanish = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
  if (!spanish.length) return { state: 'error', message: 'No hay voces en español instaladas' };
  return { state: 'ok', message: `${spanish.length} voces en español detectadas` };
}

/**
 * Deepgram no permite listar modelos desde el navegador. Se envía un audio vacío a la
 * transcripción: con una clave válida responde 400 (audio no válido, sin coste) y con una
 * inválida 401/403.
 */
export async function checkDeepgramKey(key: string): Promise<VoiceCheckResult> {
  try {
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=es', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: new Uint8Array(16),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (authFailed(res.status)) return { state: 'invalid', message: 'Clave de Deepgram no válida' };
    if (res.ok || res.status === 400) return { state: 'ok', message: 'Clave válida · modelo Nova-3 (español)' };
    return { state: 'error', message: `Deepgram respondió ${res.status}` };
  } catch {
    return { state: 'error', message: 'No se pudo comprobar (sin conexión)' };
  }
}
