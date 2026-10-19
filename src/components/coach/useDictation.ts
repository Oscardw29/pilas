import { useCallback, useEffect, useRef, useState } from 'react';
import { createVoiceListener, MicError, pickSttEngine, requestMicStream, stopStream, toMicError, type VoiceListener } from '@/lib/voiceInput';

export type DictationState = 'idle' | 'starting' | 'recording' | 'processing';

/**
 * DICTADO A TEXTO
 * - Pide el permiso del micrófono de forma explícita (el navegador muestra su aviso) antes de reconocer.
 * - Motor nativo con texto en vivo; Deepgram por frases donde el navegador no reconoce voz.
 * - `onText` recibe siempre el texto completo: lo que había escrito + lo dictado.
 */
export function useDictation({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<DictationState>('idle');
  const listenerRef = useRef<VoiceListener | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const baseRef = useRef('');
  const runRef = useRef(0);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const compose = (dictated: string) => {
    const base = baseRef.current;
    const clean = dictated.trim();
    return base && clean ? `${base} ${clean}` : base || clean;
  };

  const cleanup = useCallback(() => {
    listenerRef.current?.dispose();
    listenerRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (currentText: string) => {
      if (listenerRef.current) return;
      const run = ++runRef.current;
      baseRef.current = currentText.trim();
      setState('starting');
      try {
        const engine = pickSttEngine();
        if (!engine) throw new MicError('unsupported');
        const stream = await requestMicStream();
        if (run !== runRef.current) {
          stopStream(stream);
          return;
        }
        // El motor nativo abre el micrófono por su cuenta (en Android no puede compartirlo): el permiso ya está concedido
        if (engine === 'native') stopStream(stream);
        else streamRef.current = stream;

        listenerRef.current = createVoiceListener(
          {
            onPartial: (t) => {
              if (run === runRef.current) onTextRef.current(compose(t));
            },
            onProcessing: (busy) => {
              if (run === runRef.current) setState(busy ? 'processing' : 'recording');
            },
            onError: (err) => {
              if (run !== runRef.current) return;
              runRef.current++;
              cleanup();
              setState('idle');
              onErrorRef.current(err.message);
            },
          },
          {
            autoEnd: false,
            getStream: async () => streamRef.current ?? (streamRef.current = await requestMicStream()),
          }
        );
        listenerRef.current.setMode('turn');
        setState('recording');
      } catch (err) {
        if (run !== runRef.current) return;
        cleanup();
        setState('idle');
        onErrorRef.current(toMicError(err).message);
      }
    },
    [cleanup]
  );

  const stop = useCallback(async () => {
    const run = ++runRef.current;
    const listener = listenerRef.current;
    listenerRef.current = null;
    if (!listener) {
      cleanup();
      setState('idle');
      return;
    }
    setState('processing');
    try {
      const text = await listener.finish();
      if (text) onTextRef.current(compose(text));
    } finally {
      stopStream(streamRef.current);
      streamRef.current = null;
      if (run === runRef.current) setState('idle');
    }
  }, [cleanup]);

  /** Corta el dictado sin escribir nada más (p. ej. al enviar el mensaje) */
  const cancel = useCallback(() => {
    runRef.current++;
    cleanup();
    setState('idle');
  }, [cleanup]);

  // Al desmontar se suelta el micrófono
  useEffect(
    () => () => {
      runRef.current++;
      cleanup();
    },
    [cleanup]
  );

  return { state, active: state !== 'idle', start, stop, cancel };
}
