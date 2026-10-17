import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Maximize2, Send, Sparkles, X } from 'lucide-react';
import { useStore, selectData } from '@/store/useStore';
import { executeCoachAction, type ParsedAction } from '@/lib/coachActions';
import { playSound } from '@/lib/sound';
import { useToast } from '@/components/ui/ToastContext';
import { MarkdownMessage } from '@/components/ui/MarkdownMessage';
import { ActionConfirmationCard } from './ActionConfirmationCard';
import { extractActionAndText } from './extractAction';

/** Mismo formato de mensaje que la vista del Coach IA: ambas comparten la conversación activa */
interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  actionStatus?: 'applied' | 'dismissed';
  [extra: string]: unknown;
}

const WELCOME_TEXT =
  '¡Hola! Pregúntame lo que quieras sobre tus hábitos, rachas u objetivos. Esta conversación es la misma que ves en Coach IA.';

const QUICK_PROMPTS = ['¿Qué hago ahora mismo?', '¿Cómo salvo mi racha hoy?', 'Resume mi semana'];

const DEFAULT_TITLES = ['Conversación principal', 'Nueva conversación', 'Chat sin título'];

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const currentData = () => selectData(useStore.getState());

/** El cliente de IA es pesado: se descarga solo cuando se envía el primer mensaje (no en el arranque) */
const loadAi = () => import('@/lib/gemini');

/**
 * CHAT FLOTANTE DEL COACH
 * Burbuja en la esquina inferior derecha de todas las páginas excepto Coach IA.
 * Escribe en la conversación activa del store, así se puede continuar en la vista completa.
 */
export const FloatingCoachChat: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const createConversation = useStore((s) => s.createConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const setConversationMessages = useStore((s) => s.setConversationMessages);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const hidden = pathname === '/coach';
  const conversation = conversations?.find((c) => c.id === activeConversationId);
  const messages = (conversation?.messages as ChatMessage[] | undefined) ?? [];
  const visibleMessages: ChatMessage[] =
    messages.length > 0 ? messages : [{ id: 'welcome', sender: 'assistant', content: WELCOME_TEXT, timestamp: '' }];
  const onlyWelcome = !messages.some((m) => m.sender === 'user');

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

  // Al entrar a Coach IA el chat flotante se cierra (la vista completa toma el relevo)
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  if (hidden) return null;

  const close = () => {
    setOpen(false);
    playSound.modalClose();
  };

  const toggle = () => {
    if (open) {
      close();
    } else {
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
      setActionStatus(msgId, 'applied');
    } catch (err: any) {
      toast(`Error aplicando acción: ${err?.message || 'Error desconocido'}`, 'error');
    }
  };

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          className="coach-float-panel"
          role="dialog"
          aria-label="Chat con el Coach IA"
        >
          <header className="coach-float-head">
            <span className="coach-float-avatar" aria-hidden="true">
              <Bot size={18} />
            </span>
            <div className="coach-float-title">
              <strong>Coach IA</strong>
              <span className="truncate">{conversation?.title ?? 'Nueva conversación'}</span>
            </div>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => {
                setOpen(false);
                navigate('/coach');
              }}
              title="Abrir en Coach IA"
              aria-label="Abrir en Coach IA"
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
                        onDismiss={() => setActionStatus(m.id, 'dismissed')}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="coach-float-msg assistant">
                <div className="chat-bubble assistant coach-float-thinking">
                  <div className="thinking-dots" aria-label="El coach está escribiendo">
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
              placeholder="Escribe al coach…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              aria-label="Mensaje para el coach"
            />
            <button type="submit" className="btn btn-primary coach-float-send" disabled={!input.trim() || loading} aria-label="Enviar" data-no-sound="true">
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className={`coach-fab ${open ? 'open' : ''}`}
        onClick={toggle}
        aria-label={open ? 'Cerrar chat del coach' : 'Abrir chat del coach'}
        aria-expanded={open}
        title={open ? 'Cerrar chat' : 'Pregúntale al coach'}
        data-no-sound="true"
      >
        <span className="coach-fab-icon coach-fab-icon-bot" aria-hidden="true">
          <Bot size={24} />
        </span>
        <span className="coach-fab-icon coach-fab-icon-close" aria-hidden="true">
          <X size={22} />
        </span>
      </button>
    </>
  );
};
