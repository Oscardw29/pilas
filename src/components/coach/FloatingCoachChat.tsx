import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Maximize2, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import { coachChoiceMessage, executeCoachAction, type ParsedAction } from '@/lib/coachActions';
import { playSound } from '@/lib/sound';
import { speakCoach, stopCoachVoice, unlockCoachVoice } from '@/lib/coachVoice';
import { useToast } from '@/components/ui/ToastContext';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';
import { ActionConfirmationCard } from './ActionConfirmationCard';
import { extractActionAndText } from './extractAction';
import { CoachAvatar } from './CoachAvatar';
import { CoachTeaser } from './CoachTeaser';
import { LocalModeNotice } from './LocalModeNotice';
import { useCoachPersona } from './coachPersona';
import { useCoachMute } from './useCoachMute';

/** Mismo formato de mensaje que la página del coach: ambas comparten la conversación activa */
interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actionStatus?: 'applied' | 'dismissed';
  [extra: string]: unknown;
}

const QUICK_PROMPTS = ['¿Qué hago ahora mismo?', '¿Cómo salvo mi racha hoy?', 'Resume mi semana'];

const DEFAULT_TITLES = ['Conversación principal', 'Nueva conversación', 'Chat sin título'];

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const currentData = () => selectData(useStore.getState());

/** El cliente de IA es pesado: se descarga solo cuando se envía el primer mensaje (no en el arranque) */
const loadAi = () => import('@/lib/gemini');
/** Catálogo de frases fijas (la bienvenida tiene voz grabada): se descarga al abrir el chat */
const loadPhrases = () => import('@/lib/coachPhrases');

/** La bienvenida se dice en voz alta una sola vez por sesión, al abrir el chat sin conversación */
let welcomeSpoken = false;

/**
 * CHAT FLOTANTE DEL COACH
 * Botón con la cara del coach en la esquina inferior derecha de todas las páginas excepto la suya.
 * Escribe en la conversación activa del store, así se puede continuar en la vista completa.
 */
export const FloatingCoachChat: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const persona = useCoachPersona();
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const createConversation = useStore((s) => s.createConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const setConversationMessages = useStore((s) => s.setConversationMessages);
  const { muted, toggleMute } = useCoachMute();

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [welcome, setWelcome] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hidden = pathname === '/coach';
  const conversation = conversations?.find((c) => c.id === activeConversationId);
  const messages = (conversation?.messages as ChatMessage[] | undefined) ?? [];
  const visibleMessages: ChatMessage[] =
    messages.length > 0 ? messages : welcome ? [{ id: 'welcome', sender: 'assistant', content: welcome, timestamp: '' }] : [];
  const onlyWelcome = !messages.some((m) => m.sender === 'user');

  // Bienvenida del catálogo (con voz grabada): al abrir sin conversación, el coach la dice una vez por sesión
  const greetOnOpen = useRef(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadPhrases().then(({ phraseText }) => {
      if (!alive) return;
      const text = phraseText('bienvenida.flotante', persona.gender);
      setWelcome(text);
      if (!greetOnOpen.current) return;
      greetOnOpen.current = false;
      welcomeSpoken = true;
      if (!useStore.getState().settings.coachMuted && panelRef.current) void speakCoach(text, persona.gender);
    });
    return () => {
      alive = false;
    };
  }, [open, persona.gender]);

  // Bajar al último mensaje al abrir y con cada mensaje nuevo
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length, loading]);

  // Enfocar el campo al abrir; Escape cierra
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => {
      // Si hay un modal abierto encima, Escape es suyo
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Móvil: la burbuja se esconde al bajar por la página (para no tapar botones) y vuelve al subir.
  // Solo en móvil: en escritorio la burbuja nunca se esconde y no debe bloquear los avisos.
  const [tucked, setTucked] = useState(false);
  /** Tras sacarla a la fuerza (aviso de prueba) el scroll que aún esté en marcha no la vuelve a esconder */
  const untuckHoldUntil = useRef(0);
  const untuck = () => {
    untuckHoldUntil.current = Date.now() + 1500;
    setTucked(false);
  };
  useEffect(() => {
    if (open) { setTucked(false); return; }
    const mobile = window.matchMedia('(max-width: 639.98px)');
    const last = new WeakMap<object, number>();
    if (document.scrollingElement) last.set(document.scrollingElement, document.scrollingElement.scrollTop);
    const onScroll = (e: Event) => {
      if (!mobile.matches) {
        setTucked(false);
        return;
      }
      const t = e.target;
      const el = t === document || t === window ? document.scrollingElement : (t as HTMLElement);
      // Solo cuenta el scroll de la página, no el de listas o paneles internos.
      if (!el || el.clientHeight < window.innerHeight * 0.6) return;
      const y = el.scrollTop;
      const prev = last.get(el) ?? 0;
      last.set(el, y);
      if (Math.abs(y - prev) < 4 || Date.now() < untuckHoldUntil.current) return;
      setTucked(y > prev && y > 80);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [open]);

  // Al entrar a la página del coach el chat flotante se cierra (la vista completa toma el relevo)
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  if (hidden) return null;

  /** El aviso lleva a la página del coach con su pregunta lista para enviarse */
  const openFromTeaser = (prompt: string) => {
    setOpen(false);
    navigate('/coach', { state: { coachPrompt: prompt } });
  };

  const close = () => {
    setOpen(false);
    stopCoachVoice({ fade: true });
    playSound.modalClose();
  };

  const toggle = () => {
    if (open) {
      close();
    } else {
      // Abrir es un gesto: desbloquea el audio por si toca decir la bienvenida
      unlockCoachVoice();
      greetOnOpen.current = !welcomeSpoken && onlyWelcome && !loading;
      setOpen(true);
      playSound.chatOpen();
    }
  };

  const ensureConversation = (): string => {
    const state = useStore.getState();
    if (state.activeConversationId && state.conversations?.some((c) => c.id === state.activeConversationId)) {
      return state.activeConversationId;
    }
    return createConversation('Nueva conversación');
  };

  const readMessages = (convId: string): ChatMessage[] =>
    ((useStore.getState().conversations?.find((c) => c.id === convId)?.messages as ChatMessage[] | undefined) ?? []);

  const handleSend = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    stopCoachVoice({ fade: true });
    unlockCoachVoice();
    const convId = ensureConversation();
    const prior = readMessages(convId);

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      content,
      timestamp: nowTime(),
      versions: [{ text: content, subsequentMessages: [] }],
      activeVersionIndex: 0,
    };
    const next = [...prior, userMsg];
    setConversationMessages(convId, next);
    setInput('');
    setLoading(true);
    playSound.messageOut();

    // Título automático si la conversación aún tiene un nombre genérico
    const conv = useStore.getState().conversations?.find((c) => c.id === convId);
    if (!conv || DEFAULT_TITLES.includes(conv.title)) {
      loadAi()
        .then(({ generateTopicTitle }) => generateTopicTitle(content, currentData()))
        .then((title) => title?.trim() && renameConversation(convId, title.trim()))
        .catch(() => {
          /* el título es opcional */
        });
    }

    try {
      const history = next.slice(-6).map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content,
      }));
      const { generateHabitAdvice } = await loadAi();
      const response = await generateHabitAdvice(currentData(), content, history);
      const botMsg: ChatMessage = { id: `bot-${Date.now()}`, sender: 'assistant', content: response, timestamp: nowTime() };
      setConversationMessages(convId, [...readMessages(convId), botMsg]);
      playSound.messageIn();
      // Lee la respuesta en voz alta (salvo silencio o si el chat ya se cerró)
      if (!useStore.getState().settings.coachMuted && panelRef.current) {
        void speakCoach(response, persona.gender).then((r) => {
          if (r === 'failed') toast(`La voz de ${persona.name} no respondió (límite de la API o conexión). La respuesta sigue en el chat.`, 'warning');
        });
      }
    } catch (error: any) {
      toast('Error al generar respuesta: ' + (error?.message || 'Inténtalo de nuevo'), 'warning');
    } finally {
      setLoading(false);
    }
  };

  const setActionStatus = (msgId: string, actionStatus: 'applied' | 'dismissed') => {
    if (!activeConversationId) return;
    setConversationMessages(
      activeConversationId,
      readMessages(activeConversationId).map((m) => (m.id === msgId ? { ...m, actionStatus } : m)),
    );
  };

  /** Lo elegido en la propuesta se envía como mensaje y el coach contesta (si no está ya respondiendo) */
  const reportActionChoice = (msgId: string, action: ParsedAction, actionStatus: 'applied' | 'dismissed') => {
    setActionStatus(msgId, actionStatus);
    if (!loading) void handleSend(coachChoiceMessage(action, actionStatus));
  };

  const handleExecuteAction = (msgId: string, action: ParsedAction) => {
    const target = messages.find((m) => m.id === msgId);
    if (target?.actionStatus) return;
    try {
      const result = executeCoachAction(action);
      if (!result.ok) {
        toast(result.message, 'warning');
        return;
      }
      if (action.action === 'delete_habit') playSound.delete();
      else playSound.pop();
      toast(result.message, action.action === 'delete_habit' ? 'info' : 'success');
      reportActionChoice(msgId, action, 'applied');
    } catch (err: any) {
      toast(`Error aplicando acción: ${err?.message || 'Error desconocido'}`, 'error');
    }
  };

  const handleDismissAction = (msgId: string, action: ParsedAction) => {
    if (messages.find((m) => m.id === msgId)?.actionStatus) return;
    reportActionChoice(msgId, action, 'dismissed');
  };

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          className="coach-float-panel"
          role="dialog"
          aria-label={`Chat con ${persona.name}`}
        >
          <header className="coach-float-head">
            <span className="coach-float-avatar has-face" aria-hidden="true">
              <CoachAvatar gender={persona.gender} crop="head" size={34} expression={loading ? 'thinking' : 'neutral'} talk followPointer={false} />
            </span>
            <div className="coach-float-title">
              <strong>{persona.name}</strong>
              <span className="truncate">{conversation?.title ?? 'Nueva conversación'}</span>
            </div>
            <button
              type="button"
              className={`icon-btn sm coach-float-mute${muted ? ' muted' : ''}`}
              onClick={toggleMute}
              aria-pressed={muted}
              title={muted ? 'Activar voz' : 'Silenciar'}
              aria-label={muted ? `Activar la voz de ${persona.name}` : `Silenciar a ${persona.name}`}
              data-no-sound="true"
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => {
                setOpen(false);
                navigate('/coach');
              }}
              title={`Abrir la página de ${persona.name}`}
              aria-label={`Abrir la página de ${persona.name}`}
              data-no-sound="true"
            >
              <Maximize2 size={15} />
            </button>
            <button type="button" className="icon-btn sm" onClick={close} title="Cerrar" aria-label="Cerrar chat" data-no-sound="true">
              <X size={16} />
            </button>
          </header>

          <div className="coach-float-messages" ref={listRef} aria-live="polite">
            {visibleMessages.map((m) => {
              const isUser = m.sender === 'user';
              const parsed = isUser ? { text: m.content, action: null } : extractActionAndText(m.content);
              return (
                <div key={m.id} className={`coach-float-msg ${m.sender}`}>
                  <div className={`chat-bubble ${m.sender}`}>
                    <MarkdownMessage content={parsed.text} />
                    {parsed.action && (
                      <ActionConfirmationCard
                        action={parsed.action}
                        status={m.actionStatus || 'pending'}
                        onConfirm={() => handleExecuteAction(m.id, parsed.action!)}
                        onDismiss={() => handleDismissAction(m.id, parsed.action!)}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="coach-float-msg assistant">
                <div className="chat-bubble assistant coach-float-thinking">
                  <div className="thinking-dots" aria-label={`${persona.name} está escribiendo`}>
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                </div>
              </div>
            )}

            {onlyWelcome && !loading && (
              <div className="coach-float-quick">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q} type="button" className="preset-pill" onClick={() => void handleSend(q)}>
                    <Sparkles size={12} aria-hidden="true" /> {q}
                  </button>
                ))}
              </div>
            )}

            <LocalModeNotice />
          </div>

          <form
            className="coach-float-input"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <textarea
              ref={inputRef}
              className="input"
              rows={1}
              placeholder={`Escríbele a ${persona.name}…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              aria-label={`Mensaje para ${persona.name}`}
            />
            <button type="submit" className="btn btn-primary coach-float-send" disabled={!input.trim() || loading} aria-label="Enviar" data-no-sound="true">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <CoachTeaser blocked={open} tucked={tucked} onUntuck={untuck} onOpen={openFromTeaser} />

      <button
        type="button"
        className={`coach-fab ${open ? 'open' : ''}${tucked ? ' tucked' : ''}`}
        onClick={toggle}
        aria-label={open ? `Cerrar chat con ${persona.name}` : `Abrir chat con ${persona.name}`}
        aria-expanded={open}
        title={open ? 'Cerrar chat' : `Pregúntale a ${persona.name}`}
        data-no-sound="true"
      >
        <span className="coach-fab-icon coach-fab-icon-bot coach-fab-face" aria-hidden="true">
          <CoachAvatar gender={persona.gender} crop="head" size={58} expression={open ? 'happy' : 'neutral'} />
        </span>
        <span className="coach-fab-icon coach-fab-icon-close" aria-hidden="true">
          <X size={22} />
        </span>
      </button>
    </>
  );
};
