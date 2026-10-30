import { useEffect, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getSecrets, useSecrets } from '@/store/useSecrets';
import { fishTts } from '@/platform/fish';
import { useStore } from '@/store/useStore';
import type { CoachGender } from '@/components/coach/coachPersona';
import type { Secrets, Settings } from '@/types';
import voiceConfig from '@/data/coachVoiceConfig.json';
import { PRESET_TTS_MODELS } from './ttsPresets';
import { stripVoiceTags } from './voiceTags';

const FISH_MODEL_IDS = PRESET_TTS_MODELS.fish_audio.map((m) => m.id);

/**
 * VOZ DEL COACH
 * Lee en voz alta las respuestas del chat y publica el «nivel» de la voz (0–1) para que la boca
 * del personaje se mueva al ritmo de lo que dice.
 *
 * 1. Voz de IA, por orden: la plataforma elegida en «Voz (TTS)» de Ajustes (Fish Audio, ElevenLabs u
 *    OpenAI con su clave) y, si falta su clave, la de la plataforma de IA del chat (Gemini u OpenAI).
 *    Se reproduce con Web Audio: así el silencio puede hacerse con un fundido de 0,5 s y la boca
 *    sigue la señal real. Si falla se reintenta y, si sigue fallando, se calla.
 * 2. Frases grabadas: las frases fijas del catálogo (src/data/coachPhrases.json) que ya tienen audio en
 *    public/coach-voice (scripts/generate-coach-voice.mjs, con la misma voz de Gemini del coach) suenan
 *    aunque no haya clave: para esas frases la voz está establecida. Con Gemini como voz también se usan
 *    (ahorran cuota); con otra plataforma no, para no mezclar dos voces distintas en un mensaje.
 * 3. Sin voz configurada ni frase grabada: el coach no suena. Ya no hay voz del navegador de respaldo:
 *    el coach queda silenciado y, si se intenta activar el sonido, se avisa de dónde configurar la voz.
 *
 * Fish Audio no permite llamadas desde el navegador (su API no tiene CORS): se le habla a través
 * del relay del mismo dominio /api/fish-tts (api/fish-tts.ts en Vercel, middleware en Vite).
 */

type Provider =
  | { kind: 'gemini'; key: string }
  /** OpenAI: la clave de la plataforma de IA o la dedicada de voz; `model`/`voice` vacíos = por defecto */
  | { kind: 'openai'; key: string; model: string; voice: string }
  | { kind: 'elevenlabs'; key: string; model: string; voice: string }
  /** Fish Audio a través del relay /api/fish-tts (su API no admite llamadas desde el navegador) */
  | { kind: 'fish'; key: string; model: string; voice: string };

/** Duración del fundido al silenciar o cambiar de conversación */
const FADE_S = 0.5;
/** Límite de lectura: las respuestas muy largas se leen hasta aquí (cortando en una frase) */
const MAX_SPEECH_CHARS = 2400;
const FIRST_CHUNK_CHARS = 180;
const CHUNK_CHARS = 460;
const TTS_TIMEOUT_MS = 25_000;
/** Peticiones de voz simultáneas: suficientes para ir por delante de lo que suena sin saturar la cuota */
const MAX_PARALLEL_TTS = 2;
/** Intentos por fragmento antes de rendirse (la voz nunca cambia a otra a mitad) */
const TTS_ATTEMPTS = 4;
const TTS_RETRY_DELAY_MS = 1200;
const TTS_MAX_RETRY_DELAY_MS = 15_000;

/** Modelos, voces y estilo de Gemini TTS: los mismos con los que se graban las frases fijas (src/data/coachVoiceConfig.json) */
const GEMINI_TTS_MODELS: string[] = voiceConfig.geminiTtsModels;
const GEMINI_VOICES: Record<CoachGender, string> = voiceConfig.geminiVoices;
const OPENAI_VOICES: Record<CoachGender, string> = { male: 'ash', female: 'coral' };
/** Antoni y Bella: voces multilingües de ElevenLabs que suenan bien en español */
const ELEVENLABS_VOICES: Record<CoachGender, string> = { male: 'ErXwobaYiN019PkySvjV', female: 'EXAVITQu4vr4xnSDxMaL' };
/** Voces públicas en español del catálogo de Fish Audio, elegidas por el usuario: «Rodrigo» (Pilo) y «Chica» (Pila) */
const FISH_VOICES: Record<CoachGender, string> = { male: 'ec0718028a2445fb9be8e8bfb56a0150', female: '35929683c49c4ec0bf779dc07d22620b' };
const STYLE_PROMPT: string = voiceConfig.stylePrompt;

/* ---------------- Estado público: ¿está hablando? y nivel de la voz ---------------- */

let speaking = false;
const stateListeners = new Set<() => void>();
const levelListeners = new Set<(level: number) => void>();

function setSpeaking(value: boolean) {
  if (speaking === value) return;
  speaking = value;
  stateListeners.forEach((l) => l());
  if (value) startMeter();
}

const subscribeState = (l: () => void) => {
  stateListeners.add(l);
  return () => stateListeners.delete(l);
};

/** true mientras el coach está leyendo una respuesta */
export const useCoachSpeaking = (): boolean => useSyncExternalStore(subscribeState, () => speaking, () => false);
export const isCoachSpeaking = () => speaking;

/** Recibe el nivel de la voz en cada fotograma (0 = boca cerrada, 1 = muy abierta) */
export function onCoachVoiceLevel(fn: (level: number) => void): () => void {
  levelListeners.add(fn);
  return () => levelListeners.delete(fn);
}

/* ---------------- Grafo de audio ---------------- */

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let meterData: Float32Array<ArrayBuffer> | null = null;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    analyser.connect(ctx.destination);
    meterData = new Float32Array(analyser.fftSize);
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Llamar dentro de un gesto del usuario (enviar un mensaje): los navegadores solo dejan
 * reproducir audio después de una interacción.
 */
export function unlockCoachVoice() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
  // Se aprovecha el gesto para tener listo el índice de frases grabadas
  void ensureClipManifest();
}

/* ---------------- Sesiones: cada lectura tiene su número; cambiarlo la cancela ---------------- */

let session = 0;
let sessionGain: GainNode | null = null;
let sources: AudioBufferSourceNode[] = [];
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

/** Detiene la voz. Con `fade` el volumen baja a cero en 0,5 s antes de cortar */
export function stopCoachVoice({ fade = true }: { fade?: boolean } = {}) {
  session++;
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }

  const playing = sources;
  const gain = sessionGain;
  sources = [];
  sessionGain = null;

  if (ctx && gain && !playing.length) gain.disconnect();
  if (ctx && gain && playing.length) {
    const t = ctx.currentTime;
    const end = fade ? t + FADE_S : t;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    if (fade) gain.gain.linearRampToValueAtTime(0, end);
    playing.forEach((s) => {
      s.onended = null;
      try {
        s.stop(end);
      } catch {
        /* ya terminó */
      }
    });
    setTimeout(() => gain.disconnect(), (fade ? FADE_S : 0) * 1000 + 80);
  }

  if (!speaking) return;
  if (fade && playing.length) {
    // La boca sigue la señal mientras se apaga y luego se cierra
    const mySession = session;
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      if (session === mySession) setSpeaking(false);
    }, FADE_S * 1000);
  } else {
    setSpeaking(false);
  }
}

/**
 * Resultado de una lectura:
 * - 'ok': leída (o cortada por otra lectura).
 * - 'failed': la voz de IA no respondió tras reintentarlo; se calla y la vista avisa (el texto sigue en el chat).
 * - 'unavailable': no hay voz para este texto (sin voz de IA y sin frases grabadas que coincidan): no suena nada.
 */
export type SpeakResult = 'ok' | 'failed' | 'unavailable';

/**
 * Lee el texto con la voz del coach. Corta cualquier lectura anterior.
 * Nunca cambia de voz a mitad: si la de IA falla tras reintentarlo, se calla.
 */
export async function speakCoach(
  text: string,
  gender: CoachGender,
  /** Voz a usar en lugar de la guardada (el botón «Probar voz» de Ajustes, antes de guardar) */
  choice: CoachVoiceChoice = resolveCoachVoice(),
): Promise<SpeakResult> {
  stopCoachVoice({ fade: false });
  const mySession = session;
  const { provider } = choice;
  if (!ensureCtx()) return 'unavailable';
  // Las frases grabadas solo se buscan si pueden sonar (sin voz de IA o con la de Gemini)
  if (!provider || provider.kind === 'gemini') await ensureClipManifest();
  if (session !== mySession) return 'ok';

  // Las etiquetas de expresión ([excited], [pause]…) solo llegan a la voz que las interpreta
  const jobs = planSpeech(voiceTagsEnabled(choice) ? text : stripVoiceTags(text), gender, provider);
  if (!jobs.length) return provider ? 'ok' : 'unavailable';
  try {
    await speakJobs(jobs, gender, provider, mySession);
    return 'ok';
  } catch (err) {
    if (session !== mySession) return 'ok';
    console.warn('[coachVoice] Voz de IA no disponible:', err);
    return 'failed';
  }
}

/**
 * ¿La voz del coach interpreta etiquetas de expresión? Solo Fish Audio con modelos S2 (s1 usa otra
 * sintaxis). El prompt del chat solo las pide si esto es true y el coach no está silenciado.
 */
export function voiceTagsEnabled(choice: CoachVoiceChoice = resolveCoachVoice()): boolean {
  return choice.provider?.kind === 'fish' && choice.provider.model !== 's1';
}

const usableKey = (k: string | undefined) => (k && k.trim().length >= 9 ? k.trim() : '');

export interface CoachVoiceChoice {
  /** null = sin voz de IA (solo suenan las frases grabadas, si las hay) */
  provider: Provider | null;
  /** Qué voz usará el coach, para mostrarlo en Ajustes */
  label: string;
  /** Por qué no se usa la plataforma elegida, si es el caso */
  note?: string;
}

type VoiceSettings = Pick<Settings, 'ttsPlatform' | 'ttsModel' | 'ttsVoiceId' | 'aiPlatform'>;
type VoiceSecrets = Pick<Secrets, 'geminiApiKey' | 'elevenLabsApiKey' | 'openaiTtsApiKey' | 'fishAudioApiKey' | 'ttsApiKey'>;

const NO_VOICE_LABEL = 'Sin voz configurada (el coach no suena)';

/**
 * Decide con qué voz habla el coach según Ajustes y las claves guardadas.
 * Ajustes pasa los valores del formulario para enseñar la elección antes de guardar.
 */
export function resolveCoachVoice(
  settings: VoiceSettings = useStore.getState().settings,
  secrets: VoiceSecrets = getSecrets(),
): CoachVoiceChoice {
  const tts = settings.ttsPlatform || 'fish_audio';
  const ttsModel = settings.ttsModel?.trim() || '';
  const ttsVoice = settings.ttsVoiceId?.trim() || '';

  // La síntesis del navegador ya no existe: «native» quedó como «sin voz»
  if (tts === 'native') return { provider: null, label: NO_VOICE_LABEL };

  let note: string | undefined;
  if (tts === 'elevenlabs') {
    const key = usableKey(secrets.elevenLabsApiKey || secrets.ttsApiKey);
    const model = ttsModel.startsWith('eleven_') ? ttsModel : 'eleven_multilingual_v2';
    if (key) return { provider: { kind: 'elevenlabs', key, model, voice: ttsVoice }, label: `ElevenLabs · ${model}` };
    note = 'Falta la clave de ElevenLabs';
  } else if (tts === 'openai') {
    const key = usableKey(secrets.openaiTtsApiKey);
    // gpt-4o-audio-preview no existe en el endpoint de voz: se usa su equivalente
    const model = ttsModel && ttsModel !== 'gpt-4o-audio-preview' ? ttsModel : 'gpt-4o-mini-tts';
    if (key) return { provider: { kind: 'openai', key, model, voice: ttsVoice }, label: `OpenAI TTS · ${model}` };
    note = 'Falta la clave de OpenAI para voz';
  } else if (tts === 'fish_audio') {
    const key = usableKey(secrets.fishAudioApiKey || secrets.ttsApiKey);
    const model = FISH_MODEL_IDS.includes(ttsModel) ? ttsModel : 's2.1-pro';
    if (key) return { provider: { kind: 'fish', key, model, voice: ttsVoice }, label: `Fish Audio · ${model}` };
    note = 'Falta la clave de Fish Audio';
  }

  const aiKey = usableKey(secrets.geminiApiKey);
  const platform = settings.aiPlatform || 'gemini';
  if (aiKey && platform === 'gemini') return { provider: { kind: 'gemini', key: aiKey }, label: 'Gemini TTS (clave de IA)', note };
  if (aiKey && platform === 'openai') {
    return { provider: { kind: 'openai', key: aiKey, model: 'gpt-4o-mini-tts', voice: '' }, label: 'OpenAI TTS (clave de IA)', note };
  }
  return { provider: null, label: NO_VOICE_LABEL, note };
}

/* ---------------- ¿Tiene voz el coach? ---------------- */

/**
 * - 'tts': hay una voz de IA configurada y lee cualquier respuesta.
 * - 'clips': sin voz de IA, pero hay frases grabadas: suenan solo esas.
 * - 'none': no suena nada; el coach queda silenciado y activar el sonido muestra un aviso.
 */
export type CoachVoiceMode = 'tts' | 'clips' | 'none';

export function coachVoiceMode(gender: CoachGender, choice: CoachVoiceChoice = resolveCoachVoice()): CoachVoiceMode {
  if (choice.provider) return 'tts';
  return clipIndex[gender].size > 0 ? 'clips' : 'none';
}

/** Igual que `coachVoiceMode`, pero se actualiza al cambiar Ajustes o las claves y al cargar las frases grabadas */
export function useCoachVoiceMode(gender: CoachGender): CoachVoiceMode {
  const settings = useStore(
    useShallow((s) => ({
      ttsPlatform: s.settings.ttsPlatform,
      ttsModel: s.settings.ttsModel,
      ttsVoiceId: s.settings.ttsVoiceId,
      aiPlatform: s.settings.aiPlatform,
    })),
  );
  const keys = useSecrets((s) => s.keys);
  useSyncExternalStore(subscribeManifest, () => manifestRev, () => 0);
  useEffect(() => {
    void ensureClipManifest();
  }, []);
  return coachVoiceMode(gender, resolveCoachVoice(settings, keys));
}

/** Dónde se configura la voz (para el aviso al intentar activar el sonido sin voz) */
export const VOICE_SETTINGS_PLACE = 'Ajustes › «Voz Neuronal y Dictado (TTS & STT)»';

/* ---------------- Frases grabadas (public/coach-voice) ---------------- */

/** Carpeta pública de los audios, respetando la base de la compilación (web, Android o escritorio) */
const CLIPS_BASE = `${import.meta.env.BASE_URL}${voiceConfig.clipsDir}/`;
const CLIP_VOICES: Record<CoachGender, string> = voiceConfig.clipVoices;
/** Rutas válidas dentro de la carpeta, p. ej. «pilo/saludo.apertura.1.mp3» */
const SAFE_CLIP_PATH = /^[a-z0-9_-]+\/[a-z0-9._-]+\.(wav|mp3|ogg|m4a)$/i;

/** Texto normalizado de cada frase grabada → URL de su audio, por personaje */
let clipIndex: Record<CoachGender, Map<string, string>> = { male: new Map(), female: new Map() };
let manifestPromise: Promise<void> | null = null;
let manifestRev = 0;
const manifestListeners = new Set<() => void>();

const subscribeManifest = (l: () => void) => {
  manifestListeners.add(l);
  return () => manifestListeners.delete(l);
};

/**
 * Clave de búsqueda: solo letras y números en minúsculas. Así una línea del chat coincide con la frase
 * grabada aunque lleve negritas, viñetas, comillas o un punto final distinto.
 */
const clipKey = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Lee public/coach-voice/manifest.json (lo escribe el script de generación) una vez por sesión. Sin manifiesto,
 * vacío o mal formado no pasa nada: simplemente no hay frases grabadas. Si falla la red, se reintenta en la
 * siguiente llamada.
 */
export function ensureClipManifest(): Promise<void> {
  if (manifestPromise) return manifestPromise;
  let retry = false;
  manifestPromise = (async () => {
    try {
      const res = await fetch(`${CLIPS_BASE}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const json = (await res.json()) as { voices?: Record<string, { clips?: Record<string, { file?: unknown; text?: unknown }> }> };
      const next: typeof clipIndex = { male: new Map(), female: new Map() };
      for (const gender of ['male', 'female'] as const) {
        const clips = json.voices?.[CLIP_VOICES[gender]]?.clips ?? {};
        for (const entry of Object.values(clips)) {
          if (typeof entry?.file !== 'string' || typeof entry.text !== 'string' || !SAFE_CLIP_PATH.test(entry.file)) continue;
          next[gender].set(clipKey(cleanForSpeech(entry.text)), `${CLIPS_BASE}${entry.file}`);
        }
      }
      clipIndex = next;
    } catch {
      // Sin conexión u otro fallo pasajero: sin frases grabadas por ahora, se vuelve a intentar más tarde
      retry = true;
    } finally {
      if (retry) manifestPromise = null;
      manifestRev++;
      manifestListeners.forEach((l) => l());
    }
  })();
  return manifestPromise;
}

/** Audios ya decodificados (los últimos usados): las frases se repiten y así suenan al instante */
const CLIP_CACHE_MAX = 24;
const clipCache = new Map<string, Promise<AudioBuffer | null>>();

function loadClip(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = clipCache.get(url);
  if (cached) {
    // Se vuelve a insertar para marcarla como la más reciente
    clipCache.delete(url);
    clipCache.set(url, cached);
    return cached;
  }
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buf) => c.decodeAudioData(buf))
    .catch((err) => {
      // Falta el archivo o no se puede decodificar: esa frase se salta sin romper la lectura
      console.warn('[coachVoice] No se pudo cargar la frase grabada', url, err);
      clipCache.delete(url);
      return null;
    });
  clipCache.set(url, p);
  while (clipCache.size > CLIP_CACHE_MAX) clipCache.delete(clipCache.keys().next().value!);
  return p;
}

/* ---------------- Plan de lectura: frases grabadas y texto para la voz de IA ---------------- */

type SpeechJob = { kind: 'clip'; url: string } | { kind: 'tts'; text: string };

/**
 * Decide qué suena y con qué:
 * - Fish Audio, ElevenLabs u OpenAI: todo con esa voz (las frases grabadas son de Gemini y sonarían distintas).
 * - Gemini: cada línea que es una frase grabada suena con su audio; el resto se sintetiza con la misma voz.
 * - Sin voz de IA: solo las líneas que son frases grabadas; el resto se calla.
 */
function planSpeech(source: string, gender: CoachGender, provider: Provider | null): SpeechJob[] {
  if (provider && provider.kind !== 'gemini') {
    const clean = cleanForSpeech(source);
    return clean ? splitChunks(clean).map((text) => ({ kind: 'tts' as const, text })) : [];
  }

  const jobs: SpeechJob[] = [];
  let pending = '';
  let total = 0;
  const flush = () => {
    if (pending && provider) jobs.push(...splitChunks(pending).map((text) => ({ kind: 'tts' as const, text })));
    pending = '';
  };
  // Línea a línea: cada frase del catálogo va sola en su línea (los bloques de código y de acción, fuera)
  for (const line of source.replace(/```[\s\S]*?```/g, '\n').split('\n')) {
    if (total >= MAX_SPEECH_CHARS) break;
    const spoken = cleanForSpeech(line);
    if (!spoken) continue;
    total += spoken.length;
    const url = clipIndex[gender].get(clipKey(spoken));
    if (url) {
      flush();
      jobs.push({ kind: 'clip', url });
    } else {
      pending = pending ? `${pending} ${spoken}` : spoken;
    }
  }
  flush();
  return jobs;
}

/* ---------------- Reproducción (voz de IA y frases grabadas) ---------------- */

/**
 * Reproduce los fragmentos uno tras otro. Todos se piden desde el principio (hasta MAX_PARALLEL_TTS
 * síntesis a la vez): si se pidieran de uno en uno, generar un fragmento largo tarda más de lo que dura
 * el anterior y la voz se quedaría callada unos segundos a mitad de frase. Las frases grabadas se cargan
 * aparte (son archivos de la app) y, si falta alguna, se salta.
 * Si un fragmento de IA falla tras sus reintentos, termina lo ya programado y lanza el error.
 */
async function speakJobs(chunks: SpeechJob[], gender: CoachGender, provider: Provider | null, mySession: number): Promise<void> {
  const c = ensureCtx()!;
  if (c.state === 'suspended') await c.resume().catch(() => {});

  const gain = c.createGain();
  gain.connect(analyser!);
  sessionGain = gain;

  /** Un fragmento falló del todo: los que esperan turno ya no se piden */
  let gaveUp = false;
  const cancelled = () => gaveUp || session !== mySession;
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const acquire = () =>
    inFlight < MAX_PARALLEL_TTS ? (inFlight++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => (inFlight++, r())));
  const release = () => {
    inFlight--;
    waiting.shift()?.();
  };

  const fetchChunk = (i: number): Promise<AudioBuffer | null> => {
    const job = chunks[i];
    if (job.kind === 'clip') return loadClip(c, job.url);
    if (!provider) return Promise.resolve(null);
    const p = acquire()
      .then(async () => {
        try {
          for (let attempt = 1; ; attempt++) {
            if (cancelled()) throw new Error('Lectura cancelada');
            try {
              return await synthesize(job.text, gender, provider);
            } catch (err) {
              if (attempt >= TTS_ATTEMPTS || !isRetryable(err)) {
                gaveUp = true;
                throw err;
              }
              await new Promise((r) => setTimeout(r, retryDelayMs(err, attempt)));
            }
          }
        } finally {
          release();
        }
      })
      .then((bytes) => bytesToBuffer(c, bytes));
    p.catch(() => {}); // se maneja al esperarla; evita avisos si la sesión se cancela antes
    return p;
  };

  // En orden: los primeros fragmentos ocupan los huecos antes que los siguientes
  const requests = chunks.map((_, i) => fetchChunk(i));
  let at = 0;
  let allQueued = false;

  const maybeFinish = () => {
    if (session === mySession && allQueued && sources.length === 0) setSpeaking(false);
  };

  for (let i = 0; i < chunks.length; i++) {
    let buffer: AudioBuffer | null;
    try {
      buffer = await requests[i];
    } catch (err) {
      // Se termina la frase en curso con la misma voz y se para (sin cambiar de voz)
      allQueued = true;
      maybeFinish();
      await waitUntilDrained(mySession);
      throw err;
    }
    if (session !== mySession) return;
    if (!buffer) continue;

    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const startAt = Math.max(c.currentTime + 0.04, at);
    src.start(startAt);
    at = startAt + buffer.duration;
    sources.push(src);
    src.onended = () => {
      sources = sources.filter((s) => s !== src);
      maybeFinish();
    };
    setSpeaking(true);
  }
  allQueued = true;
  maybeFinish();
}

/** Clave inválida, sin saldo, sin permiso o petición mal formada: reintentar no arregla nada */
function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return !/\b(400|401|402|403|404)\b|API key not valid|PERMISSION_DENIED|INVALID_ARGUMENT/i.test(msg);
}

/** Espera antes de reintentar: la que pida la API en un 429 («retry in 7s») o una creciente */
function retryDelayMs(err: unknown, attempt: number): number {
  const msg = err instanceof Error ? err.message : String(err);
  const asked = msg.match(/retry(?:Delay)?["':\s]*(?:in\s*)?"?(\d+(?:\.\d+)?)\s*s/i);
  const ms = asked ? Number(asked[1]) * 1000 + 250 : TTS_RETRY_DELAY_MS * 2 ** (attempt - 1);
  return Math.min(ms, TTS_MAX_RETRY_DELAY_MS);
}

function waitUntilDrained(mySession: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (session !== mySession || sources.length === 0 ? resolve() : setTimeout(check, 120));
    check();
  });
}

let geminiModelIdx = 0;

async function synthesize(text: string, gender: CoachGender, provider: Provider): Promise<{ data: Uint8Array; mime: string }> {
  if (provider.kind === 'openai') {
    const model = provider.model || 'gpt-4o-mini-tts';
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
      body: JSON.stringify({
        model,
        voice: provider.voice || OPENAI_VOICES[gender],
        input: text,
        // Solo los modelos gpt-4o admiten indicaciones de estilo
        ...(model.startsWith('gpt-4o') ? { instructions: STYLE_PROMPT } : {}),
        response_format: 'pcm',
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mime: 'audio/pcm;rate=24000' };
  }

  if (provider.kind === 'fish') {
    const res = await fishTts(provider.key, { text, model: provider.model, reference_id: provider.voice || FISH_VOICES[gender] }, TTS_TIMEOUT_MS + 5_000);
    // El relay devuelve el código de Fish Audio (401 clave, 402 sin saldo, 429 límite…)
    if (!res.ok) throw new Error(`Fish Audio TTS HTTP ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('Content-Type') || 'audio/pcm;rate=24000' };
  }

  if (provider.kind === 'elevenlabs') {
    const voice = encodeURIComponent(provider.voice || ELEVENLABS_VOICES[gender]);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': provider.key },
      body: JSON.stringify({ text, model_id: provider.model, language_code: provider.model.includes('v2_5') ? 'es' : undefined }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`ElevenLabs TTS HTTP ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mime: 'audio/pcm;rate=24000' };
  }

  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: provider.key });
  for (;;) {
    const model = GEMINI_TTS_MODELS[geminiModelIdx];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: `${STYLE_PROMPT}: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICES[gender] } } },
          abortSignal: AbortSignal.timeout(TTS_TIMEOUT_MS),
        },
      });
      const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error('Respuesta de voz vacía');
      return { data: base64ToBytes(part.inlineData.data), mime: part.inlineData.mimeType || 'audio/pcm;rate=24000' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const notFound = msg.includes('404') || msg.toLowerCase().includes('not found');
      if (notFound && geminiModelIdx < GEMINI_TTS_MODELS.length - 1) {
        geminiModelIdx++;
        continue;
      }
      throw err;
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PCM de 16 bits (lo que devuelven Gemini y OpenAI) o, si viene otro formato, decodificación nativa */
async function bytesToBuffer(c: AudioContext, { data, mime }: { data: Uint8Array; mime: string }): Promise<AudioBuffer> {
  const isPcm = /pcm|L16/i.test(mime);
  if (!isPcm) {
    const copy = data.slice().buffer;
    return c.decodeAudioData(copy);
  }
  const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
  const samples = Math.floor(data.byteLength / 2);
  const view = new DataView(data.buffer, data.byteOffset, samples * 2);
  const buffer = c.createBuffer(1, Math.max(1, samples), rate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) ch[i] = view.getInt16(i * 2, true) / 32768;
  return buffer;
}

/* ---------------- Medidor: nivel de la voz → boca ---------------- */

let meterRaf = 0;
let level = 0;

function startMeter() {
  if (meterRaf) return;
  const tick = () => {
    let target = 0;
    if (speaking && analyser && meterData && (sources.length || sessionGain)) {
      analyser.getFloatTimeDomainData(meterData);
      let sum = 0;
      for (let i = 0; i < meterData.length; i++) sum += meterData[i] * meterData[i];
      const rms = Math.sqrt(sum / meterData.length);
      target = Math.min(1, Math.max(0, (rms - 0.012) * 7));
    }
    // Abre rápido y cierra algo más despacio, como una mandíbula
    level += (target - level) * (target > level ? 0.55 : 0.28);
    levelListeners.forEach((l) => l(level));
    if (!speaking && level < 0.01) {
      level = 0;
      levelListeners.forEach((l) => l(0));
      meterRaf = 0;
      return;
    }
    meterRaf = requestAnimationFrame(tick);
  };
  meterRaf = requestAnimationFrame(tick);
}

/* ---------------- Texto: del markdown del chat a frases legibles ---------------- */

export function cleanForSpeech(raw: string): string {
  let t = raw
    .replace(/```[\s\S]*?```/g, ' ') // bloques de código y acciones sugeridas
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/^\s*\|?[-:\s|]+\|[-:\s|]*$/gm, ' ')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, '$2')
    .replace(/[*_~#]/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/https?:\/\/\S+/g, '');

  // Cada línea es una pausa: si no acaba en puntuación se le añade un punto
  t = t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?…:;,]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (t.length > MAX_SPEECH_CHARS) {
    const cut = t.slice(0, MAX_SPEECH_CHARS);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    t = lastStop > MAX_SPEECH_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : cut;
  }
  return t;
}

/**
 * Agrupa frases en fragmentos: el primero corto para que la voz empiece cuanto antes y el
 * segundo intermedio, porque es el que menos margen tiene para generarse mientras suena el primero
 */
function splitChunks(text: string, first = FIRST_CHUNK_CHARS, rest = CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+["»”)]?\s*|[^.!?…]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    const limit = chunks.length === 0 ? first : chunks.length === 1 ? Math.round((first + rest) / 2) : rest;
    if (current && current.length + s.length + 1 > limit) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
    // Frases larguísimas: se parten por comas
    while (current.length > rest * 1.4) {
      const idx = current.lastIndexOf(', ', rest);
      const at = idx > 40 ? idx + 1 : rest;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
