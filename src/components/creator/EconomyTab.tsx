import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RotateCcw, Rocket, Save, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { CustomDatePicker } from '@/components/ui/CustomDatePicker';
import { CustomTimePicker } from '@/components/ui/CustomTimePicker';
import { useToast } from '@/components/ui/ToastContext';
import { todayKey, toKey } from '@/lib/dates';
import { applyEconomyVersions } from '@/lib/economyRules';
import {
  adminClosures, adminDeleteEconomyDraft, adminEconomyVersions, adminPublishEconomy, adminRevertEconomy, adminSaveEconomyDraft,
  getEconomyVersions,
} from '@/social/api';
import { LEAGUES } from '@/social/texts';
import type { EconomyVersion } from '@/social/types';
import {
  FIELD_GROUPS, LEAGUE_SLUGS, PRIZE_PLACES, currentVersion, extraKeys, fromFormText, mergeEconomyParams, prizeKey, toFormText,
  type FieldGroup,
} from './economyModel';
import { compareEconomies } from './simulation';
import { useCreatorTrash } from './creatorTrash';

type Closure = Awaited<ReturnType<typeof adminClosures>>[number];

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
/** Monedas, XP y personas: siempre enteros */
const fmtNum = (n: number) => Math.round(n).toLocaleString('es');

/** Fecha y hora locales de ahora, en el formato de los selectores propios («2026-10-29» y «14:05») */
const localNow = () => {
  const d = new Date();
  return { date: toKey(d), time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
};

/** Tabla de premios de las ligas (5 ligas × 4 puestos). La usa también la pestaña de ligas en modo lectura */
export const PrizeTable: React.FC<{
  text: Record<string, string>;
  errors?: Record<string, string>;
  changed?: Set<string>;
  onChange?: (key: string, value: string) => void;
}> = ({ text, errors = {}, changed, onChange }) => (
  <div className="creator-table-wrap">
    <table className="creator-table">
      <caption className="creator-sr-only">Premios en monedas por liga y puesto</caption>
      <thead>
        <tr>
          <th scope="col">Liga</th>
          {PRIZE_PLACES.map((p) => (
            <th key={p} scope="col" className="num">
              {p}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {LEAGUE_SLUGS.map((slug) => {
          const league = LEAGUES.find((l) => l.slug === slug)!;
          return (
            <tr key={slug}>
              <th scope="row">
                {league.icon} {league.name}
              </th>
              {PRIZE_PLACES.map((place, i) => {
                const key = prizeKey(slug, i);
                return (
                  <td key={key} className="num">
                    {onChange ? (
                      <input
                        className={`prize-input ${errors[key] ? 'invalid' : ''}`}
                        style={changed?.has(key) ? { borderColor: 'var(--accent)' } : undefined}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={text[key] ?? ''}
                        aria-label={`${league.name}, ${place} puesto`}
                        aria-invalid={Boolean(errors[key])}
                        title={errors[key]}
                        onChange={(e) => onChange(key, e.target.value)}
                      />
                    ) : (
                      fmtNum(Number(text[key] ?? 0))
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const FieldsGroup: React.FC<{
  group: FieldGroup;
  text: Record<string, string>;
  errors: Record<string, string>;
  changed: Set<string>;
  onChange: (key: string, value: string) => void;
  children?: React.ReactNode;
}> = ({ group, text, errors, changed, onChange, children }) => (
  <fieldset className="eco-group" id={`eco-${group.id}`} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <legend className="creator-section-title">{group.title}</legend>
    {group.sub && <p className="card-sub">{group.sub}</p>}
    <div className="eco-fields">
      {group.fields.map((f) => (
        <label key={f.key} className="field">
          <span className="label">
            {f.label}
            {changed.has(f.key) && <span className="badge accent" style={{ marginLeft: 6 }}>cambia</span>}
          </span>
          {/* Texto con teclado numérico (sin las flechas del campo numérico del sistema); admite «1,5» */}
          <input
            className={`input ${errors[f.key] ? 'invalid' : ''}`}
            type="text"
            inputMode={f.integer ? 'numeric' : 'decimal'}
            autoComplete="off"
            value={text[f.key] ?? ''}
            aria-invalid={Boolean(errors[f.key])}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
          {errors[f.key] ? <span className="field-error">{errors[f.key]}</span> : f.hint && <span className="hint">{f.hint}</span>}
        </label>
      ))}
    </div>
    {children}
  </fieldset>
);

/**
 * Economía: editar un borrador de los parámetros, simularlo contra la versión vigente, publicarlo con fecha y revertir.
 * Publicar nunca reescribe el pasado: cada día se calcula con la versión que regía ese día.
 */
export const EconomyTab: React.FC<{ focus?: string | null; onFocused?: () => void }> = ({ focus, onFocused }) => {
  const { showToast } = useToast();
  const [versions, setVersions] = useState<EconomyVersion[] | null>(null);
  const [closures, setClosures] = useState<Closure[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(localNow);
  const [revertTarget, setRevertTarget] = useState<EconomyVersion | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingLoad, setPendingLoad] = useState<{ v: EconomyVersion | null; asDraft: boolean } | null>(null);

  const current = useMemo(() => (versions ? currentVersion(versions) : null), [versions]);
  const base = useMemo(() => mergeEconomyParams(current?.params), [current]);
  const baseText = useMemo(() => toFormText(base), [base]);

  const loadInto = useCallback((v: EconomyVersion | null, asDraft: boolean) => {
    setText(toFormText(mergeEconomyParams(v?.params)));
    setExtra(extraKeys(v?.params));
    setNote(asDraft ? (v?.note ?? '') : '');
    setEditing(asDraft && v ? v.version : null);
    setDirty(false);
  }, []);

  const reload = useCallback(
    async (reset: boolean) => {
      try {
        const list = await adminEconomyVersions();
        setVersions(list);
        if (reset) {
          // Se retoma el último borrador; si no hay, se parte de la versión vigente
          const draft = list.filter((v) => v.status === 'draft').sort((a, b) => b.version - a.version)[0];
          if (draft) loadInto(draft, true);
          else loadInto(currentVersion(list), false);
        }
      } catch (err) {
        showToast((err as Error).message, 'error');
        setVersions((prev) => prev ?? []);
      }
      adminClosures()
        .then(setClosures)
        .catch(() => setClosures([]));
    },
    [loadInto, showToast],
  );

  useEffect(() => {
    void reload(true);
  }, [reload]);

  // Llegar desde «Ligas y logros»: bajar a la sección de ligas
  useEffect(() => {
    if (!focus || !versions) return;
    const t = setTimeout(() => {
      document.getElementById(`eco-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onFocused?.();
    }, 60);
    return () => clearTimeout(t);
  }, [focus, versions, onFocused]);

  const { params, errors } = useMemo(() => fromFormText(text, extra), [text, extra]);
  const draftFull = useMemo(() => mergeEconomyParams(params), [params]);
  const rows = useMemo(() => compareEconomies(base, draftFull), [base, draftFull]);
  const changed = useMemo(() => new Set(Object.keys(text).filter((k) => text[k].trim() !== baseText[k])), [text, baseText]);
  const hasErrors = Object.keys(errors).length > 0;

  const onChange = (key: string, value: string) => {
    setText((t) => ({ ...t, [key]: value }));
    setDirty(true);
  };

  const askLoad = (v: EconomyVersion | null, asDraft: boolean) => (dirty ? setPendingLoad({ v, asDraft }) : loadInto(v, asDraft));

  /** Guarda el borrador (nuevo o el que se está editando) y devuelve su versión */
  const saveDraft = async (): Promise<number | null> => {
    if (hasErrors) {
      showToast('Hay valores no válidos: revisa los campos en rojo.', 'warning');
      return null;
    }
    const saved = await adminSaveEconomyDraft(params, note.trim().slice(0, 300), editing ?? undefined);
    setEditing(saved.version);
    setDirty(false);
    return saved.version;
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const v = await saveDraft();
      if (v) {
        showToast(`Borrador v${v} guardado`, 'success');
        await reload(false);
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Vuelve a aplicar en este dispositivo las versiones publicadas (precios y topes de hoy) */
  const refreshAppEconomy = async () => {
    try {
      const list = await getEconomyVersions();
      applyEconomyVersions(
        list.map((v) => ({ from: toKey(new Date(v.from)), params: v.params })),
        todayKey(),
      );
    } catch {
      /* se aplica en el próximo arranque */
    }
  };

  const onPublish = async () => {
    // «AAAA-MM-DDTHH:mm» sin zona se lee en la hora de este dispositivo
    const when = new Date(`${effectiveFrom.date}T${effectiveFrom.time || '00:00'}`);
    if (!effectiveFrom.date || Number.isNaN(when.getTime())) {
      showToast('Elige una fecha válida.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const v = dirty || editing == null ? await saveDraft() : editing;
      if (!v) return;
      await adminPublishEconomy(v, when.toISOString());
      setPublishOpen(false);
      showToast(when.getTime() > Date.now() + 60000 ? `Versión ${v} publicada: rige desde el ${fmtDate(when.toISOString())}` : `Versión ${v} publicada y vigente`, 'success');
      await refreshAppEconomy();
      await reload(true);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDraft = async () => {
    if (editing == null) return;
    setBusy(true);
    try {
      const draft = versions?.find((v) => v.version === editing);
      await adminDeleteEconomyDraft(editing);
      if (draft) useCreatorTrash.getState().add({ kind: 'economyDraft', version: draft.version, params: draft.params, note: draft.note ?? null });
      showToast(`Borrador v${editing} movido a la papelera`, 'success', 'Tienes 24 h para restaurarlo desde «Papelera».');
      await reload(true);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onRevert = async (v: EconomyVersion) => {
    setBusy(true);
    try {
      const nv = await adminRevertEconomy(v.version);
      showToast(`Se publicó la versión ${nv} con los valores de la ${v.version}`, 'success');
      await refreshAppEconomy();
      await reload(!dirty);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (versions === null) return <p className="muted">Cargando la economía…</p>;

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const groupOrder: Record<string, number> = { Ejemplos: 0, Topes: 1, Precios: 2, Ligas: 3 };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">{editing != null ? `Borrador v${editing}` : 'Nuevo borrador'}</h2>
            <p className="card-sub">
              Base: versión vigente {current ? `v${current.version} (desde ${fmtDate(current.effective_from)})` : '(valores por defecto)'}.{' '}
              {changed.size ? `${changed.size} ${changed.size === 1 ? 'valor cambia' : 'valores cambian'}.` : 'Sin cambios todavía.'}
            </p>
          </div>
          {(editing != null || dirty) && (
            <button type="button" className="btn btn-ghost sm" onClick={() => askLoad(current, false)} disabled={busy}>
              <Undo2 /> Partir de la vigente
            </button>
          )}
        </div>

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          {FIELD_GROUPS.map((g) => (
            <FieldsGroup key={g.id} group={g} text={text} errors={errors} changed={changed} onChange={onChange}>
              {g.id === 'leagues' && (
                <>
                  <span className="label" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
                    Premios en monedas por puesto
                  </span>
                  <PrizeTable text={text} errors={errors} changed={changed} onChange={onChange} />
                </>
              )}
            </FieldsGroup>
          ))}

          <label className="field">
            <span className="label">Nota del cambio</span>
            <input className="input" value={note} maxLength={300} placeholder="Ej.: bajar el tope de monedas por inflación" onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }} />
          </label>

          <div className="eco-actions">
            <button type="submit" className="btn btn-secondary" disabled={busy || hasErrors}>
              <Save /> Guardar borrador
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || hasErrors}
              onClick={() => {
                setEffectiveFrom(localNow());
                setPublishOpen(true);
              }}
            >
              <Rocket /> Publicar
            </button>
            {editing != null && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDeleteOpen(true)} style={{ color: 'var(--danger)' }}>
                <Trash2 /> Eliminar borrador
              </button>
            )}
            {dirty && <span className="badge warning">Cambios sin guardar</span>}
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Simulación</h2>
            <p className="card-sub">
              Los ejemplos del documento de reglas, los precios y el reparto de las ligas con la versión vigente y con este borrador. Todo en
              números enteros.
            </p>
          </div>
        </div>
        <div className="creator-table-wrap">
          <table className="creator-table">
            <thead>
              <tr>
                <th scope="col">Caso</th>
                <th scope="col">Qué mide</th>
                <th scope="col" className="num">
                  Vigente
                </th>
                <th scope="col" className="num">
                  Borrador
                </th>
                <th scope="col" className="num">
                  Diferencia
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => groupOrder[a.group] - groupOrder[b.group])
                .map((r) => {
                  const diff = Math.round(r.after - r.before);
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.label}</strong>
                        {r.detail && <div className="card-sub">{r.detail}</div>}
                      </td>
                      <td>{r.unit === 'XP' ? 'XP' : r.unit === 'personas' ? 'Personas' : r.group === 'Precios' ? 'Precio' : 'Monedas'}</td>
                      <td className="num">{fmtNum(r.before)}</td>
                      <td className="num">{fmtNum(r.after)}</td>
                      <td className={`num ${diff > 0 ? 'diff-up' : diff < 0 ? 'diff-down' : 'muted'}`}>
                        {diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${fmtNum(diff)}`}
                        {diff !== 0 && r.before > 0 && <span className="card-sub"> ({diff > 0 ? '+' : ''}{Math.round((diff / r.before) * 100)} %)</span>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">
              <History size={16} style={{ verticalAlign: '-3px' }} aria-hidden="true" /> Historial de versiones
            </h2>
            <p className="card-sub">Revertir publica de nuevo, desde ahora, los valores de esa versión (como una versión nueva).</p>
          </div>
        </div>
        <ul className="history-list">
          {sorted.map((v) => {
            const isCurrent = current?.version === v.version;
            const future = v.status !== 'draft' && v.effective_from && Date.parse(v.effective_from) > Date.now();
            return (
              <li key={v.version} className={`history-item ${isCurrent ? 'is-current' : ''}`}>
                <div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <strong>v{v.version}</strong>
                    {v.status === 'draft' ? <span className="badge warning">Borrador</span> : <span className="badge success">Publicada</span>}
                    {isCurrent && <span className="badge accent">Vigente</span>}
                    {future && <span className="badge info">Programada</span>}
                    {editing === v.version && <span className="badge">Editando</span>}
                  </div>
                  <span className="card-sub">
                    {v.status === 'draft' ? `Creada ${fmtDate(v.created_at)}` : `Rige desde ${fmtDate(v.effective_from)}`}
                    {v.note ? ` · ${v.note}` : ''}
                  </span>
                </div>
                {v.status === 'draft' ? (
                  editing !== v.version && (
                    <button type="button" className="btn btn-secondary sm" onClick={() => askLoad(v, true)} disabled={busy}>
                      Editar
                    </button>
                  )
                ) : (
                  !isCurrent && (
                    <button type="button" className="btn btn-ghost sm" onClick={() => setRevertTarget(v)} disabled={busy}>
                      <RotateCcw /> Revertir a esta versión
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Cierres semanales</h2>
            <p className="card-sub">Monedas ganadas frente a gastadas cada semana. Si la razón sube mucho de 1, hay inflación: ajusta topes o premios.</p>
          </div>
        </div>
        {closures === null ? (
          <p className="muted">Cargando…</p>
        ) : closures.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Todavía no se ha cerrado ninguna semana.
          </p>
        ) : (
          <div className="creator-table-wrap">
            <table className="creator-table">
              <thead>
                <tr>
                  <th scope="col">Semana</th>
                  <th scope="col" className="num">
                    En liga
                  </th>
                  <th scope="col" className="num">
                    Premios
                  </th>
                  <th scope="col" className="num">
                    Ganadas
                  </th>
                  <th scope="col" className="num">
                    Gastadas
                  </th>
                  <th scope="col" className="num">
                    Razón
                  </th>
                </tr>
              </thead>
              <tbody>
                {closures.map((c) => {
                  const s = c.summary ?? {};
                  const earned = Number(s.earned ?? 0);
                  const spent = Number(s.spent ?? 0);
                  const ratio = spent > 0 ? earned / spent : null;
                  return (
                    <tr key={c.week_start}>
                      <td>
                        {new Date(`${c.week_start}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {c.forced && <span className="badge warning" style={{ marginLeft: 6 }}>Forzado</span>}
                      </td>
                      <td className="num">{fmtNum(Number(s.ranked ?? 0))}</td>
                      <td className="num">{fmtNum(Number(s.prizes ?? 0))}</td>
                      <td className="num">{fmtNum(earned)}</td>
                      <td className="num">{fmtNum(spent)}</td>
                      <td className={`num ${ratio != null && ratio > 1.5 ? 'diff-down' : ''}`}>{ratio == null ? '—' : ratio.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={publishOpen} onClose={() => !busy && setPublishOpen(false)} title="Publicar la economía">
        <div className="form">
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {dirty || editing == null ? 'Se guarda el borrador y se publica. ' : `Se publica el borrador v${editing}. `}
            Cada día se calcula con la versión que regía ese día: <strong>los días anteriores conservan sus valores</strong>. Hasta la fecha elegida sigue rigiendo la versión
            actual.
          </p>
          <div className="field">
            <span className="label">Rige desde</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <CustomDatePicker value={effectiveFrom.date} onChange={(date) => setEffectiveFrom((f) => ({ ...f, date }))} />
              </div>
              <div style={{ flex: '1 1 120px', minWidth: 0 }}>
                <CustomTimePicker value={effectiveFrom.time} onChange={(time) => setEffectiveFrom((f) => ({ ...f, time }))} align="right" />
              </div>
            </div>
            <span className="hint">Por defecto, ahora. Hora de este dispositivo.</span>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={() => setPublishOpen(false)} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onPublish()} disabled={busy}>
            <Rocket /> {busy ? 'Publicando…' : 'Publicar'}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(revertTarget)}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => revertTarget && void onRevert(revertTarget)}
        title={`¿Revertir a la versión ${revertTarget?.version ?? ''}?`}
        message="Se publica desde ahora una versión nueva con esos valores. Los días anteriores conservan los suyos."
        confirmText="Revertir"
      />
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void onDeleteDraft()}
        title={`¿Eliminar el borrador v${editing ?? ''}?`}
        message="Va a la papelera: durante 24 h puedes restaurarlo con sus valores guardados. La versión vigente no cambia."
        confirmText="Eliminar"
        danger
      />
      <ConfirmModal
        isOpen={Boolean(pendingLoad)}
        onClose={() => setPendingLoad(null)}
        onConfirm={() => pendingLoad && loadInto(pendingLoad.v, pendingLoad.asDraft)}
        title="Tienes cambios sin guardar"
        message="Si sigues, se descartan los cambios de este formulario."
        confirmText="Descartar y seguir"
        danger
      />
    </div>
  );
};
