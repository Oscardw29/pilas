import { GoogleGenAI } from '@google/genai';
import type { AppData, AiPlatform } from '@/types';
import { consistency, goalProgress, recoveryStats } from './metrics';
import { economySummary } from './economy';
import { todayKey } from './dates';
import { FAIL_REASON_LABELS } from './insights';
import { getSecrets } from '@/store/useSecrets';
import { getCoachPersona } from '@/components/coach/coachPersona';
import { appAiComplete, appAiInfo, AppAiError, hasOwnAiKey } from './appAi';
import { voiceTagsEnabled } from './coachVoice';
import { VOICE_TAGS_PROMPT } from './voiceTags';
import { localCoachReply } from './coachLocal';

/** Tiempo máximo para listar modelos */
const MODELS_TIMEOUT_MS = 15_000;

export interface ModelOption {
  id: string;
  name: string;
  isRecommended?: boolean;
}

/**
 * Modelos predefinidos por plataforma (usados como base y como fallback si no hay conexión)
 */
export const PRESET_MODELS: Record<AiPlatform, ModelOption[]> = {
  gemini: [
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite (Rápido y eficiente)', isRecommended: true },
    { id: 'gemini-3.1-flash', name: 'Gemini 3.1 Flash (Equilibrado)', isRecommended: true },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite (Baja latencia)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Recomendado estándar)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Razonamiento profundo)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Máxima capacidad)' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Rápido y económico)', isRecommended: true },
    { id: 'gpt-4o', name: 'GPT-4o (Omni multimodal)', isRecommended: true },
    { id: 'o3-mini', name: 'o3-mini (Razonamiento avanzado)' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile (Ultra veloz)', isRecommended: true },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant (Instantáneo)', isRecommended: true },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Contexto 32k)' },
    { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT' },
  ],
  openrouter: [
    { id: 'google/gemini-2.5-flash-lite', name: 'Google Gemini 2.5 Flash Lite (OpenRouter)', isRecommended: true },
    { id: 'google/gemini-2.5-flash', name: 'Google Gemini 2.5 Flash', isRecommended: true },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B Instruct' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    { id: 'openai/gpt-4o-mini', name: 'OpenAI GPT-4o Mini' },
  ],
};

/**
 * Consulta la API de la plataforma indicada para obtener los modelos disponibles en tiempo real.
 */
export async function fetchAvailableModels(platform: AiPlatform, apiKey: string): Promise<ModelOption[]> {
  const presets = PRESET_MODELS[platform] || PRESET_MODELS.gemini;
  if (!apiKey || apiKey.trim().length < 8) {
    return presets;
  }

  const trimmedKey = apiKey.trim();

  try {
    if (platform === 'gemini') {
      // La clave va en cabecera (no en la URL) para que no quede en historiales, logs ni cabeceras Referer
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': trimmedKey },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (Array.isArray(data.models)) {
        const fetched = data.models
          .filter((m: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
          .map((m: any) => {
            const cleanId = m.name.replace(/^models\//, '');
            return {
              id: cleanId,
              name: m.displayName ? `${m.displayName} (${cleanId})` : cleanId,
            };
          });

        // Combinar asegurando que los recomendados del usuario (3.5 Flash Lite y 3.1 Flash) estén al inicio
        const existingIds = new Set(fetched.map((f: ModelOption) => f.id));
        const merged: ModelOption[] = [];

        presets.forEach((p) => {
          if (!existingIds.has(p.id)) {
            merged.push(p);
          }
        });

        return [...merged, ...fetched];
      }
    } else if (platform === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${trimmedKey}` },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          const chatModels = data.data
            .filter((m: any) => m.id.includes('gpt') || m.id.includes('o1') || m.id.includes('o3'))
            .map((m: any) => ({
              id: m.id,
              name: m.id,
            }))
            .sort((a: ModelOption, b: ModelOption) => a.id.localeCompare(b.id));
          return chatModels.length > 0 ? chatModels : presets;
        }
      }
    } else if (platform === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${trimmedKey}` },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          return data.data.map((m: any) => ({ id: m.id, name: m.id }));
        }
      }
    } else if (platform === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${trimmedKey}` },
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.data)) {
          return data.data.slice(0, 50).map((m: any) => ({
            id: m.id,
            name: m.name ? `${m.name} (${m.id})` : m.id,
          }));
        }
      }
    }
  } catch (err) {
    console.warn(`[AI Models] No se pudieron cargar los modelos en vivo de ${platform}:`, err);
  }

  return presets;
}

/**
 * INTEGRADOR CON EL COACH CONDUCTUAL
 * Construye un contexto rico y estructurado con los datos reales del usuario.
 */
export function buildSystemContext(data: AppData, ref = todayKey()): string {
  const activeHabits = data.habits.filter((h) => h.status === 'active');
  const activeGoals = data.goals.filter((g) => g.status === 'active');
  const pts = economySummary(data);

  const goalsSummary = activeGoals
    .map((g) => {
      const prog = Math.round(goalProgress(data, g, ref) * 100);
      return `- Objetivo: "${g.name}" (${g.category}) | Progreso: ${prog}% | Prioridad: ${
        g.priority === 3 ? 'Alta' : g.priority === 2 ? 'Media' : 'Baja'
      } | Meta: ${g.targetDate ?? 'Sin fecha límite'}`;
    })
    .join('\n');

  const habitsSummary = activeHabits
    .map((h) => {
      const c = consistency(data, h, 30, ref);
      const cText = c != null ? `${Math.round(c * 100)}%` : 'Sin datos';
      const rec = recoveryStats(data, h, ref);
      const recText = rec.average != null ? `${rec.average.toFixed(1)} días` : 'N/A';
      return `- Hábito: "${h.name}" | Consistencia 30d: ${cText} | Objetivo diario: ${
        h.targetMinutes ? `${h.targetMinutes} min` : h.targetLabel ?? 'Hecho'
      } | Mínimo: ${
        h.minimumMinutes ? `${h.minimumMinutes} min` : h.minimumLabel ?? 'Mínimo'
      } | Horario: ${h.preferredTime} | Recuperación prom.: ${recText}`;
    })
    .join('\n');

  // Razones de fallos
  const failLogs = Object.values(data.logs).filter((l) => l.status === 'missed' && l.failReason);
  const failCounts: Record<string, number> = {};
  failLogs.forEach((l) => {
    if (l.failReason) failCounts[l.failReason] = (failCounts[l.failReason] || 0) + 1;
  });
  const failSummary = Object.entries(failCounts)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([r, count]) =>
        `${FAIL_REASON_LABELS[r as keyof typeof FAIL_REASON_LABELS] || r}: ${count} veces (${Math.round(
          (count / failLogs.length) * 100
        )}%)`
    )
    .join(', ');

  // Experimentos
  const expSummary = data.experiments
    .map((e) => `- Experimento: "${e.name}" | Estado: ${e.status} | Conclusión: ${e.conclusion ?? 'En curso'}`)
    .join('\n');

  const persona = getCoachPersona(data.settings);
  return `Eres ${persona.name}, ${persona.article} ${persona.role} de hábitos de "¡Pilas!", una aplicación de alto rendimiento para el desarrollo personal basada en datos reales. Hablas en primera persona con tu nombre y tu género (${persona.role}), con un tono cercano y con energía.

REGLAS DE ORO DEL COACH:
1. NUNCA optimices para que el usuario acumule más hábitos. Optimiza para MEJORES hábitos y máxima consistencia.
2. Es perfectamente válido y deseable decirle al usuario si tiene demasiados objetivos, si un hábito no aporta a sus metas o si debe reducir su dificultad.
3. Responde de forma concisa, cálida pero directa y basada estrictamente en sus datos. No des consejos genéricos de autoayuda; usa sus números reales.
4. Idioma: Español.

DATOS DEL USUARIO:
Nombre: ${data.settings.userName || 'Usuario'}
Monedas actuales: ${pts.balance} (Ganadas: ${pts.earned}, Gastadas: ${pts.spent}) · XP total: ${pts.xpTotal}
Fecha de hoy: ${ref}

OBJETIVOS ACTIVOS:
${goalsSummary || 'Ninguno'}

HÁBITOS ACTIVOS:
${habitsSummary || 'Ninguno'}

OBSTÁCULOS Y RAZONES DE FALLO REGISTRADAS:
${failSummary || 'Sin registros de fallo recientes'}

EXPERIMENTOS:
${expSummary || 'Ninguno'}

ACCIONES DIRECTAS EN LA PLATAFORMA (CON CONFIRMACIÓN PREVIA DEL USUARIO):
Puedes proponer y preparar acciones para que el usuario las aplique en su cuenta con 1 solo clic.
Cuando el usuario te pida (o le sugieras de mutuo acuerdo) crear un hábito, editarlo, eliminarlo, crear un experimento, crear una conexión/dependencia o crear una recompensa, redacta tu respuesta normalmente y al final incluye un bloque de acción estructurado con este formato exacto:

\`\`\`action
{
  "action": "create_habit" | "update_habit" | "delete_habit" | "create_experiment" | "create_connection" | "create_reward",
  "data": { ... }
}
\`\`\`

Detalles según la acción:
- create_habit: { "name": string, "icon": string, "color"?: string, "targetMinutes"?: number, "minimumMinutes"?: number, "preferredTime"?: "morning"|"afternoon"|"evening"|"any", "days"?: number[], "points"?: number, "priority"?: 1|2|3 }
- update_habit: { "habitId": string, "habitName": string, "patch": { "name"?: string, "targetMinutes"?: number, "minimumMinutes"?: number, "preferredTime"?: string } }
- delete_habit: { "habitId": string, "habitName": string }
- create_experiment: { "name": string, "hypothesis": string, "type": "schedule"|"duration"|"routine", "durationDays": number, "variants": [ { "id": "v1", "label": string, "startDay": 1, "endDay": number }, { "id": "v2", "label": string, "startDay": number, "endDay": number } ] }
- create_connection: { "fromHabitName": string, "toHabitName": string, "type": "before"|"after"|"facilitates"|"depends_on", "note"?: string }
- create_reward: { "name": string, "icon": string, "cost": number }

El usuario siempre verá una tarjeta de confirmación interactiva para verificar y confirmar la acción antes de ejecutarla.
`;
}

export const hasGeminiKey = hasOwnAiKey;

/** Tiempo máximo de espera de una respuesta de IA */
const AI_TIMEOUT_MS = 45_000;

type ChatTurn = { role: 'user' | 'model'; text: string };

const OPENAI_COMPATIBLE_ENDPOINTS: Record<Exclude<AiPlatform, 'gemini'>, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

/** Modelos de Gemini con alias que pueden no existir en el tier del usuario → modelo compatible */
const GEMINI_404_FALLBACK: Record<string, string> = {
  'gemini-3.5-flash-lite': 'gemini-2.0-flash',
  'gemini-3.1-flash': 'gemini-2.0-flash',
};

const isNotFound = (msg: string) => msg.includes('404') || msg.toLowerCase().includes('not found');

/**
 * Petición de texto a la plataforma indicada (sin contexto del usuario: eso lo añade quien llama).
 */
async function requestCompletion(
  platform: AiPlatform,
  apiKey: string,
  modelName: string,
  systemInstruction: string | undefined,
  history: ChatTurn[],
  userPrompt: string,
  temperature = 0.7
): Promise<string> {
  const trimmedKey = apiKey.trim();

  if (platform === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: trimmedKey });
    const contents = [
      ...history.slice(-6).map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: 'user', parts: [{ text: userPrompt }] },
    ];
    const run = async (model: string) => {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { systemInstruction, temperature, abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS) },
      });
      if (!response.text) throw new Error('Respuesta vacía recibida del modelo.');
      return response.text;
    };
    try {
      return await run(modelName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const alt = GEMINI_404_FALLBACK[modelName];
      if (alt && isNotFound(msg)) return run(alt);
      throw err;
    }
  }

  // Plataformas compatibles con OpenAI Chat Completions (OpenAI, Groq, OpenRouter)
  const messages = [
    ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
    ...history.slice(-6).map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: userPrompt },
  ];

  const res = await fetch(OPENAI_COMPATIBLE_ENDPOINTS[platform], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${trimmedKey}`,
      // Sin HTTP-Referer: no se comparte el origen de la app con OpenRouter
      ...(platform === 'openrouter' ? { 'X-Title': 'Pilas' } : {}),
    },
    body: JSON.stringify({ model: modelName, messages, temperature }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    const detail = errorData?.error?.message || errorData?.message || `HTTP ${res.status}: ${res.statusText}`;
    throw new Error(detail);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía recibida del servidor de IA.');
  return text;
}

/** Modelos por defecto según plataforma (los de OpenAI no existen en Groq/OpenRouter) */
const DEFAULT_MODELS: Record<AiPlatform, { primary: string; backup: string }> = {
  gemini: { primary: 'gemini-3.5-flash-lite', backup: 'gemini-3.1-flash' },
  openai: { primary: 'gpt-4o-mini', backup: 'gpt-4o' },
  groq: { primary: 'llama-3.3-70b-versatile', backup: 'llama-3.1-8b-instant' },
  openrouter: { primary: 'google/gemini-2.5-flash-lite', backup: 'google/gemini-2.5-flash' },
};

function resolveModels(data: AppData) {
  const platform: AiPlatform = data.settings.aiPlatform || 'gemini';
  const defaults = DEFAULT_MODELS[platform];
  return {
    platform,
    primaryModel: data.settings.geminiModel?.trim() || defaults.primary,
    backupModel: data.settings.backupModel?.trim() || defaults.backup,
  };
}

/**
 * Consulta con modelo principal y respaldo automático:
 * 1. Intenta con el modelo principal.
 * 2. Si falla, conmuta automáticamente al modelo de respaldo.
 * 3. Si ambos fallan o no hay clave, recurre al motor analítico local.
 */
export async function generateHabitAdvice(
  data: AppData,
  userPrompt: string,
  history: ChatTurn[] = []
): Promise<string> {
  const apiKey = getSecrets().geminiApiKey.trim();
  const { platform, primaryModel, backupModel } = resolveModels(data);

  // Con una voz expresiva (Fish Audio S2) el coach añade etiquetas de tono que solo oye el usuario
  const withVoiceTags = !data.settings.coachMuted && voiceTagsEnabled();
  const systemInstruction = buildSystemContext(data) + (withVoiceTags ? `\n\n${VOICE_TAGS_PROMPT}` : '');

  if (!hasGeminiKey(apiKey)) {
    // Sin clave propia: la IA de la app, si el creador la dejó puesta; sin ninguna de las dos, motor analítico local
    if (appAiInfo('llm')) return adviceFromAppAi(data, systemInstruction, userPrompt, history);
    return generateLocalHabitAdvice(data, userPrompt);
  }

  // 1. INTENTAR CON EL MODELO PRINCIPAL
  try {
    return await requestCompletion(platform, apiKey, primaryModel, systemInstruction, history, userPrompt);
  } catch (primaryErr: unknown) {
    const primaryMsg = describeError(primaryErr);
    console.warn(`[AI Coach] Falló modelo principal "${primaryModel}": ${primaryMsg}. Probando modelo de respaldo "${backupModel}"...`);

    // 2. CONMUTAR AL MODELO DE RESPALDO SI EL PRIMERO FALLA
    if (backupModel && backupModel !== primaryModel) {
      try {
        const backupResponse = await requestCompletion(platform, apiKey, backupModel, systemInstruction, history, userPrompt);
        return `${backupResponse}\n\n*(⚡ Nota: El modelo principal «${primaryModel}» no respondió. Se utilizó automáticamente el modelo de respaldo «${backupModel}»).*`;
      } catch (backupErr: unknown) {
        const backupMsg = describeError(backupErr);
        console.warn(`[AI Coach] Modelo de respaldo "${backupModel}" también falló: ${backupMsg}`);
        const fallback = generateLocalHabitAdvice(data, userPrompt);
        return `${fallback}\n\n*(⚠️ Nota: Falló el modelo principal «${primaryModel}» [${primaryMsg}] y el de respaldo «${backupModel}» [${backupMsg}]. Se activó el motor analítico local).*`;
      }
    }

    const fallback = generateLocalHabitAdvice(data, userPrompt);
    return `${fallback}\n\n*(⚠️ Nota: El modelo «${primaryModel}» falló [${primaryMsg}]. Se activó el motor analítico local).*`;
  }
}

/** Respuesta con la IA de la app. Si no responde o se acabó el cupo del día, contesta el motor local y lo dice */
async function adviceFromAppAi(data: AppData, systemInstruction: string, userPrompt: string, history: ChatTurn[]): Promise<string> {
  try {
    return await appAiComplete(systemInstruction, history, userPrompt);
  } catch (err) {
    console.warn('[AI Coach] La IA de la app no respondió:', err);
    const note =
      err instanceof AppAiError && err.kind === 'quota'
        ? 'Llegaste al límite diario de la IA de la app: mañana se renueva. Si quieres seguir hoy, puedes añadir tu propia clave en Ajustes.'
        : 'La IA de la app no respondió ahora mismo.';
    return `${generateLocalHabitAdvice(data, userPrompt)}\n\n*(⚠️ Nota: ${note} Te respondí con el motor local).*`;
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `sin respuesta tras ${AI_TIMEOUT_MS / 1000} s`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Motor de respuestas local (sin IA): intenciones, frases con voz grabada y datos reales en lib/coachLocal */
export function generateLocalHabitAdvice(data: AppData, userPrompt: string): string {
  return localCoachReply(data, userPrompt);
}

/**
 * Genera un título automático conciso (2 a 4 palabras) basado en el tema de la conversación.
 * Usa la plataforma y el modelo configurados (nunca envía la clave a otro proveedor). Sin clave propia se queda con el
 * título heurístico: no vale la pena gastar un uso de la IA de la app en un título.
 */
export async function generateTopicTitle(userPrompt: string, data: AppData): Promise<string> {
  const clean = userPrompt.trim();
  if (!clean) return 'Nueva conversación';

  // Extracción heurística inmediata
  const heuristic = (() => {
    let text = clean
      .replace(/^(hola|buenas|coach|oye|quisiera saber|como puedo|ayuda con|dime|quiero|me gustaria)\s+/i, '')
      .replace(/[¿?¡!.,]/g, '')
      .trim();
    if (!text) text = clean;
    const words = text.split(/\s+/).slice(0, 4).join(' ');
    const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
    return capitalized || 'Consulta de hábitos';
  })();

  const key = getSecrets().geminiApiKey;
  if (!hasGeminiKey(key)) return heuristic.slice(0, 32);

  const { platform, primaryModel } = resolveModels(data);
  try {
    const raw = await requestCompletion(
      platform,
      key,
      primaryModel,
      undefined,
      [],
      `Genera un título muy conciso de 2 a 4 palabras en español (sin comillas, sin signos) que resuma el tema central de esta pregunta de hábitos: "${clean}"`,
      0.2
    );
    const title = raw.trim().replace(/[*_#`"']/g, '');
    return (title && title.length > 2 && title.length < 35 ? title : heuristic).slice(0, 32);
  } catch {
    return heuristic.slice(0, 32);
  }
}
