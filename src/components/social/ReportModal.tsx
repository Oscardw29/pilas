import React, { useEffect, useId, useState } from 'react';
import { Flag } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { report, SocialError } from '@/social/api';
import { refreshSocialStatus } from '@/social/runtime';
import { personName, REPORT_REASONS } from '@/social/texts';
import type { ReportRow } from '@/social/types';
import './community.css';

const DETAILS_MAX = 500;

/** Reportar a una persona (o una publicación suya). Lo revisa el creador desde su panel */
export const ReportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  targetUser: string;
  /** Alias (sin «@») y nombre de la persona: se muestra el alias o, si no tiene, el nombre */
  alias?: string | null;
  name?: string | null;
  postId?: string | null;
}> = ({ isOpen, onClose, targetUser, alias, name, postId }) => {
  const { showToast } = useToast();
  const [reason, setReason] = useState<ReportRow['reason']>(REPORT_REASONS[0].id);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const detailsId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setReason(REPORT_REASONS[0].id);
    setDetails('');
  }, [isOpen]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      await report(targetUser, reason, details.slice(0, DETAILS_MAX), postId);
      playSound.pop();
      showToast('Reporte enviado. Gracias por avisar: el equipo de ¡Pilas! lo revisará.', 'success');
      onClose();
    } catch (err) {
      if (err instanceof SocialError) {
        showToast(err.message, 'error');
        if (err.banned) void refreshSocialStatus();
      } else showToast('No se pudo enviar el reporte. Inténtalo de nuevo.', 'error');
      playSound.error();
    } finally {
      setSending(false);
    }
  };

  const who = alias || name?.trim() ? personName({ alias, display_name: name }) : 'esta persona';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={postId ? 'Reportar publicación' : `Reportar a ${who}`}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="muted" style={{ fontSize: 13.5 }}>
          {postId ? `Cuéntanos qué pasa con esta publicación de ${who}.` : `Cuéntanos qué pasa con ${who}.`} Nadie más verá quién lo reportó.
        </p>
        <div className="field">
          <span className="label" aria-hidden="true">
            Motivo
          </span>
          <CustomSelect<ReportRow['reason']>
            value={reason}
            onChange={setReason}
            options={REPORT_REASONS.map((r) => ({ value: r.id, label: r.label }))}
            ariaLabel="Motivo del reporte"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={detailsId}>
            Detalles (opcional)
          </label>
          <textarea
            id={detailsId}
            className="textarea"
            value={details}
            maxLength={DETAILS_MAX}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Añade lo que nos ayude a entenderlo"
            rows={4}
          />
          <span className={`char-count ${details.length > DETAILS_MAX - 40 ? 'is-near' : ''}`} aria-live="polite">
            {details.length}/{DETAILS_MAX}
          </span>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending}>
            <Flag aria-hidden="true" /> {sending ? 'Enviando…' : 'Enviar reporte'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/**
 * Moderación (solo el creador): pide el motivo de la acción y, para un veto, cuántos días dura (o «permanente»).
 * `onSubmit` hace la llamada; si falla, el diálogo se queda abierto.
 */
export const ReasonModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  withDays?: boolean;
  onSubmit: (reason: string, days: number | null) => Promise<void> | void;
}> = ({ isOpen, onClose, title, description, confirmLabel = 'Confirmar', danger, withDays, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const [permanent, setPermanent] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasonId = useId();
  const daysId = useId();

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setDays('7');
    setPermanent(false);
  }, [isOpen]);

  const nDays = Math.round(Number(days));
  const daysOk = !withDays || permanent || (Number.isFinite(nDays) && nDays >= 1 && nDays <= 3650);
  const valid = reason.trim().length >= 3 && daysOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSubmit(reason.trim(), withDays && !permanent ? nDays : null);
      onClose();
    } catch {
      // El error ya se mostró en un toast
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        {description && (
          <p className="muted" style={{ fontSize: 13.5 }}>
            {description}
          </p>
        )}
        <div className="field">
          <label className="label" htmlFor={reasonId}>
            Motivo
          </label>
          <textarea
            id={reasonId}
            className="textarea"
            value={reason}
            maxLength={300}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            placeholder="La persona lo verá en su aviso"
            required
          />
          <span className="hint">Mínimo 3 caracteres.</span>
        </div>
        {withDays && (
          <div className="field">
            <label className="label" htmlFor={daysId}>
              Duración (días)
            </label>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input
                id={daysId}
                className="input"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={days}
                disabled={permanent}
                onChange={(e) => setDays(e.target.value)}
                style={{ width: 120 }}
              />
              <label className="custom-switch">
                <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} />
                <span className="custom-switch-track">
                  <span className="custom-switch-thumb" />
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>Permanente</span>
              </label>
            </div>
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!valid || busy}>
            {busy ? 'Aplicando…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
};
