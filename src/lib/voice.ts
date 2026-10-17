/**
 * SERVICIOS DE VOZ: SPEECH-TO-TEXT (STT) Y TEXT-TO-SPEECH (TTS)
 * Integra Deepgram (STT) y Fish Audio (TTS) con fallback a las Web APIs nativas del navegador.
 */
import { getSecrets } from '@/store/useSecrets';

/** Tiempo máximo de espera para síntesis/transcripción externas */
const VOICE_TIMEOUT_MS = 30_000;

// Reconocimiento de voz nativo (Fallback rápido y directo en navegador)
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: any) => void;
  onerror: (event: any) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function startSpeechRecognition(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (err: string) => void,
  onEnd: () => void
): { stop: () => void } | null {
  const Win = window as any;
  const SpeechRec = Win.SpeechRecognition || Win.webkitSpeechRecognition;

  if (!SpeechRec) {
    onError('Tu navegador no soporta SpeechRecognition nativo. Usa Chrome o Edge para dictado por voz en tiempo real.');
    return null;
  }

  let isExplicitlyStopped = false;
  let accumulatedFinal = '';
  // Reinicios automáticos seguidos sin recibir resultados (evita bucles infinitos si el motor falla siempre)
  let restartsWithoutResult = 0;
  const MAX_RESTARTS_WITHOUT_RESULT = 15;
  const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported', 'bad-grammar']);

  try {
    const recognition: SpeechRecognitionInstance = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-ES';

    recognition.onresult = (event: any) => {
      restartsWithoutResult = 0;
      let currentFinal = '';
      let currentInterim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        if (item.isFinal) {
          const piece = item[0].transcript.trim();
          if (piece) {
            currentFinal += (currentFinal ? ' ' : '') + piece;
          }
        } else {
          const piece = item[0].transcript.trim();
          if (piece) {
            currentInterim += (currentInterim ? ' ' : '') + piece;
          }
        }
      }

      if (currentFinal) {
        accumulatedFinal += (accumulatedFinal ? ' ' : '') + currentFinal;
      }

      const fullText = (accumulatedFinal + (currentInterim ? ' ' + currentInterim : '')).trim();
      if (fullText) {
        onTranscript(fullText, Boolean(currentFinal && !currentInterim));
      }
    };

    recognition.onerror = (event: any) => {
      // Ignorar pausas temporales o desconexión transitoria
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }
      console.warn('[STT] Error en reconocimiento nativo:', event.error);
      // Los errores persistentes no se arreglan reiniciando: se detiene en lugar de reintentar sin fin
      if (FATAL_ERRORS.has(event.error)) isExplicitlyStopped = true;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onError('Permiso de micrófono denegado en el navegador.');
      } else if (event.error === 'audio-capture') {
        onError('No se detecta ningún micrófono disponible.');
      } else if (event.error === 'network') {
        onError('Error de red al conectar con el motor de voz.');
      } else {
        onError(event.error || 'Error al capturar voz');
      }
    };

    recognition.onend = () => {
      // Si el navegador detiene el reconocimiento por silencio pero el usuario no ha cancelado, reanudar
      if (!isExplicitlyStopped && restartsWithoutResult < MAX_RESTARTS_WITHOUT_RESULT) {
        restartsWithoutResult++;
        try {
          recognition.start();
          return;
        } catch {
          setTimeout(() => {
            if (!isExplicitlyStopped) {
              try {
                recognition.start();
              } catch {}
            }
          }, 200);
          return;
        }
      }
      onEnd();
    };

    recognition.start();

    return {
      stop: () => {
        isExplicitlyStopped = true;
        try {
          recognition.stop();
        } catch {
          // Ignorar
        }
      },
    };
  } catch (err: any) {
    onError(err?.message || 'No se pudo iniciar el micrófono');
    return null;
  }
}

/**
 * Limpieza inteligente de API Keys (elimina espacios, comillas o prefijos 'Bearer ' pegados por error)
 */
function cleanApiKey(key?: string): string {
  if (!key) return '';
  return key.trim().replace(/^Bearer\s+/i, '').replace(/^Token\s+/i, '').replace(/^['"]|['"]$/g, '');
}

/**
 * Limpieza inteligente de IDs de voz (extrae el ID limpio si el usuario pegó la URL de fish.audio o elevenlabs)
 */
function cleanVoiceId(provider: string, voiceId?: string): string | undefined {
  if (!voiceId || !voiceId.trim()) return undefined;
  let val = voiceId.trim();
  if (provider === 'fish_audio') {
    val = val
      .replace(/^https?:\/\/(?:www\.)?fish\.audio\/(?:m|model|models|voice)\//i, '')
      .replace(/^fish\.audio\/(?:m|model|models|voice)\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  } else if (provider === 'elevenlabs') {
    val = val
      .replace(/^https?:\/\/(?:www\.)?elevenlabs\.io\/(?:app\/voice-lab\/|voice\/|[^\/]+\/)?/i, '')
      .replace(/^elevenlabs\.io\/(?:app\/voice-lab\/|voice\/|[^\/]+\/)?/i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }
  return val.trim() || undefined;
}

export type VoiceProvider = 'fish-audio' | 'elevenlabs' | 'openai-tts' | 'deepgram';

/**
 * Fetch a un proveedor de voz a través del reenvío `/api/relay/<proveedor>`:
 * - En desarrollo lo atiende el proxy de Vite; en producción la función serverless `api/relay.ts`.
 * - Ambos marcan sus respuestas con `x-constancia-relay`. Si no hay reenvío disponible
 *   (p. ej. hosting sin funciones) se intenta la URL directa del proveedor.
 * Algunos proveedores no permiten CORS desde el navegador, por eso existe el reenvío.
 */
async function relayFetch(provider: VoiceProvider, path: string, directUrl: string, init: RequestInit): Promise<Response> {
  const withTimeout: RequestInit = { ...init, signal: AbortSignal.timeout(VOICE_TIMEOUT_MS) };
  try {
    const res = await fetch(`/api/relay/${provider}${path}`, withTimeout);
    if (res.headers.get('x-constancia-relay')) return res;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw err;
    // Sin reenvío disponible: continuar con la URL directa
  }
  return fetch(directUrl, { ...init, signal: AbortSignal.timeout(VOICE_TIMEOUT_MS) });
}

/**
 * Reproduce audio sintetizado. `onStart` solo se dispara si la reproducción arranca; si falla,
 * se lanza el error sin llamar a `onEnd` para que el fallback a voz nativa no duplique eventos.
 * La URL del blob se libera siempre al terminar.
 */
async function playAudioBlob(
  blob: Blob,
  onAudioCreated?: (audio: HTMLAudioElement) => void,
  onStart?: () => void,
  onEnd?: () => void
): Promise<{ stop: () => void }> {
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    URL.revokeObjectURL(audioUrl);
  };

  let hasEnded = false;
  const triggerEnd = () => {
    if (hasEnded) return;
    hasEnded = true;
    release();
    onEnd?.();
  };

  onAudioCreated?.(audio);

  try {
    await audio.play();
  } catch (playErr) {
    hasEnded = true;
    release();
    throw playErr;
  }
  audio.onended = triggerEnd;
  audio.onerror = triggerEnd;
  onStart?.();

  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      triggerEnd();
    },
  };
}

/**
 * Transcripción con Deepgram Nova-3 API (si se cuenta con API Key de Deepgram)
 */
export async function transcribeWithDeepgram(audioBlob: Blob, apiKey: string): Promise<string> {
  const trimmed = cleanApiKey(apiKey);
  const path = '/v1/listen?model=nova-3&language=es&smart_format=true&punctuate=true';

  const res = await relayFetch('deepgram', path, `https://api.deepgram.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${trimmed}`,
      'Content-Type': audioBlob.type || 'audio/webm',
    },
    body: audioBlob,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.err_msg || `Deepgram error HTTP ${res.status}`);
  }

  const data = await res.json();
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return transcript || '';
}

export interface TtsModelOption {
  id: string;
  name: string;
  defaultVoice?: string;
}

export const PRESET_TTS_MODELS: Record<string, TtsModelOption[]> = {
  fish_audio: [
    { id: 's2.1-pro-free', name: 'Fish Audio S2.1 Pro Free (Gratuito / Alta fidelidad)', defaultVoice: '' },
    { id: 's2-pro', name: 'Fish Audio S2 Pro (Última generación profesional)', defaultVoice: '' },
    { id: 's2.1-pro', name: 'Fish Audio S2.1 Pro (Expresión avanzada y dicción fluida)', defaultVoice: '' },
    { id: 's2', name: 'Fish Audio S2 (Nueva generación estándar)', defaultVoice: '' },
    { id: 's1', name: 'Fish Audio S1 (Neuronal ultra-realista)', defaultVoice: '' },
    { id: 'tts-1', name: 'Fish Audio TTS-1 (Baja latencia)', defaultVoice: '' },
    { id: 'speech-1', name: 'Fish Audio Speech-1 (Conversacional)', defaultVoice: '' },
  ],
  elevenlabs: [
    { id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2 (Español nativo recomendado)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5 (Tiempo real ultra-rápido ~75ms)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_turbo_v2_5', name: 'Eleven Turbo v2.5 (Baja latencia)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_turbo_v2', name: 'Eleven Turbo v2 (Alta velocidad)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_multilingual_v1', name: 'Eleven Multilingual v1 (Clásico)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
    { id: 'eleven_monolingual_v1', name: 'Eleven English v1 (Solo inglés)', defaultVoice: '21m00Tcm4TlvDq8ikWAM' },
  ],
  openai: [
    { id: 'tts-1', name: 'OpenAI TTS-1 (Baja latencia estándar)', defaultVoice: 'nova' },
    { id: 'tts-1-hd', name: 'OpenAI TTS-1 HD (Alta fidelidad 24kHz)', defaultVoice: 'nova' },
    { id: 'gpt-4o-audio-preview', name: 'OpenAI GPT-4o Audio Preview (Neuronal avanzado)', defaultVoice: 'nova' },
  ],
  native: [
    { id: 'browser-native', name: 'Síntesis Nativa del Navegador (Web Speech)', defaultVoice: 'es-ES' },
  ],
};

/**
 * Síntesis de voz con Fish Audio (TTS)
 * API Docs: https://api.fish.audio/v1/tts
 * Header requerido para modelo: 'model: <model_name>'
 * Body: { text: string, format: 'mp3', reference_id?: string }
 */
export async function speakWithFishAudio(
  text: string,
  apiKey: string,
  voiceId?: string,
  model?: string,
  onAudioCreated?: (audio: HTMLAudioElement) => void,
  onStart?: () => void,
  onEnd?: () => void
): Promise<{ stop: () => void }> {
  const trimmed = cleanApiKey(apiKey);
  const cleanText = text.replace(/[*_#`~[\]()>]/g, '').trim();
  // Voz por defecto: Chico Joven en español (alta fidelidad y naturalidad)
  const DEFAULT_SPANISH_MALE_VOICE = '1fb9a295ef7047eb9ae334b779567f9d';
  const sanitizedVoice = cleanVoiceId('fish_audio', voiceId) || DEFAULT_SPANISH_MALE_VOICE;


  const bodyPayload: Record<string, unknown> = {
    text: cleanText,
    format: 'mp3',
    reference_id: sanitizedVoice,
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${trimmed}`,
    'Content-Type': 'application/json',
  };
  const targetModel = model && model.trim() ? model.trim() : 's2.1-pro-free';
  headers['model'] = targetModel;

  const res = await relayFetch('fish-audio', '/v1/tts', 'https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let detailMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.detail || parsed?.message) {
        detailMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail || parsed.message);
      }
    } catch {
      // conservar texto sin formato
    }
    throw new Error(`Fish Audio HTTP ${res.status}: ${detailMsg || res.statusText}`);
  }

  return playAudioBlob(await res.blob(), onAudioCreated, onStart, onEnd);
}

/**
 * Síntesis de voz con ElevenLabs (TTS)
 */
export async function speakWithElevenLabs(
  text: string,
  apiKey: string,
  voiceId?: string,
  model = 'eleven_multilingual_v2',
  onAudioCreated?: (audio: HTMLAudioElement) => void,
  onStart?: () => void,
  onEnd?: () => void
): Promise<{ stop: () => void }> {
  const trimmedKey = cleanApiKey(apiKey);
  const cleanText = text.replace(/[*_#`~[\]()>]/g, '').trim();
  const sanitizedVoice = cleanVoiceId('elevenlabs', voiceId);
  const targetVoice = sanitizedVoice || '21m00Tcm4TlvDq8ikWAM'; // Rachel/Default

  const path = `/v1/text-to-speech/${encodeURIComponent(targetVoice)}`;

  const res = await relayFetch('elevenlabs', path, `https://api.elevenlabs.io${path}`, {
    method: 'POST',
    headers: {
      'xi-api-key': trimmedKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: cleanText,
      model_id: model || 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let detailMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.detail?.message || parsed?.detail) {
        detailMsg = parsed.detail?.message || parsed.detail;
      }
    } catch {
      // conservar texto sin formato
    }
    throw new Error(`ElevenLabs HTTP ${res.status}: ${detailMsg || res.statusText}`);
  }

  return playAudioBlob(await res.blob(), onAudioCreated, onStart, onEnd);
}

/**
 * Síntesis de voz con OpenAI TTS
 */
export async function speakWithOpenAiTts(
  text: string,
  apiKey: string,
  voice = 'nova',
  model = 'tts-1',
  onAudioCreated?: (audio: HTMLAudioElement) => void,
  onStart?: () => void,
  onEnd?: () => void
): Promise<{ stop: () => void }> {
  const trimmedKey = cleanApiKey(apiKey);
  const cleanText = text.replace(/[*_#`~[\]()>]/g, '').trim();

  const res = await relayFetch('openai-tts', '/v1/audio/speech', 'https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${trimmedKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'tts-1',
      input: cleanText,
      voice: voice || 'nova',
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let detailMsg = errorText;
    try {
      const parsed = JSON.parse(errorText);
      if (parsed?.error?.message) {
        detailMsg = parsed.error.message;
      }
    } catch {
      // conservar texto sin formato
    }
    throw new Error(`OpenAI TTS HTTP ${res.status}: ${detailMsg || res.statusText}`);
  }

  return playAudioBlob(await res.blob(), onAudioCreated, onStart, onEnd);
}

const activeUtterances = new Set<SpeechSynthesisUtterance>();

/**
 * Síntesis de voz nativa del navegador (SpeechSynthesis)
 * Selecciona activamente por defecto la voz del chico joven en español y respeta ID/nombre personalizado si se provee.
 */
export function speakNative(
  text: string,
  onStart?: () => void,
  onEnd?: () => void,
  customVoiceIdOrName?: string
): { stop: () => void } {
  if (!('speechSynthesis' in window)) {
    console.warn('SpeechSynthesis no soportado en este navegador.');
    onEnd?.();
    return { stop: () => {} };
  }

  try {
    window.speechSynthesis.cancel();
  } catch {}

  if (window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume();
    } catch {}
  }

  const cleanText = text
    .replace(/```action[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_#`~[\]()>]/g, '')
    .trim();

  if (!cleanText) {
    onEnd?.();
    return { stop: () => {} };
  }

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'es-ES';

  const selectAndAssignVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;
    const esVoices = voices.filter((v) => v.lang.startsWith('es') || v.lang.startsWith('es-'));

    let selectedVoice = customVoiceIdOrName?.trim()
      ? esVoices.find((v) =>
          v.name.toLowerCase().includes(customVoiceIdOrName.trim().toLowerCase()) ||
          v.voiceURI.toLowerCase().includes(customVoiceIdOrName.trim().toLowerCase())
        ) ||
        voices.find((v) =>
          v.name.toLowerCase().includes(customVoiceIdOrName.trim().toLowerCase()) ||
          v.voiceURI.toLowerCase().includes(customVoiceIdOrName.trim().toLowerCase())
        )
      : undefined;

    if (!selectedVoice) {
      selectedVoice = esVoices.find((v) => {
        const name = v.name.toLowerCase();
        return (
          name.includes('alvaro') ||
          name.includes('álvaro') ||
          name.includes('pablo') ||
          name.includes('jorge') ||
          name.includes('alonso') ||
          name.includes('raul') ||
          name.includes('raúl') ||
          name.includes('diego') ||
          name.includes('carlos') ||
          name.includes('david') ||
          name.includes('male') ||
          name.includes('hombre') ||
          name.includes('chico') ||
          name.includes('boy')
        );
      });
    }

    if (!selectedVoice) {
      selectedVoice =
        esVoices.find((v) => {
          const name = v.name.toLowerCase();
          return (
            !name.includes('helen') &&
            !name.includes('paulina') &&
            !name.includes('mónica') &&
            !name.includes('monica') &&
            !name.includes('sabina') &&
            !name.includes('female') &&
            !name.includes('mujer')
          );
        }) ||
        esVoices[0] ||
        voices[0];
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
  };

  selectAndAssignVoice();
  if (!utterance.voice) {
    window.speechSynthesis.addEventListener('voiceschanged', selectAndAssignVoice, { once: true });
  }

  utterance.pitch = 1.05;
  utterance.rate = 1.05;

  let hasEnded = false;
  const finish = () => {
    if (hasEnded) return;
    hasEnded = true;
    activeUtterances.delete(utterance);
    onEnd?.();
  };

  activeUtterances.add(utterance);

  utterance.onstart = () => {
    onStart?.();
  };

  utterance.onend = () => {
    finish();
  };

  utterance.onerror = (e) => {
    console.warn('[SpeechSynthesis] Evento error en voz nativa:', e);
    finish();
  };

  // Keep-alive timer para evitar que Chromium pause la síntesis a los 15s
  const keepAliveTimer = setInterval(() => {
    if (hasEnded) {
      clearInterval(keepAliveTimer);
      return;
    }
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 9000);

  // Safety timer para garantizar que onend dispare incluso si el navegador se silencia.
  // Si sigue hablando, se vuelve a esperar (hasta 3 veces) en lugar de cortar antes de tiempo.
  const maxWaitMs = Math.max(3500, cleanText.length * 85 + 2500);
  let safetyChecks = 0;
  let safetyTimeout: ReturnType<typeof setTimeout>;
  const armSafety = () => {
    safetyTimeout = setTimeout(() => {
      if (hasEnded) return;
      if (window.speechSynthesis.speaking && safetyChecks < 3) {
        safetyChecks++;
        armSafety();
        return;
      }
      clearInterval(keepAliveTimer);
      finish();
    }, maxWaitMs);
  };
  armSafety();

  try {
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[SpeechSynthesis] Error al llamar speak():', err);
    finish();
  }

  return {
    stop: () => {
      hasEnded = true;
      clearInterval(keepAliveTimer);
      clearTimeout(safetyTimeout);
      activeUtterances.delete(utterance);
      try {
        window.speechSynthesis.cancel();
      } catch {}
    },
  };
}

/**
 * Despachador unificado de TTS que respeta la plataforma y configuración del usuario
 * Si la API externa no está configurada o falla, conmuta automáticamente a voz nativa sin errores.
 */
export async function speakWithTts(
  text: string,
  settings: {
    ttsPlatform?: string;
    ttsApiKey?: string;
    ttsModel?: string;
    ttsVoiceId?: string;
    fishAudioApiKey?: string;
    elevenLabsApiKey?: string;
    openaiTtsApiKey?: string;
  },
  onAudioCreated?: (audio: HTMLAudioElement) => void,
  onStart?: () => void,
  onEnd?: () => void
): Promise<{ stop: () => void }> {
  // Las claves vienen del almacén de secretos salvo que se pasen explícitamente (p. ej. al probar en Ajustes)
  const secrets = getSecrets();
  settings = {
    ...settings,
    ttsApiKey: settings.ttsApiKey ?? secrets.ttsApiKey,
    fishAudioApiKey: settings.fishAudioApiKey ?? secrets.fishAudioApiKey,
    elevenLabsApiKey: settings.elevenLabsApiKey ?? secrets.elevenLabsApiKey,
    openaiTtsApiKey: settings.openaiTtsApiKey ?? secrets.openaiTtsApiKey,
  };
  const platform = settings.ttsPlatform || 'fish_audio';

  if (platform === 'fish_audio') {
    const key = (settings.fishAudioApiKey || settings.ttsApiKey || '').trim();
    if (!key) {
      // Sin clave configurada: utilizar inmediatamente la voz nativa en español
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
    const DEFAULT_SPANISH_MALE_VOICE = '1fb9a295ef7047eb9ae334b779567f9d';
    const effectiveVoice = settings.ttsVoiceId?.trim() || DEFAULT_SPANISH_MALE_VOICE;
    try {
      return await speakWithFishAudio(
        text,
        key,
        effectiveVoice,
        settings.ttsModel,
        onAudioCreated,
        onStart,
        onEnd
      );
    } catch (err) {
      console.warn('[Fish Audio] Falló síntesis externa, conmutando a voz nativa:', err);
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
  }

  if (platform === 'elevenlabs') {
    const key = (settings.elevenLabsApiKey || settings.ttsApiKey || '').trim();
    if (!key) {
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
    const defaultElevenMale = 'ErXwobaYiN019PkySvjV'; // Antoni (joven en español)
    const effectiveVoice = settings.ttsVoiceId?.trim() || defaultElevenMale;
    try {
      return await speakWithElevenLabs(
        text,
        key,
        effectiveVoice,
        settings.ttsModel,
        onAudioCreated,
        onStart,
        onEnd
      );
    } catch (err) {
      console.warn('[ElevenLabs] Falló síntesis externa, conmutando a voz nativa:', err);
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
  }

  if (platform === 'openai') {
    const key = (settings.openaiTtsApiKey || settings.ttsApiKey || '').trim();
    if (!key) {
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
    const defaultOpenAiMale = 'echo'; // Voz conversacional joven
    const effectiveVoice = settings.ttsVoiceId?.trim() || defaultOpenAiMale;
    try {
      return await speakWithOpenAiTts(
        text,
        key,
        effectiveVoice,
        settings.ttsModel,
        onAudioCreated,
        onStart,
        onEnd
      );
    } catch (err) {
      console.warn('[OpenAI TTS] Falló síntesis externa, conmutando a voz nativa:', err);
      return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
    }
  }

  // Plataforma nativa del navegador ('native')
  return speakNative(text, onStart, onEnd, settings.ttsVoiceId?.trim());
}
