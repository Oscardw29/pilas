/**
 * ENTRADA DE VOZ (micrófono → texto)
 * Un único «oyente» para el asistente de voz y el dictado, con dos motores:
 * - 'native': SpeechRecognition del navegador (Chrome, Edge, Safari). Da texto en vivo.
 * - 'deepgram': graba con MediaRecorder, detecta el final de cada frase por volumen y la transcribe con Deepgram.
 *   Se usa donde no hay reconocimiento nativo (Firefox, Brave, apps de escritorio o móvil) si hay clave configurada.
 *
 * Modos del oyente:
 * - 'turn': turno del usuario. Emite el texto parcial y, tras una pausa, el turno completo.
 * - 'watch': el asistente está hablando. Solo avisa si el usuario lo interrumpe (filtra el eco de los altavoces).
 * - 'off': ignora todo lo que oiga (p. ej. mientras el asistente piensa).
 */
import { getSecrets } from '@/store/useSecrets';
import { transcribeWithDeepgram } from './voice';
import { detectBargeIn, isLikelyEcho } from './voiceText';

export type SttEngine = 'native' | 'deepgram';
export type ListenerMode = 'turn' | 'watch' | 'off';

export type MicErrorCode = 'insecure' | 'unsupported' | 'denied' | 'no-device' | 'busy' | 'network' | 'stt-key' | 'unknown';

const MIC_MESSAGES: Record<MicErrorCode, string> = {
  insecure: 'El micrófono solo funciona en una conexión segura. Abre ¡Pilas! con https o desde localhost.',
  unsupported: 'Este navegador no reconoce la voz. Usa Chrome o Edge, o agrega una clave de Deepgram en Ajustes.',
  denied: 'No hay permiso para usar el micrófono. Actívalo desde el candado de la barra de direcciones y vuelve a intentarlo.',
  'no-device': 'No se encontró ningún micrófono conectado.',
  busy: 'El micrófono está ocupado por otra aplicación. Ciérrala y vuelve a intentarlo.',
  network: 'El reconocimiento de voz del navegador no responde. Revisa tu conexión o agrega una clave de Deepgram en Ajustes.',
  'stt-key': 'La clave de Deepgram no es válida. Revísala en Ajustes.',
  unknown: 'No se pudo activar el micrófono.',
};

export class MicError extends Error {
  constructor(public code: MicErrorCode, message = MIC_MESSAGES[code]) {
    super(message);
    this.name = 'MicError';
  }
}

export function toMicError(err: unknown): MicError {
  if (err instanceof MicError) return err;
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return new MicError('denied');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new MicError('no-device');
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return new MicError('busy');
  return new MicError('unknown');
}

type RecognitionCtor = new () => any;

function nativeRecognitionCtor(): RecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/** Entornos que exponen SpeechRecognition pero no lo hacen funcionar (fallan con «network» o en silencio) */
function nativeLooksBroken(): boolean {
  const w = window as any;
  return Boolean((navigator as any).brave || w.__TAURI__ || w.__TAURI_INTERNALS__ || w.Capacitor?.isNativePlatform?.());
}

function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function deepgramKey(): string {
  return getSecrets().deepgramApiKey?.trim() ?? '';
}

/** Motor de reconocimiento disponible en este dispositivo, o null si no hay ninguno */
export function pickSttEngine(): SttEngine | null {
  const native = nativeRecognitionCtor();
  const deepgram = Boolean(deepgramKey()) && canRecord();
  if (native && !nativeLooksBroken()) return 'native';
  if (deepgram) return 'deepgram';
  return native ? 'native' : null;
}

/**
 * Pide el micrófono (muestra el aviso de permiso del navegador) con cancelación de eco.
 * Lanza MicError con un mensaje listo para mostrar.
 */
export async function requestMicStream(): Promise<MediaStream> {
  if (!window.isSecureContext) throw new MicError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unsupported');
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    throw toMicError(err);
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ya detenida */
    }
  });
}

export interface ListenerCallbacks {
  /** Texto del turno en curso (en vivo con el motor nativo; por frases con Deepgram) */
  onPartial?: (text: string) => void;
  /** Turno del usuario terminado (solo con `autoEnd`) */
  onTurn?: (text: string) => void;
  /** El usuario interrumpió al asistente en modo 'watch'. El oyente pasa solo a 'turn'. */
  onBargeIn?: () => void;
  /** Deepgram está transcribiendo una frase */
  onProcessing?: (busy: boolean) => void;
  /** Error que detiene el oyente */
  onError: (err: MicError) => void;
  onEngineChange?: (engine: SttEngine) => void;
}

export interface ListenerOptions {
  /** true: el turno termina solo tras una pausa (asistente). false: sigue hasta `finish()` (dictado). */
  autoEnd: boolean;
  /** Stream de micrófono para el motor Deepgram (se pide si hace falta) */
  getStream?: () => Promise<MediaStream>;
}

export interface VoiceListener {
  readonly engine: SttEngine;
  setMode(mode: ListenerMode, spokenText?: string): void;
  /** Cierra el turno ya, sin esperar la pausa (botón «Listo») */
  flush(): void;
  /** Termina y devuelve el texto del turno en curso (dictado) */
  finish(): Promise<string>;
  dispose(): void;
}

/** Pausa tras un resultado definitivo / provisional para dar el turno por terminado */
const FINAL_PAUSE_MS = 850;
const INTERIM_PAUSE_MS = 1600;

interface Segment {
  text: string;
  isFinal: boolean;
}

/* ---------------------------------------------------------------- Motor nativo */

function createNativeListener(cb: ListenerCallbacks, opts: ListenerOptions): VoiceListener {
  const Ctor = nativeRecognitionCtor();
  if (!Ctor) throw new MicError('unsupported');

  let rec: any = null;
  let disposed = false;
  let fatal = false;
  let mode: ListenerMode = 'off';
  let spoken = '';
  /** Turno anterior al último reinicio del motor (el navegador vacía sus resultados al reiniciar) */
  let carried: Segment[] = [];
  let session: Segment[] = [];
  /** Índice desde el que empiezan los segmentos del turno actual */
  let boundary = 0;
  let lastPartial = '';
  let endTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let quickEnds = 0;
  let sessionStartedAt = 0;

  const all = () => [...carried, ...session];
  const turnText = () =>
    all()
      .slice(boundary)
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const clearEndTimer = () => {
    if (endTimer) clearTimeout(endTimer);
    endTimer = null;
  };

  const resetTurn = () => {
    clearEndTimer();
    boundary = all().length;
    lastPartial = '';
  };

  const emitTurn = () => {
    clearEndTimer();
    const text = turnText();
    resetTurn();
    if (!text) return;
    mode = 'off';
    cb.onTurn?.(text);
  };

  const handleResults = () => {
    if (disposed || mode === 'off') return;
    const segs = all();

    if (mode === 'watch') {
      const heard = turnText();
      if (!heard || !detectBargeIn(heard, spoken)) return;
      // El turno del usuario empieza en el primer segmento que no es eco
      const firstUser = segs.findIndex((s, i) => i >= boundary && !isLikelyEcho(s.text, spoken));
      if (firstUser >= 0) boundary = firstUser;
      mode = 'turn';
      lastPartial = '';
      cb.onBargeIn?.();
    }

    const text = turnText();
    if (text === lastPartial) return;
    lastPartial = text;
    if (!text) return;
    cb.onPartial?.(text);
    if (!opts.autoEnd) return;
    clearEndTimer();
    const lastFinal = segs[segs.length - 1]?.isFinal;
    endTimer = setTimeout(emitTurn, lastFinal ? FINAL_PAUSE_MS : INTERIM_PAUSE_MS);
  };

  const fail = (err: MicError) => {
    if (fatal || disposed) return;
    fatal = true;
    clearEndTimer();
    try {
      rec?.abort();
    } catch {
      /* ignorar */
    }
    rec = null;
    cb.onError(err);
  };

  const scheduleRestart = () => {
    if (disposed || fatal || restartTimer) return;
    // Si el motor se cierra nada más arrancar varias veces seguidas, espaciar los reintentos
    const delay = quickEnds > 4 ? 1500 : 120;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startRecognition();
    }, delay);
  };

  const startRecognition = () => {
    if (disposed || fatal || rec) return;
    const r = new Ctor();
    r.lang = navigator.language?.toLowerCase().startsWith('es') ? navigator.language : 'es-ES';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (e: any) => {
      quickEnds = 0;
      const list: Segment[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const text = String(e.results[i][0]?.transcript ?? '').trim();
        if (text) list.push({ text, isFinal: Boolean(e.results[i].isFinal) });
      }
      session = list;
      handleResults();
    };

    r.onerror = (e: any) => {
      const code = e?.error;
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed') {
        fail(new MicError('denied'));
      } else if (code === 'service-not-allowed') {
        // El navegador bloquea su servicio de reconocimiento (p. ej. Brave): se trata como no disponible
        fail(new MicError('network'));
      } else if (code === 'audio-capture') {
        fail(new MicError('busy'));
      } else if (code === 'network') {
        fail(new MicError('network'));
      } else if (code === 'language-not-supported') {
        fail(new MicError('unsupported'));
      }
    };

    r.onend = () => {
      if (rec === r) rec = null;
      if (Date.now() - sessionStartedAt < 1000) quickEnds++;
      // Conservar el turno en curso: el siguiente arranque empieza con resultados vacíos
      const pending = turnText();
      const wasFinalPending = pending && mode !== 'off';
      carried = wasFinalPending ? [{ text: pending, isFinal: true }] : [];
      session = [];
      boundary = 0;
      if (!wasFinalPending) lastPartial = '';
      scheduleRestart();
    };

    try {
      sessionStartedAt = Date.now();
      r.start();
      rec = r;
    } catch {
      scheduleRestart();
    }
  };

  startRecognition();

  return {
    engine: 'native',
    setMode(next, spokenText) {
      if (disposed) return;
      if (next === 'watch') spoken = spokenText ?? '';
      if (next !== mode || next !== 'turn') resetTurn();
      mode = next;
    },
    flush() {
      if (mode === 'turn') emitTurn();
    },
    async finish() {
      const text = turnText();
      this.dispose();
      return text;
    },
    dispose() {
      disposed = true;
      clearEndTimer();
      if (restartTimer) clearTimeout(restartTimer);
      try {
        rec?.abort();
      } catch {
        /* ignorar */
      }
      rec = null;
    },
  };
}

/* ---------------------------------------------------------------- Motor Deepgram (grabación + VAD) */

/** Silencio tras hablar que cierra una frase */
const UTTERANCE_SILENCE_MS = 950;
/** Voz sostenida necesaria para considerar que alguien habla / interrumpe */
const SPEECH_ON_MS = 160;
const BARGE_IN_ON_MS = 320;
const MAX_UTTERANCE_MS = 30_000;
const TICK_MS = 50;

function pickMimeType(): string | undefined {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((t) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(t));
}

async function createRecorderListener(cb: ListenerCallbacks, opts: ListenerOptions, apiKey: string): Promise<VoiceListener> {
  if (!opts.getStream) throw new MicError('unsupported');
  const stream = await opts.getStream();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  ctx.resume().catch(() => undefined);
  const mimeType = pickMimeType();

  let disposed = false;
  let mode: ListenerMode = 'off';
  let floor = 0.006;
  let aboveMs = 0;
  let silenceMs = 0;
  let speechMs = 0;
  let inSpeech = false;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let transcript = '';
  let inFlight: Promise<void> = Promise.resolve();

  const startRecorder = () => {
    if (recorder || disposed) return;
    // Cada grabación tiene su propia lista: la anterior puede seguir cerrándose mientras empieza la siguiente
    const own: Blob[] = [];
    chunks = own;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size) own.push(e.data);
    };
    recorder.start(250);
  };

  /** Detiene la grabación y transcribe lo grabado (si hubo voz) */
  const closeUtterance = (hadSpeech: boolean): Promise<void> => {
    const r = recorder;
    const recorded = chunks;
    recorder = null;
    inSpeech = false;
    silenceMs = 0;
    speechMs = 0;
    if (!r) return inFlight;
    const done = new Promise<Blob>((resolve) => {
      r.onstop = () => resolve(new Blob(recorded, { type: r.mimeType || mimeType || 'audio/webm' }));
    });
    try {
      r.stop();
    } catch {
      /* ya detenido */
    }
    if (!hadSpeech) return inFlight;

    const job = inFlight.then(async () => {
      const blob = await done;
      if (blob.size < 2000) return;
      cb.onProcessing?.(true);
      try {
        const text = (await transcribeWithDeepgram(blob, apiKey)).trim();
        if (disposed || !text) return;
        transcript = transcript ? `${transcript} ${text}` : text;
        cb.onPartial?.(transcript);
        if (opts.autoEnd) {
          const turn = transcript;
          transcript = '';
          mode = 'off';
          cb.onTurn?.(turn);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|403|invalid|credentials/i.test(msg)) {
          dispose();
          cb.onError(new MicError('stt-key'));
        } else {
          console.warn('[STT Deepgram] Falló la transcripción:', msg);
        }
      } finally {
        cb.onProcessing?.(false);
      }
    });
    inFlight = job;
    return job;
  };

  const tick = setInterval(() => {
    if (disposed || mode === 'off') return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!inSpeech) floor = Math.max(0.002, floor * 0.96 + rms * 0.04);

    if (mode === 'watch') {
      // Mientras el asistente habla se exige más volumen y más tiempo (el eco residual no debe cortarlo)
      const threshold = Math.max(0.035, floor * 4.5);
      aboveMs = rms > threshold ? aboveMs + TICK_MS : 0;
      if (aboveMs >= BARGE_IN_ON_MS) {
        aboveMs = 0;
        mode = 'turn';
        startRecorder();
        inSpeech = true;
        cb.onBargeIn?.();
      }
      return;
    }

    // mode === 'turn'
    startRecorder();
    const threshold = Math.max(0.012, floor * 2.6);
    if (rms > threshold) {
      aboveMs += TICK_MS;
      silenceMs = 0;
      if (aboveMs >= SPEECH_ON_MS) inSpeech = true;
    } else {
      aboveMs = 0;
      if (inSpeech) silenceMs += TICK_MS;
    }
    if (inSpeech) speechMs += TICK_MS;
    if (inSpeech && (silenceMs >= UTTERANCE_SILENCE_MS || speechMs >= MAX_UTTERANCE_MS)) {
      void closeUtterance(true);
    } else if (!inSpeech && recorder && chunks.length > 40) {
      // Más de 10 s de silencio grabado: se descarta y se vuelve a empezar
      void closeUtterance(false);
    }
  }, TICK_MS);

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(tick);
    try {
      recorder?.stop();
    } catch {
      /* ignorar */
    }
    recorder = null;
    try {
      source.disconnect();
    } catch {
      /* ignorar */
    }
    ctx.close().catch(() => undefined);
  }

  return {
    engine: 'deepgram',
    setMode(next) {
      if (disposed) return;
      if (next !== 'turn' && recorder) void closeUtterance(false);
      if (next !== 'turn') transcript = '';
      aboveMs = 0;
      mode = next;
    },
    flush() {
      if (mode !== 'turn') return;
      if (recorder) void closeUtterance(inSpeech || speechMs > 0 || chunks.length > 2);
    },
    async finish() {
      if (recorder) await closeUtterance(inSpeech || chunks.length > 2);
      else await inFlight;
      const text = transcript;
      dispose();
      return text;
    },
    dispose,
  };
}

/* ---------------------------------------------------------------- Fábrica */

/**
 * Crea el oyente con el mejor motor disponible. Si el motor nativo falla por red o soporte y hay clave de
 * Deepgram, cambia solo a Deepgram sin que quien llama tenga que hacer nada.
 */
export function createVoiceListener(cb: ListenerCallbacks, opts: ListenerOptions): VoiceListener {
  const engine = pickSttEngine();
  if (!engine) throw new MicError('unsupported');

  let inner: VoiceListener | null = null;
  let disposed = false;
  let mode: ListenerMode = 'off';
  let spoken = '';

  // El modo se sigue aquí también para poder trasladarlo si cambia el motor
  const tracked: ListenerCallbacks = {
    ...cb,
    onBargeIn: () => {
      mode = 'turn';
      cb.onBargeIn?.();
    },
    onTurn: (text) => {
      mode = 'off';
      cb.onTurn?.(text);
    },
  };

  const useDeepgram = () => {
    const key = deepgramKey();
    if (!key || !canRecord()) return false;
    createRecorderListener(tracked, opts, key)
      .then((l) => {
        if (disposed) {
          l.dispose();
          return;
        }
        inner = l;
        l.setMode(mode, spoken);
        cb.onEngineChange?.('deepgram');
      })
      .catch((err) => cb.onError(toMicError(err)));
    return true;
  };

  if (engine === 'native') {
    inner = createNativeListener(
      {
        ...tracked,
        onError: (err) => {
          inner?.dispose();
          inner = null;
          if ((err.code === 'network' || err.code === 'unsupported') && useDeepgram()) return;
          cb.onError(err);
        },
      },
      opts
    );
  } else {
    useDeepgram();
  }

  return {
    get engine() {
      return inner?.engine ?? engine;
    },
    setMode(next, spokenText) {
      mode = next;
      if (next === 'watch') spoken = spokenText ?? '';
      inner?.setMode(next, spokenText);
    },
    flush() {
      inner?.flush();
    },
    async finish() {
      const text = inner ? await inner.finish() : '';
      disposed = true;
      inner = null;
      return text;
    },
    dispose() {
      disposed = true;
      inner?.dispose();
      inner = null;
    },
  };
}
