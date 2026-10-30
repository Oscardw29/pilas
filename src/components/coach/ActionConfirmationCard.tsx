import React, { useState } from 'react';
import { Check, X, Plus, Pencil, Trash2 } from 'lucide-react';
import { describeCoachAction, type ParsedAction } from '@/lib/coachActions';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

/**
 * Tarjeta de confirmación de un cambio propuesto por el Coach IA (crear/editar hábitos, retos, etc.).
 * Los detalles salen de `describeCoachAction`: textos legibles con los mismos datos validados que se aplicarían.
 * Las propuestas de eliminar piden además una confirmación explícita antes de aplicarse.
 */
export const ActionConfirmationCard: React.FC<{
  action: ParsedAction;
  status: 'pending' | 'applied' | 'dismissed';
  onConfirm: () => void;
  onDismiss: () => void;
}> = ({ action, status, onConfirm, onDismiss }) => {
  const summary = describeCoachAction(action);
  const ToneIcon = summary.tone === 'delete' ? Trash2 : summary.tone === 'update' ? Pencil : Plus;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const accept = () => (summary.tone === 'delete' ? setConfirmDelete(true) : onConfirm());

  return (
    <div
      className={`action-card tone-${summary.tone} is-${status}`}
      role="group"
      aria-label={`Cambio propuesto: ${summary.title}`}
    >
      <div className="action-card-head">
        <span className="action-card-icon" aria-hidden="true">
          <ToneIcon size={14} />
        </span>
        <div className="action-card-heading">
          <span className="action-card-title">{summary.title}</span>
          <span className="action-card-subject">{summary.subject}</span>
        </div>
        {status !== 'pending' && (
          <span className="action-card-state">{status === 'applied' ? 'Aplicado' : 'Rechazado'}</span>
        )}
      </div>

      {summary.details.length > 0 && (
        <dl className="action-card-details">
          {summary.details.map((d) => (
            <div key={d.label} className="action-card-row">
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {status === 'pending' && (
        <div className="action-card-buttons">
          <button type="button" className="btn btn-ghost sm" onClick={onDismiss}>
            <X size={13} /> Rechazar
          </button>
          <button
            type="button"
            className={`btn sm ${summary.tone === 'delete' ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={accept}
          >
            <Check size={13} /> Aceptar
          </button>
        </div>
      )}

      {summary.tone === 'delete' && (
        <ConfirmModal
          isOpen={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onConfirm();
          }}
          title={`¿${summary.title}?`}
          message={`Se eliminará «${summary.subject}» de tu lista de hábitos. ¿Quieres continuar?`}
          confirmLabel="Sí, eliminar"
          confirmVariant="danger"
          zIndex={1500}
        />
      )}
    </div>
  );
};
