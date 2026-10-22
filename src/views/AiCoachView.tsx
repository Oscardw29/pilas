import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useStore, selectData } from '../store/useStore';
import { useSecrets } from '../store/useSecrets';
import { generateHabitAdvice, hasGeminiKey, generateTopicTitle } from '../lib/gemini';
import { coachChoiceMessage, executeCoachAction, type ParsedAction } from '../lib/coachActions';
import { ActionConfirmationCard } from '../components/coach/ActionConfirmationCard';
import { extractActionAndText } from '../components/coach/extractAction';
import { stripVoiceTags } from '../lib/voiceTags';
import {
  Send,
  Sparkles,
  Key,
  Trash2,
  Lightbulb,
  Pencil,
  Copy,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CoachStage } from '../components/coach/CoachStage';
import { CoachAvatar } from '../components/coach/CoachAvatar';
import { useCoachPersona, type CoachPersona } from '../components/coach/coachPersona';
import { markCoachVisited } from '../components/coach/coachTeasers';
import { speakCoach, stopCoachVoice, unlockCoachVoice } from '../lib/coachVoice';
import { useToast } from '../components/ui/ToastContext';
import { MarkdownMessage } from '../components/ui/MarkdownMessage';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Modal } from '../components/ui/Modal';
import { playSound } from '../lib/sound';
import { AiConversation } from '../types';

interface MessageVersion {
  text: string;
  subsequentMessages: ChatMessage[];
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  versions?: MessageVersion[];
  activeVersionIndex?: number;
  /** Estado de la acción sugerida en este mensaje (se guarda con la conversación) */
  actionStatus?: 'applied' | 'dismissed';
}

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Datos actuales del store en el momento de la llamada (sin suscribir la vista a todos los cambios) */
const currentData = () => selectData(useStore.getState());

interface MenuState {
  convId: string;
  conv: AiConversation;
  position: { top: number; left: number };
}

const PRESET_QUESTIONS = [
  '¿Por qué suelo fallar más en ejercicio que en programación?',
  '¿Qué cambio me daría el mayor impacto positivo esta semana?',
  '¿Cómo estructurar mi día cuando mi energía está en 1 o 2 sobre 5?',
  'Analiza mis razones de abandono y proponme versiones mínimas.',
  '¿Qué experimento A/B me recomiendas hacer ahora?',
];

const welcomeText = (p: CoachPersona) =>
  `¡Hola! Soy ${p.name}, tu ${p.role} de hábitos. Tengo acceso en tiempo real a tus objetivos, tus datos de consistencia de los últimos 30 días, patrones de energía y causas de fallo registradas.\n\n¿En qué te puedo asesorar hoy para optimizar tu constancia?`;

export const AiCoachView: React.FC = () => {
  const {
    settings,
    conversations = [],
    activeConversationId,
    createConversation,
    renameConversation,
    deleteConversation,
    setActiveConversation,
    setConversationMessages,
  } = useStore(
    useShallow((s) => ({
      settings: s.settings,
      conversations: s.conversations,
      activeConversationId: s.activeConversationId,
      createConversation: s.createConversation,
      renameConversation: s.renameConversation,
      deleteConversation: s.deleteConversation,
      setActiveConversation: s.setActiveConversation,
      setConversationMessages: s.setConversationMessages,
    }))
  );
  const isKeyConfigured = useSecrets((s) => hasGeminiKey(s.keys.geminiApiKey));
  const keysLocked = useSecrets((s) => s.locked);
  const { toast } = useToast();
  const persona = useCoachPersona();
  const DEFAULT_WELCOME_TEXT = welcomeText(persona);
  const location = useLocation();
  const navigate = useNavigate();
  /** Sube cuando se aplica una acción sugerida: el coach lo celebra */
  const [cheerKey, setCheerKey] = useState(0);

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  /** Respuesta que se está regenerando: espera dentro de su propia burbuja */
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  // Estados de gestión de conversaciones
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState('');

  // Menú flotante sin recortes para los 3 puntos
  const [menuState, setMenuState] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Confirmación simple y directa para eliminar conversación
  const [deletingConv, setDeletingConv] = useState<AiConversation | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Estados para edición y confirmación de sobreescritura de mensaje
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [pendingEditMsgId, setPendingEditMsgId] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  // En móvil/tablet la lista de conversaciones se pliega para dejar el chat a la vista
  const [convListOpen, setConvListOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return [
      {
        id: 'welcome',
        sender: 'assistant',
        content: DEFAULT_WELCOME_TEXT,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ];
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  /** Animación de escritura en curso: el texto completo ya está guardado, esto es solo visual */
  const streamRef = useRef<{ timer: ReturnType<typeof setInterval>; botId: string; fullText: string; onDone?: () => void } | null>(null);

  const activePrimaryModel = settings.geminiModel || 'Gemini 3.5 Flash Lite';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: streamRef.current ? 'auto' : 'smooth', block: 'end' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Manejador robusto para cerrar el menú flotante al hacer clic fuera o hacer scroll
  useEffect(() => {
    if (!menuState) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState(null);
      }
    };

    const handleScroll = () => {
      setMenuState(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [menuState]);

  // Inicializar primera conversación si no hay ninguna
  useEffect(() => {
    // Leer el estado actual (no el del render): en StrictMode el efecto se ejecuta dos veces
    if ((useStore.getState().conversations ?? []).length === 0) {
      const defaultId = createConversation('Conversación principal');
      const initialMsgs: ChatMessage[] = [
        {
          id: 'welcome',
          sender: 'assistant',
          content: DEFAULT_WELCOME_TEXT,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
      setConversationMessages(defaultId, initialMsgs);
    }
  }, []);

  // Sincronizar mensajes al cambiar la conversación activa
  useEffect(() => {
    finishStream();
    stopCoachVoice({ fade: true });
    if (!activeConversationId) return;
    const currentConv = conversations.find((c) => c.id === activeConversationId);
    if (currentConv && Array.isArray(currentConv.messages) && currentConv.messages.length > 0) {
      setMessages(currentConv.messages);
    } else {
      const initialMsgs: ChatMessage[] = [
        {
          id: 'welcome',
          sender: 'assistant',
          content: DEFAULT_WELCOME_TEXT,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
      setMessages(initialMsgs);
      setConversationMessages(activeConversationId, initialMsgs);
    }
  }, [activeConversationId]);

  useEffect(() => {
    markCoachVisited();
    return () => {
      if (streamRef.current) clearInterval(streamRef.current.timer);
      streamRef.current = null;
      // Al salir de la página el coach deja de hablar con un fundido
      stopCoachVoice({ fade: true });
    };
  }, []);

  /** Termina al instante la animación en curso (mostrando el texto completo) */
  const finishStream = () => {
    const st = streamRef.current;
    if (!st) return;
    clearInterval(st.timer);
    streamRef.current = null;
    setMessages((prev) => prev.map((m) => (m.id === st.botId ? { ...m, content: st.fullText } : m)));
    st.onDone?.();
  };

  /**
   * Guarda la respuesta COMPLETA en la conversación indicada (aunque el usuario ya haya cambiado de chat)
   * y después anima la escritura solo en pantalla. Así una animación interrumpida nunca deja texto truncado.
   */
  const deliverBotResponse = (convId: string | undefined, botId: string, fullText: string, onDone?: () => void) => {
    if (convId) {
      const conv = useStore.getState().conversations?.find((c) => c.id === convId);
      if (conv) {
        const msgs = conv.messages as ChatMessage[];
        const existing = msgs.find((m) => m.id === botId);
        const botMsg: ChatMessage = { id: botId, sender: 'assistant', content: fullText, timestamp: existing?.timestamp ?? nowTime() };
        setConversationMessages(convId, existing ? msgs.map((m) => (m.id === botId ? botMsg : m)) : [...msgs, botMsg]);
      }
    }

    // Si el usuario cambió de conversación mientras esperaba, no animar aquí
    if (convId !== useStore.getState().activeConversationId) {
      onDone?.();
      return;
    }

    // El coach lee la respuesta (salvo que esté silenciado)
    if (!useStore.getState().settings.coachMuted) {
      void speakCoach(fullText, persona.gender).then((r) => {
        if (r === 'failed') toast(`La voz de ${persona.name} no respondió (límite de la API o conexión). La respuesta sigue en el chat.`, 'warning');
      });
    }

    finishStream();
    const words = fullText.split(' ');
    let currentIdx = 0;
    const timer = setInterval(() => {
      currentIdx += 2;
      if (currentIdx >= words.length) {
        finishStream();
        return;
      }
      const partial = words.slice(0, currentIdx).join(' ');
      setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, content: partial } : m)));
    }, 28);
    streamRef.current = { timer, botId, fullText, onDone };
  };

  /**
   * `base`: mensajes sobre los que se añade el del usuario (por defecto los actuales).
   * `force`: envía aunque siga la animación de escritura (la respuesta anterior ya está completa).
   */
  const handleSend = async (messageText?: string, opts: { base?: ChatMessage[]; force?: boolean } = {}) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || (loading && !opts.force)) return;
    finishStream();
    stopCoachVoice({ fade: true });
    unlockCoachVoice();
    const convId = activeConversationId;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      content: textToSend.trim(),
      timestamp: nowTime(),
      versions: [
        {
          text: textToSend.trim(),
          subsequentMessages: [],
        },
      ],
      activeVersionIndex: 0,
    };

    const nextMessages = [...(opts.base ?? messages), userMsg];
    setMessages(nextMessages);
    if (activeConversationId) {
      setConversationMessages(activeConversationId, nextMessages);

      // Asignar título automático basado en el tema de la conversación si tiene título genérico
      const currentConv = conversations.find((c) => c.id === activeConversationId);
      const isDefaultTitle =
        !currentConv ||
        currentConv.title === 'Conversación principal' ||
        currentConv.title === 'Nueva conversación' ||
        currentConv.title === 'Chat sin título';

      if (isDefaultTitle) {
        generateTopicTitle(textToSend, currentData())
          .then((smartTitle) => {
            if (smartTitle && smartTitle.trim()) {
              renameConversation(activeConversationId, smartTitle.trim());
            }
          })
          .catch(() => {
            /* el título es opcional */
          });
      }
    }
    setInput('');
    setLoading(true);
    playSound.click();

    try {
      const chatHistory = nextMessages.slice(-6).map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content,
      }));

      const botId = `bot-${Date.now()}`;
      const placeholderBotMsg: ChatMessage = {
        id: botId,
        sender: 'assistant',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages([...nextMessages, placeholderBotMsg]);

      const response = await generateHabitAdvice(currentData(), textToSend.trim(), chatHistory);
      // `loading` sigue activo hasta que termina la animación: evita enviar otro mensaje encima
      deliverBotResponse(convId, botId, response, () => setLoading(false));
    } catch (error: any) {
      setMessages((prev) => prev.filter((m) => m.content !== '' || m.sender !== 'assistant'));
      toast('Error al generar respuesta: ' + (error?.message || 'Inténtalo de nuevo'), 'warning');
      setLoading(false);
    }
  };

  // Llegada desde el aviso del coach: su pregunta se envía sola para que cumpla lo prometido
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  const teaserHandled = useRef(false);
  useEffect(() => {
    const prompt = (location.state as { coachPrompt?: string } | null)?.coachPrompt;
    if (!prompt || teaserHandled.current) return;
    teaserHandled.current = true;
    navigate(location.pathname, { replace: true, state: null });
    // Deja que la conversación activa se cargue antes de enviar (sin limpieza: en StrictMode el efecto se repite)
    setTimeout(() => handleSendRef.current(prompt), 400);
  }, [location.state]);

  /** Guarda el estado de la acción en el propio mensaje (persistido con la conversación) */
  const setMessageActionStatus = (msgId: string, actionStatus: 'applied' | 'dismissed') => {
    setMessages((prev) => {
      const next = prev.map((m) => (m.id === msgId ? { ...m, actionStatus } : m));
      if (activeConversationId) setConversationMessages(activeConversationId, next);
      return next;
    });
  };

  /**
   * Responder a una propuesta con sus botones deja constancia en el chat: se envía un mensaje con lo
   * elegido y el coach contesta. Si aún se espera una respuesta, solo se guarda el estado.
   */
  const reportActionChoice = (msgId: string, action: ParsedAction, actionStatus: 'applied' | 'dismissed') => {
    if (loading && !streamRef.current) {
      setMessageActionStatus(msgId, actionStatus);
      return;
    }
    // Si la respuesta aún se está «escribiendo», se guarda con su texto completo
    const st = streamRef.current;
    const base = messages.map((m) => ({
      ...m,
      ...(st && m.id === st.botId ? { content: st.fullText } : {}),
      ...(m.id === msgId ? { actionStatus } : {}),
    }));
    void handleSend(coachChoiceMessage(action, actionStatus), { base, force: true });
  };

  // Ejecutar acciones sugeridas por el Coach tras confirmación del usuario (validadas en lib/coachActions)
  const handleExecuteAction = (msgId: string, action: ParsedAction) => {
    const target = messages.find((m) => m.id === msgId);
    if (target?.actionStatus) return; // ya aplicada o descartada: evita aplicarla dos veces
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
      setCheerKey((k) => k + 1);
    } catch (err: any) {
      toast(`Error aplicando acción: ${err?.message || 'Error desconocido'}`, 'error');
    }
  };

  const handleDismissAction = (msgId: string, action: ParsedAction) => {
    if (messages.find((m) => m.id === msgId)?.actionStatus) return;
    reportActionChoice(msgId, action, 'dismissed');
  };

  // Regenerar respuesta del coach
  const handleRegenerate = async (botMsgId: string) => {
    if (loading) return;
    finishStream();
    const convId = activeConversationId;
    const botIdx = messages.findIndex((m) => m.id === botMsgId);
    if (botIdx <= 0) return;

    const userMsg = messages[botIdx - 1];
    if (userMsg.sender !== 'user') return;

    stopCoachVoice({ fade: true });
    unlockCoachVoice();
    setLoading(true);
    setRegeneratingId(botMsgId);
    playSound.click();

    try {
      const priorHistory = messages.slice(0, botIdx - 1).slice(-4).map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content,
      }));

      const newResponse = await generateHabitAdvice(currentData(), userMsg.content, priorHistory);
      // Misma burbuja (mismo id); sin estado de acción: la propuesta nueva, si la hay, está pendiente
      setMessages((prev) =>
        prev.map((m) => (m.id === botMsgId ? { id: botMsgId, sender: 'assistant', content: '', timestamp: nowTime() } : m))
      );
      setRegeneratingId(null);
      deliverBotResponse(convId, botMsgId, newResponse, () => setLoading(false));
    } catch (error: any) {
      setRegeneratingId(null);
      toast('Error al regenerar respuesta: ' + (error?.message || 'Error desconocido'), 'warning');
      setLoading(false);
    }
  };

  // Iniciar edición de mensaje
  const handleStartEdit = (id: string, currentContent: string) => {
    setEditingId(id);
    setEditText(currentContent);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  // Al guardar edición: verificar si hay mensajes posteriores para pedir confirmación
  const handleAttemptSaveEdit = (msgId: string) => {
    if (!editText.trim() || loading) return;
    const userIdx = messages.findIndex((m) => m.id === msgId);
    if (userIdx === -1) return;

    const hasSubsequent = userIdx < messages.length - 1;
    if (hasSubsequent) {
      setPendingEditMsgId(msgId);
      setShowEditConfirm(true);
    } else {
      executeSaveEdit(msgId);
    }
  };

  // Ejecución de la edición y creación de nueva versión
  const executeSaveEdit = async (msgId: string) => {
    const userIdx = messages.findIndex((m) => m.id === msgId);
    if (userIdx === -1) return;

    finishStream();
    const convId = activeConversationId;
    const targetMsg = messages[userIdx];
    const newText = editText.trim();
    setEditingId(null);
    setShowEditConfirm(false);
    stopCoachVoice({ fade: true });
    unlockCoachVoice();

    const subsequent = messages.slice(userIdx + 1);
    // Copia: no mutar las versiones que forman parte del estado
    const existingVersions: MessageVersion[] = targetMsg.versions
      ? [...targetMsg.versions]
      : [{ text: targetMsg.content, subsequentMessages: subsequent }];

    const currentVersionIdx = targetMsg.activeVersionIndex ?? 0;
    existingVersions[currentVersionIdx] = {
      text: targetMsg.content,
      subsequentMessages: subsequent,
    };

    const newVersionIdx = existingVersions.length;
    const updatedVersions: MessageVersion[] = [
      ...existingVersions,
      { text: newText, subsequentMessages: [] },
    ];

    const updatedUserMsg: ChatMessage = {
      ...targetMsg,
      content: newText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      versions: updatedVersions,
      activeVersionIndex: newVersionIdx,
    };

    const nextBase = [...messages.slice(0, userIdx), updatedUserMsg];
    setMessages(nextBase);
    if (activeConversationId) {
      setConversationMessages(activeConversationId, nextBase);
    }
    setLoading(true);
    playSound.click();

    try {
      const priorHistory = nextBase.slice(0, userIdx).slice(-4).map((m) => ({
        role: (m.sender === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content,
      }));

      const botId = `bot-${Date.now()}`;
      const placeholderBotMsg: ChatMessage = {
        id: botId,
        sender: 'assistant',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages([...nextBase, placeholderBotMsg]);

      const response = await generateHabitAdvice(currentData(), newText, priorHistory);
      deliverBotResponse(convId, botId, response, () => setLoading(false));
      toast('Mensaje editado y nueva versión creada', 'success');
    } catch (error: any) {
      toast('Error al responder: ' + (error?.message || 'Error desconocido'), 'warning');
      setLoading(false);
    }
  };

  // Navegar entre versiones del mensaje (< 1/3 >)
  const handleSwitchVersion = (msgId: string, direction: -1 | 1) => {
    const userIdx = messages.findIndex((m) => m.id === msgId);
    if (userIdx === -1) return;

    const targetMsg = messages[userIdx];
    if (!targetMsg.versions || targetMsg.versions.length <= 1) return;

    const currentIdx = targetMsg.activeVersionIndex ?? 0;
    const targetIdx = currentIdx + direction;

    if (targetIdx < 0 || targetIdx >= targetMsg.versions.length) return;

    const currentSubsequent = messages.slice(userIdx + 1);
    const updatedVersions = [...targetMsg.versions];
    updatedVersions[currentIdx] = {
      text: targetMsg.content,
      subsequentMessages: currentSubsequent,
    };

    const selectedVersion = updatedVersions[targetIdx];
    const updatedUserMsg: ChatMessage = {
      ...targetMsg,
      content: selectedVersion.text,
      versions: updatedVersions,
      activeVersionIndex: targetIdx,
    };

    const nextCombined = [
      ...messages.slice(0, userIdx),
      updatedUserMsg,
      ...(selectedVersion.subsequentMessages || []),
    ];

    setMessages(nextCombined);
    if (activeConversationId) {
      setConversationMessages(activeConversationId, nextCombined);
    }

    playSound.pop();
    toast(`Versión ${targetIdx + 1} de ${updatedVersions.length} cargada`, 'info');
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast('No se pudo copiar al portapapeles', 'warning');
      return;
    }
    setCopiedId(id);
    playSound.click();
    toast('Copiado al portapapeles', 'info');
    setTimeout(() => {
      setCopiedId((cur) => (cur === id ? null : cur));
    }, 2000);
  };

  // Abrir menú de 3 puntos con coordenadas calculadas para evitar recortes
  const handleOpenMenu = (e: React.MouseEvent<HTMLButtonElement>, conv: AiConversation) => {
    e.stopPropagation();
    if (menuState?.convId === conv.id) {
      setMenuState(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuState({
      convId: conv.id,
      conv,
      position: {
        top: rect.bottom + 4,
        left: Math.max(10, Math.min(window.innerWidth - 170, rect.right - 145)),
      },
    });
  };

  // Crear nueva conversación
  const handleCreateNewConversation = () => {
    if (!newConvTitle.trim()) return;
    const newId = createConversation(newConvTitle.trim());
    const initialMsgs: ChatMessage[] = [
      {
        id: 'welcome',
        sender: 'assistant',
        content: DEFAULT_WELCOME_TEXT,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ];
    setConversationMessages(newId, initialMsgs);
    setMessages(initialMsgs);
    setNewConvTitle('');
    setShowNewConvModal(false);
    playSound.pop();
    toast('Nueva conversación creada', 'success');
  };

  // Confirmar renombrado de conversación
  const handleConfirmRename = () => {
    if (!renamingConvId || !renameTitle.trim()) return;
    renameConversation(renamingConvId, renameTitle.trim());
    setRenamingConvId(null);
    setRenameTitle('');
    setShowRenameModal(false);
    playSound.pop();
    toast('Conversación renombrada con éxito', 'success');
  };

  return (
    <div className="stack fade-up coach-page">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Coach de hábitos con IA</p>
          <h1>
            {persona.name}, tu {persona.role}
          </h1>
        </div>

        <div className="actions coach-model-badges">
          {/* Muestra automáticamente el modelo principal en uso */}
          <span
            className="badge accent"
            style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            title={`Modelo principal activo: ${activePrimaryModel}`}
          >
            <Sparkles size={13} /> {activePrimaryModel}
          </span>

          {settings.backupModel && (
            <span
              className="badge"
              style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399' }}
              title="Modelo de respaldo automático si el principal falla"
            >
              Respaldo: {settings.backupModel}
            </span>
          )}
        </div>
      </div>

      {/* Alerta de API Key si no está configurada */}
      {!isKeyConfigured && (
        <div className="callout attention coach-key-callout">
          <Key />
          <div className="row-between grow" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div className="title">{keysLocked ? 'Claves de API bloqueadas' : 'Modo Local Algorítmico Activo'}</div>
              <div className="detail">
                {keysLocked
                  ? 'Tus claves están cifradas. Desbloquéalas en Ajustes con tu contraseña para usar los modelos de IA; mientras tanto responde el motor analítico local.'
                  : `El coach está respondiendo con el motor analítico local. Para activar los modelos neuronales con respaldo automático (${activePrimaryModel} + ${settings.backupModel || 'Gemini 3.1 Flash'}), añade tu clave de API en Ajustes.`}
              </div>
            </div>
            <Link to="/ajustes" className="btn btn-secondary sm">
              {keysLocked ? 'Desbloquear claves' : 'Configurar clave y modelos'}
            </Link>
          </div>
        </div>
      )}

      {/* LAYOUT PRINCIPAL: CONVERSACIONES A LA IZQUIERDA Y CHAT A LA DERECHA */}
      <div className="coach-layout">
        {/* PANEL IZQUIERDO: CONVERSACIONES Y, DEBAJO, EL COACH */}
        <div className="coach-left">
        <div className={`card conversations-sidebar ${convListOpen ? 'conv-list-open' : ''}`}>
          {/* Encabezado: Recientes ⌵ (plegable en pantallas pequeñas) y botón + Nueva */}
          <div className="conversations-header">
            <button
              type="button"
              className="conversations-title-btn"
              onClick={() => setConvListOpen((v) => !v)}
              aria-expanded={convListOpen}
              aria-controls="coach-conv-list"
            >
              <span className="conv-header-label">Recientes</span>
              <span className="conv-header-current truncate">
                {conversations.find((c) => c.id === activeConversationId)?.title ?? 'Conversaciones'}
              </span>
              <ChevronDown size={14} className="conv-header-chevron" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn sm"
              onClick={() => {
                setNewConvTitle('');
                setShowNewConvModal(true);
              }}
              title="Nueva conversación"
              aria-label="Nueva conversación"
            >
              <Plus size={15} />
            </button>
          </div>

          {/* Lista de conversaciones con estilo idéntico a la referencia y acción de eliminar directa */}
          <div id="coach-conv-list" className="conv-list">
            {(conversations || []).map((conv) => {
              const isActive = conv.id === activeConversationId;
              const isMenuOpen = menuState?.convId === conv.id;

              return (
                <div
                  key={conv.id}
                  className={`conversation-item ${isActive ? 'active' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => {
                    setActiveConversation(conv.id);
                    setConvListOpen(false);
                    playSound.click();
                  }}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setActiveConversation(conv.id);
                      setConvListOpen(false);
                    }
                  }}
                  title={conv.title}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                >
                  <span className="conv-title" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conv.title}
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    {/* Botón rápido de eliminar */}
                    <button
                      type="button"
                      className="conv-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingConv(conv);
                        setShowDeleteModal(true);
                      }}
                      title="Eliminar conversación"
                      aria-label={`Eliminar conversación «${conv.title}»`}
                    >
                      <Trash2 size={13} />
                    </button>

                    {/* Botón de 3 puntos horizontal (...) */}
                    <button
                      type="button"
                      className={`conv-more-btn ${isMenuOpen ? 'menu-open' : ''}`}
                      onClick={(e) => handleOpenMenu(e, conv)}
                      title="Opciones de la conversación"
                      aria-label={`Opciones de «${conv.title}»`}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <CoachStage thinking={loading && !streamRef.current} cheerKey={cheerKey} />
        </div>

        {/* CONTENEDOR DE CHAT PRINCIPAL A LA DERECHA */}
        <div className="card chat-container" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chat-messages">
            {messages.map((m) => {
              const isUser = m.sender === 'user';
              const isEditing = editingId === m.id;
              const isCopied = copiedId === m.id;
              const totalVersions = m.versions?.length || 1;
              const currentVersionNum = (m.activeVersionIndex ?? 0) + 1;
              const parsed = !isUser ? extractActionAndText(m.content) : { text: m.content, action: null };

              return (
                <div
                  key={m.id}
                  className={`chat-message-wrapper ${m.sender}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    marginBottom: 14,
                    position: 'relative',
                  }}
                >
                  {/* Burbuja del mensaje */}
                  <div
                    className={`chat-bubble ${m.sender}`}
                  >
                    {isEditing ? (
                      <div className="chat-edit-box" style={{ minWidth: 'min(260px, 100%)' }}>
                        <textarea
                          className="chat-edit-input"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div className="chat-edit-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost sm"
                            onClick={handleCancelEdit}
                          >
                            <X size={13} /> Cancelar
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary sm"
                            onClick={() => handleAttemptSaveEdit(m.id)}
                          >
                            <Check size={13} /> Guardar
                          </button>
                        </div>
                      </div>
                    ) : m.id === regeneratingId ? (
                      <div className="thinking-dots" aria-label={`${persona.name} está regenerando la respuesta`}>
                        <span className="dot dot-1" />
                        <span className="dot dot-2" />
                        <span className="dot dot-3" />
                      </div>
                    ) : (
                      <>
                        <MarkdownMessage content={parsed.text} />
                        {parsed.action && (
                          <div style={{ marginTop: 10 }}>
                            <ActionConfirmationCard
                              action={parsed.action}
                              status={m.actionStatus || 'pending'}
                              onConfirm={() => handleExecuteAction(m.id, parsed.action!)}
                              onDismiss={() => handleDismissAction(m.id, parsed.action!)}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* ACCIONES FUERA DE LA BURBUJA (ABAJO), CON ANIMACIÓN HOVER EASE-IN/EASE-OUT Y SIN FONDO */}
                  {!isEditing && (
                    <div
                      className="chat-actions-bottom"
                    >
                      <span className="chat-msg-time">
                        {m.timestamp}
                      </span>

                      {/* Botón Copiar */}
                      <button
                        type="button"
                        onClick={() => handleCopy(m.id, isUser ? m.content : stripVoiceTags(m.content))}
                        className="chat-msg-action"
                        title="Copiar texto"
                        aria-label="Copiar texto"
                      >
                        {isCopied ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} />}
                      </button>

                      {/* Botón Editar (Solo en mensajes de usuario) */}
                      {isUser && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(m.id, m.content)}
                          className="chat-msg-action"
                          title="Editar mensaje"
                          aria-label="Editar mensaje"
                        >
                          <Pencil size={13} />
                        </button>
                      )}

                      {/* Botón Regenerar (Solo en mensajes del asistente) */}
                      {!isUser && m.id !== 'welcome' && (
                        <button
                          type="button"
                          onClick={() => handleRegenerate(m.id)}
                          disabled={loading}
                          className="chat-msg-action"
                          title={`Regenerar respuesta de ${persona.name}`}
                          aria-label={`Regenerar respuesta de ${persona.name}`}
                        >
                          <Sparkles size={13} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* NAVEGADOR DE VERSIONES DE MENSAJE (< 1 / 2 >) */}
                  {isUser && totalVersions > 1 && !isEditing && (
                    <div
                      className="chat-versions-nav"
                    >
                      <button
                        type="button"
                        disabled={currentVersionNum <= 1}
                        onClick={() => handleSwitchVersion(m.id, -1)}
                        className="chat-version-btn"
                        title="Versión anterior"
                        aria-label="Versión anterior"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <span style={{ fontWeight: 600 }}>
                        {currentVersionNum} / {totalVersions}
                      </span>
                      <button
                        type="button"
                        disabled={currentVersionNum >= totalVersions}
                        onClick={() => handleSwitchVersion(m.id, 1)}
                        className="chat-version-btn"
                        title="Siguiente versión"
                        aria-label="Siguiente versión"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ANIMACIÓN DE CARGA / PENSANDO DEL COACH (al regenerar espera en su propia burbuja) */}
            {loading && !regeneratingId && !streamRef.current && (
              <div
                className="chat-message-wrapper assistant"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  marginBottom: 14,
                }}
              >
                <div
                  className="chat-bubble assistant"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '14px 20px',
                    borderRadius: 20,
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                    background: 'rgba(99, 102, 241, 0.08)',
                  }}
                >
                  <span className="chat-thinking-avatar" aria-hidden="true">
                    <CoachAvatar gender={persona.gender} crop="head" size={38} expression="thinking" />
                  </span>
                  <div className="thinking-dots">
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic' }}>
                    {persona.name} está analizando tus datos y preparando la mejor respuesta…
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Sugerencias de consulta rápida compactas (solo al inicio del chat para ahorrar espacio) */}
          {messages.filter((m) => m.sender === 'user').length === 0 && (
            <div
              className="chat-presets"
              style={{
                marginTop: 8,
                padding: '6px 10px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.05))',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  flexShrink: 0,
                }}
              >
                <Lightbulb size={12} style={{ color: 'var(--accent)' }} /> <span className="chat-presets-label">Sugerencias:</span>
              </span>
              <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'nowrap' }}>
                {PRESET_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="chip"
                    onClick={() => handleSend(q)}
                    disabled={loading}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 12,
                      fontSize: 11.5,
                      cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-2)',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input de chat */}
          <form
            className="chat-input-bar"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}
          >
            <input
              type="text"
              className="input chat-input grow"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre tus hábitos, energía o consistencia..."
              disabled={loading}
            />

            {/* Botón Enviar */}
            <button
              type="submit"
              className="btn btn-primary chat-send-btn"
              disabled={!input.trim() || loading}
              aria-label="Enviar"
            >
              <Send size={16} /> <span className="chat-send-label">Enviar</span>
            </button>
          </form>
        </div>
      </div>

      {/* MENÚ FLOTANTE VÍA PORTAL PARA LOS 3 PUNTOS (CERO RECORTES POR OVERFLOW) */}
      {menuState &&
        createPortal(
          <div
            ref={menuRef}
            className="conv-portal-dropdown"
            style={{
              top: menuState.position.top,
              left: menuState.position.left,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setRenamingConvId(menuState.conv.id);
                setRenameTitle(menuState.conv.title);
                setShowRenameModal(true);
                setMenuState(null);
              }}
            >
              <Pencil size={13} /> Editar nombre
            </button>
            <button
              type="button"
              className="dropdown-item danger"
              onClick={() => {
                setDeletingConv(menuState.conv);
                setShowDeleteModal(true);
                setMenuState(null);
              }}
            >
              <Trash2 size={13} /> Eliminar
            </button>
          </div>,
          document.body
        )}

      {/* Modal para crear nueva conversación */}
      <Modal
        isOpen={showNewConvModal}
        onClose={() => setShowNewConvModal(false)}
        title="Crear nueva conversación"
      >
        <div className="form">
          <div className="field">
            <span className="label">Título de la conversación</span>
            <input
              type="text"
              className="input"
              placeholder="Ej. Plan semanal, Nutrición, Enfoque matutino..."
              value={newConvTitle}
              onChange={(e) => setNewConvTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNewConversation();
              }}
            />
            <span className="hint">
              Asigna un nombre descriptivo para identificar los consejos de este chat.
            </span>
          </div>

          <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowNewConvModal(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreateNewConversation}
              disabled={!newConvTitle.trim()}
            >
              Crear conversación
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal para renombrar conversación */}
      <Modal
        isOpen={showRenameModal}
        onClose={() => {
          setShowRenameModal(false);
          setRenamingConvId(null);
        }}
        title="Editar nombre de la conversación"
      >
        <div className="form">
          <div className="field">
            <span className="label">Nuevo título</span>
            <input
              type="text"
              className="input"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmRename();
              }}
            />
          </div>

          <div className="form-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowRenameModal(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmRename}
              disabled={!renameTitle.trim()}
            >
              Guardar cambios
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal de confirmación para eliminar conversación (Directo y de 1 solo paso) */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setDeletingConv(null);
        }}
        onConfirm={() => {
          if (deletingConv) {
            const wasActive = deletingConv.id === activeConversationId;
            deleteConversation(deletingConv.id);
            playSound.delete();
            toast('Conversación eliminada con éxito', 'info');
            if (wasActive) {
              const st = useStore.getState();
              const nextConv = (st.conversations || []).find((c) => c.id === st.activeConversationId);
              if (nextConv && nextConv.messages.length > 0) {
                setMessages(nextConv.messages);
              } else {
                setMessages([
                  {
                    id: 'welcome',
                    sender: 'assistant',
                    content: DEFAULT_WELCOME_TEXT,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  },
                ]);
              }
            }
          }
          setShowDeleteModal(false);
          setDeletingConv(null);
        }}
        title="¿Eliminar conversación?"
        message={`¿Seguro que deseas eliminar «${deletingConv?.title}»? Esta acción borrará permanentemente sus mensajes.`}
        confirmLabel="Eliminar conversación"
        confirmVariant="danger"
        zIndex={1450}
      />

      {/* Modal de confirmación al editar mensaje con subsecuentes */}
      <ConfirmModal
        isOpen={showEditConfirm}
        onClose={() => {
          setShowEditConfirm(false);
          setPendingEditMsgId(null);
        }}
        onConfirm={() => {
          if (pendingEditMsgId) executeSaveEdit(pendingEditMsgId);
        }}
        title="¿Editar mensaje y ramificar conversación?"
        message="Al guardar este cambio se creará una nueva versión del mensaje y se regenerará la respuesta. Podrás alternar entre versiones en cualquier momento usando los botones < >."
        confirmLabel="Guardar y regenerar"
        confirmVariant="primary"
        zIndex={1400}
      />

    </div>
  );
};
