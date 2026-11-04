import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import { playSound } from '@/lib/sound';
import { useModalBehavior } from './useModalBehavior';
import { useSheetDismiss } from './useSheetDismiss';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  danger?: boolean;
  confirmVariant?: 'danger' | 'warning' | 'primary';
  zIndex?: number;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  confirmLabel,
  cancelText = 'Cancelar',
  danger,
  confirmVariant,
  zIndex,
}) => {
  // Solo es "peligroso" si se indica explícitamente (antes era el valor por defecto)
  const isDanger = danger ?? confirmVariant === 'danger';
  const effectiveConfirmText = confirmLabel || confirmText || 'Confirmar';
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();

  const handleClose = () => {
    playSound.modalClose();
    onClose();
  };

  useEffect(() => {
    if (isOpen) playSound.modalOpen();
  }, [isOpen]);

  useModalBehavior(isOpen, dialogRef, handleClose);
  const { dismiss } = useSheetDismiss(dialogRef, isOpen, () => {
    playSound.dismiss();
    onClose();
  });

  if (!isOpen) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      style={{ zIndex: zIndex ?? 1300 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="modal confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
      >
        <div className="confirm-modal-head">
          <div className={`confirm-modal-icon ${isDanger ? 'danger' : ''}`} aria-hidden="true">
            {isDanger ? <Trash2 size={22} /> : <AlertTriangle size={22} />}
          </div>

          <div className="confirm-modal-text">
            <h3 id={titleId}>{title}</h3>
            <p id={messageId}>{message}</p>
          </div>

          <button type="button" className="icon-btn sm" onClick={handleClose} aria-label="Cerrar">
            <X size={15} />
          </button>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={handleClose}>
            {cancelText}
          </button>
          <button
            type="button"
            data-autofocus={isDanger ? undefined : true}
            className={`btn ${isDanger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {effectiveConfirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
