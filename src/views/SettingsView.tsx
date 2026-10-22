import React, { useState, useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { useSecrets } from '../store/useSecrets';
import { AiPlatform, TtsPlatform, UserGender } from '../types';
import { personaFor } from '../components/coach/coachPersona';
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
  Mic,
  Headphones,
  Check,
  ChevronDown,
  X,
  Bell,
  Clock,
  Flame,
  Sun,
  Moon,
  Droplets,
  Eye,
  EyeOff,
  Play,
  Square,
} from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { ApiKeySecurityCard } from '../components/settings/ApiKeySecurityCard';
import { BackupCard } from '../components/settings/BackupCard';
import { AccountCard } from '../components/settings/AccountCard';
import { AnimationTestCard } from '../components/settings/AnimationTestCard';
import { useToast } from '../components/ui/ToastContext';
import { CustomSelect } from '../components/ui/CustomSelect';
import { CustomTimePicker } from '../components/ui/CustomTimePicker';
import { fetchAvailableModels, PRESET_MODELS, ModelOption } from '../lib/gemini';
import { checkDeepgramKey, checkTtsKey, type VoiceCheckResult } from '../lib/voiceCheck';
import { resolveCoachVoice, speakCoach, stopCoachVoice, unlockCoachVoice, useCoachSpeaking } from '../lib/coachVoice';
import { playSound } from '../lib/sound';
import { PRESET_TTS_MODELS } from '../lib/ttsPresets';
import {
  getNotificationPermission,
  requestNotificationPermission,
} from '../lib/notifications';

interface VoicePresetItem {
  id: string;
  name: string;
  gender?: string;
  desc?: string;
}

interface VoicePresetGroup {
  groupName: string;
  flag?: string;
  voices: VoicePresetItem[];
}

const VOICE_PRESETS: Record<string, VoicePresetGroup[]> = {
  fish_audio: [
    {
      groupName: 'Español',
      flag: '🇪🇸',
      voices: [
        { id: 'bfed5c0810a347dbb62e8ccce7f59c48', name: 'Mujer Adulta', gender: 'Femenina', desc: 'bfed5c08...' },
        { id: '60a33602dacc4d899cb671b024e66d8c', name: 'Hombre Adulto', gender: 'Masculina', desc: '60a33602...' },
        { id: '1fb9a295ef7047eb9ae334b779567f9d', name: 'Chico Joven', gender: 'Masculina', desc: '1fb9a295...' },
        { id: '35929683c49c4ec0bf779dc07d22620b', name: 'Chica Joven', gender: 'Femenina', desc: '35929683...' },
      ],
    },
    {
      groupName: 'English',
      flag: '🇬🇧',
      voices: [
        { id: '933563129e564b19a115bedd57b7406a', name: 'Adult Woman', gender: 'Female', desc: '93356312...' },
        { id: 'd8a1340984ee4b63ad1ffae27a6a4339', name: 'Adult Man', gender: 'Male', desc: 'd8a13409...' },
        { id: '802e3bc2b27e49c2995d23ef70e6ac89', name: 'Young Boy', gender: 'Male', desc: '802e3bc2...' },
        { id: 'c2623f0c075b4492ac367989aee1576f', name: 'Young Girl', gender: 'Female', desc: 'c2623f0c...' },
      ],
    },
  ],
  openai: [
    {
      groupName: 'Voces OpenAI',
      voices: [
        { id: 'nova', name: 'Nova', gender: 'Femenina', desc: 'Cálida y natural' },
        { id: 'alloy', name: 'Alloy', gender: 'Neutra', desc: 'Equilibrada y versátil' },
        { id: 'echo', name: 'Echo', gender: 'Masculina', desc: 'Clara y confiable' },
        { id: 'fable', name: 'Fable', gender: 'Expresiva', desc: 'Narrativa británica' },
        { id: 'onyx', name: 'Onyx', gender: 'Masculina', desc: 'Profunda y formal' },
        { id: 'shimmer', name: 'Shimmer', gender: 'Femenina', desc: 'Clara y brillante' },
      ],
    },
  ],
  elevenlabs: [
    {
      groupName: 'Voces Populares ElevenLabs',
      voices: [
        { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'Femenina', desc: 'Calmada y amigable' },
        { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'Masculina', desc: 'Profunda y autoritaria' },
        { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'Masculina', desc: 'Equilibrada y profesional' },
        { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'Femenina', desc: 'Suave y expresiva' },
        { id: 'piTKgcLEGmPE4e6mEKli', name: 'Nicole', gender: 'Femenina', desc: 'Lectura pausada' },
      ],
    },
  ],
};

/** Insignias del estado de las claves de voz: mismo estilo que la de modelos detectados de IA */
const VOICE_BADGE_STYLE: Record<VoiceCheckResult['state'] | 'checking', React.CSSProperties> = {
  ok: { fontSize: 11, background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' },
  invalid: { fontSize: 11, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171' },
  error: { fontSize: 11, background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' },
  checking: { fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 },
};

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
  const [userGender, setUserGender] = useState<UserGender>(settings.userGender || 'other');
  const [maxActiveHabits, setMaxActiveHabits] = useState(settings.maxActiveHabits || 7);
  const [askFailReason, setAskFailReason] = useState(settings.askFailReason);

  // IA Settings
  const [aiPlatform, setAiPlatform] = useState<AiPlatform>(settings.aiPlatform || 'gemini');
  const [geminiApiKey, setGeminiApiKey] = useState(secrets.geminiApiKey);
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel || 'gemini-3.5-flash-lite');
  const [backupModel, setBackupModel] = useState(settings.backupModel || 'gemini-3.1-flash');

  // Voz (TTS & STT)
  const [ttsPlatform, setTtsPlatform] = useState<TtsPlatform>(settings.ttsPlatform || 'fish_audio');
  const keyForTtsPlatform = (p: TtsPlatform | undefined) =>
    (p === 'elevenlabs'
      ? secrets.elevenLabsApiKey
      : p === 'openai'
      ? secrets.openaiTtsApiKey
      : p === 'native'
      ? ''
      : secrets.fishAudioApiKey) || secrets.ttsApiKey;
  const [ttsApiKey, setTtsApiKey] = useState(() => keyForTtsPlatform(settings.ttsPlatform || 'fish_audio'));
  const [ttsModel, setTtsModel] = useState(settings.ttsModel || 's2.1-pro-free');
  const [ttsVoiceId, setTtsVoiceId] = useState(settings.ttsVoiceId || '');
  const [deepgramApiKey, setDeepgramApiKey] = useState(secrets.deepgramApiKey);

  // Comprobación de las claves de voz y modelos detectados (como en la tarjeta de IA)
  const [ttsCheck, setTtsCheck] = useState<VoiceCheckResult | null>(null);
  const [isCheckingTts, setIsCheckingTts] = useState(false);
  const [sttCheck, setSttCheck] = useState<VoiceCheckResult | null>(null);
  const [isCheckingStt, setIsCheckingStt] = useState(false);

  useEffect(() => {
    const key = ttsApiKey.trim();
    if (ttsPlatform !== 'native' && key.length < 8) {
      setTtsCheck(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setIsCheckingTts(true);
      const result = await checkTtsKey(ttsPlatform, key);
      if (!active) return;
      setTtsCheck(result);
      setIsCheckingTts(false);
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
      setIsCheckingTts(false);
    };
  }, [ttsPlatform, ttsApiKey]);

  useEffect(() => {
    const key = deepgramApiKey.trim();
    if (key.length < 8) {
      setSttCheck(null);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setIsCheckingStt(true);
      const result = await checkDeepgramKey(key);
      if (!active) return;
      setSttCheck(result);
      setIsCheckingStt(false);
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
      setIsCheckingStt(false);
    };
  }, [deepgramApiKey]);

  // Al desbloquear las claves cifradas, rellenar los campos con los valores descifrados
  useEffect(() => {
    if (secretsLocked) return;
    setGeminiApiKey(secrets.geminiApiKey);
    setDeepgramApiKey(secrets.deepgramApiKey);
    setTtsApiKey(keyForTtsPlatform(ttsPlatform));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretsLocked]);


  // Estado para edición de ID de voz custom
  const [isEditingCustomVoice, setIsEditingCustomVoice] = useState(false);

  // Identificar si el ID actual coincide con algún preset para mostrar badge visual
  const currentPresetVoice = useMemo(() => {
    if (!ttsVoiceId.trim()) return null;
    const groups = VOICE_PRESETS[ttsPlatform] || [];
    for (const group of groups) {
      for (const v of group.voices) {
        if (v.id.toLowerCase() === ttsVoiceId.trim().toLowerCase()) {
          return { ...v, flag: group.flag, groupName: group.groupName };
        }
      }
    }
    return null;
  }, [ttsVoiceId, ttsPlatform]);

  const voiceSelectOptions = useMemo(() => {
    const groups = VOICE_PRESETS[ttsPlatform] || [];
    const opts = [
      {
        value: '',
        label: 'Voz base del modelo (Predeterminada)',
        sublabel: 'Voz estándar sin referencia',
      },
    ];

    groups.forEach((g) => {
      g.voices.forEach((v) => {
        opts.push({
          value: v.id,
          label: `${g.flag ? g.flag + ' ' : ''}${v.name} ${v.gender ? `(${v.gender})` : ''}`,
          sublabel: `${g.groupName} · ${v.desc || (v.id.length > 12 ? v.id.slice(0, 10) + '...' : v.id)}`,
        });
      });
    });

    opts.push({
      value: '__custom__',
      label: 'Especificar ID o referencia personalizada...',
      sublabel: 'Escribir o pegar un Voice ID propio',
    });

    return opts;
  }, [ttsPlatform]);

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

  const ttsModelOptions = useMemo(() => {
    // Con la clave comprobada se ofrecen los modelos que de verdad tiene la cuenta
    const detected = ttsCheck?.state === 'ok' && ttsCheck.models?.length ? ttsCheck.models : null;
    const models = detected ?? PRESET_TTS_MODELS[ttsPlatform] ?? [];
    const opts = models.map((m) => ({
      value: m.id,
      label: m.name,
      sublabel: m.id,
    }));
    if (ttsModel && !models.some((m) => m.id === ttsModel)) {
      opts.push({
        value: ttsModel,
        label: `${ttsModel} (Personalizado)`,
        sublabel: 'Ingresado manualmente',
      });
    }
    return opts;
  }, [ttsPlatform, ttsModel, ttsCheck]);

  /** Voz que usará el coach con lo que hay ahora en el formulario */
  const coachVoicePreview = useMemo(
    () =>
      resolveCoachVoice(
        { ttsPlatform, ttsModel, ttsVoiceId, aiPlatform },
        {
          geminiApiKey,
          ttsApiKey,
          elevenLabsApiKey: ttsPlatform === 'elevenlabs' ? ttsApiKey : secrets.elevenLabsApiKey,
          openaiTtsApiKey: ttsPlatform === 'openai' ? ttsApiKey : secrets.openaiTtsApiKey,
          fishAudioApiKey: ttsPlatform === 'fish_audio' ? ttsApiKey : secrets.fishAudioApiKey,
        },
      ),
    [ttsPlatform, ttsModel, ttsVoiceId, aiPlatform, geminiApiKey, ttsApiKey, secrets],
  );
  /** Prueba de voz con lo que hay en el formulario (sin guardar), con la voz de Pilo o Pila elegida arriba */
  const coachSpeaking = useCoachSpeaking();
  const [testingVoice, setTestingVoice] = useState(false);
  const handleTestVoice = async () => {
    if (coachSpeaking || testingVoice) {
      stopCoachVoice({ fade: true });
      setTestingVoice(false);
      return;
    }
    const persona = personaFor(userGender);
    unlockCoachVoice();
    setTestingVoice(true);
    const result = await speakCoach(
      `¡Hola! Soy ${persona.name}, tu ${persona.role}. Así sonaré cuando te lea mis consejos. ¡Vamos con todo hoy!`,
      persona.gender,
      coachVoicePreview,
    );
    setTestingVoice(false);
    if (result === 'failed') {
      showToast(`No se pudo generar la voz con ${coachVoicePreview.label}. Revisa la clave, el saldo o el ID de voz.`, 'warning');
    }
  };
  // Al salir de Ajustes la prueba se corta
  useEffect(() => () => stopCoachVoice({ fade: true }), []);

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsLoadedStatus, setModelsLoadedStatus] = useState<string | null>(null);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showTtsKey, setShowTtsKey] = useState(false);
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);

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

  // Cambio de plataforma TTS
  const handleTtsPlatformChange = (p: TtsPlatform) => {
    setTtsPlatform(p);
    const presets = PRESET_TTS_MODELS[p] || [];
    if (presets.length > 0) setTtsModel(presets[0].id);
    // Sin ID la voz se elige según el coach (Pilo o Pila); el usuario puede escribir otra
    setTtsVoiceId('');
    setTtsApiKey(p === 'native' ? '' : keyForTtsPlatform(p));
    playSound.pop();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      userName: userName.trim(),
      userGender,
      maxActiveHabits: Number(maxActiveHabits),
      askFailReason,
      aiPlatform,
      geminiModel: geminiModel.trim(),
      backupModel: backupModel.trim(),
      ttsPlatform,
      ttsModel: ttsModel.trim(),
      ttsVoiceId: ttsVoiceId.trim(),
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
      await setKeys({
        geminiApiKey: geminiApiKey.trim(),
        ttsApiKey: ttsApiKey.trim(),
        ...(ttsPlatform === 'fish_audio' ? { fishAudioApiKey: ttsApiKey.trim() } : {}),
        ...(ttsPlatform === 'elevenlabs' ? { elevenLabsApiKey: ttsApiKey.trim() } : {}),
        ...(ttsPlatform === 'openai' ? { openaiTtsApiKey: ttsApiKey.trim() } : {}),
        deepgramApiKey: deepgramApiKey.trim(),
      });
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
                <span className="label" id="settings-gender-label">
                  Te identificas como
                </span>
                <div className="gender-options" role="radiogroup" aria-labelledby="settings-gender-label">
                  {(
                    [
                      ['male', 'Hombre'],
                      ['female', 'Mujer'],
                      ['other', 'Otro'],
                    ] as [UserGender, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={userGender === value}
                      className="gender-option"
                      onClick={() => setUserGender(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  Tu coach será {personaFor(userGender).name}, tu {personaFor(userGender).role}.
                </span>
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

        {/* VOZ Y DICTADO NEURONAL (TTS Y STT) */}
        <div className="card">
          <div className="card-head">
            <div className="row">
              <Headphones size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Voz Neuronal y Dictado (TTS & STT)</div>
                <div className="card-sub">Claves y preferencias de voz y transcripción, guardadas en este navegador</div>
              </div>
            </div>
            {isCheckingTts ? (
              <span className="badge" style={VOICE_BADGE_STYLE.checking}>
                <RefreshCw size={11} className="spin" /> Comprobando clave…
              </span>
            ) : (
              ttsCheck && <span className="badge" style={VOICE_BADGE_STYLE[ttsCheck.state]}>{ttsCheck.message}</span>
            )}
          </div>

          <div className="form">
            {/* PLATAFORMA TTS & API KEY */}
            <div className="grid-2" style={{ gap: 14 }}>
              {/* Plataforma proveedora de TTS */}
              <div className="field">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    <Volume2 size={14} style={{ color: '#06b6d4' }} />
                    Plataforma de Voz (TTS)
                  </span>
                  <span className="badge" style={{ fontSize: 10, background: 'rgba(6, 182, 212, 0.15)', color: '#06b6d4' }}>
                    Lectura
                  </span>
                </div>
                <CustomSelect<TtsPlatform>
                  value={ttsPlatform}
                  onChange={(val) => handleTtsPlatformChange(val)}
                  options={[
                    { value: 'fish_audio', label: 'Fish Audio', sublabel: 'Neuronal ultra-realista' },
                    { value: 'elevenlabs', label: 'ElevenLabs', sublabel: 'Voces humanas premium' },
                    { value: 'openai', label: 'OpenAI TTS', sublabel: 'Nova, Alloy, Echo...' },
                    { value: 'native', label: 'Síntesis nativa del navegador', sublabel: 'Sin costo (motor local)' },
                  ]}
                />
                <span className="hint">
                  Selecciona qué proveedor generará las respuestas habladas de tu asistente.
                </span>
              </div>

              {/* API Key de TTS */}
              <div className="field">
                <div className="row-between">
                  <span className="label">
                    {ttsPlatform === 'fish_audio'
                      ? 'Fish Audio API Key'
                      : ttsPlatform === 'elevenlabs'
                      ? 'ElevenLabs API Key'
                      : ttsPlatform === 'openai'
                      ? 'OpenAI API Key (Audio)'
                      : 'API Key no requerida'}
                  </span>
                  {ttsPlatform === 'fish_audio' && (
                    <a href="https://fish.audio" target="_blank" rel="noreferrer" className="small accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      fish.audio <ExternalLink size={12} />
                    </a>
                  )}
                  {ttsPlatform === 'elevenlabs' && (
                    <a href="https://elevenlabs.io" target="_blank" rel="noreferrer" className="small accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      elevenlabs.io <ExternalLink size={12} />
                    </a>
                  )}
                  {ttsPlatform === 'openai' && (
                    <a href="https://platform.openai.com" target="_blank" rel="noreferrer" className="small accent" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      openai.com <ExternalLink size={12} />
                    </a>
                  )}
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showTtsKey ? 'text' : 'password'}
                    name="constancia_tts_token_field"
                    autoComplete="new-password"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-bwignore="true"
                    data-form-type="other"
                    spellCheck={false}
                    className="input"
                    disabled={ttsPlatform === 'native' || secretsLocked}
                    value={ttsPlatform === 'native' ? 'No se requiere clave' : ttsApiKey}
                    onChange={(e) => setTtsApiKey(e.target.value)}
                    style={{ paddingRight: ttsPlatform !== 'native' ? 40 : undefined }}
                    placeholder={
                      ttsPlatform === 'fish_audio'
                        ? 'fish_...'
                        : ttsPlatform === 'elevenlabs'
                        ? 'sk_...'
                        : ttsPlatform === 'openai'
                        ? 'sk-proj-...'
                        : 'Síntesis local sin costo'
                    }
                  />
                  {ttsPlatform !== 'native' && (
                    <button
                      type="button"
                      onClick={() => setShowTtsKey((p) => !p)}
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
                      title={showTtsKey ? 'Ocultar clave' : 'Mostrar clave'}
                      aria-label={showTtsKey ? 'Ocultar clave' : 'Mostrar clave'}
                    >
                      {showTtsKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  )}
                </div>
                <span className="hint">
                  {ttsPlatform === 'native'
                    ? 'Usa el motor de voz del sistema operativo de tu dispositivo.'
                    : 'Clave privada almacenada únicamente en tu navegador.'}
                </span>
              </div>
            </div>

            {/* MODELO DE VOZ & ID DE VOZ */}
            <div className="grid-2" style={{ gap: 14 }}>
              {/* Modelo de TTS */}
              <div className="field">
                <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Layers size={14} style={{ color: 'var(--accent)' }} />
                  Modelo de Voz
                </span>
                <CustomSelect
                  value={ttsModel}
                  onChange={(val) => setTtsModel(val)}
                  options={ttsModelOptions}
                  disabled={ttsPlatform === 'native'}
                />
                <span className="hint">
                  {ttsPlatform === 'fish_audio'
                    ? 'Modelos de última generación: S2.1 Pro Free (gratuito), S2 Pro y S1 con máxima fidelidad y emoción.'
                    : ttsPlatform === 'elevenlabs'
                    ? 'Multilingual v2 está optimizado para español nativo.'
                    : ttsPlatform === 'openai'
                    ? 'tts-1 ofrece baja latencia para conversaciones dinámicas.'
                    : 'Voz estándar en español de tu navegador.'}
                </span>
              </div>

              {/* ID de Voz - Campo de escritura limpio */}
              <div className="field">
                <div className="row-between" style={{ marginBottom: 4 }}>
                  <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                    <Mic size={14} style={{ color: 'var(--accent)' }} />
                    ID de Voz
                  </span>
                </div>

                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input"
                    disabled={ttsPlatform === 'native'}
                    value={ttsVoiceId}
                    onChange={(e) => setTtsVoiceId(e.target.value)}
                    placeholder="Vacío: voz según Pilo o Pila"
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 12.5,
                      flex: 1,
                      paddingRight: ttsVoiceId ? 36 : undefined,
                    }}
                  />
                  {ttsVoiceId && (
                    <button
                      type="button"
                      className="btn btn-ghost sm"
                      onClick={() => {
                        setTtsVoiceId('');
                        playSound.pop();
                      }}
                      style={{ position: 'absolute', right: 6, padding: 4 }}
                      title="Limpiar ID de voz"
                      aria-label="Limpiar ID de voz"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <span className="hint">
                  {ttsPlatform === 'native'
                    ? 'Usa la síntesis de voz nativa del dispositivo.'
                    : 'ID de referencia para la síntesis de voz.'}
                </span>
              </div>
            </div>

            {/* STT DEDICADO: DEEPGRAM (OBLIGATORIO FIJO) */}
            <div className="field" style={{ marginTop: 4 }}>
              <div className="row-between">
                <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mic size={14} style={{ color: '#10b981' }} />
                  Deepgram API Key (Dictado y Reconocimiento de Voz - STT)
                </span>
                <a
                  href="https://console.deepgram.com"
                  target="_blank"
                  rel="noreferrer"
                  className="small accent"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  console.deepgram.com <ExternalLink size={12} />
                </a>
              </div>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showDeepgramKey ? 'text' : 'password'}
                  name="constancia_stt_token_field"
                  autoComplete="new-password"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  spellCheck={false}
                  className="input"
                  style={{ paddingRight: 40 }}
                  disabled={secretsLocked}
                  value={deepgramApiKey}
                  onChange={(e) => setDeepgramApiKey(e.target.value)}
                  placeholder="dg_..."
                />
                <button
                  type="button"
                  onClick={() => setShowDeepgramKey((p) => !p)}
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
                  title={showDeepgramKey ? 'Ocultar clave' : 'Mostrar clave'}
                  aria-label={showDeepgramKey ? 'Ocultar clave' : 'Mostrar clave'}
                >
                  {showDeepgramKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <span className="hint">
                Proveedor fijo de STT. Modelo Nova-3 con transcripción ultrarrápida y puntuación automática en español. Si no se configura, se utiliza el reconocimiento de voz nativo del navegador.
              </span>
              {(isCheckingStt || sttCheck) && (
                <span className="badge" style={{ ...VOICE_BADGE_STYLE[isCheckingStt ? 'checking' : sttCheck!.state], alignSelf: 'flex-start' }}>
                  {isCheckingStt ? (
                    <>
                      <RefreshCw size={11} className="spin" /> Comprobando clave…
                    </>
                  ) : (
                    sttCheck!.message
                  )}
                </span>
              )}
            </div>

            {/* Qué voz usará de verdad el coach con estos ajustes */}
            <div className="callout" style={{ alignItems: 'center' }}>
              <Volume2 />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">Voz del coach: {coachVoicePreview.label}</div>
                {coachVoicePreview.note && <div className="detail">{coachVoicePreview.note}, por eso el coach usa esta voz en su lugar.</div>}
              </div>
              <button
                type="button"
                className="btn btn-secondary sm"
                onClick={handleTestVoice}
                disabled={testingVoice && !coachSpeaking}
                aria-label={coachSpeaking ? 'Detener la prueba de voz' : `Probar la voz de ${personaFor(userGender).name}`}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {coachSpeaking ? (
                  <>
                    <Square size={13} /> Detener
                  </>
                ) : testingVoice ? (
                  <>
                    <RefreshCw size={13} className="spin" /> Generando…
                  </>
                ) : (
                  <>
                    <Play size={13} /> Probar voz
                  </>
                )}
              </button>
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
                  Alertas nativas del sistema operativo: recordatorios a tu hora exacta, racha activa y mensajes de {personaFor(userGender).name} con variantes
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
                        Mensaje de {personaFor(userGender).name} con tu nombre ({userName || 'Usuario'})
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
                    </div>
                  </div>
                  <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
                    Envía un mensaje reflexivo y motivacional de {personaFor(userGender).name} con tu nombre real, alternando frases de disciplina, claridad mental y enfoque sin necesidad de consumo de API.
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

      <AccountCard />

      <BackupCard onDataReplaced={onDataReplaced} />

      <AnimationTestCard />

      <ApiKeySecurityCard
        onKeysForgotten={() => {
          setGeminiApiKey('');
          setTtsApiKey('');
          setDeepgramApiKey('');
        }}
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
        message="Esta acción reemplazará los hábitos, sesiones e historiales actuales con el conjunto de datos de demostración de ~9 semanas, en todos tus dispositivos (se sincroniza con tu cuenta). Tus claves de API y modelos se conservarán."
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
        message="Se eliminarán todos los hábitos, objetivos, retos, sesiones y registros de tu cuenta, también en tus otros dispositivos. Esta acción no se puede deshacer. ¿Deseas continuar?"
        confirmLabel="Sí, empezar de 0"
        confirmVariant="danger"
        zIndex={1300}
      />
    </div>
  );
};
