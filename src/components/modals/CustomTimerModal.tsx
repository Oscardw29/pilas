import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalBehavior } from '@/components/ui/useModalBehavior';
import { X, Clock, Play, Sparkles, Zap } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';

interface CustomTimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRESET_ICONS = ['⏱️', '⚡', '🎯', '🚀', '💡', '☕', '🧘', '💻', '📚', '✍️', '🎨', '🎵', '🛠️', '🧹', '🏃', '🥊'];
const PRESET_MINUTES = [10, 15, 25, 30, 45, 60, 90];

export const CustomTimerModal: React.FC<CustomTimerModalProps> = ({ isOpen, onClose }) => {
  const startCustomTimer = useStore((s) => s.startCustomTimer);
  const activeTimer = useStore((s) => s.activeTimer);
  const { toast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [minutes, setMinutes] = useState(25);
  const [icon, setIcon] = useState('⏱️');

  const [shaking, setShaking] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsSettled(true), 240);
      return () => clearTimeout(timer);
    } else {
      setIsSettled(false);
    }
  }, [isOpen]);

  const handleClose = () => {
    playSound.modalClose();
    onClose();
  };

  const triggerShake = () => {
    setShaking(true);
    playSound.blocked();
    toast('Para salir debes hacer clic en la X de la esquina.', 'warning');
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 380);
  };

  useEffect(() => {
    if (isOpen) {
      playSound.modalOpen();
    }
  }, [isOpen]);

  // Escape agita el diálogo (hay que salir con la X); foco atrapado y scroll bloqueado
  useModalBehavior(isOpen, dialogRef, triggerShake);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setMinutes(25);
      setIcon('⏱️');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast('Ingresa un título o nombre para la sesión', 'warning');
      return;
    }
    if (minutes <= 0) {
      toast('El tiempo debe ser mayor a 0 minutos', 'warning');
      return;
    }
    if (activeTimer) {
      toast('Ya hay un temporizador activo en curso. Termínalo o cancélalo primero.', 'warning');
      return;
    }

    startCustomTimer({
      title: title.trim(),
      description: description.trim() || undefined,
      icon,
      minutes: Number(minutes),
    });

    playSound.startTimerCountdown();
    toast(`Temporizador libre de ${minutes} min iniciado`, 'info');
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop"
      style={{
        zIndex: 1300,
        background: 'var(--overlay)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) triggerShake();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Temporizador libre"
        tabIndex={-1}
        className={`card ${shaking ? 'shake-modal' : ''}`}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: 'calc(100dvh - 40px)',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, var(--popover) 0%, var(--popover-end) 100%)',
          border: '1px solid var(--border-2)',
          borderRadius: 24,
          padding: '28px 24px',
          boxShadow: '0 24px 60px color-mix(in srgb, var(--shadow-color) 85%, transparent)',
          animation: isSettled ? 'none' : 'modalIn .2s ease both',
          position: 'relative',
        }}
      >
        {/* Botón cerrar */}
        <button
          type="button"
          className="icon-btn sm"
          style={{ position: 'absolute', top: 16, right: 16 }}
          onClick={handleClose}
        >
          <X size={16} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--yellow) 15%, transparent)',
              color: 'var(--yellow)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Zap size={20} aria-hidden="true" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Temporizador puntual</h3>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
              Sesión de enfoque de un solo uso (no altera hábitos ni estadísticas)
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 14 }}>
          {/* Título de la sesión */}
          <div className="field">
            <label className="label">Título o Tarea *</label>
            <input
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Redactar documento, Limpiar correos, Lectura..."
              autoFocus
              required
            />
          </div>

          {/* Duración en minutos */}
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label className="label" style={{ margin: 0 }}>Duración (minutos) *</label>
              <span className="badge sm accent">{minutes} min</span>
            </div>
            <input
              type="number"
              className="input"
              min={1}
              max={360}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              required
            />
            {/* Presets rápidos de minutos */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {PRESET_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn-ghost sm ${minutes === m ? 'active' : ''}`}
                  style={{
                    padding: '3px 10px',
                    fontSize: 12,
                    borderRadius: 8,
                    background: minutes === m ? 'var(--accent)' : 'var(--surface-2)',
                    color: minutes === m ? '#fff' : 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                  onClick={() => setMinutes(m)}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>

          {/* Icono de la sesión */}
          <div className="field">
            <label className="label">Icono</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {PRESET_ICONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => setIcon(em)}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    fontSize: 20,
                    background: icon === em ? 'var(--accent-soft)' : 'var(--surface-2)',
                    border: icon === em ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    transition: 'transform 0.15s ease',
                    transform: icon === em ? 'scale(1.1)' : 'none',
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Descripción opcional */}
          <div className="field">
            <label className="label">Descripción (opcional)</label>
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej. Enfoque profundo sin revisar el móvil"
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={Boolean(activeTimer)}
              style={{
                background: 'linear-gradient(135deg, #eab308, #ca8a04)',
                borderColor: '#eab308',
                color: '#000',
                fontWeight: 700,
              }}
            >
              <Play size={16} /> Iniciar temporizador
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
