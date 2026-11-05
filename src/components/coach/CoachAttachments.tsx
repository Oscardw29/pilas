import React, { useCallback, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, X } from 'lucide-react';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import {
  ATTACHMENT_ACCEPT,
  AttachmentError,
  MAX_ATTACHMENTS,
  formatBytes,
  prepareAttachment,
  type CoachAttachment,
  type StoredAttachment,
} from '@/lib/coachAttachments';
import './coach.css';

/**
 * ADJUNTOS EN EL CHAT DEL COACH
 * Lo comparten la página del coach y el chat flotante: botón del clip, pegar una imagen (Ctrl+V), soltar archivos
 * encima del chat, la fila de lo que se va a enviar y los adjuntos dentro de cada mensaje.
 */

export function useAttachmentDraft() {
  const { toast } = useToast();
  const [items, setItems] = useState<CoachAttachment[]>([]);
  const [busy, setBusy] = useState(0);
  const countRef = useRef(0);
  countRef.current = items.length + busy;

  const addFiles = useCallback(
    async (list: FileList | File[] | null | undefined) => {
      const files = Array.from(list ?? []);
      if (!files.length) return;
      const room = MAX_ATTACHMENTS - countRef.current;
      if (room <= 0) {
        playSound.blocked();
        toast(`Puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje`, 'warning');
        return;
      }
      if (files.length > room) toast(`Solo se añadieron ${room}: el máximo es ${MAX_ATTACHMENTS} por mensaje`, 'warning');
      const take = files.slice(0, room);
      setBusy((n) => n + take.length);
      await Promise.all(
        take.map(async (file) => {
          try {
            const att = await prepareAttachment(file);
            setItems((prev) => [...prev, att]);
            playSound.pop();
          } catch (err) {
            toast(err instanceof AttachmentError ? err.message : 'No se pudo adjuntar ese archivo', 'warning');
          } finally {
            setBusy((n) => n - 1);
          }
        }),
      );
    },
    [toast],
  );

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  /** Pegar una captura o imagen desde el portapapeles */
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    },
    [addFiles],
  );

  /** Soltar archivos encima del chat */
  const [dragging, setDragging] = useState(false);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      setDragging(false);
      void addFiles(e.dataTransfer.files);
    },
  };

  return { items, busy: busy > 0, addFiles, remove, clear, onPaste, dropProps, dragging };
}

export const AttachButton: React.FC<{ onFiles: (files: FileList | null) => void; disabled?: boolean; className?: string }> = ({
  onFiles,
  disabled,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={`icon-btn coach-attach-btn ${className}`}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Adjuntar imagen o archivo"
        title="Adjuntar imagen o archivo (también puedes pegar o soltar)"
      >
        <Paperclip size={18} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
};

const FileTile: React.FC<{ a: StoredAttachment }> = ({ a }) =>
  a.kind === 'image' && a.thumb ? (
    <img className="coach-att-thumb" src={a.thumb} alt={a.name} loading="lazy" />
  ) : (
    <span className="coach-att-file" aria-hidden="true">
      <FileText size={16} />
      <span className="coach-att-ext">{a.kind === 'pdf' ? 'PDF' : (a.name.split('.').pop() ?? 'txt').slice(0, 4).toUpperCase()}</span>
    </span>
  );

/** Lo que se va a enviar con el próximo mensaje */
export const AttachmentDraftRow: React.FC<{ items: CoachAttachment[]; busy: boolean; onRemove: (id: string) => void }> = ({ items, busy, onRemove }) => {
  if (!items.length && !busy) return null;
  return (
    <ul className="coach-att-draft" aria-label="Archivos adjuntos">
      {items.map((a) => (
        <li key={a.id} className="coach-att-chip">
          <FileTile a={a} />
          <span className="coach-att-meta">
            <span className="coach-att-name truncate">{a.name}</span>
            <span className="coach-att-size">{formatBytes(a.size)}</span>
          </span>
          <button type="button" className="coach-att-remove" onClick={() => onRemove(a.id)} aria-label={`Quitar ${a.name}`} title="Quitar">
            <X size={13} />
          </button>
        </li>
      ))}
      {busy && (
        <li className="coach-att-chip is-loading" aria-live="polite">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          <span className="coach-att-meta">
            <span className="coach-att-name">Preparando…</span>
          </span>
        </li>
      )}
    </ul>
  );
};

/** Adjuntos dentro de un mensaje ya enviado */
export const MessageAttachments: React.FC<{ items?: StoredAttachment[] }> = ({ items }) => {
  if (!items?.length) return null;
  return (
    <ul className="coach-att-list" aria-label="Adjuntos">
      {items.map((a) => (
        <li key={a.id} className={`coach-att-item ${a.kind === 'image' && a.thumb ? 'is-image' : ''}`} title={`${a.name} · ${formatBytes(a.size)}`}>
          <FileTile a={a} />
          {!(a.kind === 'image' && a.thumb) && <span className="coach-att-name truncate">{a.name}</span>}
        </li>
      ))}
    </ul>
  );
};

export const DropHint: React.FC<{ show: boolean }> = ({ show }) =>
  show ? (
    <div className="coach-drop-hint" aria-hidden="true">
      <Paperclip size={22} /> Suelta aquí para adjuntar
    </div>
  ) : null;
