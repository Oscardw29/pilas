import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, MicOff, Hand, ArrowUp, AudioLines, RotateCcw } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import { getSecrets } from '@/store/useSecrets';
import { useModalBehavior } from '@/components/ui/useModalBehavior';
import { useToast } from '@/components/ui/ToastContext';
import { generateHabitAdvice } from '@/lib/gemini';
import { speakWithTts } from '@/lib/voice';
import { createVoiceListener, requestMicStream, stopStream, toMicError, type VoiceListener } from '@/lib/voiceInput';
import { classifyConfirmation, normalizeWords, toSpeechText } from '@/lib/voiceText';
import { executeCoachAction, type ParsedAction } from '@/lib/coachActions';
import { playSound } from '@/lib/sound';
import { ActionConfirmationCard } from '@/components/coach/ActionConfirmationCard';
import { extractActionAndText } from '@/components/coach/extractAction';
import { VoiceVisualizer, type VisualizerState } from '@/components/coach/VoiceVisualizer';

/** Saludos breves: el asistente debe dar paso al usuario cuanto antes */
const GREETINGS = [
  (n: string) => `¡Hola${n}! ¿En qué te ayudo?`,
  (n: string) => `¡Hola${n}! Te escucho.`,
  (n: string) => `¡Qué más${n}! ¿Qué revisamos?`,
  (n: string) => `Aquí estoy${n}. ¿Qué necesitas?`,
];

function greeting(userName?: string): string {
  const first = userName?.trim().split(/\s+/)[0];
  const n = first ? `, ${first}` : '';
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)](n);
}

type Phase = 'starting' | 'listening' | 'thinking' | 'speaking';
type ChatTurn = { role: 'user' | 'model'; text: string };
interface PendingAction {
  action: ParsedAction;
  status: 'pending' | 'applied' | 'dismissed';
}

interface VoiceAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceAssistantModal: React.FC<VoiceAssistantModalProps> = ({ isOpen, onClose }) => {
  const settings = useStore((s) => s.settings);
  // Valor más reciente sin reiniciar la sesión de voz si cambian los ajustes con el modal abierto
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [phase, setPhaseState] = useState<Phase>('starting');
  const [muted, setMuted] = useState(false);
  const [caption, setCaption] = useState<{ who: 'user' | 'assistant'; text: string }>({ who: 'assistant', text: '' });
  const [pending, setPendingState] = useState<PendingAction | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  /** Cada apertura es una sesión: las respuestas asíncronas de una sesión anterior se descartan */
  const sessionRef = useRef(0);
  const phaseRef = useRef<Phase>('starting');
  const mutedRef = useRef(false);
  const pendingRef = useRef<PendingAction | null>(null);
  const historyRef = useRef<ChatTurn[]>([]);

  const listenerRef = useRef<VoiceListener | null>(null);
  const listenerRetriedRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const ttsAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const speechRef = useRef<{ stop: () => void } | null>(null);
  const speechTokenRef = useRef(0);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const speakingTextRef = useRef('');
  const pulseRef = useRef(0);

  const setPending = (p: PendingAction | null) => {
    pendingRef.current = p;
    setPendingState(p);
  };

  /** Modo del oyente según la fase: escuchar, vigilar interrupciones o ignorar */
  const syncListener = useCallback(() => {
    const l = listenerRef.current;
    if (!l) return;
    const p = phaseRef.current;
    if (mutedRef.current || p === 'thinking' || p === 'starting') l.setMode('off');
    else if (p === 'speaking') l.setMode('watch', speakingTextRef.current);
    else l.setMode('turn');
  }, []);

  const setPhase = useCallback(
    (p: Phase) => {
      phaseRef.current = p;
      setPhaseState(p);
      syncListener();
    },
    [syncListener]
  );

  /* ------------------------------------------------------------ Audio de salida (voz del asistente) */

  const stopSpeaking = useCallback(() => {
    speechTokenRef.current++;
    const handle = speechRef.current;
    speechRef.current = null;
    try {
      handle?.stop();
    } catch {
      /* ignorar */
    }
    const el = audioElRef.current;
    audioElRef.current = null;
    if (el) {
      try {
        el.pause();
        el.removeAttribute('src');
      } catch {
        /* ignorar */
      }
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignorar */
      }
    }
  }, []);

  /** Enruta el audio sintetizado al analizador para que el anillo reaccione a la voz real */
  const handleAudioCreated = useCallback((audio: HTMLAudioElement) => {
    audioElRef.current = audio;
    const ctx = audioCtxRef.current;
    // Con el contexto suspendido el audio enrutado sonaría mudo: en ese caso se deja sonar sin analizar
    if (!ctx || ctx.state !== 'running') return;
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.55;
      const src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      src.connect(ctx.destination);
      ttsAnalyserRef.current = analyser;
    } catch (err) {
      console.warn('[Voz] No se pudo analizar el audio del asistente:', err);
    }
  }, []);

  const goListen = useCallback(() => {
    ttsAnalyserRef.current = null;
    setPhase('listening');
  }, [setPhase]);

  /** Dice un texto (ya limpio para voz) y vuelve a escuchar al terminar o al ser interrumpido */
  const speak = useCallback(
    async (text: string) => {
      const sid = sessionRef.current;
      stopSpeaking();
      const spoken = toSpeechText(text);
      if (!spoken) {
        goListen();
        return;
      }
      const token = speechTokenRef.current;
      const isCurrent = () => sid === sessionRef.current && token === speechTokenRef.current;
      speakingTextRef.current = spoken;
      setCaption({ who: 'assistant', text: spoken });

      try {
        const handle = await speakWithTts(
          spoken,
          settingsRef.current,
          handleAudioCreated,
          () => {
            if (isCurrent()) setPhase('speaking');
          },
          () => {
            if (isCurrent()) goListen();
          },
          () => {
            pulseRef.current = Math.min(1, pulseRef.current + 0.7);
          }
        );
        if (!isCurrent()) {
          handle.stop();
          return;
        }
        speechRef.current = handle;
      } catch (err) {
        console.warn('[Voz] No se pudo reproducir la respuesta:', err);
        if (isCurrent()) goListen();
      }
    },
    [goListen, handleAudioCreated, setPhase, stopSpeaking]
  );

  /* ------------------------------------------------------------ Cambios propuestos */

  const applyPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p || p.status !== 'pending') return;
    try {
      const result = executeCoachAction(p.action);
      if (!result.ok) {
        setPending({ ...p, status: 'dismissed' });
        toast(result.message, 'warning');
        void speak(`No pude aplicarlo. ${result.message}.`);
        return;
      }
      setPending({ ...p, status: 'applied' });
      if (p.action.action === 'delete_habit') playSound.delete();
      else playSound.pop();
      toast(result.message, p.action.action === 'delete_habit' ? 'info' : 'success');
      void speak(`Listo. ${result.message}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast(`Error aplicando el cambio: ${msg}`, 'error');
      setPending({ ...p, status: 'dismissed' });
      void speak('No pude aplicar ese cambio.');
    }
  }, [speak, toast]);

  const dismissPending = useCallback(
    (sayIt: boolean) => {
      const p = pendingRef.current;
      if (!p || p.status !== 'pending') return;
      setPending({ ...p, status: 'dismissed' });
      playSound.dismiss();
      if (sayIt) void speak('Entendido, no hago ese cambio.');
    },
    [speak]
  );

  /* ------------------------------------------------------------ Turno del usuario → respuesta */

  const handleUserTurn = useCallback(
    async (text: string) => {
      const sid = sessionRef.current;
      const userText = text.trim();
      if (!userText) return;
      setCaption({ who: 'user', text: userText });
      setPhase('thinking');

      // ¿Responde «sí» o «no» a un cambio que está en pantalla?
      const p = pendingRef.current;
      if (p?.status === 'pending') {
        const verdict = classifyConfirmation(userText);
        if (verdict === 'accept') {
          applyPending();
          return;
        }
        if (verdict === 'reject') {
          const onlyNo = normalizeWords(userText).length <= 2;
          dismissPending(onlyNo);
          if (onlyNo) return;
        }
      }

      try {
        const response = await generateHabitAdvice(selectData(useStore.getState()), userText, historyRef.current, { voice: true });
        if (sid !== sessionRef.current) return;
        const { text: visible, action } = extractActionAndText(response);
        historyRef.current = [...historyRef.current, { role: 'user' as const, text: userText }, { role: 'model' as const, text: visible }].slice(-8);
        if (action) {
          setPending({ action, status: 'pending' });
          playSound.pop();
        }
        const reply = toSpeechText(visible) || (action ? 'Te dejé la propuesta en pantalla. ¿La aplico?' : '');
        await speak(reply || 'Ahora mismo no tengo una respuesta. ¿Me lo repites?');
      } catch (err) {
        console.warn('[Voz] Error generando respuesta:', err);
        if (sid === sessionRef.current) await speak('No pude responder ahora. Inténtalo de nuevo en un momento.');
      }
    },
    [applyPending, dismissPending, setPhase, speak]
  );

  /* ------------------------------------------------------------ Micrófono y reconocimiento */

  const releaseMic = useCallback(() => {
    try {
      micSourceRef.current?.disconnect();
    } catch {
      /* ignorar */
    }
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const startListener = useCallback(
    (sid: number) => {
      listenerRef.current?.dispose();
      listenerRef.current = null;
      try {
        listenerRef.current = createVoiceListener(
          {
            onPartial: (t) => {
              if (sid !== sessionRef.current || phaseRef.current === 'thinking') return;
              setCaption({ who: 'user', text: t });
            },
            onTurn: (t) => {
              if (sid === sessionRef.current) void handleUserTurn(t);
            },
            onBargeIn: () => {
              if (sid !== sessionRef.current) return;
              // El usuario habla encima: se corta la voz al instante y su turno ya está en curso
              stopSpeaking();
              ttsAnalyserRef.current = null;
              phaseRef.current = 'listening';
              setPhaseState('listening');
            },
            onProcessing: (busy) => {
              if (sid === sessionRef.current) setTranscribing(busy);
            },
            onError: (err) => {
              if (sid !== sessionRef.current) return;
              listenerRef.current = null;
              // En Android el reconocimiento nativo no comparte el micrófono: se suelta el del visualizador y se reintenta
              if (err.code === 'busy' && streamRef.current && !listenerRetriedRef.current) {
                listenerRetriedRef.current = true;
                releaseMic();
                startListener(sid);
                return;
              }
              setMicError(err.message);
            },
          },
          {
            autoEnd: true,
            getStream: async () => streamRef.current ?? (streamRef.current = await requestMicStream()),
          }
        );
        syncListener();
      } catch (err) {
        setMicError(toMicError(err).message);
      }
    },
    [handleUserTurn, releaseMic, stopSpeaking, syncListener]
  );

  /** Pide el micrófono (muestra el aviso de permiso), prepara el analizador y arranca el reconocimiento */
  const startMic = useCallback(
    async (sid: number) => {
      setMicError(null);
      listenerRetriedRef.current = false;
      try {
        const stream = await requestMicStream();
        if (sid !== sessionRef.current) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const ctx = audioCtxRef.current;
        if (ctx) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.6;
          const src = ctx.createMediaStreamSource(stream);
          src.connect(analyser); // nunca a los altavoces
          micSourceRef.current = src;
          micAnalyserRef.current = analyser;
        }
      } catch (err) {
        if (sid !== sessionRef.current) return;
        setMicError(toMicError(err).message);
        return;
      }
      startListener(sid);
    },
    [startListener]
  );

  /* ------------------------------------------------------------ Ciclo de vida */

  const teardown = useCallback(() => {
    sessionRef.current++;
    stopSpeaking();
    listenerRef.current?.dispose();
    listenerRef.current = null;
    releaseMic();
    ttsAnalyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => undefined);
  }, [releaseMic, stopSpeaking]);

  useEffect(() => {
    if (!isOpen) return;
    const sid = ++sessionRef.current;
    playSound.modalOpen();

    mutedRef.current = false;
    setMuted(false);
    setPending(null);
    setMicError(null);
    setTranscribing(false);
    historyRef.current = [];

    const cfg = settingsRef.current;
    const secrets = getSecrets();
    const ttsKey =
      cfg.ttsPlatform === 'elevenlabs'
        ? secrets.elevenLabsApiKey
        : cfg.ttsPlatform === 'openai'
          ? secrets.openaiTtsApiKey
          : secrets.fishAudioApiKey || secrets.ttsApiKey;
    setVoiceNote(cfg.ttsPlatform && cfg.ttsPlatform !== 'native' && !ttsKey ? 'Sin clave de voz configurada: se usa la voz del navegador.' : null);

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioCtxRef.current = new AudioCtx();
        audioCtxRef.current.resume().catch(() => undefined);
      }
    } catch {
      audioCtxRef.current = null;
    }

    phaseRef.current = 'starting';
    setPhaseState('starting');
    void speak(greeting(cfg.userName));
    void startMic(sid);

    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    teardown();
    playSound.modalClose();
    onClose();
  };

  useModalBehavior(isOpen, dialogRef, handleClose);

  /* ------------------------------------------------------------ Controles */

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    playSound.click();
    syncListener();
  };

  /** Acción principal: interrumpir si habla, enviar si hay texto dictado */
  const primaryAction = () => {
    if (phaseRef.current === 'speaking' || phaseRef.current === 'starting') {
      stopSpeaking();
      goListen();
      return;
    }
    if (mutedRef.current) {
      toggleMute();
      return;
    }
    if (phaseRef.current === 'listening' && caption.who === 'user' && caption.text) listenerRef.current?.flush();
  };

  const retryMic = () => {
    playSound.click();
    listenerRef.current?.dispose();
    listenerRef.current = null;
    releaseMic();
    void startMic(sessionRef.current);
  };

  if (!isOpen) return null;

  const visualState: VisualizerState =
    phase === 'speaking' ? 'speaking' : phase === 'thinking' ? 'thinking' : phase === 'starting' ? 'idle' : muted || micError ? 'muted' : 'listening';

  const hasUserText = phase === 'listening' && caption.who === 'user' && Boolean(caption.text);
  const statusText =
    phase === 'speaking'
      ? 'Hablando'
      : phase === 'thinking'
        ? 'Pensando'
        : phase === 'starting'
          ? 'Conectando'
          : muted
            ? 'Micrófono en pausa'
            : micError
              ? 'Sin micrófono'
              : transcribing
                ? 'Transcribiendo'
                : 'Te escucho';

  const primary =
    phase === 'speaking' || phase === 'starting'
      ? { icon: <Hand size={16} />, label: 'Interrumpir', disabled: false }
      : muted
        ? { icon: <Mic size={16} />, label: 'Reanudar', disabled: false }
        : hasUserText
          ? { icon: <ArrowUp size={16} />, label: 'Enviar', disabled: false }
          : { icon: <AudioLines size={16} />, label: phase === 'thinking' ? 'Pensando…' : 'Habla cuando quieras', disabled: true };

  return createPortal(
    <div
      className="voice-backdrop"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        teardown();
        playSound.dismiss();
        onClose();
      }}
    >
      <div ref={dialogRef} className={`voice-panel phase-${visualState}`} role="dialog" aria-modal="true" aria-label="Asistente de voz" tabIndex={-1}>
        <div className="voice-top">
          <div className="voice-title">
            <span className="voice-title-icon" aria-hidden="true">
              <AudioLines size={15} />
            </span>
            Coach de voz
          </div>
          <button type="button" className="icon-btn sm" onClick={handleClose} aria-label="Cerrar asistente de voz">
            <X size={18} />
          </button>
        </div>

        <VoiceVisualizer
          state={visualState}
          getAnalyser={() => (phaseRef.current === 'speaking' ? ttsAnalyserRef.current : phaseRef.current === 'listening' ? micAnalyserRef.current : null)}
          pulseRef={pulseRef}
          onActivate={primaryAction}
          label={phase === 'speaking' ? 'Interrumpir al asistente' : hasUserText ? 'Enviar lo que dijiste' : 'Asistente de voz'}
        />

        <div className="voice-status" aria-live="polite">
          <span className="voice-status-dot" aria-hidden="true" />
          {statusText}
        </div>

        <p className={`voice-caption from-${caption.who}`} aria-live="polite">
          {caption.text || ' '}
        </p>

        {pending && (
          <div className="voice-action">
            <ActionConfirmationCard
              compact
              action={pending.action}
              status={pending.status}
              onConfirm={applyPending}
              onDismiss={() => dismissPending(true)}
            />
          </div>
        )}

        {micError && (
          <div className="voice-alert" role="alert">
            <span>{micError}</span>
            <button type="button" className="btn btn-secondary sm" onClick={retryMic}>
              <RotateCcw size={13} /> Reintentar
            </button>
          </div>
        )}

        <div className="voice-controls">
          <button
            type="button"
            className={`voice-ctrl${muted ? ' is-off' : ''}`}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
            title={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
            disabled={Boolean(micError)}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button type="button" className="btn btn-secondary voice-primary" onClick={primaryAction} disabled={primary.disabled}>
            {primary.icon} {primary.label}
          </button>
          <button type="button" className="voice-ctrl is-end" onClick={handleClose} aria-label="Terminar conversación" title="Terminar">
            <X size={20} />
          </button>
        </div>

        {voiceNote && <p className="voice-note">{voiceNote}</p>}
      </div>
    </div>,
    document.body
  );
};
