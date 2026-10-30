import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Check, Coins, Minus, Save, Trash2, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { REWARD_ICONS } from '@/components/modals/RewardModal';
import { playSound } from '@/lib/sound';
import type { Reward } from '@/types';
import './rewardsBulk.css';

/**
 * EDITAR VARIAS RECOMPENSAS A LA VEZ (Tienda de recompensas)
 * Una fila por premio propio con su icono, nombre, descripción y costo. Los cambios se guardan juntos con un único
 * «Guardar cambios» (con las acciones individuales del store, una por premio cambiado). La selección múltiple permite
 * eliminar varios de golpe, siempre con confirmación. Los canjes pasados se conservan.
 */

const COST_MAX = 100000;
const NAME_MAX = 60;
const DESC_MAX = 160;

interface Draft {
  name: string;
  icon: string;
  /** Texto del campo (solo dígitos): las monedas son siempre enteras */
  cost: string;
  description: string;
}

const draftOf = (r: Reward): Draft => ({ name: r.name, icon: r.icon, cost: String(Math.round(r.cost)), description: r.description ?? '' });

const sameAs = (d: Draft, r: Reward) => {
  const base = draftOf(r);
  return d.name.trim() === base.name.trim() && d.icon === base.icon && d.cost === base.cost && d.description.trim() === base.description.trim();
};

const costOk = (cost: string) => {
  const n = Number(cost);
  return cost !== '' && Number.isInteger(n) && n >= 1 && n <= COST_MAX;
};

/** Casilla propia (sin el control nativo): marcada, sin marcar o «algunas» */
const BulkCheck: React.FC<{ checked: boolean | 'mixed'; onToggle: () => void; label: string }> = ({ checked, onToggle, label }) => (
  <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="rb-check" onClick={onToggle}>
    <span className="rb-check-box" aria-hidden="true">
      {checked === 'mixed' ? <Minus size={13} strokeWidth={3.2} /> : <Check size={13} strokeWidth={3.2} />}
    </span>
  </button>
);

/** Botón con el icono del premio que abre la rejilla de iconos */
const IconPicker: React.FC<{ value: string; onChange: (icon: string) => void; label: string }> = ({ value, onChange, label }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const icons = REWARD_ICONS.includes(value) ? REWARD_ICONS : [value, ...REWARD_ICONS];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    // El foco entra en el icono elegido
    wrapRef.current?.querySelector<HTMLButtonElement>('.rb-icon-opt[aria-pressed="true"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="rb-icon" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="rb-icon-btn"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {value}
      </button>
      {open && (
        <div id={popId} className="rb-icon-pop" role="group" aria-label="Elige un icono">
          {icons.map((em) => (
            <button
              key={em}
              type="button"
              className="rb-icon-opt"
              aria-pressed={em === value}
              onClick={() => {
                onChange(em);
                setOpen(false);
                btnRef.current?.focus();
              }}
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const RewardsBulkEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { rewards, updateReward, deleteReward } = useStore(
    useShallow((s) => ({ rewards: s.rewards, updateReward: s.updateReward, deleteReward: s.deleteReward })),
  );
  const { showToast } = useToast();
  const titleId = useId();

  /** Solo se guardan las filas tocadas; el resto se lee del store (si otro dispositivo cambia algo, se ve al momento) */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Lo que ya no existe (borrado aquí o en otro dispositivo) sale de la selección y de los borradores
  useEffect(() => {
    const ids = new Set(rewards.map((r) => r.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setDrafts((prev) => {
      const keys = Object.keys(prev).filter((id) => ids.has(id));
      return keys.length === Object.keys(prev).length ? prev : Object.fromEntries(keys.map((k) => [k, prev[k]]));
    });
  }, [rewards]);

  const rowOf = (r: Reward) => drafts[r.id] ?? draftOf(r);
  const changed = useMemo(() => rewards.filter((r) => drafts[r.id] && !sameAs(drafts[r.id], r)), [rewards, drafts]);
  const invalid = useMemo(
    () => changed.filter((r) => !drafts[r.id].name.trim() || !costOk(drafts[r.id].cost)),
    [changed, drafts],
  );

  const patch = (r: Reward, p: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] ?? draftOf(r)), ...p } }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked: boolean | 'mixed' = selected.size === 0 ? false : selected.size === rewards.length ? true : 'mixed';
  const toggleAll = () => setSelected(allChecked === true ? new Set() : new Set(rewards.map((r) => r.id)));

  const save = () => {
    if (!changed.length) {
      onClose();
      return;
    }
    if (invalid.length) {
      setShowErrors(true);
      showToast(
        invalid.length === 1
          ? 'Revisa la recompensa marcada: necesita un nombre y un costo entero de 1 a 100.000.'
          : `Revisa las ${invalid.length} recompensas marcadas: necesitan un nombre y un costo entero de 1 a 100.000.`,
        'warning',
      );
      playSound.error();
      return;
    }
    for (const r of changed) {
      const d = drafts[r.id];
      updateReward(r.id, { name: d.name.trim(), icon: d.icon, cost: Number(d.cost), description: d.description.trim() || undefined });
    }
    playSound.pop();
    showToast(changed.length === 1 ? 'Recompensa actualizada' : `${changed.length} recompensas actualizadas`, 'success');
    onClose();
  };

  const removeSelected = () => {
    const ids = [...selected];
    if (!ids.length) return;
    for (const id of ids) deleteReward(id);
    playSound.delete();
    showToast(ids.length === 1 ? 'Recompensa eliminada.' : `${ids.length} recompensas eliminadas.`, 'info');
    setSelected(new Set());
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))));
    if (ids.length >= rewards.length) onClose();
  };

  const cancel = () => {
    if (changed.length) setConfirmDiscard(true);
    else onClose();
  };

  const selectedNames = rewards.filter((r) => selected.has(r.id)).map((r) => `«${r.name}»`);
  const namesText =
    selectedNames.length <= 3 ? selectedNames.join(', ') : `${selectedNames.slice(0, 3).join(', ')} y ${selectedNames.length - 3} más`;

  return (
    <section className="card rb-editor" aria-labelledby={titleId}>
      <div className="card-head">
        <div>
          <h2 id={titleId} className="card-title">
            Editar varias recompensas
          </h2>
          <p className="card-sub">Cambia lo que quieras y guarda todo junto. Marca las casillas para eliminar varias a la vez.</p>
        </div>
      </div>

      <div className="rb-toolbar">
        <label className="rb-select-all">
          <BulkCheck checked={allChecked} onToggle={toggleAll} label="Seleccionar todas las recompensas" />
          {/* La etiqueta activa la casilla al tocar el texto */}
          <span aria-hidden="true">
            {selected.size ? `${selected.size} ${selected.size === 1 ? 'seleccionada' : 'seleccionadas'}` : 'Seleccionar todas'}
          </span>
        </label>
        <button type="button" className="btn btn-ghost sm danger" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
          <Trash2 size={14} aria-hidden="true" /> Eliminar{selected.size ? ` (${selected.size})` : ''}
        </button>
      </div>

      <div className="rb-cols" aria-hidden="true">
        <span />
        <span>Icono</span>
        <span>Nombre</span>
        <span>Descripción (opcional)</span>
        <span>Costo</span>
      </div>

      <ul className="rb-list">
        {rewards.map((r) => {
          const d = rowOf(r);
          const dirty = Boolean(drafts[r.id]) && !sameAs(drafts[r.id], r);
          const nameBad = showErrors && dirty && !d.name.trim();
          const costBad = showErrors && dirty && !costOk(d.cost);
          const label = d.name.trim() || r.name;
          return (
            <li key={r.id} className={`rb-row${dirty ? ' is-dirty' : ''}${selected.has(r.id) ? ' is-selected' : ''}`}>
              <div className="rb-sel">
                <BulkCheck checked={selected.has(r.id)} onToggle={() => toggle(r.id)} label={`Seleccionar «${label}»`} />
              </div>
              <div className="rb-icon-cell">
                <IconPicker value={d.icon} onChange={(icon) => patch(r, { icon })} label={`Icono de «${label}»: ${d.icon}. Cambiar`} />
              </div>
              <input
                className="input rb-name"
                value={d.name}
                maxLength={NAME_MAX}
                onChange={(e) => patch(r, { name: e.target.value })}
                aria-label={`Nombre de «${r.name}»`}
                aria-invalid={nameBad || undefined}
                placeholder="Nombre del premio"
              />
              <input
                className="input rb-desc"
                value={d.description}
                maxLength={DESC_MAX}
                onChange={(e) => patch(r, { description: e.target.value })}
                aria-label={`Descripción de «${label}»`}
                placeholder="Texto de la tarjeta"
              />
              <div className="rb-cost">
                <Coins size={15} aria-hidden="true" />
                <input
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={d.cost}
                  onChange={(e) => patch(r, { cost: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  aria-label={`Costo de «${label}» en puntos`}
                  aria-invalid={costBad || undefined}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="modal-foot rb-foot">
        <span className="rb-status" role="status" aria-live="polite">
          {changed.length
            ? `${changed.length} ${changed.length === 1 ? 'recompensa con cambios' : 'recompensas con cambios'} sin guardar`
            : 'Sin cambios'}
        </span>
        <button type="button" className="btn btn-ghost" onClick={cancel}>
          <X size={15} aria-hidden="true" /> Cancelar
        </button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={!changed.length}>
          <Save size={15} aria-hidden="true" /> Guardar cambios
        </button>
      </div>

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={removeSelected}
        title={selected.size === 1 ? '¿Eliminar 1 recompensa?' : `¿Eliminar ${selected.size} recompensas?`}
        message={`Se quitarán de tu catálogo: ${namesText}. Los canjes pasados se conservarán.`}
        confirmLabel="Eliminar"
        danger
      />
      <ConfirmModal
        isOpen={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={onClose}
        title="¿Descartar los cambios?"
        message="Hay cambios sin guardar en tus recompensas. Si sales ahora, se pierden."
        confirmLabel="Descartar"
        cancelText="Seguir editando"
        confirmVariant="warning"
      />
    </section>
  );
};
