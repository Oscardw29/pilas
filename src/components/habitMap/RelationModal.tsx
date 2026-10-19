import React, { useEffect, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import type { Habit, HabitRelation, RelationType } from '@/types';
import { EDGE_KINDS, RELATION_OPTIONS, RELATION_PHRASE, edgeKindOf } from './relationMeta';

export interface RelationDraft {
  fromId: string;
  toId: string;
  type: RelationType;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  habits: Habit[];
  relations: HabitRelation[];
  initial: Partial<RelationDraft>;
  onSave: (rel: Omit<HabitRelation, 'id'>) => void;
}

/** Muestra de línea igual a la del mapa, para que el tipo se reconozca después. */
export const EdgeSwatch: React.FC<{ type: RelationType }> = ({ type }) => {
  const meta = EDGE_KINDS[edgeKindOf(type)];
  return (
    <svg width="30" height="10" viewBox="0 0 30 10" aria-hidden="true" className="hm-swatch">
      <line x1="1" y1="5" x2="22" y2="5" strokeLinecap="round" strokeDasharray={meta.dash} style={{ stroke: meta.color, strokeWidth: 2.4 }} />
      <path d="M21,1 L29,5 L21,9 z" style={{ fill: meta.color }} />
    </svg>
  );
};

export const RelationModal: React.FC<Props> = ({ isOpen, onClose, habits, relations, initial, onSave }) => {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [type, setType] = useState<RelationType>('facilitates');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFromId(initial.fromId ?? '');
    setToId(initial.toId ?? '');
    setType(initial.type ?? 'facilitates');
    setNote('');
    setError(null);
  }, [isOpen, initial.fromId, initial.toId, initial.type]);

  const from = habits.find((h) => h.id === fromId);
  const to = habits.find((h) => h.id === toId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId) return setError('Elige los dos hábitos que quieres conectar.');
    if (fromId === toId) return setError('Un hábito no puede conectarse consigo mismo.');
    if (relations.some((r) => r.fromId === fromId && r.toId === toId && r.type === type)) {
      return setError('Esta conexión ya existe en tu mapa.');
    }
    onSave({ fromId, toId, type, ...(note.trim() ? { note: note.trim() } : {}) });
  };

  const habitOptions = (exclude: string) =>
    habits.filter((h) => h.id !== exclude).map((h) => ({ value: h.id, label: h.name, icon: h.icon }));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Conectar dos hábitos">
      <form className="form" onSubmit={submit}>
        <div className="hm-pair">
          <div className="field">
            <span className="label">Este hábito…</span>
            <CustomSelect value={fromId} onChange={(v) => { setFromId(v); setError(null); }} options={habitOptions(toId)} placeholder="Elige un hábito" searchable />
          </div>
          <button
            type="button"
            className="icon-btn sm hm-swap"
            onClick={() => { setFromId(toId); setToId(fromId); }}
            disabled={!fromId && !toId}
            aria-label="Intercambiar hábitos"
            title="Intercambiar"
          >
            <ArrowUpDown />
          </button>
          <div className="field">
            <span className="label">…se conecta con este</span>
            <CustomSelect value={toId} onChange={(v) => { setToId(v); setError(null); }} options={habitOptions(fromId)} placeholder="Elige otro hábito" searchable />
          </div>
        </div>

        <fieldset className="field hm-types">
          <legend className="label">¿Cómo se relacionan?</legend>
          {RELATION_OPTIONS.map((o) => (
            <label key={o.type} className={`hm-type${type === o.type ? ' active' : ''}`}>
              <input type="radio" name="relation-type" value={o.type} checked={type === o.type} onChange={() => { setType(o.type); setError(null); }} />
              <EdgeSwatch type={o.type} />
              <span className="grow">
                <span className="hm-type-title">{o.title}</span>
                <span className="hm-type-example">{o.example}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="hm-preview" aria-live="polite">
          {from && to ? (
            <>
              {RELATION_PHRASE[type].pre && `${RELATION_PHRASE[type].pre} `}
              <b>{from.icon} {from.name}</b> {RELATION_PHRASE[type].mid} <b>{to.icon} {to.name}</b>
            </>
          ) : (
            <span className="muted">Elige los dos hábitos para ver cómo se leerá la conexión.</span>
          )}
        </div>

        <div className="field">
          <span className="label">¿Por qué? (opcional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Si duermo temprano tengo energía para entrenar" maxLength={160} />
        </div>

        {error && <p className="small danger" role="alert">{error}</p>}

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Guardar conexión</button>
        </div>
      </form>
    </Modal>
  );
};
