import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Mic, MicOff, Sparkles, AlertCircle } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import { getSecrets } from '@/store/useSecrets';
import { useModalBehavior } from '@/components/ui/useModalBehavior';
import { generateHabitAdvice } from '@/lib/gemini';
import { startSpeechRecognition, speakWithTts, speakNative } from '@/lib/voice';
import { playSound } from '@/lib/sound';

const COACH_GREETING_TEMPLATES = [
  (name: string) => `¡Hola, ${name}! ¿En qué te puedo asesorar hoy para mantener tu constancia al máximo?`,
  (name: string) => `¡Buenas, ${name}! Estoy listo para apoyarte. ¿Qué hábito o desafío revisamos juntos hoy?`,
  (name: string) => `¡Hola! ¿Cómo va tu energía hoy? Cuéntame en qué objetivo o hábito nos enfocamos.`,
  (name: string) => `¡Qué tal, ${name}! Tu progreso y tu disciplina cuentan cada día. ¿Qué necesitas ajustar o potenciar?`,
  (name: string) => `¡Hola, ${name}! Aquí está tu coach de hábitos. Dime qué meta quieres que impulsemos hoy.`,
  (name: string) => `¡Buenas! Te escucho con atención. ¿Qué hábito o rutina tenemos entre manos hoy?`,
  (name: string) => `¡Hola! Listo para construir tu mejor versión. ¿En qué te puedo ayudar en este momento?`,
  (name: string) => `¡Saludos, ${name}! Cada pequeño paso suma. ¿Cómo puedo ayudarte hoy con tus hábitos?`,
];

function getRandomGreeting(userName?: string): string {
  const name = userName?.trim() || 'campeón';
  const idx = Math.floor(Math.random() * COACH_GREETING_TEMPLATES.length);
  return COACH_GREETING_TEMPLATES[idx](name);
}

interface VoiceAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VoiceAssistantModal: React.FC<VoiceAssistantModalProps> = ({ isOpen, onClose }) => {
  const settings = useStore((s) => s.settings);
  // Refs con el valor más reciente: cambiar los ajustes con el modal abierto ya no reinicia (ni rompe) la sesión de voz
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastAiTextRef = useRef('');

  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastAiText, setLastAiText] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [apiWarning, setApiWarning] = useState<string | null>(null);

  const statusRef = useRef<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const isMutedRef = useRef(false);

  const updateStatus = useCallback((newStatus: 'idle' | 'listening' | 'thinking' | 'speaking') => {
    statusRef.current = newStatus;
    setStatus(newStatus);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const speechRef = useRef<{ stop: () => void } | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<any>(null);
  const currentTranscriptRef = useRef('');
  const isOpenRef = useRef(isOpen);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);

  // Sincronizar isOpenRef e isMutedRef en cada cambio de estado
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Web Audio API para análisis espectral 100% real (no simulado)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const activeMediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Inicializar o reanudar el grafo de Web Audio API
  const getAudioGraph = useCallback(() => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtxClass) return null;
        audioCtxRef.current = new AudioCtxClass();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (!analyserRef.current || analyserRef.current.context !== ctx) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // 128 bins de frecuencia
        analyser.smoothingTimeConstant = 0.78; // Suavidad fluida y orgánica
        analyserRef.current = analyser;
        freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      return { ctx, analyser: analyserRef.current };
    } catch (err) {
      console.warn('[WebAudio] No se pudo inicializar AudioContext:', err);
      return null;
    }
  }, []);

  // Enrutar el elemento de audio del asistente hacia el Analyser y los altavoces
  const handleAudioCreated = useCallback(
    (audio: HTMLAudioElement) => {
      currentAudioElementRef.current = audio;
      if (!isOpenRef.current) {
        try {
          audio.pause();
          audio.currentTime = 0;
          audio.src = '';
        } catch {}
        return;
      }
      try {
        const graph = getAudioGraph();
        if (!graph) return;
        const { ctx, analyser } = graph;

        // Desconectar elemento anterior si existía
        if (activeMediaSourceRef.current) {
          try {
            activeMediaSourceRef.current.disconnect();
          } catch {}
          activeMediaSourceRef.current = null;
        }

        // Conectar el nuevo elemento de audio al analizador (visual) y a los altavoces (audible)
        const source = ctx.createMediaElementSource(audio);
        activeMediaSourceRef.current = source;
        source.connect(analyser);
        source.connect(ctx.destination);

        // Apagar ganancia de micrófono mientras el asistente habla para no capturar su propio eco
        if (micGainRef.current) {
          micGainRef.current.gain.setValueAtTime(0, ctx.currentTime);
        }
      } catch (err) {
        console.warn('[WebAudio] Error conectando audio de voz al visualizador:', err);
      }
    },
    [getAudioGraph]
  );

  // Inicializar captura del micrófono para visualización en tiempo real mientras el usuario habla
  const setupMicAnalysis = useCallback(async () => {
    try {
      const graph = getAudioGraph();
      if (!graph) return;
      const { ctx, analyser } = graph;

      if (!micStreamRef.current || !micStreamRef.current.active) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!isOpenRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
      }

      if (!micGainRef.current || micGainRef.current.context !== ctx) {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1.0, ctx.currentTime);
        gain.connect(analyser); // Conectar al analizador ÚNICAMENTE, NUNCA a ctx.destination
        micGainRef.current = gain;
      }

      if (!micSourceRef.current && micStreamRef.current) {
        const source = ctx.createMediaStreamSource(micStreamRef.current);
        micSourceRef.current = source;
        source.connect(micGainRef.current);
      }
    } catch (err) {
      console.warn('[WebAudio Mic] Permiso denegado o micrófono no disponible para análisis:', err);
    }
  }, [getAudioGraph]);

  // Actualizar ganancia del micrófono según el estado activo
  useEffect(() => {
    if (!audioCtxRef.current || !micGainRef.current) return;
    const ctx = audioCtxRef.current;
    const targetGain = status === 'listening' && !isMuted ? 1.0 : 0.0;
    try {
      micGainRef.current.gain.setValueAtTime(targetGain, ctx.currentTime);
    } catch {}
  }, [status, isMuted]);

  const handleClose = () => {
    stopAll();
    playSound.modalClose();
    onClose();
  };

  // Escape, foco atrapado y bloqueo de scroll compartidos con el resto de diálogos
  useModalBehavior(isOpen, dialogRef, handleClose);

  const stopAll = useCallback(() => {
    isOpenRef.current = false;

    // 1. Detener de inmediato cualquier síntesis nativa de voz
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    // 2. Detener y vaciar de inmediato cualquier elemento de audio HTML
    if (currentAudioElementRef.current) {
      try {
        currentAudioElementRef.current.pause();
        currentAudioElementRef.current.currentTime = 0;
        currentAudioElementRef.current.src = '';
      } catch {}
      currentAudioElementRef.current = null;
    }

    // 3. Detener objeto controlador de habla activo
    if (speechRef.current) {
      try {
        speechRef.current.stop();
      } catch {}
      speechRef.current = null;
    }

    // 4. Detener timers y reconocimiento de voz
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    // 5. Cancelar loop de animación de canvas
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // 6. Detener pistas de micrófono para liberar hardware
    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      micStreamRef.current = null;
    }
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
      } catch {}
      micSourceRef.current = null;
    }
    if (activeMediaSourceRef.current) {
      try {
        activeMediaSourceRef.current.disconnect();
      } catch {}
      activeMediaSourceRef.current = null;
    }
    if (micGainRef.current) {
      try {
        micGainRef.current.disconnect();
      } catch {}
      micGainRef.current = null;
    }

    // 7. Cerrar el AudioContext (antes quedaba uno abierto por cada apertura del modal)
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  // Ciclo de vida al abrir: saludo automático e inicialización
  useEffect(() => {
    if (isOpen) {
      playSound.modalOpen();
      setIsMuted(false);
      isMutedRef.current = false;
      setTranscript('');
      currentTranscriptRef.current = '';
      const cfg = settingsRef.current;
      const secrets = getSecrets();
      const ttsKey =
        cfg.ttsPlatform === 'elevenlabs'
          ? secrets.elevenLabsApiKey
          : cfg.ttsPlatform === 'openai'
          ? secrets.openaiTtsApiKey
          : secrets.fishAudioApiKey || secrets.ttsApiKey;
      setApiWarning(
        cfg.ttsPlatform && cfg.ttsPlatform !== 'native' && !ttsKey
          ? 'Sin clave de voz configurada: se usa la voz del navegador'
          : null
      );
      const greetingText = getRandomGreeting(cfg.userName);
      setLastAiText(greetingText);
      lastAiTextRef.current = greetingText;
      updateStatus('speaking');

      // Iniciar contexto de audio y capturar micro
      getAudioGraph();
      setupMicAnalysis();

      let isCancelled = false;

      // Iniciar reconocimiento de fondo de inmediato para permitir interrupción (barge-in)
      startListening();

      const triggerGreeting = async () => {
        try {
          const spk = await speakWithTts(
            greetingText,
            settingsRef.current,
            handleAudioCreated,
            () => {
              if (isOpenRef.current && !isCancelled) updateStatus('speaking');
            },
            () => {
              if (isOpenRef.current && !isCancelled) {
                updateStatus('listening');
                if (!isMutedRef.current) startListening();
              }
            }
          );
          if (!isOpenRef.current || isCancelled) {
            spk.stop();
            if (currentAudioElementRef.current) {
              try {
                currentAudioElementRef.current.pause();
                currentAudioElementRef.current.currentTime = 0;
              } catch {}
            }
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
              window.speechSynthesis.cancel();
            }
            return;
          }
          speechRef.current = spk;
        } catch (err: any) {
          if (!isOpenRef.current || isCancelled) return;
          console.warn('[Voice greeting fallback]:', err);
          if (!isCancelled) {
            // Fallback directo a voz nativa sin interrumpir la experiencia
            try {
              const spk = speakNative(
                greetingText,
                () => {
                  if (isOpenRef.current && !isCancelled) updateStatus('speaking');
                },
                () => {
                  if (isOpenRef.current && !isCancelled) {
                    updateStatus('listening');
                    if (!isMutedRef.current) startListening();
                  }
                },
                settingsRef.current.ttsVoiceId
              );
              if (!isOpenRef.current || isCancelled) {
                spk.stop();
                if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                  window.speechSynthesis.cancel();
                }
                return;
              }
              speechRef.current = spk;
            } catch {
              if (isOpenRef.current && !isCancelled) {
                updateStatus('listening');
                if (!isMutedRef.current) startListening();
              }
            }
          }
        }
      };

      triggerGreeting();

      return () => {
        isCancelled = true;
        stopAll();
      };
    } else {
      stopAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, handleAudioCreated, getAudioGraph, setupMicAnalysis]);

  // Iniciar reconocimiento de voz con detección de silencio e interrupción
  const startListening = () => {
    if (isMutedRef.current || !isOpenRef.current) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    const rec = startSpeechRecognition(
      (text) => {
        if (!isOpenRef.current || isMutedRef.current) return;
        const clean = text?.trim();
        if (!clean) return;

        currentTranscriptRef.current = clean;
        setTranscript(clean);

        // Interrupción instantánea (Barge-in): si el asistente está hablando y el usuario habla, cortar de inmediato
        if (speechRef.current || statusRef.current === 'speaking') {
          if (speechRef.current) {
            try {
              speechRef.current.stop();
            } catch {}
            speechRef.current = null;
          }
          if (currentAudioElementRef.current) {
            try {
              currentAudioElementRef.current.pause();
              currentAudioElementRef.current.currentTime = 0;
            } catch {}
          }
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            try {
              window.speechSynthesis.cancel();
            } catch {}
          }
          updateStatus('listening');
        }

        // Detección automática de pausa/silencio (1.2s sin hablar = procesar respuesta)
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const userQuery = currentTranscriptRef.current.trim();
          if (userQuery && isOpenRef.current && !isMutedRef.current) {
            handleUserFinishedSpeaking(userQuery);
          }
        }, 1200);
      },
      (err) => {
        console.warn('[Voice STT] Error:', err);
      },
      () => {
        // En fin de ciclo STT, si seguimos en escucha y no muteados, reiniciar reconocimiento
        if (statusRef.current === 'listening' && !isMutedRef.current && isOpenRef.current) {
          setTimeout(() => {
            if (statusRef.current === 'listening' && !isMutedRef.current && isOpenRef.current) {
              startListening();
            }
          }, 200);
        }
      }
    );

    recognitionRef.current = rec;
  };

  const handleUserFinishedSpeaking = async (userPrompt: string) => {
    if (!userPrompt.trim() || !isOpenRef.current) return;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }

    updateStatus('thinking');
    currentTranscriptRef.current = '';

    try {
      // Datos actuales en el momento de la pregunta (no los del render en que se creó el callback)
      const response = await generateHabitAdvice(selectData(useStore.getState()), userPrompt);
      if (!isOpenRef.current) return;
      setLastAiText(response);
      lastAiTextRef.current = response;
      updateStatus('speaking');

      // Limpiar markdown y bloques de acción para la locución natural de voz
      const cleanVoiceText = response
        .replace(/```action[\s\S]*?```/gi, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[*_#`~[\]()>]/g, '')
        .trim();

      const textToSpeak = cleanVoiceText || 'Entendido. Estoy aquí para acompañar tu constancia.';

      const spk = await speakWithTts(
        textToSpeak,
        settingsRef.current,
        handleAudioCreated,
        () => {
          if (isOpenRef.current) updateStatus('speaking');
        },
        () => {
          if (isOpenRef.current) {
            updateStatus('listening');
            if (!isMutedRef.current) startListening();
          }
        }
      );
      if (!isOpenRef.current) {
        spk.stop();
        if (currentAudioElementRef.current) {
          try {
            currentAudioElementRef.current.pause();
            currentAudioElementRef.current.currentTime = 0;
          } catch {}
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
        return;
      }
      speechRef.current = spk;
    } catch (err: any) {
      if (!isOpenRef.current) return;
      console.warn('[Voice error]:', err);
      try {
        const lastText = lastAiTextRef.current;
        const fallbackText =
          lastText && lastText.trim()
            ? lastText.replace(/```action[\s\S]*?```/gi, '').replace(/```[\s\S]*?```/g, '').replace(/[*_#`~[\]()>]/g, '').trim()
            : 'Te escucho con atención. ¿Qué hábito o desafío revisamos juntos hoy?';
        const spk = speakNative(
          fallbackText,
          () => {
            if (isOpenRef.current) updateStatus('speaking');
          },
          () => {
            if (isOpenRef.current) {
              updateStatus('listening');
              if (!isMutedRef.current) startListening();
            }
          },
          settingsRef.current.ttsVoiceId
        );
        if (!isOpenRef.current) {
          spk.stop();
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          return;
        }
        speechRef.current = spk;
      } catch {
        if (isOpenRef.current) {
          updateStatus('listening');
          if (!isMutedRef.current) startListening();
        }
      }
    }
  };

  // Mutear / Desmutear
  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      playSound.click();
      if (statusRef.current === 'listening' || statusRef.current === 'idle') {
        updateStatus('listening');
        startListening();
      }
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      playSound.click();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
    }
  };

  // RENDERIZADOR CANVAS: ECUALIZADOR RADIAL 100% REACTIVO AL SONIDO REAL (WEB AUDIO ANALYSER)
  useEffect(() => {
    if (!isOpen) return;

    let isRunning = true;
    let animId: number;

    const startCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas || !isRunning) {
        if (isRunning) {
          animId = requestAnimationFrame(startCanvas);
        }
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx || !isRunning) return;

      let time = 0;
      const NUM_BARS = 84;
      const HALF_BARS = 42;
      const INNER_RADIUS = 78;

      const render = () => {
        if (!isRunning) return;

        const width = canvas.width || 380;
        const height = canvas.height || 380;
        const cx = width / 2;
        const cy = height / 2;

        ctx.clearRect(0, 0, width, height);

        time += 0.035;

        // Leer datos de frecuencia reales del Web Audio Analyser
        let hasRealAudio = false;
        let overallVolume = 0;

        if (analyserRef.current && freqDataRef.current) {
          analyserRef.current.getByteFrequencyData(freqDataRef.current as any);
          const data = freqDataRef.current;

          // Calcular volumen medio en el rango de voz humana (bins 2 a 55)
          let sum = 0;
          for (let b = 2; b < 55; b++) {
            sum += data[b];
          }
          overallVolume = sum / (53 * 255); // 0 a 1
          if (overallVolume > 0.02) {
            hasRealAudio = true;
          }
        }

        // Resplandor y aura reactiva emanando suavemente DESDE EL CENTRO
        const basePulse = Math.sin(time * 2.2) * 0.08 + 0.12;
        const glowStrength = Math.min(
          0.75,
          status === 'speaking'
            ? 0.45 + (hasRealAudio ? overallVolume * 0.6 : basePulse * 1.5)
            : status === 'thinking'
            ? 0.38 + Math.sin(time * 4) * 0.15
            : status === 'listening'
            ? 0.28 + (hasRealAudio ? overallVolume * 0.7 : basePulse)
            : 0.15
        );

        const glowRadius = INNER_RADIUS * (1.1 + (hasRealAudio ? overallVolume * 0.45 : basePulse * 0.5));
        const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
        centerGlow.addColorStop(0, `rgba(167, 139, 250, ${glowStrength * 0.9})`);
        centerGlow.addColorStop(0.4, `rgba(139, 92, 246, ${glowStrength * 0.6})`);
        centerGlow.addColorStop(0.75, `rgba(124, 58, 237, ${glowStrength * 0.25})`);
        centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = centerGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // Dibujar las 84 barras radiales con simetría bilateral orgánica
        for (let i = 0; i < NUM_BARS; i++) {
          const angle = (i / NUM_BARS) * Math.PI * 2;
          // Mapeo simétrico: mitad izquierda y derecha balanceadas
          const k = i < HALF_BARS ? i : NUM_BARS - 1 - i;

          let barLength = 6;

          if (hasRealAudio && freqDataRef.current) {
            // REACTIVIDAD 100% REAL: frecuencia física del audio
            const bin = Math.min(127, Math.floor(2 + Math.pow(k / HALF_BARS, 1.25) * 58));
            const freqAmp = freqDataRef.current[bin] / 255;
            const dynamicBoost = Math.pow(freqAmp, 1.15) * 58;
            const subtleBreath = Math.sin(angle * 2 + time * 1.5) * 1.5;
            barLength = Math.max(5, 6 + dynamicBoost + subtleBreath);
          } else {
            // Sin audio real activo (silencio, reposo, silenciado o esperando)
            if (status === 'speaking') {
              const breath = Math.sin(time * 3 + angle * 4) * 0.5 + 0.5;
              barLength = 6 + breath * 16;
            } else if (status === 'thinking') {
              const pulse = Math.sin(angle * 3 - time * 5);
              barLength = 6 + Math.max(0, pulse) * 18;
            } else {
              // Silenciado o en escucha pasiva: crestas pequeñas orgánicas que ondulan suavemente
              const wave1 = Math.sin(angle * 4 + time * 2) * 0.5 + 0.5;
              const wave2 = Math.cos(angle * 6 - time * 1.5) * 0.5 + 0.5;
              barLength = 5 + wave1 * 6 + wave2 * 4;
            }
          }

          const x1 = cx + Math.cos(angle) * INNER_RADIUS;
          const y1 = cy + Math.sin(angle) * INNER_RADIUS;
          const x2 = cx + Math.cos(angle) * (INNER_RADIUS + barLength);
          const y2 = cy + Math.sin(angle) * (INNER_RADIUS + barLength);

          // Gradiente armónico de la marca: Lavanda (#a78bfa) -> Violeta (#8b5cf6) -> Púrpura profundo (#7c3aed) -> Orquídea (#c084fc)
          const angleVal = (angle + Math.PI / 2 + time * 0.25) % (Math.PI * 2);
          const t = angleVal / (Math.PI * 2);

          let r = 167;
          let g = 139;
          let b = 250;

          if (t < 0.25) {
            const factor = t / 0.25;
            r = Math.round(167 + factor * (139 - 167));
            g = Math.round(139 + factor * (92 - 139));
            b = Math.round(250 + factor * (246 - 250));
          } else if (t < 0.5) {
            const factor = (t - 0.25) / 0.25;
            r = Math.round(139 + factor * (124 - 139));
            g = Math.round(92 + factor * (58 - 92));
            b = Math.round(246 + factor * (237 - 246));
          } else if (t < 0.75) {
            const factor = (t - 0.5) / 0.25;
            r = Math.round(124 + factor * (192 - 124));
            g = Math.round(58 + factor * (132 - 58));
            b = Math.round(237 + factor * (252 - 237));
          } else {
            const factor = (t - 0.75) / 0.25;
            r = Math.round(192 + factor * (167 - 192));
            g = Math.round(132 + factor * (139 - 132));
            b = Math.round(252 + factor * (250 - 252));
          }

          // Nunca apagado ni desvanecido al silenciarse: vibrante en todo momento
          let alpha = 0.88;
          if (hasRealAudio) {
            alpha = Math.min(1.0, 0.85 + overallVolume * 0.3);
          }

          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.lineWidth = 3.2;
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Anillo interior sutil reactivo
        ctx.beginPath();
        ctx.arc(cx, cy, INNER_RADIUS - 1, 0, Math.PI * 2);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = hasRealAudio
          ? `rgba(167, 139, 250, ${0.35 + overallVolume * 0.45})`
          : 'rgba(139, 92, 246, 0.2)';
        ctx.stroke();

        animId = requestAnimationFrame(render);
        animFrameRef.current = animId;
      };

      render();
    };

    animId = requestAnimationFrame(startCanvas);
    animFrameRef.current = animId;

    return () => {
      isRunning = false;
      if (animId) cancelAnimationFrame(animId);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isOpen, status, isMuted]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      style={{
        zIndex: 1400,
        background: 'rgba(3, 4, 8, 0.92)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        stopAll();
        playSound.dismiss();
        onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="card voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Asistente de voz"
        tabIndex={-1}
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'linear-gradient(180deg, #0d0f17 0%, #06070a 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 36,
          padding: '36px 24px',
          boxShadow: '0 30px 100px rgba(0, 0, 0, 0.95), 0 0 60px rgba(139, 92, 246, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          position: 'relative',
          animation: 'modalIn .25s ease both',
        }}
      >
        {/* Botón cerrar */}
        <button
          type="button"
          className="icon-btn sm"
          style={{ position: 'absolute', top: 18, right: 18 }}
          onClick={handleClose}
          aria-label="Cerrar asistente de voz"
        >
          <X size={18} />
        </button>

        {/* VISUALIZADOR CIRCULAR RADIAL DE BARRAS NEÓN */}
        <div
          style={{
            position: 'relative',
            width: 'min(300px, 72vw)',
            aspectRatio: '1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            marginTop: 10,
          }}
        >
          <canvas
            ref={canvasRef}
            width={380}
            height={380}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </div>

        {/* Mensaje de advertencia si la API externa tuvo algún error */}
        {apiWarning && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#f87171',
              background: 'rgba(239, 68, 68, 0.12)',
              padding: '4px 12px',
              borderRadius: 8,
              border: '1px solid rgba(239, 68, 68, 0.25)',
              maxWidth: 360,
              textAlign: 'center',
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{apiWarning}</span>
          </div>
        )}

        {/* Estado actual único y limpio */}
        <div aria-live="polite" style={{ textAlign: 'center', minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 18px',
              borderRadius: 999,
              fontSize: 13.5,
              fontWeight: 600,
              background:
                status === 'speaking'
                  ? 'rgba(168, 85, 247, 0.2)'
                  : isMuted
                  ? 'rgba(239, 68, 68, 0.15)'
                  : status === 'thinking'
                  ? 'rgba(234, 179, 8, 0.18)'
                  : 'rgba(139, 92, 246, 0.18)',
              color:
                status === 'speaking'
                  ? '#c084fc'
                  : isMuted
                  ? '#f87171'
                  : status === 'thinking'
                  ? '#fde047'
                  : '#a78bfa',
              border: `1px solid ${
                status === 'speaking'
                  ? 'rgba(168, 85, 247, 0.35)'
                  : isMuted
                  ? 'rgba(239, 68, 68, 0.3)'
                  : status === 'thinking'
                  ? 'rgba(234, 179, 8, 0.35)'
                  : 'rgba(139, 92, 246, 0.35)'
              }`,
            }}
          >
            {status === 'speaking'
              ? 'Hablando...'
              : isMuted
              ? 'Micrófono silenciado'
              : status === 'thinking'
              ? 'Pensando...'
              : status === 'listening'
              ? 'Escuchando...'
              : 'En espera'}
          </div>
        </div>

        {/* Botón de Mutear / Desmutear */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
          <button
            type="button"
            className={`btn ${isMuted ? 'btn-danger' : 'btn-secondary'}`}
            onClick={toggleMute}
            aria-pressed={isMuted}
            style={{
              borderRadius: 999,
              padding: '10px 24px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
              fontWeight: 500,
              boxShadow: isMuted ? '0 0 20px rgba(239, 68, 68, 0.3)' : undefined,
            }}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
            {isMuted ? 'Micrófono silenciado' : 'Silenciar micrófono'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
