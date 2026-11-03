import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { playSound } from '@/lib/sound';
import { useToast } from './ToastContext';
import { useModalBehavior } from './useModalBehavior';
import { useSheetDismiss } from './useSheetDismiss';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  zIndex?: number;
  preventBackdropClose?: boolean;
}

/**
 * Diálogo base. En pantallas pequeñas se muestra como hoja inferior (bottom sheet, ver .modal en global.css)
 * que se cierra deslizándola hacia abajo o tocando fuera (también con `preventBackdropClose`, que solo aplica en
 * pantallas anchas).
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  wide,
  zIndex,
  preventBackdropClose = false,
}) => {
  const { toast } = useToast();
  const [shaking, setShaking] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();

  // Marcar como asentado para evitar parpadeo de animación modalIn al agitar
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => setIsSettled(true), 240);
      return () => clearTimeout(timer);
    }
    setIsSettled(false);
  }, [isOpen]);

  // Sonido suave al abrir el modal
  useEffect(() => {
    if (isOpen) playSound.modalOpen();
  }, [isOpen]);

  useEffect(() => () => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
  }, []);

  const handleClose = () => {
    playSound.modalClose();
    onClose();
  };

  /** Clic fuera del diálogo: sonido propio de «descartar», distinto del cierre con la X */
  const dismissFromBackdrop = () => {
    playSound.dismiss();
    onClose();
  };

  const triggerShake = () => {
    setShaking(true);
    playSound.blocked();
    toast('Para salir usa la X o el botón Cancelar.', 'warning');
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 380);
  };

  const requestClose = () => (preventBackdropClose ? triggerShake() : handleClose());

  useModalBehavior(isOpen, dialogRef, requestClose);
  const { dismiss } = useSheetDismiss(dialogRef, isOpen, dismissFromBackdrop);
  const isMobile = () => window.matchMedia('(max-width: 639.98px)').matches;

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      style={{ zIndex: zIndex ?? 1000 }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (preventBackdropClose && !isMobile()) triggerShake();
        else dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${wide ? 'wide' : ''} ${isSettled ? 'modal-settled' : ''} ${shaking ? 'shake-modal' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-grabber" aria-hidden="true" />
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn sm" onClick={handleClose} aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};
