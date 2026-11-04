import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '@/components/ui/useModalBehavior';
import { useSheetDismiss } from '@/components/ui/useSheetDismiss';
import { MOBILE_QUERY } from '@/lib/useMediaQuery';
import { Play, Pause, Square, X, Sparkles, Sprout } from 'lucide-react';
import { useStore, useData, minimumMinutesFor } from '@/store/useStore';
import { formatClock, todayKey } from '@/lib/dates';
import { getLog } from '@/lib/metrics';
import { SessionFinishModal } from './SessionFinishModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { fireRewardCelebration } from '@/lib/confetti';
import { useElapsed } from '@/lib/timer';
import { playSound } from '@/lib/sound';

export const TimerModal: React.FC = () => {
  const data = useData();
  const activeTimer = useStore((s) => s.activeTimer);
  const isTimerModalOpen = useStore((s) => s.isTimerModalOpen);
  const setTimerModalOpen = useStore((s) => s.setTimerModalOpen);
  const pauseTimer = useStore((s) => s.pauseTimer);
  const resumeTimer = useStore((s) => s.resumeTimer);
  const cancelTimer = useStore((s) => s.cancelTimer);
  const finishTimer = useStore((s) => s.finishTimer);
  const habits = useStore((s) => s.habits);
  const minimumRatio = useStore((s) => s.settings.minimumRatio);
  const { toast } = useToast();

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
  }, []);
  const isVisible = Boolean(activeTimer && isTimerModalOpen);

  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => setIsSettled(true), 260);
      return () => clearTimeout(timer);
    } else {
      setIsSettled(false);
    }
  }, [isVisible]);

  // Sonido al abrir el modal del temporizador
  useEffect(() => {
    if (isVisible) playSound.modalOpen();
  }, [isVisible]);

  const handleMinimize = () => {
    playSound.modalClose();
    setTimerModalOpen(false);
  };

  const triggerShake = () => {
    setShaking(true);
    playSound.blocked();
    toast('Para salir o minimizar debes hacer clic en la X de la esquina.', 'warning');
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 380);
  };

  // Reloj de tiempo transcurrido (por diferencia de tiempo: no deriva)
  const elapsed = useElapsed(activeTimer);

  // Escape agita el diálogo (se minimiza con la X); con un diálogo hijo abierto, responde el hijo
  useModalBehavior(isVisible && !showFinishModal && !showCancelConfirm, dialogRef, triggerShake);
  // Móvil: deslizar hacia abajo o tocar fuera lo minimiza (el temporizador sigue en marcha)
  const { dismiss } = useSheetDismiss(dialogRef, isVisible && !showFinishModal && !showCancelConfirm, handleMinimize);

  if (!activeTimer || !isTimerModalOpen) return null;

  const isCustom = Boolean(activeTimer.isCustom);
  const habit = !isCustom && activeTimer.habitId ? habits.find((h) => h.id === activeTimer.habitId) : null;
  const timerTitle = isCustom ? (activeTimer.customTitle || 'Temporizador libre') : (habit?.name ?? 'Sesión');
  const timerIcon = isCustom ? (activeTimer.customIcon || '⏱️') : (habit?.icon ?? '⏱️');
  const customMin = activeTimer.customMinutes ?? 25;
  const habitTargetMin = isCustom ? customMin : (habit?.targetMinutes ?? 25);
  const todayLog = habit ? getLog(data, habit.id, todayKey()) : undefined;
  const alreadyLoggedMin = isCustom ? 0 : (todayLog?.minutes || 0);

  // Tiempo restante para completar la meta de hoy:
  const remainingTargetMin = isCustom ? customMin : Math.max(0, habitTargetMin - alreadyLoggedMin);
  const sessionTargetSec = (isCustom ? customMin : (remainingTargetMin > 0 ? remainingTargetMin : habitTargetMin)) * 60;
  const remainingSec = Math.max(0, sessionTargetSec - elapsed);
  const isCompleted = remainingSec === 0 || elapsed >= sessionTargetSec;

  const minMin = isCustom || !habit ? 0 : minimumMinutesFor({ ...habit, targetMinutes: habitTargetMin }, minimumRatio);
  const totalMinDoneToday = alreadyLoggedMin + Math.floor(elapsed / 60);
  const hasReachedMinimum = !isCustom && minMin > 0 && totalMinDoneToday >= minMin;

  // Fracción restante: 1.0 al inicio, desciende gradualmente hasta 0.0 al agotarse
  const fractionRemaining = sessionTargetSec > 0 ? Math.max(0, Math.min(1, remainingSec / sessionTargetSec)) : 0;

  // Parámetros del SVG circular
  const size = 320;
  const strokeWidth = 10;
  const radius = (size - strokeWidth * 2) / 2; // ~150px
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - fractionRemaining);

  // Color de stroke:
  const activeStrokeColor = isCustom
    ? 'var(--yellow)'
    : hasReachedMinimum
    ? 'var(--orange)'
    : (habit?.color || 'var(--accent)');
  const strokeGlow = isCustom
    ? 'color-mix(in srgb, var(--yellow) 60%, transparent)'
    : hasReachedMinimum
    ? 'color-mix(in srgb, var(--orange) 70%, transparent)'
    : `${activeStrokeColor}66`;

  // Muesca en la posición de la versión mínima dentro de la meta
  const showTick = !isCustom && minMin > 0;
  const tickAngleDeg = Math.min(1, minMin / Math.max(1, habitTargetMin)) * 360;
  const tickRad = (tickAngleDeg * Math.PI) / 180;
  const tickX1 = size / 2 + (radius - 8) * Math.cos(tickRad);
  const tickY1 = size / 2 + (radius - 8) * Math.sin(tickRad);
  const tickX2 = size / 2 + (radius + 8) * Math.cos(tickRad);
  const tickY2 = size / 2 + (radius + 8) * Math.sin(tickRad);

  return createPortal(
    <>
      {!showFinishModal && !showCancelConfirm && (
        <div
          className="modal-backdrop"
          style={{
            zIndex: 1200,
            background: 'var(--overlay)',
            backdropFilter: 'blur(22px)',
            WebkitBackdropFilter: 'blur(22px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
          }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (window.matchMedia(MOBILE_QUERY).matches) dismiss();
            else triggerShake();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Temporizador en curso"
            tabIndex={-1}
            className={shaking ? 'shake-modal' : ''}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 440,
              maxHeight: 'calc(100dvh - 32px)',
              overflowY: 'auto',
              background: 'linear-gradient(180deg, var(--surface-2) 0%, var(--surface) 100%)',
              border: `1px solid ${hasReachedMinimum ? 'color-mix(in srgb, var(--orange) 40%, transparent)' : 'var(--border-2)'}`,
              borderRadius: 28,
              padding: '36px 24px 30px',
              boxShadow: hasReachedMinimum
                ? '0 30px 80px color-mix(in srgb, var(--shadow-color) 90%, transparent), 0 0 40px rgba(249, 115, 22, 0.25)'
                : '0 30px 80px color-mix(in srgb, var(--shadow-color) 90%, transparent), 0 0 40px rgba(139, 92, 246, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 24,
              animation: isSettled ? 'none' : 'modalIn .25s ease both',
              transition: 'border-color .3s ease, box-shadow .3s ease',
            }}
          >
            {/* Botón X superior derecha para minimizar a la barra superior */}
            <button
              type="button"
              className="icon-btn sm"
              style={{
                position: 'absolute',
                zIndex: 2,
                top: 16,
                right: 16,
                background: 'color-mix(in srgb, var(--text) 6%, transparent)',
                border: '1px solid var(--border)',
                color: 'var(--text-2)',
              }}
              onClick={handleMinimize}
              title="Minimizar (ver en la barra superior)"
              aria-label="Minimizar (ver en la barra superior)"
            >
              <X size={16} />
            </button>

            {/* CÍRCULO QUE SE VACÍA GRADUALMENTE */}
            {/* Anillo escalable: nunca más ancho que la pantalla */}
            <div style={{ position: 'relative', width: `min(${size}px, 78vw)`, aspectRatio: '1' }}>
              <svg
                viewBox={`0 0 ${size} ${size}`}
                width="100%"
                height="100%"
                style={{
                  transform: 'rotate(-90deg)',
                  pointerEvents: 'none',
                  transformOrigin: '50% 50%',
                  overflow: 'visible',
                }}
              >
                {/* Círculo de fondo tenue */}
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke="color-mix(in srgb, var(--text) 6%, transparent)"
                  strokeWidth={strokeWidth}
                />
                {/* Círculo activo que se va vaciando */}
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={activeStrokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  style={{
                    transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease',
                    filter: `drop-shadow(0 0 12px ${strokeGlow})`,
                  }}
                />
                {/* Muesca (tick mark) para modo mínimo */}
                {showTick && (
                  <line
                    x1={tickX1}
                    y1={tickY1}
                    x2={tickX2}
                    y2={tickY2}
                    stroke="var(--orange-fill)"
                    strokeWidth={4}
                    strokeLinecap="round"
                    style={{ filter: 'drop-shadow(0 0 4px var(--orange))' }}
                  />
                )}
              </svg>

              {/* CONTENIDO CENTRADO DENTRO DEL CÍRCULO */}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '24px',
                  pointerEvents: 'none',
                }}
              >
                {/* Icono del hábito o temporizador libre */}
                <span style={{ fontSize: 'clamp(30px, 9vw, 44px)', lineHeight: 1, marginBottom: 6 }}>{timerIcon}</span>

                {/* Título */}
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 18,
                    letterSpacing: '-0.02em',
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--text)',
                  }}
                  title={timerTitle}
                >
                  {timerTitle}
                </div>

                {/* Subtítulo */}
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    marginTop: 2,
                    marginBottom: 8,
                  }}
                >
                  {isCustom
                    ? (activeTimer?.customDescription || `${customMin} minutos de enfoque directo`)
                    : alreadyLoggedMin > 0
                    ? `Hecho hoy: ${alreadyLoggedMin}m · Resta: ${remainingTargetMin}m`
                    : `Meta diaria: ${habitTargetMin} min`}
                  {!isCustom && minMin > 0 && (
                    <span style={{ color: hasReachedMinimum ? 'var(--orange)' : 'var(--minimum)' }}>
                      {' '}· mín: {minMin}m
                    </span>
                  )}
                </div>

                {/* Reloj descendente */}
                <div
                  style={{
                    fontSize: 'clamp(32px, 10vw, 48px)',
                    fontWeight: 800,
                    letterSpacing: '-0.03em',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                    color: activeTimer.pausedAt
                      ? 'var(--warning)'
                      : isCompleted
                      ? 'var(--success)'
                      : hasReachedMinimum
                      ? 'var(--orange)'
                      : 'var(--text)',
                  }}
                >
                  {formatClock(remainingSec)}
                </div>

                {/* Estado */}
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginTop: 6,
                    color: activeTimer.pausedAt
                      ? 'var(--warning)'
                      : isCompleted
                      ? 'var(--success)'
                      : hasReachedMinimum
                      ? 'var(--orange)'
                      : 'var(--accent-2)',
                  }}
                >
                  <span className="icon-label">
                    {activeTimer.pausedAt ? (
                      <><Pause size={13} strokeWidth={2.6} aria-hidden="true" /> En pausa</>
                    ) : isCompleted ? (
                      <><Sparkles size={13} aria-hidden="true" /> Meta alcanzada</>
                    ) : hasReachedMinimum ? (
                      <><Sprout size={13} aria-hidden="true" /> Modo mínimo logrado</>
                    ) : (
                      <><Play size={13} strokeWidth={2.6} aria-hidden="true" /> En progreso</>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* CONTROLES INFERIORES */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
              <div style={{ display: 'flex', gap: 10, width: '100%' }}>
                {activeTimer.pausedAt ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1, padding: '12px' }}
                    onClick={resumeTimer}
                  >
                    <Play size={16} /> Reanudar
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '12px' }}
                    onClick={pauseTimer}
                  >
                    <Pause size={16} /> Pausar
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    borderColor: '#10b981',
                  }}
                  onClick={() => {
                    if (isCustom) {
                      finishTimer();
                      fireRewardCelebration();
                      toast('¡Temporizador finalizado! Has completado tu sesión de enfoque.', 'success');
                    } else {
                      setShowFinishModal(true);
                    }
                  }}
                >
                  <Square size={16} /> Terminar
                </button>
              </div>

              <button
                type="button"
                className="btn btn-ghost sm danger"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setShowCancelConfirm(true)}
              >
                Cancelar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de finalización de sesión */}
      {showFinishModal && (
        <SessionFinishModal
          isOpen={showFinishModal}
          onClose={() => setShowFinishModal(false)}
          zIndex={1300}
        />
      )}

      {/* Confirmación para cancelar sesión */}
      {showCancelConfirm && (
        <ConfirmModal
          isOpen={showCancelConfirm}
          onClose={() => setShowCancelConfirm(false)}
          onConfirm={() => {
            cancelTimer();
            setShowCancelConfirm(false);
          }}
          title="¿Cancelar sesión actual?"
          message={
            isCustom
              ? "¿Estás seguro de que deseas cancelar este temporizador puntual?"
              : "No se guardará el tiempo transcurrido en el registro de hoy ni se otorgarán puntos."
          }
          confirmLabel="Cancelar sesión"
          confirmVariant="danger"
          zIndex={1300}
        />
      )}
    </>,
    document.body
  );
};
