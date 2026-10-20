import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useCoachPersona } from './coachPersona';
import { canShowEntryTeaser, canShowTeaser, pickTeaser, recordTeaserShown, TEASER_EVENT, type CoachTeaserMsg } from './coachTeasers';
import { playSound } from '@/lib/sound';

/** Aviso al entrar a la app (se reintenta si hay un diálogo abierto, p. ej. la bienvenida), y cada cuánto se vuelve a comprobar */
const ENTRY_DELAY_MS = 3_000;
const ENTRY_RETRY_MS = 2_000;
const CHECK_EVERY_MS = 60_000;
/** Velocidad de escritura letra a letra */
const TYPE_MS = 38;
/** Tiempo visible tras terminar de escribir (se pausa con el ratón encima) */
const LINGER_MS = 9_000;
const EXIT_MS = 320;

/** Una vez por apertura de la app: el componente se desmonta en la página del coach y no debe repetirlo al volver */
let entryPending = true;

interface CoachTeaserProps {
  /** El chat flotante está abierto: no molestar */
  blocked: boolean;
  /** La burbuja está escondida al bajar por la página (móvil): los avisos automáticos esperan */
  tucked: boolean;
  /** Vuelve a mostrar la burbuja (la prueba desde Ajustes la saca aunque esté escondida) */
  onUntuck: () => void;
  onOpen: (prompt: string) => void;
}

/**
 * Burbuja del coach junto a su botón (a la izquierda en escritorio, encima en móvil):
 * una tarjeta blanca en la que el coach escribe su mensaje letra a letra.
 */
export const CoachTeaser: React.FC<CoachTeaserProps> = ({ blocked, tucked, onUntuck, onOpen }) => {
  const persona = useCoachPersona();
  const [teaser, setTeaser] = useState<CoachTeaserMsg | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [typed, setTyped] = useState(0);
  const [hover, setHover] = useState(false);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const tuckedRef = useRef(tucked);
  tuckedRef.current = tucked;
  const onUntuckRef = useRef(onUntuck);
  onUntuckRef.current = onUntuck;
  const teaserRef = useRef<CoachTeaserMsg | null>(null);
  teaserRef.current = teaser;

  const show = (force = false) => {
    if (teaserRef.current || blockedRef.current) return;
    if (!force && (tuckedRef.current || document.hidden)) return;
    const entry = !force && entryPending;
    if (entry) {
      // Espera a que se cierre cualquier diálogo (bienvenida del primer uso, etc.)
      if (document.querySelector('.modal-backdrop')) return;
      entryPending = false;
      if (!canShowEntryTeaser()) return;
    } else if (!force && !canShowTeaser()) return;
    if (force && tuckedRef.current) onUntuckRef.current();
    const msg = pickTeaser();
    // La prueba desde Ajustes no gasta el cupo diario
    if (!force) recordTeaserShown();
    setLeaving(false);
    setTyped(0);
    setTeaser(msg);
    playSound.pop();
  };
  const showRef = useRef(show);
  showRef.current = show;

  // Programación: un aviso nada más entrar y luego una comprobación cada minuto
  useEffect(() => {
    let first: ReturnType<typeof setTimeout>;
    const tryEntry = () => {
      showRef.current();
      if (entryPending) first = setTimeout(tryEntry, ENTRY_RETRY_MS);
    };
    first = setTimeout(tryEntry, ENTRY_DELAY_MS);
    const every = setInterval(() => showRef.current(), CHECK_EVERY_MS);
    const onForce = () => showRef.current(true);
    window.addEventListener(TEASER_EVENT, onForce);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      window.removeEventListener(TEASER_EVENT, onForce);
    };
  }, []);

  const hide = () => {
    if (!teaserRef.current) return;
    setLeaving(true);
    setTimeout(() => {
      setTeaser(null);
      setLeaving(false);
    }, EXIT_MS);
  };

  // Escritura letra a letra (por puntos de código: los emojis no se parten)
  const chars = teaser ? Array.from(teaser.text) : [];
  const done = teaser !== null && typed >= chars.length;
  useEffect(() => {
    if (!teaser || leaving || done) return;
    const t = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 520 : TYPE_MS);
    return () => clearTimeout(t);
  }, [teaser, typed, leaving, done]);

  // Se va solo pasado un rato, salvo con el ratón encima
  useEffect(() => {
    if (!done || hover || leaving) return;
    const t = setTimeout(hide, LINGER_MS);
    return () => clearTimeout(t);
  }, [done, hover, leaving]);

  useEffect(() => {
    if (blocked || tucked) hide();
  }, [blocked, tucked]);

  if (!teaser) return null;

  const open = () => {
    playSound.chatOpen();
    onOpen(teaser.prompt);
    setTeaser(null);
  };

  return (
    <div
      className={`coach-teaser${leaving ? ' leaving' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="coach-teaser-bubble-wrap">
      <button
        type="button"
        className="coach-teaser-bubble"
        onClick={open}
        aria-label={`${persona.name} dice: ${teaser.text}. Abrir su página`}
        data-no-sound="true"
      >
        <span className="coach-teaser-name">
          <Sparkles size={12} aria-hidden="true" />
          {persona.name}
        </span>
        <span className="coach-teaser-text" aria-hidden="true">
          {chars.slice(0, typed).join('')}
          {!done && <span className="coach-teaser-caret" />}
          {/* Reserva el espacio del texto completo para que la burbuja no cambie de tamaño */}
          <span className="coach-teaser-ghost">{chars.slice(typed).join('')}</span>
        </span>
        <span className={`coach-teaser-cta${done ? ' show' : ''}`} aria-hidden="true">
          Toca para verlo →
        </span>
      </button>
      <button
        type="button"
        className="coach-teaser-close"
        onClick={(e) => {
          e.stopPropagation();
          playSound.dismiss();
          hide();
        }}
        aria-label="Cerrar aviso"
        data-no-sound="true"
      >
        <X size={13} />
      </button>
      </div>
    </div>
  );
};
