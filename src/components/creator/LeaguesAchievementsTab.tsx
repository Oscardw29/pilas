import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, CalendarCheck, Coins, Pencil, Plus, Settings2, Trash2, Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { adminCloseWeek, adminDeleteAchievement, adminEconomyVersions, adminSaveAchievement, getAchievementDefs } from '@/social/api';
import { METRIC_LABEL, RARITY } from '@/social/texts';
import type { AchievementDef, AchievementMetric, Rarity } from '@/social/types';
import { currentVersion, mergeEconomyParams, toFormText } from './economyModel';
import { PrizeTable } from './EconomyTab';

const METRICS = Object.keys(METRIC_LABEL) as AchievementMetric[];
const ID_RE = /^[a-z0-9_]{2,40}$/;

/** Lunes de la semana pasada (AAAA-MM-DD, hora local) */
function lastMonday(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isMonday = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00`).getDay() === 1;

const emptyDef = (sort: number): AchievementDef => ({
  id: '',
  name: '',
  description: '',
  icon: '🏅',
  rarity: 'common',
  metric: 'streak',
  threshold: 7,
  prize: 50,
  active: true,
  sort,
});

const AchievementModal: React.FC<{ def: AchievementDef; isNew: boolean; takenIds: Set<string>; onClose: () => void; onSaved: () => void }> = ({
  def,
  isNew,
  takenIds,
  onClose,
  onSaved,
}) => {
  const { showToast } = useToast();
  const [d, setD] = useState({ ...def, threshold: String(def.threshold), prize: String(def.prize), sort: String(def.sort) });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    const threshold = Number(d.threshold);
    const prize = Number(d.prize);
    const sort = Number(d.sort);
    const id = d.id.trim();
    const problem = isNew && !ID_RE.test(id)
      ? 'El identificador lleva de 2 a 40 letras minúsculas, números o «_».'
      : isNew && takenIds.has(id)
        ? 'Ya existe un logro con ese identificador.'
        : !d.name.trim() || d.name.length > 60
          ? 'El nombre debe tener entre 1 y 60 caracteres.'
          : d.description.length > 200
            ? 'La descripción admite hasta 200 caracteres.'
            : !d.icon.trim()
              ? 'Elige un icono.'
              : !(threshold > 0)
                ? 'La meta debe ser mayor que 0.'
                : d.prize.trim() === '' || !Number.isInteger(prize) || prize < 0 || prize > 10000
                  ? 'El premio debe ser un número entero entre 0 y 10 000.'
                  : !Number.isInteger(sort)
                    ? 'El orden debe ser un número entero.'
                    : null;
    if (problem) {
      showToast(problem, 'warning');
      return;
    }
    setBusy(true);
    try {
      await adminSaveAchievement(
        { id, name: d.name.trim(), description: d.description.trim(), icon: d.icon.trim(), rarity: d.rarity, metric: d.metric, threshold, prize, active: d.active, sort },
        isNew,
      );
      showToast(isNew ? 'Logro creado' : 'Logro guardado', 'success');
      onSaved();
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isNew ? 'Nuevo logro' : `Editar: ${def.name}`} preventBackdropClose>
      <form
        id="achievement-form"
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-row">
          <label className="field">
            <span className="label">Identificador</span>
            <input className="input" value={d.id} disabled={!isNew} maxLength={40} placeholder="racha_30" onChange={(e) => set('id', e.target.value.toLowerCase())} />
            <span className="hint">{isNew ? 'No se puede cambiar después' : 'Fijo'}</span>
          </label>
          <label className="field">
            <span className="label">Icono</span>
            <input className="input" value={d.icon} maxLength={16} onChange={(e) => set('icon', e.target.value)} style={{ fontSize: 20, maxWidth: 120 }} />
          </label>
        </div>
        <label className="field">
          <span className="label">Nombre</span>
          <input className="input" value={d.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">Descripción</span>
          <textarea className="textarea" rows={2} value={d.description} maxLength={200} onChange={(e) => set('description', e.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">
            <span className="label">Condición</span>
            <select className="select" value={d.metric} onChange={(e) => set('metric', e.target.value as AchievementMetric)}>
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Meta</span>
            <input className="input" type="number" min={0} step="any" value={d.threshold} onChange={(e) => set('threshold', e.target.value)} />
            <span className="hint">
              Se consigue al llegar a {d.threshold || '?'} {METRIC_LABEL[d.metric]}
            </span>
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span className="label">Rareza</span>
            <select className="select" value={d.rarity} onChange={(e) => set('rarity', e.target.value as Rarity)}>
              {(Object.keys(RARITY) as Rarity[]).map((r) => (
                <option key={r} value={r}>
                  {RARITY[r].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Premio (monedas)</span>
            <input className="input" type="number" min={0} max={10000} step={1} value={d.prize} onChange={(e) => set('prize', e.target.value)} />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span className="label">Orden</span>
            <input className="input" type="number" step={1} value={d.sort} onChange={(e) => set('sort', e.target.value)} />
          </label>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <label className="custom-switch">
              <input type="checkbox" checked={d.active} onChange={(e) => set('active', e.target.checked)} />
              <span className="custom-switch-track">
                <span className="custom-switch-thumb" />
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-1)' }}>{d.active ? 'Activo (se puede conseguir)' : 'Retirado'}</span>
            </label>
          </div>
        </div>
      </form>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" form="achievement-form" className="btn btn-primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
};

/** Ligas (premios y % que sube o baja, dentro de la economía), logros y cierre de semana para pruebas */
export const LeaguesAchievementsTab: React.FC<{ onEditLeagues: () => void }> = ({ onEditLeagues }) => {
  const { showToast } = useToast();
  const [defs, setDefs] = useState<AchievementDef[] | null>(null);
  const [prizes, setPrizes] = useState<{ text: Record<string, string>; up: number; down: number; size: number; version: number | null } | null>(null);
  const [editing, setEditing] = useState<{ def: AchievementDef; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<AchievementDef | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [week, setWeek] = useState(lastMonday());
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<Record<string, unknown> | null>(null);

  const loadDefs = useCallback(async () => {
    try {
      setDefs(await getAchievementDefs());
    } catch (err) {
      showToast((err as Error).message, 'error');
      setDefs((p) => p ?? []);
    }
  }, [showToast]);

  useEffect(() => {
    void loadDefs();
    adminEconomyVersions()
      .then((list) => {
        const cur = currentVersion(list);
        const p = mergeEconomyParams(cur?.params);
        setPrizes({ text: toFormText(p), up: p.leaguePromotePct, down: p.leagueDemotePct, size: p.leagueGroupSize, version: cur?.version ?? null });
      })
      .catch((err) => showToast((err as Error).message, 'error'));
  }, [loadDefs, showToast]);

  const takenIds = useMemo(() => new Set((defs ?? []).map((d) => d.id)), [defs]);
  const nextSort = Math.max(0, ...(defs ?? []).map((d) => d.sort)) + 10;

  const toggleActive = async (def: AchievementDef) => {
    setBusyId(def.id);
    try {
      await adminSaveAchievement({ ...def, active: !def.active }, false);
      showToast(def.active ? `«${def.name}» retirado: nadie más lo podrá conseguir` : `«${def.name}» activo de nuevo`, 'success');
      await loadDefs();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (def: AchievementDef) => {
    setBusyId(def.id);
    try {
      await adminDeleteAchievement(def.id);
      showToast(`«${def.name}» eliminado`, 'success');
      await loadDefs();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const closeWeek = async () => {
    setClosing(true);
    setCloseResult(null);
    try {
      const r = await adminCloseWeek(week);
      setCloseResult(r ?? {});
      showToast(r && r.closed === false ? 'Esa semana ya estaba cerrada' : 'Semana cerrada', r && r.closed === false ? 'info' : 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Premios de las ligas</h2>
            <p className="card-sub">
              Son parte de la economía: se editan en su borrador y rigen al publicarlo.
              {prizes && ` Vigente${prizes.version ? ` (v${prizes.version})` : ''}: sube el ${prizes.up} %, baja el ${prizes.down} %, grupos de ${prizes.size}.`}
            </p>
          </div>
          <button type="button" className="btn btn-secondary sm" onClick={onEditLeagues}>
            <Settings2 /> Editar en Economía
          </button>
        </div>
        {prizes ? <PrizeTable text={prizes.text} /> : <p className="muted">Cargando…</p>}
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Logros</h2>
            <p className="card-sub">Retirar un logro evita que alguien más lo consiga; quien ya lo tiene lo conserva.</p>
          </div>
          <button type="button" className="btn btn-primary sm" onClick={() => setEditing({ def: emptyDef(nextSort), isNew: true })}>
            <Plus /> Nuevo logro
          </button>
        </div>
        {defs === null ? (
          <p className="muted">Cargando los logros…</p>
        ) : defs.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Todavía no hay logros.
          </p>
        ) : (
          <div className="creator-table-wrap">
            <table className="creator-table">
              <thead>
                <tr>
                  <th scope="col">Logro</th>
                  <th scope="col">Condición</th>
                  <th scope="col">Rareza</th>
                  <th scope="col" className="num">
                    Premio
                  </th>
                  <th scope="col" className="num">
                    Orden
                  </th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className="creator-sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => (
                  <tr key={d.id} style={d.active ? undefined : { opacity: 0.6 }}>
                    <td className="wrap">
                      <div className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 20, lineHeight: 1.2 }} aria-hidden="true">
                          {d.icon}
                        </span>
                        <div>
                          <strong>{d.name}</strong>
                          <div className="card-sub">{d.description}</div>
                          <code className="card-sub">{d.id}</code>
                        </div>
                      </div>
                    </td>
                    <td>
                      {Number(d.threshold).toLocaleString('es')} {METRIC_LABEL[d.metric] ?? d.metric}
                    </td>
                    <td>
                      <span className="rarity" style={{ '--r': RARITY[d.rarity].color } as React.CSSProperties}>
                        {RARITY[d.rarity].label}
                      </span>
                    </td>
                    <td className="num">
                      <span className="preview-price">
                        <Coins size={13} aria-hidden="true" /> {d.prize.toLocaleString('es')}
                      </span>
                    </td>
                    <td className="num">{d.sort}</td>
                    <td>{d.active ? <span className="badge success">Activo</span> : <span className="badge">Retirado</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button type="button" className="icon-btn sm" aria-label={`Editar ${d.name}`} onClick={() => setEditing({ def: d, isNew: false })}>
                          <Pencil />
                        </button>
                        <button
                          type="button"
                          className="icon-btn sm"
                          aria-label={d.active ? `Retirar ${d.name}` : `Reactivar ${d.name}`}
                          title={d.active ? 'Retirar' : 'Reactivar'}
                          disabled={busyId === d.id}
                          onClick={() => void toggleActive(d)}
                        >
                          {d.active ? <Archive /> : <Undo2 />}
                        </button>
                        <button type="button" className="icon-btn sm danger" aria-label={`Eliminar ${d.name}`} disabled={busyId === d.id} onClick={() => setDeleting(d)}>
                          <Trash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">Forzar cierre de semana (solo pruebas)</h2>
            <p className="card-sub">
              Reparte los premios, mueve de liga y arma el podio de esa semana. Una semana solo se cierra una vez, aunque se repita; el cierre normal ocurre solo cada lunes.
            </p>
          </div>
        </div>
        <div className="search-row">
          <label className="field" style={{ flex: 1, minWidth: 180 }}>
            <span className="label">Lunes de la semana</span>
            <input className="input" type="date" value={week} onChange={(e) => setWeek(e.target.value)} aria-invalid={!isMonday(week)} />
            {!isMonday(week) && <span className="field-error">Elige un lunes</span>}
          </label>
          <button type="button" className="btn btn-danger" style={{ alignSelf: 'flex-end' }} disabled={!isMonday(week) || closing} onClick={() => setCloseOpen(true)}>
            <CalendarCheck /> {closing ? 'Cerrando…' : 'Cerrar semana'}
          </button>
        </div>
        {closeResult && (
          <div style={{ marginTop: 14 }}>
            <span className="label" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>
              Resultado
            </span>
            <pre className="json-pre">{JSON.stringify(closeResult, null, 2)}</pre>
          </div>
        )}
      </div>

      {editing && (
        <AchievementModal
          key={editing.isNew ? 'new' : editing.def.id}
          def={editing.def}
          isNew={editing.isNew}
          takenIds={takenIds}
          onClose={() => setEditing(null)}
          onSaved={() => void loadDefs()}
        />
      )}
      <ConfirmModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
        title={`¿Eliminar «${deleting?.name ?? ''}»?`}
        message="Las personas que ya lo consiguieron lo perderán (y desaparece de sus perfiles). Si solo quieres que nadie más lo consiga, usa «Retirar»."
        confirmText="Eliminar"
        danger
      />
      <ConfirmModal
        isOpen={closeOpen}
        onClose={() => setCloseOpen(false)}
        onConfirm={() => void closeWeek()}
        title="¿Cerrar la semana a la fuerza?"
        message={`Se cierra la semana del ${new Date(`${week}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}: se pagan los premios de liga, hay ascensos y descensos y se avisa a las personas. No se puede deshacer.`}
        confirmText="Cerrar semana"
        danger
      />
    </div>
  );
};
