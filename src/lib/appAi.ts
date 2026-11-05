import { create } from 'zustand';
import { useSecrets } from '@/store/useSecrets';
import { isSupabaseConfigured, supabase } from '@/sync/supabase';
import type { CoachAttachment } from './coachAttachments';

/**
 * IA DE LA APP
 * Claves del creador (panel del creador › IA de la app) que usa todo el mundo mientras estén puestas. Las claves se quedan
 * en el servidor: aquí solo se sabe qué servicios hay (`ai_status`) y se le piden las respuestas a la función `pilas-ai`
 * (supabase/functions/pilas-ai). Una clave propia en Ajustes siempre tiene prioridad; sin ninguna de las dos, el coach
 * usa el motor local y salen los avisos de configurar una clave.
 */

export type AppAiService = 'llm' | 'tts' | 'stt';

export interface AppAiInfo {
  provider: string;
  model?: string;
}

export type AppAiStatus = Partial<Record<AppAiService, AppAiInfo>>;

/** Copia de `ai_status` en el dispositivo: evita que los avisos parpadeen al abrir la app antes de la respuesta */
const STATUS_KEY = 'pilas:app-ai';
const FUNCTION_NAME = 'pilas-ai';
const LLM_TIMEOUT_MS = 90_000;
const TTS_TIMEOUT_MS = 35_000;

function readCached(): AppAiStatus {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as AppAiStatus) : {};
  } catch {
    return {};
  }
}

export const useAppAi = create<{ status: AppAiStatus }>()(() => ({ status: readCached() }));

const setStatus = (status: AppAiStatus) => {
  useAppAi.setState({ status });
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify(status));
  } catch {
    /* sin almacenamiento: se vuelve a pedir en el próximo arranque */
  }
};

/** Pide qué servicios hay. Si falla la red se conserva lo último conocido */
export async function refreshAppAi(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const { data, error } = await supabase().rpc('ai_status');
  // PGRST202: la migración 0004 aún no está aplicada, así que no hay IA de la app
  if (error) {
    if (error.code === 'PGRST202') setStatus({});
    return;
  }
  setStatus((data ?? {}) as AppAiStatus);
}

export const appAiInfo = (service: AppAiService): AppAiInfo | undefined => useAppAi.getState().status[service];

/** La clave propia de IA sirve solo si parece una clave */
export const hasOwnAiKey = (key: string | undefined) => Boolean(key && key.trim().length > 8);

/** ¿El coach puede responder con IA (clave propia o de la app)? */
export const useHasAi = (): boolean => {
  const own = useSecrets((s) => hasOwnAiKey(s.keys.geminiApiKey));
  const app = useAppAi((s) => Boolean(s.status.llm));
  return own || app;
};

/* ---------------- Peticiones a la función ---------------- */

export type AppAiFailure = 'quota' | 'unavailable' | 'auth' | 'banned' | 'provider';

export class AppAiError extends Error {
  constructor(
    readonly kind: AppAiFailure,
    /** Código del proveedor si fue él quien falló (401 clave, 429 límite…) */
    readonly status?: number,
  ) {
    super(`IA de la app: ${kind}${status ? ` (${status})` : ''}`);
  }
  /** Solo vale la pena reintentar un fallo pasajero del proveedor */
  get retryable() {
    return this.kind === 'provider' && (this.status === 429 || (this.status ?? 0) >= 500);
  }
}

const KINDS: Record<string, AppAiFailure> = { quota: 'quota', banned: 'banned', auth: 'auth', provider: 'provider' };

async function call(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AppAiError('auth');
  const url = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')}/functions/v1/${FUNCTION_NAME}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Sin conexión, sin respuesta a tiempo o la función aún no está desplegada
    throw new AppAiError('unavailable');
  }
  if (res.ok) return res;
  const info = (await res.json().catch(() => ({}))) as { error?: string; status?: number };
  throw new AppAiError(KINDS[info.error ?? ''] ?? 'unavailable', info.status);
}

export type AppAiTurn = { role: 'user' | 'model'; text: string };

/** Respuesta del modelo de la app (con su modelo de respaldo, si lo tiene) */
export async function appAiComplete(
  system: string | undefined,
  history: AppAiTurn[],
  prompt: string,
  temperature = 0.7,
  attachments: readonly CoachAttachment[] = [],
): Promise<string> {
  const files = attachments.map(({ name, mime, kind, data, text }) => ({ name, mime, kind, ...(data ? { data } : {}), ...(text ? { text } : {}) }));
  const res = await call(
    { service: 'llm', system, history: history.slice(-6), prompt, temperature, ...(files.length ? { attachments: files } : {}) },
    LLM_TIMEOUT_MS,
  );
  const { text } = (await res.json()) as { text?: string };
  if (!text) throw new AppAiError('provider');
  return text;
}

/** Audio de la voz de la app: PCM de 24 kHz o el formato que indique `mime` */
export async function appAiSpeech(text: string, gender: 'male' | 'female'): Promise<{ data: Uint8Array; mime: string }> {
  const res = await call({ service: 'tts', text, gender }, TTS_TIMEOUT_MS);
  return { data: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('Content-Type') || 'audio/pcm;rate=24000' };
}

/** Comprueba el dictado de la app con un audio mínimo: si el proveedor lo rechaza por vacío (400), la clave vale */
export async function appAiCheckDictation(): Promise<void> {
  try {
    await call({ service: 'stt', audio: 'AAAAAAAAAAAAAAAAAAAAAA==', mime: 'audio/wav' }, TTS_TIMEOUT_MS);
  } catch (err) {
    if (!(err instanceof AppAiError && err.kind === 'provider' && err.status === 400)) throw err;
  }
}

/** Texto para el panel del creador según lo que falló */
export function describeAppAiError(err: unknown): string {
  if (!(err instanceof AppAiError)) return 'No se pudo comprobar.';
  if (err.kind === 'unavailable') return 'No hay respuesta de la función «pilas-ai»: revisa que esté desplegada en Supabase.';
  if (err.kind === 'quota') return 'Se alcanzó el límite diario.';
  if (err.kind === 'auth') return 'Tu sesión no es válida: vuelve a iniciar sesión.';
  if (err.kind === 'banned') return 'Esta cuenta tiene un veto activo.';
  if (err.status === 401 || err.status === 403) return `El proveedor rechazó la clave (${err.status}).`;
  if (err.status === 402) return 'La cuenta del proveedor no tiene saldo (402).';
  if (err.status === 404) return 'El proveedor no encontró ese modelo (404).';
  if (err.status === 429) return 'El proveedor limitó las peticiones (429). Prueba en un rato.';
  return `El proveedor falló${err.status ? ` (${err.status})` : ''}.`;
}
