import React, { useCallback, useEffect, useState } from 'react';
import { AudioLines, BrainCircuit, CheckCircle2, DatabaseZap, Eye, EyeOff, Mic, Play, Save, Trash2, TriangleAlert } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useToast } from '@/components/ui/ToastContext';
import { appAiCheckDictation, appAiComplete, appAiSpeech, describeAppAiError, refreshAppAi, type AppAiService } from '@/lib/appAi';
import { speakCoach, unlockCoachVoice } from '@/lib/coachVoice';
import { playSound } from '@/lib/sound';
import { adminAiServices, adminClearAiService, adminSetAiService, SocialError } from '@/social/api';
import type { AdminAiService } from '@/social/types';
import './aiServices.css';

interface ServiceDef {
  id: AppAiService;
  title: string;
  sub: string;
  icon: React.ReactNode;
  providers: { value: string; label: string; modelHint: string }[];
  defaultLimit: number;
}

const SERVICES: ServiceDef[] = [
  {
    id: 'llm',
    title: 'Modelo de lenguaje (LLM)',
    sub: 'Las respuestas del coach en el chat.',
    icon: <BrainCircuit aria-hidden="true" />,
    providers: [
      { value: 'gemini', label: 'Google Gemini', modelHint: 'gemini-2.5-flash' },
      { value: 'openai', label: 'OpenAI', modelHint: 'gpt-4o-mini' },
      { value: 'groq', label: 'Groq', modelHint: 'llama-3.1-8b-instant' },
      { value: 'openrouter', label: 'OpenRouter', modelHint: 'google/gemini-2.5-flash-lite' },
    ],
    defaultLimit: 40,
  },
  {
    id: 'tts',
    title: 'Voz (TTS)',
    sub: 'La voz con la que el coach lee sus respuestas. Cada fragmento leído cuenta como un uso.',
    icon: <AudioLines aria-hidden="true" />,
    providers: [
      { value: 'gemini', label: 'Google Gemini', modelHint: 'gemini-2.5-flash-preview-tts' },
      { value: 'fish_audio', label: 'Fish Audio', modelHint: 's2.1-pro' },
      { value: 'elevenlabs', label: 'ElevenLabs', modelHint: 'eleven_multilingual_v2' },
      { value: 'openai', label: 'OpenAI', modelHint: 'gpt-4o-mini-tts' },
    ],
    defaultLimit: 200,
  },
  {
    id: 'stt',
    title: 'Dictado (STT)',
    sub: 'Pasar voz a texto. La clave queda lista, pero la app todavía no tiene botón de dictado que la use.',
    icon: <Mic aria-hidden="true" />,
    providers: [{ value: 'deepgram', label: 'Deepgram', modelHint: 'nova-3' }],
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

const formFrom = (def: ServiceDef, saved?: AdminAiService): Form => ({
  provider: saved?.provider ?? def.providers[0].value,
  model: saved?.model ?? '',
  backupModel: saved?.backup_model ?? '',
  voice: saved?.voice ?? '',
  limit: String(saved?.daily_limit ?? def.defaultLimit),
  key: '',
});

/** Usos al día por persona: entero entre 1 y 100.000 */
const readLimit = (text: string) => {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
};

const ServiceCard: React.FC<{ def: ServiceDef; saved?: AdminAiService; onChanged: () => Promise<void> }> = ({ def, saved, onChanged }) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(() => formFrom(def, saved));
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Al volver a cargar lo guardado (tras guardar o quitar) el formulario enseña lo del servidor, sin la clave pegada
  useEffect(() => setForm(formFrom(def, saved)), [def, saved]);

  const set = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setTest(null);
  };
  const provider = def.providers.find((p) => p.value === form.provider) ?? def.providers[0];
  const limit = readLimit(form.limit);
  const canSave = !busy && limit !== null && Boolean(saved || form.key.trim());

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

  /** Prueba de verdad: pasa por la función `pilas-ai` como lo haría cualquier persona */
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      if (def.id === 'llm') {
        const text = await appAiComplete(undefined, [], 'Responde únicamente con la palabra: listo', 0);
        setTest({ ok: true, text: `Respondió: «${text.trim().slice(0, 60)}»` });
      } else if (def.id === 'tts') {
        const sample = 'Hola, así sueno con la voz de la app.';
        unlockCoachVoice();
        await appAiSpeech(sample, 'male');
        void speakCoach(sample, 'male', { provider: { kind: 'app', via: saved?.provider ?? '', model: saved?.model ?? '' }, label: '' });
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

  return (
    <div className="card ai-service">
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

      <div className="ai-service-fields">
        <div className="field">
          <span className="label">Proveedor</span>
          <CustomSelect value={form.provider} options={def.providers} onChange={(provider) => set({ provider })} ariaLabel={`Proveedor de ${def.title}`} disabled={def.providers.length === 1} />
        </div>
        <label className="field">
          <span className="label">Clave de API</span>
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
              placeholder={saved ? 'Déjala vacía para conservar la actual' : 'Pega aquí tu clave'}
              value={form.key}
              onChange={(e) => set({ key: e.target.value })}
            />
            <button type="button" className="icon-btn sm" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Ocultar clave' : 'Mostrar clave'} title={showKey ? 'Ocultar clave' : 'Mostrar clave'}>
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
        </label>
        <label className="field">
          <span className="label">Modelo</span>
          <input className="input" autoComplete="off" spellCheck={false} placeholder={provider.modelHint} value={form.model} onChange={(e) => set({ model: e.target.value })} />
        </label>
        {def.id === 'llm' && (
          <label className="field">
            <span className="label">Modelo de respaldo (opcional)</span>
            <input className="input" autoComplete="off" spellCheck={false} placeholder="Si falla el principal" value={form.backupModel} onChange={(e) => set({ backupModel: e.target.value })} />
          </label>
        )}
        {def.id === 'tts' && (
          <label className="field">
            <span className="label">Voz (opcional)</span>
            <input className="input" autoComplete="off" spellCheck={false} placeholder="Vacío: las voces de Pilo y Pila" value={form.voice} onChange={(e) => set({ voice: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span className="label">Usos al día por persona</span>
          <input className={`input ${limit === null ? 'invalid' : ''}`} type="text" inputMode="numeric" autoComplete="off" value={form.limit} aria-invalid={limit === null} onChange={(e) => set({ limit: e.target.value })} />
          {limit === null && <span className="hint">Un número entero entre 1 y 100.000.</span>}
        </label>
      </div>

      {test && (
        <div className={`callout ${test.ok ? 'positive' : 'attention'} ai-service-test`} role="status">
          {test.ok ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <div className="detail">{test.text}</div>
        </div>
      )}

      <div className="ai-service-foot">
        <span className="hint">{saved ? `Hoy: ${Number(saved.used_today).toLocaleString('es')} ${Number(saved.used_today) === 1 ? 'uso' : 'usos'} en total` : 'Sin clave aquí, cada persona necesita la suya.'}</span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {saved && (
            <>
              <button type="button" className="btn btn-ghost sm ai-service-clear" onClick={() => setConfirmClear(true)} disabled={busy}>
                <Trash2 aria-hidden="true" /> Quitar clave
              </button>
              <button type="button" className="btn btn-secondary sm" onClick={() => void runTest()} disabled={testing || busy}>
                <Play aria-hidden="true" /> {testing ? 'Probando…' : 'Probar'}
              </button>
            </>
          )}
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
