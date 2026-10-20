import React, { useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { useSecrets } from '../store/useSecrets';
import { AiPlatform } from '../types';
import {
  Save,
  RotateCcw,
  User,
  Sparkles,
  ExternalLink,
  Volume2,
  VolumeX,
  Layers,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Check,
  ChevronDown,
  Bell,
  Clock,
  Flame,
  Sun,
  Moon,
  Droplets,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ApiKeySecurityCard } from '../components/settings/ApiKeySecurityCard';
import { BackupCard } from '../components/settings/BackupCard';
import { AnimationTestCard } from '../components/settings/AnimationTestCard';
import { useToast } from '../components/ui/ToastContext';
import { CustomSelect } from '../components/ui/CustomSelect';
import { CustomTimePicker } from '../components/ui/CustomTimePicker';
import { fetchAvailableModels, PRESET_MODELS, ModelOption } from '../lib/gemini';
import { playSound } from '../lib/sound';
import {
  getNotificationPermission,
  requestNotificationPermission,
  triggerTestNotification,
  NotificationType,
} from '../lib/notifications';

/**
 * El formulario copia los ajustes a estado local al montarse. Tras importar o reiniciar datos se vuelve a montar
 * (cambio de `key`) para que no guarde valores obsoletos encima de los nuevos.
 */
export const SettingsView: React.FC = () => {
  const [formKey, setFormKey] = useState(0);
  return <SettingsForm key={formKey} onDataReplaced={() => setFormKey((k) => k + 1)} />;
};

const SettingsForm: React.FC<{ onDataReplaced: () => void }> = ({ onDataReplaced }) => {
  const { settings, updateSettings, resetDemo, resetEmpty, importData } = useStore(
    useShallow((s) => ({
      settings: s.settings,
      updateSettings: s.updateSettings,
      resetDemo: s.resetDemo,
      resetEmpty: s.resetEmpty,
      importData: s.importData,
    }))
  );
  const { secrets, secretsLocked, setKeys } = useSecrets(
    useShallow((s) => ({ secrets: s.keys, secretsLocked: s.locked, setKeys: s.setKeys }))
  );
  const { showToast } = useToast();

  const [userName, setUserName] = useState(settings.userName || 'Usuario');
  const [maxActiveHabits, setMaxActiveHabits] = useState(settings.maxActiveHabits || 7);
  const [askFailReason, setAskFailReason] = useState(settings.askFailReason);

  // IA Settings
  const [aiPlatform, setAiPlatform] = useState<AiPlatform>(settings.aiPlatform || 'gemini');
  const [geminiApiKey, setGeminiApiKey] = useState(secrets.geminiApiKey);
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel || 'gemini-3.5-flash-lite');
  const [backupModel, setBackupModel] = useState(settings.backupModel || 'gemini-3.1-flash');

  // Al desbloquear las claves cifradas, rellenar los campos con los valores descifrados
  useEffect(() => {
    if (secretsLocked) return;
    setGeminiApiKey(secrets.geminiApiKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretsLocked]);

  const [availableModels, setAvailableModels] = useState<ModelOption[]>(
    PRESET_MODELS[settings.aiPlatform || 'gemini'] || PRESET_MODELS.gemini
  );

  const mainModelOptions = useMemo(() => {
    const list = availableModels.map((m) => ({
      value: m.id,
      label: m.name,
      sublabel: m.id,
    }));
    if (geminiModel && !list.some((o) => o.value === geminiModel)) {
      list.push({ value: geminiModel, label: `${geminiModel} (Personalizado)`, sublabel: 'Modelo manual' });
    }
    return list;
  }, [availableModels, geminiModel]);

  const backupModelOptions = useMemo(() => {
    const list = availableModels.map((m) => ({
      value: m.id,
      label: m.name,
      sublabel: m.id,
    }));
    if (backupModel && !list.some((o) => o.value === backupModel)) {
      list.push({ value: backupModel, label: `${backupModel} (Personalizado)`, sublabel: 'Modelo manual' });
    }
    return list;
  }, [availableModels, backupModel]);

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsLoadedStatus, setModelsLoadedStatus] = useState<string | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // Sonidos
  const [soundEnabled, setSoundEnabled] = useState(settings.soundEnabled ?? true);
  const [soundVolume, setSoundVolume] = useState(settings.soundVolume ?? 0.6);

  // Notificaciones del Sistema Operativo (Windows & Móviles)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    getNotificationPermission()
  );
  const [notifEnabled, setNotifEnabled] = useState(settings.notifications?.enabled ?? true);
  const [habitReminders, setHabitReminders] = useState(settings.notifications?.habitReminders ?? true);
  const [streakReminder, setStreakReminder] = useState(settings.notifications?.streakReminder ?? true);
  const [streakReminderTime, setStreakReminderTime] = useState(settings.notifications?.streakReminderTime ?? '20:30');
  const [coachReminder, setCoachReminder] = useState(settings.notifications?.coachReminder ?? true);
  const [coachReminderTime, setCoachReminderTime] = useState(settings.notifications?.coachReminderTime ?? '16:30');
  const [morningReminder, setMorningReminder] = useState(settings.notifications?.morningReminder ?? true);
  const [morningReminderTime, setMorningReminderTime] = useState(settings.notifications?.morningReminderTime ?? '08:00');
  const [middayReminder, setMiddayReminder] = useState(settings.notifications?.middayReminder ?? true);
  const [middayReminderTime, setMiddayReminderTime] = useState(settings.notifications?.middayReminderTime ?? '13:30');
  const [nightReminder, setNightReminder] = useState(settings.notifications?.nightReminder ?? true);
  const [nightReminderTime, setNightReminderTime] = useState(settings.notifications?.nightReminderTime ?? '22:00');
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  // Modales de confirmación
  const [showResetDemoConfirm, setShowResetDemoConfirm] = useState(false);
  const [showResetEmptyConfirm, setShowResetEmptyConfirm] = useState(false);

  // Carga automática de modelos al cambiar clave o plataforma
  useEffect(() => {
    let active = true;

    const load = async () => {
      const presets = PRESET_MODELS[aiPlatform] || PRESET_MODELS.gemini;
      if (!geminiApiKey || geminiApiKey.trim().length < 8) {
        setAvailableModels(presets);
        setModelsLoadedStatus(null);
        return;
      }

      setIsLoadingModels(true);
      setModelsLoadedStatus('Consultando modelos disponibles en la plataforma...');

      try {
        const list = await fetchAvailableModels(aiPlatform, geminiApiKey);
        if (!active) return;
        setAvailableModels(list);
        setModelsLoadedStatus(`${list.length} modelos detectados para ${aiPlatform.toUpperCase()}`);
      } catch {
        if (!active) return;
        setAvailableModels(presets);
        setModelsLoadedStatus('Usando lista de modelos recomendados');
      } finally {
        if (active) setIsLoadingModels(false);
      }
    };

    const timer = setTimeout(load, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [aiPlatform, geminiApiKey]);

  // Al cambiar de plataforma, ajustar defaults si no coinciden
  const handlePlatformChange = (p: AiPlatform) => {
    setAiPlatform(p);
    const presets = PRESET_MODELS[p] || PRESET_MODELS.gemini;
    setAvailableModels(presets);
    if (p === 'gemini') {
      setGeminiModel('gemini-3.5-flash-lite');
      setBackupModel('gemini-3.1-flash');
    } else if (p === 'openai') {
      setGeminiModel('gpt-4o-mini');
      setBackupModel('gpt-4o');
    } else if (p === 'groq') {
      setGeminiModel('llama-3.3-70b-versatile');
      setBackupModel('llama-3.1-8b-instant');
    } else if (p === 'openrouter') {
      setGeminiModel('google/gemini-2.5-flash-lite');
      setBackupModel('google/gemini-2.5-flash');
    }
    playSound.pop();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      userName: userName.trim(),
      maxActiveHabits: Number(maxActiveHabits),
      askFailReason,
      aiPlatform,
      geminiModel: geminiModel.trim(),
      backupModel: backupModel.trim(),
      soundEnabled,
      soundVolume,
      notifications: {
        enabled: notifEnabled,
        habitReminders,
        streakReminder,
        streakReminderTime,
        coachReminder,
        coachReminderTime,
        morningReminder,
        morningReminderTime,
        middayReminder,
        middayReminderTime,
        nightReminder,
        nightReminderTime,
      },
    });

    // Las claves se guardan aparte (almacén de secretos, cifrado si está activado)
    if (secretsLocked) {
      playSound.pop();
      showToast('Ajustes guardados. Las claves de API están bloqueadas: desbloquéalas para editarlas.', 'warning');
      return;
    }
    try {
      await setKeys({ geminiApiKey: geminiApiKey.trim() });
      playSound.pop();
      showToast('Configuraciones guardadas con éxito', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'No se pudieron guardar las claves', 'error');
    }
  };


  // Acciones de Notificaciones del Sistema
  const handleRequestPermission = async () => {
    setIsRequestingPermission(true);
    try {
      const perm = await requestNotificationPermission();
      setNotifPermission(perm);
      if (perm === 'granted') {
        showToast('¡Permiso de notificaciones del sistema concedido!', 'success');
        playSound.celebration();
      } else if (perm === 'denied') {
        showToast('El permiso fue bloqueado en las preferencias del navegador o sistema.', 'error');
      } else {
        showToast('Permiso de notificaciones no activado.', 'warning');
      }
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const handleTestNotification = async (type: NotificationType) => {
    let perm = getNotificationPermission();
    if (perm !== 'granted') {
      perm = await requestNotificationPermission();
      setNotifPermission(perm);
      if (perm !== 'granted') {
        showToast('Debes conceder permisos en el navegador para recibir notificaciones del sistema.', 'warning');
        return;
      }
    }
    playSound.pop();
    const sampleHabit = useStore.getState().habits.find((h) => h.status === 'active');
    const res = await triggerTestNotification(type, userName, sampleHabit);
    if (res.success) {
      showToast(res.message, 'success');
    } else {
      showToast(res.message, 'error');
    }
  };

  // Prueba rápida de la configuración de IA
  const handleTestAi = async () => {
    if (!geminiApiKey || geminiApiKey.trim().length < 8) {
      showToast('Ingresa una API Key para probar los modelos', 'warning');
      return;
    }

    setIsTestingAi(true);
    showToast(`Verificando modelo principal «${geminiModel}»...`, 'info');

    try {
      const models = await fetchAvailableModels(aiPlatform, geminiApiKey);
      setAvailableModels(models);
      playSound.complete();
      showToast(`¡Conexión exitosa! Modelos disponibles verificados.`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Aviso: ${msg}. El modelo de respaldo «${backupModel}» se usará si el primero falla.`, 'warning');
    } finally {
      setIsTestingAi(false);
    }
  };

  // Prueba de sonidos
  const handleTestSound = () => {
    playSound.complete();
    setTimeout(() => {
      playSound.streak();
    }, 380);
    showToast('Reproduciendo efecto de sonido de prueba', 'info');
  };

  const handleResetSeed = () => {
    setShowResetDemoConfirm(true);
  };

  const confirmResetDemo = () => {
    resetDemo();
    playSound.modalClose();
    showToast('Datos de demostración restablecidos con éxito', 'info');
    setShowResetDemoConfirm(false);
    onDataReplaced();
  };

  const handleResetEmpty = () => {
    setShowResetEmptyConfirm(true);
  };

  const confirmResetEmpty = () => {
    resetEmpty();
    playSound.modalClose();
    showToast('Se han eliminado todos los datos. Comenzando de 0.', 'info');
    setShowResetEmptyConfirm(false);
    onDataReplaced();
  };

  return (
    <div className="stack fade-up" style={{ maxWidth: 860 }}>
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Preferencias y persistencia</p>
          <h1>Ajustes del sistema</h1>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Personaliza tu filosofía de hábitos, modelos de IA con respaldo automático, retroalimentación sonora y administración de respaldos.
      </p>

      {/* Formulario de Ajustes */}
      <form
        onSubmit={handleSaveProfile}
        className="form"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
      >
        {/* Perfil y Filosofía */}
        <div className="card">
          <div className="card-head">
            <div className="row">
              <User size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Perfil de usuario y carga de hábitos</div>
                <div className="card-sub">Previene la acumulación excesiva y la sobrecarga</div>
              </div>
            </div>
          </div>

          <div className="form">
            <div className="form-row">
              <div className="field">
                <span className="label">Tu nombre o alias</span>
                <input
                  type="text"
                  className="input"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="label">Límite recomendado de hábitos activos</span>
                  <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-2)', fontWeight: 700 }}>
                    {maxActiveHabits} hábitos
                  </span>
                </div>
                <div className="custom-slider-wrap">
                  <input
                    type="range"
                    min={2}
                    max={15}
                    step={1}
                    className="custom-slider-input"
                    value={maxActiveHabits}
                    style={{
                      background: `linear-gradient(to right, #6366f1 0%, #a855f7 ${((maxActiveHabits - 2) / 13) * 100}%, rgba(255, 255, 255, 0.12) ${((maxActiveHabits - 2) / 13) * 100}%, rgba(255, 255, 255, 0.12) 100%)`,
                    }}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setMaxActiveHabits(val);
                      playSound.click();
                    }}
                  />
                </div>
                <span className="hint">Sugerido: 4 a 7 hábitos simultáneos para evitar el colapso.</span>
              </div>
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="label">Modo Mínimo en consistencia</span>
                <span className="badge accent" style={{ fontWeight: 700 }}>{Math.round(settings.minimumRatio * 100)}% fijado</span>
              </div>
              <span className="hint" style={{ marginTop: 4 }}>
                Completar la versión mínima preserva tu racha de días y suma el {Math.round(settings.minimumRatio * 100)}% del valor y puntos del hábito según la metodología conductual.
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <label className="custom-switch">
                <input
                  type="checkbox"
                  checked={askFailReason}
                  onChange={(e) => {
                    setAskFailReason(e.target.checked);
                    playSound.pop();
                  }}
                />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 500 }}>
                  Preguntar motivo de falla al marcar un hábito como no realizado
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* INTELIGENCIA ARTIFICIAL MULTI-MODELO */}
        <div className="card highlight" style={{ border: '1px solid rgba(139, 92, 246, 0.35)' }}>
          <div className="card-head">
            <div className="row">
              <Sparkles size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Inteligencia Artificial y Coach Conductual</div>
                <div className="card-sub">Configura tu modelo principal y modelo de respaldo ante saturaciones</div>
              </div>
            </div>
            {modelsLoadedStatus && (
              <span className="badge" style={{ fontSize: 11, background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' }}>
                {modelsLoadedStatus}
              </span>
            )}
          </div>

          <div className="form">
            {/* Selector de Plataforma */}
            <div className="field">
              <span className="label">Plataforma de IA</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginTop: 4 }}>
                {(
                  [
                    { id: 'gemini', label: 'Google Gemini', tag: 'Recomendado' },
                    { id: 'openai', label: 'OpenAI (ChatGPT)', tag: 'GPT-4o' },
                    { id: 'groq', label: 'Groq', tag: 'Baja latencia' },
                    { id: 'openrouter', label: 'OpenRouter', tag: 'Multi-modelo' },
                  ] as const
                ).map((plat) => (
                  <button
                    key={plat.id}
                    type="button"
                    onClick={() => handlePlatformChange(plat.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: aiPlatform === plat.id ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                      background: aiPlatform === plat.id ? 'rgba(99, 102, 241, 0.16)' : 'var(--bg-panel)',
                      color: aiPlatform === plat.id ? 'var(--text)' : 'var(--text-2)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{plat.label}</span>
                    <span style={{ fontSize: 10, color: aiPlatform === plat.id ? 'var(--accent-2)' : 'var(--muted)' }}>
                      {plat.tag}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* API Key */}
            <div className="field">
              <div className="row-between">
                <span className="label">Clave de API ({aiPlatform.toUpperCase()})</span>
                {aiPlatform === 'gemini' && (
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="small accent"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Obtener clave gratuita en Google AI Studio <ExternalLink size={13} />
                  </a>
                )}
                {aiPlatform === 'openai' && (
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    className="small accent"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Obtener clave en OpenAI Platform <ExternalLink size={13} />
                  </a>
                )}
                {aiPlatform === 'groq' && (
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="small accent"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Obtener clave en Groq Console <ExternalLink size={13} />
                  </a>
                )}
                {aiPlatform === 'openrouter' && (
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="small accent"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Obtener clave en OpenRouter <ExternalLink size={13} />
                  </a>
                )}
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  name="constancia_ai_token_field"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  spellCheck={false}
                  className="input"
                  style={{ paddingRight: 40 }}
                  disabled={secretsLocked}
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={
                    aiPlatform === 'gemini'
                      ? 'AIzaSy...'
                      : aiPlatform === 'openai'
                      ? 'sk-proj-...'
                      : aiPlatform === 'groq'
                      ? 'gsk_...'
                      : 'sk-or-...'
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowGeminiKey((p) => !p)}
                  style={{
                    position: 'absolute',
                    right: 10,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: 4,
                  }}
                  title={showGeminiKey ? 'Ocultar clave' : 'Mostrar clave'}
                  aria-label={showGeminiKey ? 'Ocultar clave' : 'Mostrar clave'}
                >
                  {showGeminiKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <span className="hint">
                {secretsLocked
                  ? 'Las claves están cifradas y bloqueadas. Desbloquéalas en «Seguridad de las claves de API» para editarlas.'
                  : 'Al ingresar tu API key se detectan automáticamente los modelos disponibles en tu cuenta. Se guarda solo en este navegador y nunca se incluye en los respaldos.'}
              </span>
            </div>

            {/* DOS CAMPOS DE MODELOS: PRINCIPAL Y RESPALDO */}
            <div className="grid-2" style={{ gap: 14 }}>
              {/* Campo 1: Modelo Principal */}
              <div className="field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    <Layers size={14} style={{ color: 'var(--accent)' }} />
                    Modelo principal
                  </span>
                  <span className="badge" style={{ fontSize: 10, background: 'rgba(99, 102, 241, 0.2)' }}>
                    Prioritario
                  </span>
                </div>
                <CustomSelect
                  value={geminiModel}
                  onChange={(val) => setGeminiModel(val)}
                  options={mainModelOptions}
                  searchable
                />
                <span className="hint">
                  {aiPlatform === 'gemini'
                    ? 'Por defecto Gemini 3.5 Flash Lite para respuestas rápidas y fluidas.'
                    : 'Modelo estándar para la conversación.'}
                </span>
              </div>

              {/* Campo 2: Modelo de Respaldo */}
              <div className="field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    <ShieldCheck size={14} style={{ color: '#10b981' }} />
                    Modelo de respaldo (Fallback)
                  </span>
                  <span className="badge" style={{ fontSize: 10, background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>
                    Automático
                  </span>
                </div>
                <CustomSelect
                  value={backupModel}
                  onChange={(val) => setBackupModel(val)}
                  options={backupModelOptions}
                  searchable
                />
                <span className="hint">
                  {aiPlatform === 'gemini'
                    ? 'Por defecto Gemini 3.1 Flash. Se activa automáticamente si el principal falla.'
                    : 'Se consulta de inmediato si el modelo principal no responde o da error.'}
                </span>
              </div>
            </div>

            {/* Botón de prueba y estado */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary sm"
                disabled={isTestingAi || isLoadingModels || !geminiApiKey}
                onClick={handleTestAi}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {isTestingAi || isLoadingModels ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
                Verificar conexión y modelos
              </button>

              <span className="small muted">
                {isLoadingModels ? 'Detectando modelos...' : `${availableModels.length} modelos listados`}
              </span>
            </div>
          </div>
        </div>

        {/* EFECTOS DE SONIDO EN LA INTERFAZ */}
        <div className="card">
          <div className="card-head">
            <div className="row">
              {soundEnabled ? (
                <Volume2 size={18} style={{ color: 'var(--accent-2)' }} />
              ) : (
                <VolumeX size={18} style={{ color: 'var(--muted)' }} />
              )}
              <div>
                <div className="card-title">Efectos de sonido en la interfaz</div>
                <div className="card-sub">Sonidos naturales para botones, apertura/cierre de modales y hábitos</div>
              </div>
            </div>
            <button
              type="button"
              className="btn-sound-test"
              onClick={handleTestSound}
              disabled={!soundEnabled}
            >
              <Volume2 size={13} /> Probar sonido
            </button>
          </div>

          <div className="form">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="custom-switch">
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => {
                    setSoundEnabled(e.target.checked);
                    if (e.target.checked) playSound.pop();
                  }}
                />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>
                  Activar sonidos acústicos táctiles
                </span>
              </label>
              <span
                className="badge"
                style={{
                  background: soundEnabled ? 'rgba(16, 185, 129, 0.18)' : 'rgba(100, 100, 100, 0.18)',
                  color: soundEnabled ? '#34d399' : 'var(--muted)',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 12,
                }}
              >
                {soundEnabled ? 'Activado' : 'Silenciado'}
              </span>
            </div>

            <p className="hint" style={{ marginTop: 2 }}>
              Diseñado con síntesis armónica procedural (Web Audio): clics suaves, chimes al marcar hábitos completados y transiciones orgánicas al abrir/cerrar modales.
            </p>

            {soundEnabled && (
              <div className="custom-slider-wrap" style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                    <Sliders size={13} style={{ color: 'var(--accent)' }} />
                    Volumen de los efectos
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: 'var(--accent-2)',
                      fontWeight: 700,
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 8,
                    }}
                  >
                    {Math.round(soundVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  className="custom-slider-input"
                  value={soundVolume}
                  style={{
                    background: `linear-gradient(to right, #6366f1 0%, #a855f7 ${((soundVolume - 0.1) / 0.9) * 100}%, rgba(255, 255, 255, 0.12) ${((soundVolume - 0.1) / 0.9) * 100}%, rgba(255, 255, 255, 0.12) 100%)`,
                  }}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSoundVolume(val);
                    updateSettings({ soundVolume: val });
                    playSound.click();
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* NOTIFICACIONES DEL SISTEMA (WINDOWS Y CELULARES) */}
        <div className="card" style={{ borderTop: '3px solid var(--accent)' }}>
          <div className="card-head">
            <div className="row">
              <Bell size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Notificaciones del Sistema (Windows y Celulares)</div>
                <div className="card-sub">
                  Alertas nativas del sistema operativo: recordatorios a tu hora exacta, racha activa y Coach IA con variantes
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {notifPermission === 'granted' ? (
                <span
                  className="badge"
                  style={{
                    background: 'rgba(16, 185, 129, 0.18)',
                    color: '#34d399',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                >
                  Concedido en el sistema
                </span>
              ) : notifPermission === 'denied' ? (
                <span
                  className="badge"
                  style={{
                    background: 'rgba(239, 68, 68, 0.18)',
                    color: '#f87171',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                >
                  Bloqueado en el navegador / SO
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary sm"
                  onClick={handleRequestPermission}
                  disabled={isRequestingPermission}
                >
                  <Bell size={13} /> Activar permisos del sistema
                </button>
              )}
            </div>
          </div>

          <div className="form">
            {/* Toggle Maestro */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '1px solid var(--border-2)' }}>
              <label className="custom-switch">
                <input
                  type="checkbox"
                  checked={notifEnabled}
                  onChange={(e) => {
                    setNotifEnabled(e.target.checked);
                    playSound.pop();
                  }}
                />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>
                  Activar notificaciones del sistema en este dispositivo
                </span>
              </label>
              <span
                className="badge"
                style={{
                  background: notifEnabled ? 'rgba(139, 92, 246, 0.18)' : 'rgba(100, 100, 100, 0.18)',
                  color: notifEnabled ? 'var(--accent-2)' : 'var(--muted)',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 12,
                }}
              >
                {notifEnabled ? 'Habilitadas' : 'Desactivadas'}
              </span>
            </div>

            {notifEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
                {/* 1. RECORDATORIOS DE HÁBITOS A SU HORA EXACTA */}
                <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <label className="custom-switch">
                      <input
                        type="checkbox"
                        checked={habitReminders}
                        onChange={(e) => {
                          setHabitReminders(e.target.checked);
                          playSound.pop();
                        }}
                      />
                      <span className="custom-switch-track">
                        <span className="custom-switch-thumb" />
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>
                        Recordatorios de hábitos en su hora fijada
                      </span>
                    </label>

                    <button
                      type="button"
                      className="btn btn-secondary sm"
                      onClick={() => handleTestNotification('habit')}
                    >
                      <Bell size={12} /> Probar en el sistema
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                    Dispara una notificación del sistema a la hora programada en cada hábito si aún no lo has completado hoy. Cada recordatorio rota entre distintas frases para evitar la monotonía.
                  </p>
                </div>

                {/* 2. ALERTA DE RACHA ACTIVA */}
                <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <label className="custom-switch">
                      <input
                        type="checkbox"
                        checked={streakReminder}
                        onChange={(e) => {
                          setStreakReminder(e.target.checked);
                          playSound.pop();
                        }}
                      />
                      <span className="custom-switch-track">
                        <span className="custom-switch-thumb" />
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Flame size={15} style={{ color: 'var(--warning)' }} />
                        Alerta para mantener la racha activa
                      </span>
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Hora:</span>
                      <div style={{ width: 140 }}>
                        <CustomTimePicker
                          value={streakReminderTime}
                          onChange={(t) => setStreakReminderTime(t)}
                          disabled={!streakReminder}
                          size="sm"
                          align="right"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary sm"
                        onClick={() => handleTestNotification('streak')}
                      >
                        <Flame size={12} style={{ color: 'var(--warning)' }} /> Probar
                      </button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                    Te avisa si tienes hábitos pendientes antes de que termine el día, recordándote que incluso la versión mínima salva tu racha consecutiva.
                  </p>
                </div>

                {/* 3. MENSAJE DEL COACH IA */}
                <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <label className="custom-switch">
                      <input
                        type="checkbox"
                        checked={coachReminder}
                        onChange={(e) => {
                          setCoachReminder(e.target.checked);
                          playSound.pop();
                        }}
                      />
                      <span className="custom-switch-track">
                        <span className="custom-switch-thumb" />
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={15} style={{ color: 'var(--accent-2)' }} />
                        Mensaje del Coach IA con tu nombre ({userName || 'Usuario'})
                      </span>
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Hora:</span>
                      <div style={{ width: 140 }}>
                        <CustomTimePicker
                          value={coachReminderTime}
                          onChange={(t) => setCoachReminderTime(t)}
                          disabled={!coachReminder}
                          size="sm"
                          align="right"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary sm"
                        onClick={() => handleTestNotification('coach')}
                      >
                        <Sparkles size={12} style={{ color: 'var(--accent-2)' }} /> Probar
                      </button>
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                    Envía un mensaje reflexivo y motivacional del Coach con tu nombre real, alternando frases de disciplina, claridad mental y enfoque sin necesidad de consumo de API.
                  </p>
                </div>

                {/* 4. RUTINAS CLAVE A LO LARGO DEL DÍA */}
                <div>
                  <span className="label" style={{ marginBottom: 8, display: 'block' }}>
                    Otras notificaciones clave del día (con variantes):
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
                    {/* Impulso Matutino */}
                    <div style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="custom-switch">
                          <input
                            type="checkbox"
                            checked={morningReminder}
                            onChange={(e) => setMorningReminder(e.target.checked)}
                          />
                          <span className="custom-switch-track">
                            <span className="custom-switch-thumb" />
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Sun size={14} style={{ color: '#fbbf24' }} /> Impulso Matutino
                          </span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <CustomTimePicker
                            value={morningReminderTime}
                            onChange={(t) => setMorningReminderTime(t)}
                            disabled={!morningReminder}
                            size="sm"
                            align="left"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost sm"
                          onClick={() => handleTestNotification('morning')}
                          style={{ fontSize: 11 }}
                        >
                          Probar
                        </button>
                      </div>
                    </div>

                    {/* Pausa Mediodía */}
                    <div style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="custom-switch">
                          <input
                            type="checkbox"
                            checked={middayReminder}
                            onChange={(e) => setMiddayReminder(e.target.checked)}
                          />
                          <span className="custom-switch-track">
                            <span className="custom-switch-thumb" />
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Droplets size={14} style={{ color: '#22d3ee' }} /> Pausa e Hidratación
                          </span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <CustomTimePicker
                            value={middayReminderTime}
                            onChange={(t) => setMiddayReminderTime(t)}
                            disabled={!middayReminder}
                            size="sm"
                            align="left"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost sm"
                          onClick={() => handleTestNotification('midday')}
                          style={{ fontSize: 11 }}
                        >
                          Probar
                        </button>
                      </div>
                    </div>

                    {/* Descanso Noche */}
                    <div style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label className="custom-switch">
                          <input
                            type="checkbox"
                            checked={nightReminder}
                            onChange={(e) => setNightReminder(e.target.checked)}
                          />
                          <span className="custom-switch-track">
                            <span className="custom-switch-thumb" />
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Moon size={14} style={{ color: '#a78bfa' }} /> Cierre y Descanso
                          </span>
                        </label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <CustomTimePicker
                            value={nightReminderTime}
                            onChange={(t) => setNightReminderTime(t)}
                            disabled={!nightReminder}
                            size="sm"
                            align="left"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost sm"
                          onClick={() => handleTestNotification('night')}
                          style={{ fontSize: 11 }}
                        >
                          Probar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Banner Informativo */}
                <div style={{ fontSize: 12, color: 'var(--muted)', background: 'rgba(139, 92, 246, 0.08)', padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(139, 92, 246, 0.2)', lineHeight: 1.45 }}>
                  <strong>Notificaciones nativas del sistema:</strong> Las notificaciones se envían directamente al Centro de Actividades de Windows y a la bandeja de notificaciones en celulares (Android / iOS) mediante Web Notifications y Service Worker. No son alertas simuladas dentro de la página.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Botón Guardar */}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="submit" className="btn btn-primary lg">
            <Save size={16} /> Guardar configuración
          </button>
        </div>
      </form>

      <BackupCard onDataReplaced={onDataReplaced} />

      <AnimationTestCard />

      <ApiKeySecurityCard
        onKeysForgotten={() => setGeminiApiKey('')}
      />

      {/* Acciones destructivas / Restablecer datos */}
      <div className="card" style={{ border: '1px solid var(--border-danger, rgba(239, 68, 68, 0.3))' }}>
        <div className="card-head">
          <div className="row">
            <RotateCcw size={18} style={{ color: '#ef4444' }} />
            <div>
              <div className="card-title" style={{ color: '#ef4444' }}>
                Restablecer datos
              </div>
              <div className="card-sub">Acciones de mantenimiento y reinicio del sistema</div>
            </div>
          </div>
        </div>

        <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 14 }}>
          Puedes cargar los datos de ejemplo iniciales para explorar todas las métricas, o comenzar totalmente de cero limpiando los hábitos y registros. Tus claves de API y configuraciones de IA se conservarán.
        </p>

        <div className="grid-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetSeed}
            style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: 'var(--text)' }}
          >
            <RotateCcw size={16} /> Cargar datos de ejemplo
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetEmpty}
            style={{
              borderColor: '#ef4444',
              borderWidth: '1.5px',
              borderStyle: 'solid',
              color: '#ef4444',
              fontWeight: 600,
            }}
          >
            <RotateCcw size={16} style={{ color: '#ef4444' }} /> Empezar de 0
          </button>
        </div>
      </div>

      {/* Modal Confirmación Cargar Datos Demo */}
      <ConfirmModal
        isOpen={showResetDemoConfirm}
        onClose={() => setShowResetDemoConfirm(false)}
        onConfirm={confirmResetDemo}
        title="¿Cargar datos de ejemplo?"
        message="Esta acción reemplazará los hábitos, sesiones e historiales actuales con el conjunto de datos de demostración de ~9 semanas. Tus claves de API y modelos se conservarán."
        confirmLabel="Cargar datos de ejemplo"
        confirmVariant="warning"
        zIndex={1300}
      />

      {/* Modal Confirmación Empezar de 0 */}
      <ConfirmModal
        isOpen={showResetEmptyConfirm}
        onClose={() => setShowResetEmptyConfirm(false)}
        onConfirm={confirmResetEmpty}
        title="¿Empezar completamente de 0?"
        message="Se eliminarán todos los hábitos, objetivos, retos, sesiones y registros de la aplicación. Esta acción no se puede deshacer. ¿Deseas continuar?"
        confirmLabel="Sí, empezar de 0"
        confirmVariant="danger"
        zIndex={1300}
      />
    </div>
  );
};
