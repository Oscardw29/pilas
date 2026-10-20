import { useSyncExternalStore } from 'react';
import { getSecrets } from '@/store/useSecrets';
import { useStore } from '@/store/useStore';
import type { CoachGender } from '@/components/coach/coachPersona';

/**
 * VOZ DEL COACH
 * Lee en voz alta las respuestas del chat y publica el «nivel» de la voz (0–1) para que la boca
 * del personaje se mueva al ritmo de lo que dice.
 *
 * 1. Con clave de Gemini (o de OpenAI) usa su modelo de texto a voz y reproduce el audio con
 *    Web Audio: así el silencio puede hacerse con un fundido de 0,5 s y la boca sigue la señal real.
 * 2. Sin clave, o si falla, recurre a la voz del navegador (speechSynthesis). Esa voz no admite
 *    bajar el volumen a mitad de frase: al silenciarla se corta y la boca se cierra suavemente.
 */

type Provider = 'gemini' | 'openai';

/** Duración del fundido al silenciar o cambiar de conversación */
const FADE_S = 0.5;
/** Límite de lectura: las respuestas muy largas se leen hasta aquí (cortando en una frase) */
const MAX_SPEECH_CHARS = 2400;
const FIRST_CHUNK_CHARS = 180;
const CHUNK_CHARS = 460;
const TTS_TIMEOUT_MS = 25_000;
/** Peticiones de voz simultáneas: suficientes para ir por delante de lo que suena sin saturar la cuota */
const MAX_PARALLEL_TTS = 3;
const TTS_RETRY_DELAY_MS = 1200;

const GEMINI_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-tts'];
const GEMINI_VOICES: Record<CoachGender, string> = { male: 'Puck', female: 'Zephyr' };
const OPENAI_VOICES: Record<CoachGender, string> = { male: 'ash', female: 'coral' };
const STYLE_PROMPT =
  'Lee en español latino, con voz cálida y enérgica de entrenador personal que anima sin exagerar';

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

let speechUnlocked = false;

/**
 * Llamar dentro de un gesto del usuario (enviar un mensaje): los navegadores solo dejan
 * reproducir audio después de una interacción.
 */
export function unlockCoachVoice() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume().catch(() => {});
  if (!speechUnlocked && 'speechSynthesis' in window) {
    speechUnlocked = true;
    try {
      // iOS: la primera locución debe salir de un gesto; una vacía basta para desbloquear
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* sin voz del navegador */
    }
  }
}

/* ---------------- Sesiones: cada lectura tiene su número; cambiarlo la cancela ---------------- */

let session = 0;
let sessionGain: GainNode | null = null;
let sources: AudioBufferSourceNode[] = [];
let browserTalking = false;
let boundaryPulse = 0;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Detiene la voz. Con `fade` el volumen baja a cero en 0,5 s antes de cortar
 * (la voz del navegador no lo permite y se corta al momento).
 */
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

  if (browserTalking || window.speechSynthesis?.speaking) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* nada que cortar */
    }
  }
  browserTalking = false;

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

/** Lee el texto con la voz del coach. Corta cualquier lectura anterior. */
export async function speakCoach(text: string, gender: CoachGender): Promise<void> {
  stopCoachVoice({ fade: false });
  const mySession = session;
  const clean = cleanForSpeech(text);
  if (!clean) return;

  const provider = pickProvider();
  if (provider && ensureCtx()) {
    try {
      const rest = await speakWithApi(clean, gender, provider, mySession);
      if (rest && session === mySession) speakWithBrowser(rest, gender, mySession);
      return;
    } catch (err) {
      if (session !== mySession) return;
      console.warn('[coachVoice] Voz de IA no disponible, uso la del navegador:', err);
    }
  }
  if (session === mySession) speakWithBrowser(clean, gender, mySession);
}

function pickProvider(): Provider | null {
  const key = getSecrets().geminiApiKey?.trim();
  if (!key || key.length < 9) return null;
  const platform = useStore.getState().settings.aiPlatform || 'gemini';
  if (platform === 'gemini') return 'gemini';
  if (platform === 'openai') return 'openai';
  return null;
}

/* ---------------- Voz de IA (Gemini / OpenAI) ---------------- */

/**
 * Reproduce los fragmentos uno tras otro. Todos se piden desde el principio (hasta
 * MAX_PARALLEL_TTS a la vez): si se pidieran de uno en uno, generar un fragmento largo tarda
 * más de lo que dura el anterior y la voz se quedaría callada unos segundos a mitad de frase.
 * Si falla el primero lanza el error (la llamada pasa a la voz del navegador);
 * si falla uno posterior (tras reintentarlo) devuelve el texto que faltaba por leer.
 */
async function speakWithApi(text: string, gender: CoachGender, provider: Provider, mySession: number): Promise<string | null> {
  const c = ensureCtx()!;
  if (c.state === 'suspended') await c.resume().catch(() => {});
  const chunks = splitChunks(text);

  const gain = c.createGain();
  gain.connect(analyser!);
  sessionGain = gain;

  const cancelled = () => session !== mySession;
  let inFlight = 0;
  const waiting: (() => void)[] = [];
  const acquire = () =>
    inFlight < MAX_PARALLEL_TTS ? (inFlight++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => (inFlight++, r())));
  const release = () => {
    inFlight--;
    waiting.shift()?.();
  };

  const fetchChunk = (i: number) => {
    const p = acquire()
      .then(async () => {
        try {
          if (cancelled()) throw new Error('Lectura cancelada');
          try {
            return await synthesize(chunks[i], gender, provider);
          } catch (err) {
            // El primero no se reintenta: si falla, la voz del navegador empieza cuanto antes
            if (i === 0 || cancelled()) throw err;
            await new Promise((r) => setTimeout(r, TTS_RETRY_DELAY_MS));
            if (cancelled()) throw err;
            return await synthesize(chunks[i], gender, provider);
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
    let buffer: AudioBuffer;
    try {
      buffer = await requests[i];
    } catch (err) {
      if (i === 0) throw err;
      allQueued = true;
      // Lo que falta se lee con la voz del navegador cuando acabe lo ya programado
      await waitUntilDrained(mySession);
      return session === mySession ? chunks.slice(i).join(' ') : null;
    }
    if (session !== mySession) return null;

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
  return null;
}

function waitUntilDrained(mySession: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (session !== mySession || sources.length === 0 ? resolve() : setTimeout(check, 120));
    check();
  });
}

let geminiModelIdx = 0;

async function synthesize(text: string, gender: CoachGender, provider: Provider): Promise<{ data: Uint8Array; mime: string }> {
  const apiKey = getSecrets().geminiApiKey.trim();

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: OPENAI_VOICES[gender],
        input: text,
        instructions: STYLE_PROMPT,
        response_format: 'pcm',
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mime: 'audio/pcm;rate=24000' };
  }

  const { GoogleGenAI, Modality } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
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

/* ---------------- Voz del navegador ---------------- */

const MALE_HINTS = /jorge|pablo|diego|ra[uú]l|juan|carlos|enrique|[aá]lvaro|alonso|gonzalo|jos[eé]|miguel|andr[eé]s|tom[aá]s|male|hombre/i;
const FEMALE_HINTS = /helena|laura|sabina|paulina|m[oó]nica|elvira|dalia|luc[ií]a|elena|paloma|marisol|ximena|camila|female|mujer|google espa/i;

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', done);
    setTimeout(done, 1200);
  });
}

function pickVoice(voices: SpeechSynthesisVoice[], gender: CoachGender): SpeechSynthesisVoice | undefined {
  const spanish = voices.filter((v) => v.lang?.toLowerCase().startsWith('es'));
  if (!spanish.length) return undefined;
  const latam = (v: SpeechSynthesisVoice) => /es-(419|mx|us|co|ar|cl|pe|ve)/i.test(v.lang);
  const hint = gender === 'female' ? FEMALE_HINTS : MALE_HINTS;
  const other = gender === 'female' ? MALE_HINTS : FEMALE_HINTS;
  // Las voces locales tienen prioridad: las remotas descargan cada frase al llegar a ella y dejan
  // silencios de segundos entre frases
  const score = (v: SpeechSynthesisVoice) =>
    (hint.test(v.name) ? 4 : 0) - (other.test(v.name) ? 3 : 0) + (latam(v) ? 2 : 0) + (v.localService ? 3 : 0);
  return [...spanish].sort((a, b) => score(b) - score(a))[0];
}

function speakWithBrowser(text: string, gender: CoachGender, mySession: number) {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  void waitForVoices().then((voices) => {
    if (session !== mySession) return;
    const voice = pickVoice(voices, gender);
    // Frases cortas: Chrome corta las locuciones largas a los ~15 s
    const parts = splitChunks(text, 200, 200);
    browserTalking = true;
    parts.forEach((part, i) => {
      const u = new SpeechSynthesisUtterance(part);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'es-419';
      u.rate = 1.04;
      u.pitch = gender === 'female' ? 1.12 : 0.96;
      u.onstart = () => {
        if (session === mySession) setSpeaking(true);
      };
      u.onboundary = () => {
        boundaryPulse = 1;
      };
      const end = () => {
        if (session !== mySession || i !== parts.length - 1) return;
        browserTalking = false;
        setSpeaking(false);
      };
      u.onend = end;
      u.onerror = end;
      synth.speak(u);
    });
  });
}

/* ---------------- Medidor: nivel de la voz → boca ---------------- */

let meterRaf = 0;
let level = 0;

function startMeter() {
  if (meterRaf) return;
  const tick = (t: number) => {
    let target = 0;
    if (speaking) {
      if (analyser && meterData && (sources.length || sessionGain)) {
        analyser.getFloatTimeDomainData(meterData);
        let sum = 0;
        for (let i = 0; i < meterData.length; i++) sum += meterData[i] * meterData[i];
        const rms = Math.sqrt(sum / meterData.length);
        target = Math.min(1, Math.max(0, (rms - 0.012) * 7));
      }
      if (browserTalking) {
        // Sin acceso a la señal: sílabas simuladas que se refuerzan en cada palabra
        const syllable = 0.5 + 0.5 * Math.sin(t / 58) * Math.sin(t / 23 + 1.3);
        target = Math.max(target, 0.18 + 0.5 * syllable + 0.35 * boundaryPulse);
        boundaryPulse *= 0.86;
      }
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
