import React, { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, CheckCircle2, DatabaseZap, ExternalLink, Eye, EyeOff, Headphones, Layers, Mic, Play, RefreshCw, Save, ShieldCheck, Sparkles, Trash2, TriangleAlert, Volume2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useToast } from '@/components/ui/ToastContext';
import { appAiCheckDictation, appAiComplete, appAiSpeech, describeAppAiError, refreshAppAi, type AppAiService } from '@/lib/appAi';
import { speakCoach, unlockCoachVoice } from '@/lib/coachVoice';
import { playSound } from '@/lib/sound';
import { adminAiServices, adminClearAiService, adminSetAiService, SocialError } from '@/social/api';
import type { AdminAiService } from '@/social/types';
import type { AiPlatform } from '@/types';
import { fetchAvailableModels, PRESET_MODELS, type ModelOption } from '@/lib/gemini';
import { PRESET_TTS_MODELS } from '@/lib/ttsPresets';
import './aiServices.css';

interface Provider {
  value: string;
  label: string;
  /** Lema corto bajo el nombre en la tarjeta de plataforma (como en Ajustes) */
  tag: string;
  keyPlaceholder: string;
  keyLink: { href: string; text: string };
  /** Modelos que se ofrecen en el selector (los mismos que en Ajustes) */
  models: { id: string; name: string }[];
}

interface ServiceDef {
  id: AppAiService;
  title: string;
  sub: string;
  icon: React.ReactNode;
  providers: Provider[];
  defaultLimit: number;
}

const llm = (value: AiPlatform, label: string, tag: string, keyPlaceholder: string, keyLink: Provider['keyLink']): Provider => ({
  value,
  label,
  tag,
  keyPlaceholder,
  keyLink,
  models: PRESET_MODELS[value],
});
const tts = (value: string, label: string, tag: string, keyPlaceholder: string, keyLink: Provider['keyLink'], models?: Provider['models']): Provider => ({
  value,
  label,
  tag,
  keyPlaceholder,
  keyLink,
  models: models ?? PRESET_TTS_MODELS[value] ?? [],
});

const SERVICES: ServiceDef[] = [
  {
    id: 'llm',
    title: 'Inteligencia Artificial y Coach Conductual',
    sub: 'Las respuestas del coach en el chat para todas las personas sin clave propia, con modelo de respaldo ante saturaciones.',
    icon: <Sparkles aria-hidden="true" />,
    providers: [
      llm('gemini', 'Google Gemini', 'Recomendado', 'AIzaSy...', { href: 'https://aistudio.google.com/app/apikey', text: 'Obtener clave gratuita en Google AI Studio' }),
      llm('openai', 'OpenAI (ChatGPT)', 'GPT-4o', 'sk-proj-...', { href: 'https://platform.openai.com/api-keys', text: 'Obtener clave en OpenAI Platform' }),
      llm('groq', 'Groq', 'Baja latencia', 'gsk_...', { href: 'https://console.groq.com/keys', text: 'Obtener clave en Groq Console' }),
      llm('openrouter', 'OpenRouter', 'Multi-modelo', 'sk-or-...', { href: 'https://openrouter.ai/keys', text: 'Obtener clave en OpenRouter' }),
    ],
    defaultLimit: 40,
  },
  {
    id: 'tts',
    title: 'Voz Neuronal (TTS)',
    sub: 'La voz con la que el coach lee sus respuestas. Cada fragmento leído cuenta como un uso.',
    icon: <Headphones aria-hidden="true" />,
    providers: [
      tts('fish_audio', 'Fish Audio', 'Ultra-realista', 'fish_...', { href: 'https://fish.audio', text: 'fish.audio' }),
      tts('elevenlabs', 'ElevenLabs', 'Voces premium', 'sk_...', { href: 'https://elevenlabs.io', text: 'elevenlabs.io' }),
      // Los que acepta /v1/audio/speech (pilas-ai usa gpt-4o-mini-tts si no se elige otro)
      tts('openai', 'OpenAI TTS', 'Nova, Alloy…', 'sk-proj-...', { href: 'https://platform.openai.com/api-keys', text: 'openai.com' }, [
        { id: 'gpt-4o-mini-tts', name: 'OpenAI GPT-4o Mini TTS (Expresivo · recomendado)' },
        { id: 'tts-1', name: 'OpenAI TTS-1 (Baja latencia estándar)' },
        { id: 'tts-1-hd', name: 'OpenAI TTS-1 HD (Alta fidelidad 24kHz)' },
      ]),
      tts('gemini', 'Google Gemini', 'Voces de Gemini', 'AIzaSy...', { href: 'https://aistudio.google.com/app/apikey', text: 'Google AI Studio' }, [
        { id: 'gemini-2.5-flash-preview-tts', name: 'Gemini 2.5 Flash TTS (Rápido)' },
        { id: 'gemini-2.5-pro-preview-tts', name: 'Gemini 2.5 Pro TTS (Máxima calidad)' },
      ]),
    ],
    defaultLimit: 200,
  },
  {
    id: 'stt',
    title: 'Dictado (STT)',
    sub: 'Pasar voz a texto. La clave queda lista, pero la app todavía no tiene botón de dictado que la use.',
    icon: <Mic aria-hidden="true" />,
    providers: [
      tts('deepgram', 'Deepgram', 'Nova-3 en español', 'dg_...', { href: 'https://console.deepgram.com', text: 'console.deepgram.com' }, [
        { id: 'nova-3', name: 'Deepgram Nova-3 (Recomendado · puntuación automática)' },
        { id: 'nova-2', name: 'Deepgram Nova-2' },
      ]),
    ],
    defaultLimit: 40,
  },
];

interface Form {
  provider: string;
  model: string;
  backupModel: string;
  voice: string;
  limit: string;
  key: string;
}

const formFrom = (def: ServiceDef, saved?: AdminAiService): Form => {
  const provider = def.providers.find((p) => p.value === saved?.provider) ?? def.providers[0];
  return {
    provider: provider.value,
    // Lo guardado manda (vacío = el predeterminado del servidor); sin nada guardado se proponen los recomendados
    model: saved ? saved.model ?? '' : provider.models[0]?.id ?? '',
    backupModel: saved ? saved.backup_model ?? '' : def.id === 'llm' ? provider.models[1]?.id ?? '' : '',
    voice: saved?.voice ?? '',
    limit: String(saved?.daily_limit ?? def.defaultLimit),
    key: '',
  };
};

/** Usos al día por persona: entero entre 1 y 100.000 */
const readLimit = (text: string) => {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
};

/** Opciones del selector; un modelo guardado que no está en la lista se conserva como «personalizado» */
const modelOptions = (models: { id: string; name: string }[], current: string, allowEmpty = false) => {
  const list = models.map((m) => ({ value: m.id, label: m.name, sublabel: m.id }));
  if (allowEmpty) list.unshift({ value: '', label: 'Sin respaldo', sublabel: 'Solo el modelo principal' });
  else if (!current) list.unshift({ value: '', label: 'Predeterminado del servidor', sublabel: 'El que usa pilas-ai si no eliges otro' });
  if (current && !list.some((o) => o.value === current)) list.push({ value: current, label: `${current} (Personalizado)`, sublabel: 'Modelo manual' });
  return list;
};

const ServiceCard: React.FC<{ def: ServiceDef; saved?: AdminAiService; onChanged: () => Promise<void> }> = ({ def, saved, onChanged }) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => formFrom(def, saved));
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** Modelos de la cuenta detectados con la clave pegada (solo LLM; la clave guardada nunca vuelve al dispositivo) */
  const [detected, setDetected] = useState<{ provider: string; models: ModelOption[] } | null>(null);

  // Al volver a cargar lo guardado (tras guardar o quitar) el formulario enseña lo del servidor, sin la clave pegada
  useEffect(() => setForm(formFrom(def, saved)), [def, saved]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest(null);
  };
  const provider = def.providers.find((p) => p.value === form.provider) ?? def.providers[0];
  const models = detected?.provider === provider.value ? detected.models : provider.models;
  const limit = readLimit(form.limit);
  // La clave guardada es de su plataforma: al cambiar de plataforma hace falta pegar la nueva
  const providerChanged = Boolean(saved && saved.provider !== form.provider);
  const needsKey = !saved || providerChanged;
  const canSave = !busy && limit !== null && (!needsKey || Boolean(form.key.trim()));
  const isLlm = def.id === 'llm';

  /** Cambiar de plataforma propone sus modelos recomendados, como en Ajustes */
  const pickProvider = (value: string) => {
    const next = def.providers.find((p) => p.value === value) ?? def.providers[0];
    set({
      provider: next.value,
      model: next.models[0]?.id ?? '',
      backupModel: isLlm ? next.models[1]?.id ?? '' : '',
    });
    setDetected(null);
  };

  const save = async () => {
    if (limit === null) return;
    setBusy(true);
    try {
      await adminSetAiService({
        service: def.id,
        provider: form.provider,
        apiKey: form.key,
        model: form.model,
        backupModel: form.backupModel,
        voice: form.voice,
        dailyLimit: limit,
      });
      await onChanged();
      playSound.pop();
      toast(`${def.title}: guardado. Ya lo usan todas las personas sin clave propia.`, 'success');
    } catch (err) {
      toast(err instanceof SocialError ? err.message : 'No se pudo guardar', 'error');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    setBusy(true);
    try {
      await adminClearAiService(def.id);
      await onChanged();
      setTest(null);
      playSound.delete();
      toast(`${def.title}: clave quitada del servidor.`, 'info');
    } catch (err) {
      toast(err instanceof SocialError ? err.message : 'No se pudo quitar', 'error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Verificar: con una clave recién pegada (LLM) se listan los modelos de esa cuenta, como en Ajustes.
   * Con la clave ya guardada, la prueba pasa por la función `pilas-ai` como lo haría cualquier persona.
   */
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      if (isLlm && form.key.trim()) {
        const list = await fetchAvailableModels(provider.value as AiPlatform, form.key);
        setDetected({ provider: provider.value, models: list });
        setTest({ ok: true, text: `${list.length} modelos disponibles en esa cuenta. Elige y pulsa Guardar.` });
      } else if (!saved) {
        setTest({ ok: false, text: 'Pega una clave y guárdala para poder probarla.' });
      } else if (isLlm) {
        const text = await appAiComplete(undefined, [], 'Responde únicamente con la palabra: listo', 0);
        setTest({ ok: true, text: `Respondió: «${text.trim().slice(0, 60)}»` });
      } else if (def.id === 'tts') {
        const sample = 'Hola, así sueno con la voz de la app.';
        unlockCoachVoice();
        await appAiSpeech(sample, 'male');
        void speakCoach(sample, 'male', { provider: { kind: 'app', via: saved.provider ?? '', model: saved.model ?? '' }, label: '' });
        setTest({ ok: true, text: 'La voz respondió.' });
      } else {
        await appAiCheckDictation();
        setTest({ ok: true, text: 'Deepgram aceptó la clave.' });
      }
    } catch (err) {
      setTest({ ok: false, text: describeAppAiError(err) });
    } finally {
      setTesting(false);
    }
  };

  const keyField = (
    <div className="field">
      <div className="row-between">
        <span className="label">
          {isLlm ? `Clave de API (${provider.label})` : `${provider.label} API Key`}
        </span>
        <a href={provider.keyLink.href} target="_blank" rel="noreferrer" className="small accent ai-service-link">
          {provider.keyLink.text} <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      <span className="ai-service-key">
        <input
          className="input"
          type={showKey ? 'text' : 'password'}
          autoComplete="new-password"
          data-lpignore="true"
          data-1p-ignore="true"
          data-bwignore="true"
          data-form-type="other"
          spellCheck={false}
          placeholder={saved && !providerChanged ? `Guardada (…${saved.key_hint}). Déjala vacía para conservarla` : provider.keyPlaceholder}
          value={form.key}
          onChange={(e) => set({ key: e.target.value })}
          aria-label={`Clave de ${provider.label}`}
        />
        <button type="button" className="ai-service-eye" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Ocultar clave' : 'Mostrar clave'} title={showKey ? 'Ocultar clave' : 'Mostrar clave'}>
          {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
      <span className="hint" style={providerChanged && !form.key.trim() ? { color: 'var(--warning)' } : undefined}>
        {providerChanged && !form.key.trim()
          ? `Cambiaste a ${provider.label}: pega su clave para poder guardar (la guardada es de otra plataforma).`
          : 'Se guarda en el servidor y nunca llega a los dispositivos: la usa la función de la app por todos.'}
      </span>
    </div>
  );

  return (
    <div className={`card ai-service${isLlm ? ' highlight ai-service-main' : ''}`}>
      <div className="card-head">
        <div className="row">
          <span className="ai-service-icon">{def.icon}</span>
          <div>
            <div className="card-title">{def.title}</div>
            <div className="card-sub">{def.sub}</div>
          </div>
        </div>
        {saved ? (
          <span className="badge success">
            <CheckCircle2 size={12} aria-hidden="true" /> Activa · …{saved.key_hint}
          </span>
        ) : (
          <span className="badge">Sin clave</span>
        )}
      </div>

      <div className="form">
        {isLlm ? (
          <>
            {/* Plataforma en tarjetas, como en Ajustes */}
            <div className="field">
              <span className="label">Plataforma de IA</span>
              <div className="ai-platforms" role="radiogroup" aria-label="Plataforma de IA">
                {def.providers.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={form.provider === p.value}
                    className={`ai-platform${form.provider === p.value ? ' is-on' : ''}`}
                    onClick={() => pickProvider(p.value)}
                  >
                    <span className="ai-platform-name">{p.label}</span>
                    <span className="ai-platform-tag">{p.tag}</span>
                  </button>
                ))}
              </div>
            </div>
            {keyField}
            <div className="grid-2 ai-service-pair">
              <div className="field">
                <div className="row-between ai-service-label">
                  <span className="label">
                    <Layers size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} /> Modelo principal
                  </span>
                  <span className="badge ai-badge-main">Prioritario</span>
                </div>
                <CustomSelect value={form.model} onChange={(model) => set({ model })} options={modelOptions(models, form.model)} searchable ariaLabel="Modelo principal" />
                <span className="hint">El que responde siempre que esté disponible.</span>
              </div>
              <div className="field">
                <div className="row-between ai-service-label">
                  <span className="label">
                    <ShieldCheck size={14} aria-hidden="true" style={{ color: 'var(--emerald)' }} /> Modelo de respaldo (Fallback)
                  </span>
                  <span className="badge ai-badge-auto">Automático</span>
                </div>
                <CustomSelect
                  value={form.backupModel}
                  onChange={(backupModel) => set({ backupModel })}
                  options={modelOptions(models, form.backupModel, true)}
                  searchable
                  ariaLabel="Modelo de respaldo"
                />
                <span className="hint">Se usa automáticamente si el principal falla o está saturado.</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid-2 ai-service-pair">
              <div className="field">
                <div className="row-between ai-service-label">
                  <span className="label">
                    {def.id === 'tts' ? <Volume2 size={14} aria-hidden="true" style={{ color: 'var(--cyan)' }} /> : <Mic size={14} aria-hidden="true" style={{ color: 'var(--emerald)' }} />}{' '}
                    {def.id === 'tts' ? 'Plataforma de Voz (TTS)' : 'Plataforma de dictado (STT)'}
                  </span>
                  <span className={`badge ${def.id === 'tts' ? 'ai-badge-tts' : 'ai-badge-auto'}`}>{def.id === 'tts' ? 'Lectura' : 'Dictado'}</span>
                </div>
                <CustomSelect
                  value={form.provider}
                  options={def.providers.map((p) => ({ value: p.value, label: p.label, sublabel: p.tag }))}
                  onChange={pickProvider}
                  ariaLabel={`Plataforma de ${def.title}`}
                  disabled={def.providers.length === 1}
                />
                <span className="hint">{def.id === 'tts' ? 'Qué proveedor genera la voz del coach para todos.' : 'Proveedor fijo de dictado.'}</span>
              </div>
              {keyField}
            </div>
            <div className="grid-2 ai-service-pair">
              <div className="field">
                <span className="label ai-service-label">
                  <Layers size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} /> {def.id === 'tts' ? 'Modelo de Voz' : 'Modelo de dictado'}
                </span>
                <CustomSelect value={form.model} onChange={(model) => set({ model })} options={modelOptions(provider.models, form.model)} ariaLabel={`Modelo de ${def.title}`} />
                <span className="hint">{def.id === 'tts' ? 'Los mismos modelos que se ofrecen en Ajustes.' : 'Nova-3 transcribe español con puntuación automática.'}</span>
              </div>
              {def.id === 'tts' ? (
                <label className="field">
                  <span className="label ai-service-label">
                    <Mic size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} /> ID de Voz
                  </span>
                  <input className="input" autoComplete="off" spellCheck={false} placeholder="Vacío: voz según Pilo o Pila" value={form.voice} onChange={(e) => set({ voice: e.target.value })} />
                  <span className="hint">ID de referencia de la voz. Vacío: las voces de Pilo y Pila.</span>
                </label>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          </>
        )}

        <label className="field ai-service-limit">
          <span className="label">Usos al día por persona</span>
          <input className={`input ${limit === null ? 'invalid' : ''}`} type="text" inputMode="numeric" autoComplete="off" value={form.limit} aria-invalid={limit === null} onChange={(e) => set({ limit: e.target.value })} />
          <span className="hint">{limit === null ? 'Un número entero entre 1 y 100.000.' : 'Al llegar al límite, esa persona pasa al modo local hasta mañana.'}</span>
        </label>
      </div>

      {test && (
        <div className={`callout ${test.ok ? 'positive' : 'attention'} ai-service-test`} role="status">
          {test.ok ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div className="detail">{test.text}</div>
        </div>
      )}

      <div className="ai-service-foot">
        <span className="hint">
          {saved
            ? `Hoy: ${Number(saved.used_today).toLocaleString('es')} ${Number(saved.used_today) === 1 ? 'uso' : 'usos'} en total`
            : isLlm && detected
              ? `${models.length} modelos listados`
              : 'Sin clave aquí, cada persona necesita la suya.'}
        </span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {saved && (
            <button type="button" className="btn btn-ghost sm ai-service-clear" onClick={() => setConfirmClear(true)} disabled={busy}>
              <Trash2 aria-hidden="true" /> Quitar clave
            </button>
          )}
          <button type="button" className="btn btn-secondary sm" onClick={() => void runTest()} disabled={testing || busy || (!saved && !(isLlm && form.key.trim()))}>
            {testing ? <RefreshCw aria-hidden="true" className="spin" /> : isLlm ? <Sparkles aria-hidden="true" /> : <Play aria-hidden="true" />}{' '}
            {testing ? 'Comprobando…' : isLlm ? 'Verificar conexión y modelos' : 'Probar'}
          </button>
          <button type="button" className="btn btn-primary sm" onClick={() => void save()} disabled={!canSave}>
            <Save aria-hidden="true" /> {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void clear()}
        title={`¿Quitar la clave de ${def.title}?`}
        message="Se borra del servidor. Quien no tenga clave propia pasará al modo local y volverá a ver los avisos de configurar una clave."
        confirmLabel="Quitar clave"
        danger
      />
    </div>
  );
};

/**
 * IA DE LA APP (panel del creador)
 * Tus claves de LLM, voz y dictado para que todos usen la app sin configurar nada. Se guardan en el servidor y nunca
 * llegan a los dispositivos: la función `pilas-ai` responde por ellas (lib/appAi.ts, migración 0004).
 */
export const AiServicesTab: React.FC = () => {
  const [rows, setRows] = useState<AdminAiService[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await adminAiServices());
      setMissing(false);
      setFailed(false);
    } catch (err) {
      if (err instanceof SocialError && err.code === 'PGRST202') setMissing(true);
      else setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = useCallback(async () => {
    await Promise.all([load(), refreshAppAi()]);
  }, [load]);

  if (missing) {
    return (
      <div className="card">
        <div className="empty">
          <div className="empty-icon">
            <DatabaseZap aria-hidden="true" />
          </div>
          <h3>Falta preparar el servidor</h3>
          <p>
            Aplica <code>supabase/migrations/0004_ia_de_la_app.sql</code> en el editor SQL de Supabase y crea la función <code>pilas-ai</code> (pasos en{' '}
            <code>docs/supabase.md</code>). Después vuelve a esta pestaña.
          </p>
        </div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="card">
        <div className="empty">
          <h3>No se pudo cargar</h3>
          <p>Revisa tu conexión e inténtalo de nuevo.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="card row" style={{ justifyContent: 'center', padding: 32 }} aria-live="polite">
        <span className="spinner" aria-hidden="true" /> <span className="muted">Cargando…</span>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="callout neutral">
        <BrainCircuit aria-hidden="true" />
        <div>
          <div className="title">Tus claves, para toda la app</div>
          <div className="detail">
            Mientras estén aquí, quien no tenga clave propia usa la IA, la voz y el dictado sin configurar nada, y no ve avisos de claves. Se guardan en el servidor y nunca
            llegan a los dispositivos: nadie puede sacarlas de la app. Cuando las quites, vuelven el modo local y los avisos.
          </div>
        </div>
      </div>
      {SERVICES.map((def) => (
        <ServiceCard key={def.id} def={def} saved={rows.find((r) => r.service === def.id)} onChanged={onChanged} />
      ))}
    </div>
  );
};
