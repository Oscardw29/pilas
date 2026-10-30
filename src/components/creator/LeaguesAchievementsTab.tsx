import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, Minus, Plus, RotateCcw, Save, Settings2, Sparkles, Trash2, UserCheck, UserMinus } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { CustomDatePicker } from '@/components/ui/CustomDatePicker';
import { useToast } from '@/components/ui/ToastContext';
import { triggerAchievementCelebration } from '@/components/ui/AchievementUnlockOverlay';
import {
  adminCloseWeek, adminDeleteAchievement, adminEconomyVersions, adminSaveAchievement, adminSetMyAchievement, getAchievementDefs,
  getUserAchievements,
} from '@/social/api';
import { myUserId } from '@/social/runtime';
import { METRIC_LABEL, RARITY } from '@/social/texts';
import type { AchievementDef, AchievementMetric, Rarity } from '@/social/types';
import { currentVersion, mergeEconomyParams, toFormText } from './economyModel';
import { PrizeTable } from './EconomyTab';
import './achievementsTab.css';

const METRICS = Object.keys(METRIC_LABEL) as AchievementMetric[];
const RARITIES = Object.keys(RARITY) as Rarity[];
const ID_RE = /^[a-z0-9_]{2,40}$/;

const METRIC_OPTIONS = METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }));
const RARITY_OPTIONS = RARITIES.map((r) => ({ value: r, label: RARITY[r].label, color: RARITY[r].color }));

/** Lunes de la semana pasada (AAAA-MM-DD, hora local) */
function lastMonday(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isMonday = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T12:00:00`).getDay() === 1;

/* ---------------- Filas editables ---------------- */

/** Un logro tal como se edita en la tabla (los números como texto para poder escribirlos libremente) */
interface Row {
  /** Id del logro, o «nuevo-…» mientras no se guarda */
  key: string;
  isNew: boolean;
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  metric: AchievementMetric;
  threshold: string;
  prize: string;
  sort: string;
  active: boolean;
}

type Field = Exclude<keyof Row, 'key' | 'isNew'>;
const FIELDS: Field[] = ['id', 'name', 'description', 'icon', 'rarity', 'metric', 'threshold', 'prize', 'sort', 'active'];

const toRow = (d: AchievementDef): Row => ({
  key: d.id,
  isNew: false,
  id: d.id,
  name: d.name,
  description: d.description ?? '',
  icon: d.icon,
  rarity: d.rarity,
  metric: d.metric,
  threshold: String(d.threshold),
  prize: String(d.prize),
  sort: String(d.sort),
  active: d.active,
});

let newSeq = 0;
const newRow = (sort: number): Row => ({
  key: `nuevo-${Date.now().toString(36)}-${++newSeq}`,
  isNew: true,
  id: '',
  name: '',
  description: '',
  icon: '🏅',
  rarity: 'common',
  metric: 'streak',
  threshold: '7',
  prize: '50',
  sort: String(sort),
  active: true,
});

/** Campos que cambiaron respecto a lo guardado (un logro nuevo cuenta como cambiado entero) */
function changedFields(r: Row, saved: AchievementDef | undefined): Set<Field> {
  if (r.isNew || !saved) return new Set(FIELDS);
  const base = toRow(saved);
  return new Set(FIELDS.filter((f) => String(r[f]).trim() !== String(base[f]).trim()));
}

/** Problema de una fila (o null si se puede guardar) */
function rowProblem(r: Row, takenIds: Set<string>): string | null {
  const threshold = Number(r.threshold.replace(',', '.'));
  const prize = Number(r.prize);
  const sort = Number(r.sort);
  const id = r.id.trim();
  if (r.isNew && !ID_RE.test(id)) return 'El identificador lleva de 2 a 40 letras minúsculas, números o «_».';
  if (r.isNew && takenIds.has(id)) return 'Ya existe un logro con ese identificador.';
  if (!r.name.trim() || r.name.trim().length > 60) return 'El nombre debe tener entre 1 y 60 caracteres.';
  if (r.description.length > 200) return 'La descripción admite hasta 200 caracteres.';
  if (!r.icon.trim()) return 'Elige un icono.';
  if (!(threshold > 0)) return 'La meta debe ser mayor que 0.';
  if (r.prize.trim() === '' || !Number.isInteger(prize) || prize < 0 || prize > 10000) return 'El premio debe ser un número entero entre 0 y 10 000.';
  if (r.sort.trim() === '' || !Number.isInteger(sort)) return 'El orden debe ser un número entero.';
  return null;
}

const toDef = (r: Row): AchievementDef => ({
  id: r.id.trim(),
  name: r.name.trim(),
  description: r.description.trim(),
  icon: r.icon.trim(),
  rarity: r.rarity,
  metric: r.metric,
  threshold: Number(r.threshold.replace(',', '.')),
  prize: Math.round(Number(r.prize)),
  active: r.active,
  sort: Math.round(Number(r.sort)),
});

/** Casilla de selección propia (sin checkbox nativo) */
const Check3: React.FC<{ checked: boolean | 'mixed'; onChange: () => void; label: string; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    className={`lat-check ${checked ? 'is-on' : ''}`}
    onClick={onChange}
    disabled={disabled}
  >
    {checked === 'mixed' ? <Minus aria-hidden="true" /> : checked ? <Check aria-hidden="true" /> : null}
  </button>
);

/** Interruptor propio (.custom-switch) */
const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; text: string }> = ({ checked, onChange, label, text }) => (
  <label className="custom-switch lat-switch">
    <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    <span className="custom-switch-track">
      <span className="custom-switch-thumb" />
    </span>
    <span className="lat-switch-text">{text}</span>
  </label>
);

interface RowProps {
  /** Para llevar la vista a la fila (p. ej. al crear un logro) */
  anchorId: string;
  row: Row;
  changed: Set<Field>;
  error?: string;
  selected: boolean;
  owned: boolean;
  busy: boolean;
  /** Se está guardando la tabla: los campos no se pueden tocar (lo escrito ahora se perdería al recargar) */
  locked: boolean;
  onChange: (patch: Partial<Row>) => void;
  onSelect: () => void;
  onPreview: () => void;
  onMine: (on: boolean) => void;
  onDelete: () => void;
}

const AchievementRow: React.FC<RowProps> = ({ anchorId, row, changed, error, selected, owned, busy, locked, onChange, onSelect, onPreview, onMine, onDelete }) => {
  const c = (f: Field) => (changed.has(f) && !row.isNew ? 'is-changed' : '');
  const label = row.name.trim() || (row.isNew ? 'logro nuevo' : row.id);
  const dirty = row.isNew || changed.size > 0;
  return (
    <li
      id={anchorId}
      className={`lat-row ${dirty ? 'is-dirty' : ''} ${selected ? 'is-selected' : ''} ${row.active ? '' : 'is-off'} ${error ? 'has-error' : ''}`}
      style={{ '--r': RARITY[row.rarity].color, '--r-text': RARITY[row.rarity].text } as React.CSSProperties}
    >
      <div className="lat-lead">
        <Check3 checked={selected} onChange={onSelect} label={`Seleccionar ${label}`} disabled={locked} />
        <label className={`lat-icon ${c('icon')}`}>
          <span className="creator-sr-only">Icono de {label}</span>
          <input className="input" value={row.icon} maxLength={16} onChange={(e) => onChange({ icon: e.target.value })} disabled={locked} />
        </label>
      </div>

      <fieldset className="lat-fields" disabled={locked}>
        <label className={`lat-f f-name ${c('name')}`}>
          <span>Nombre</span>
          <input className="input" value={row.name} maxLength={60} placeholder="Racha de hierro" onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        {row.isNew ? (
          <label className="lat-f f-id">
            <span>Identificador</span>
            <input
              className="input"
              value={row.id}
              maxLength={40}
              placeholder="racha_30"
              onChange={(e) => onChange({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            />
          </label>
        ) : (
          <div className="lat-f f-id">
            <span>Identificador</span>
            <code className="lat-code" title="El identificador no se puede cambiar">
              {row.id}
            </code>
          </div>
        )}
        <label className={`lat-f f-desc ${c('description')}`}>
          <span>Descripción</span>
          <input className="input" value={row.description} maxLength={200} onChange={(e) => onChange({ description: e.target.value })} />
        </label>
        <label className={`lat-f f-sort ${c('sort')}`}>
          <span>Orden</span>
          <input className="input" inputMode="numeric" value={row.sort} onChange={(e) => onChange({ sort: e.target.value })} />
        </label>

        <div className={`lat-f f-rarity ${c('rarity')}`}>
          <span>Rareza</span>
          <CustomSelect<Rarity> size="sm" value={row.rarity} options={RARITY_OPTIONS} onChange={(v) => onChange({ rarity: v })} ariaLabel={`Rareza de ${label}`} />
        </div>
        <div className={`lat-f f-metric ${c('metric')}`}>
          <span>Condición</span>
          <CustomSelect<AchievementMetric>
            size="sm"
            value={row.metric}
            options={METRIC_OPTIONS}
            searchable
            searchPlaceholder="Buscar condición…"
            onChange={(v) => onChange({ metric: v })}
            ariaLabel={`Condición de ${label}`}
          />
        </div>
        <label className={`lat-f f-num ${c('threshold')}`}>
          <span>Meta</span>
          <input className="input" inputMode="decimal" value={row.threshold} onChange={(e) => onChange({ threshold: e.target.value })} />
        </label>
        <label className={`lat-f f-num ${c('prize')}`}>
          <span>Premio</span>
          <input className="input" inputMode="numeric" value={row.prize} onChange={(e) => onChange({ prize: e.target.value })} />
        </label>
        <div className={`lat-f f-active ${c('active')}`}>
          <span>Estado</span>
          <Switch checked={row.active} onChange={(v) => onChange({ active: v })} label={`${label} activo`} text={row.active ? 'Activo' : 'Retirado'} />
        </div>
      </fieldset>

      <div className="lat-actions">
        <button type="button" className="btn btn-ghost sm" onClick={onPreview} title="Reproducir la animación del logro">
          <Sparkles aria-hidden="true" /> Ver animación
        </button>
        {!row.isNew &&
          (owned ? (
            <button type="button" className="btn btn-ghost sm" onClick={() => onMine(false)} disabled={busy}>
              <UserMinus aria-hidden="true" /> Quitármelo
            </button>
          ) : (
            <button type="button" className="btn btn-ghost sm" onClick={() => onMine(true)} disabled={busy}>
              <UserCheck aria-hidden="true" /> Marcarme como conseguido
            </button>
          ))}
        {owned && <span className="badge success lat-owned">Lo tienes</span>}
        <button type="button" className="icon-btn sm danger lat-delete" aria-label={`Eliminar ${label}`} title="Eliminar" onClick={onDelete} disabled={busy}>
          <Trash2 />
        </button>
      </div>

      {error && (
        <p className="field-error lat-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
};

/* ---------------- Pestaña ---------------- */

type Bulk = 'activate' | 'deactivate' | 'delete';

/** Ligas (premios y cupos de ascenso/descenso, dentro de la economía), logros y cierre de semana para pruebas */
export const LeaguesAchievementsTab: React.FC<{ onEditLeagues: () => void }> = ({ onEditLeagues }) => {
  const { showToast } = useToast();
  // Lo guardado en el servidor y lo que se está editando
  const [saved, setSaved] = useState<Map<string, AchievementDef> | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [unmarking, setUnmarking] = useState<Row | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const [league, setLeague] = useState<{ text: Record<string, string>; promote: number; stay: number; solo: number; size: number; version: number | null } | null>(
    null,
  );
  const [week, setWeek] = useState(lastMonday());
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<Record<string, unknown> | null>(null);

  /** Trae los logros; `keep` conserva esas filas editadas (p. ej. las que no se pudieron guardar) */
  const loadDefs = useCallback(
    async (keep: Row[] = []) => {
      try {
        const defs = await getAchievementDefs();
        setSaved(new Map(defs.map((d) => [d.id, d])));
        const kept = new Map(keep.map((r) => [r.key, r]));
        setRows([...defs.map((d) => kept.get(d.id) ?? toRow(d)), ...keep.filter((r) => r.isNew)]);
        setSelected((s) => new Set([...s].filter((k) => defs.some((d) => d.id === k) || kept.has(k))));
      } catch (err) {
        showToast((err as Error).message, 'error');
        setSaved((p) => p ?? new Map());
      }
    },
    [showToast],
  );

  useEffect(() => {
    void loadDefs();
    const me = myUserId();
    if (me) {
      getUserAchievements(me)
        .then((list) => setOwned(new Set(list.map((a) => a.achievement_id))))
        .catch(() => undefined);
    }
    adminEconomyVersions()
      .then((list) => {
        const cur = currentVersion(list);
        const p = mergeEconomyParams(cur?.params);
        setLeague({
          text: toFormText(p),
          promote: p.leaguePromoteCount,
          stay: p.leagueStayCount,
          solo: p.leagueSoloPrize,
          size: p.leagueGroupSize,
          version: cur?.version ?? null,
        });
      })
      .catch((err) => showToast((err as Error).message, 'error'));
  }, [loadDefs, showToast]);

  const takenFor = useCallback(
    (key: string) => new Set([...(saved?.keys() ?? []), ...rows.filter((r) => r.key !== key && r.isNew).map((r) => r.id.trim())]),
    [saved, rows],
  );

  const changes = useMemo(() => new Map(rows.map((r) => [r.key, changedFields(r, saved?.get(r.key))])), [rows, saved]);
  const dirtyRows = rows.filter((r) => r.isNew || (changes.get(r.key)?.size ?? 0) > 0);
  const nextSort = Math.max(0, ...rows.map((r) => Number(r.sort) || 0)) + 10;

  const patchRow = (key: string, patch: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if (errors[key])
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
  };

  const toggleSelect = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const someSelected = rows.some((r) => selected.has(r.key));
  const selectedRows = rows.filter((r) => selected.has(r.key));

  const addRow = () => {
    const r = newRow(nextSort);
    setRows((list) => [...list, r]);
    // Lleva la vista a la fila nueva
    requestAnimationFrame(() => document.getElementById(`lat-row-${r.key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  /* ---- Guardar todas las filas modificadas de una vez ---- */
  const saveAll = async () => {
    if (!dirtyRows.length) return;
    const problems: Record<string, string> = {};
    for (const r of dirtyRows) {
      const p = rowProblem(r, takenFor(r.key));
      if (p) problems[r.key] = p;
    }
    if (Object.keys(problems).length) {
      setErrors(problems);
      const n = Object.keys(problems).length;
      showToast(n === 1 ? 'Hay un logro con un dato por corregir' : `Hay ${n} logros con datos por corregir`, 'warning');
      return;
    }
    setSaving(true);
    const failed: Record<string, string> = {};
    let ok = 0;
    for (const r of dirtyRows) {
      try {
        await adminSaveAchievement(toDef(r), r.isNew);
        ok++;
      } catch (err) {
        failed[r.key] = (err as Error).message || 'No se pudo guardar';
      }
    }
    // Las que fallaron siguen editadas (con su error); el resto se recarga del servidor
    const keep = dirtyRows.filter((r) => failed[r.key]);
    await loadDefs(keep);
    setErrors(failed);
    setSaving(false);
    if (ok) showToast(ok === 1 ? 'Cambios guardados en 1 logro' : `Cambios guardados en ${ok} logros`, 'success');
    if (Object.keys(failed).length) showToast(`No se pudieron guardar ${Object.keys(failed).length} logros: revisa los mensajes en rojo`, 'error');
  };

  const discard = () => {
    if (!saved) return;
    setRows([...saved.values()].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)).map(toRow));
    setErrors({});
    setSelected(new Set());
  };

  /* ---- Acciones en bloque (con confirmación) ---- */
  const applyBulk = async (kind: Bulk) => {
    const list = selectedRows;
    if (!list.length) return;
    setSaving(true);
    let ok = 0;
    const failed: string[] = [];
    if (kind === 'delete') {
      const removed = new Set<string>();
      for (const r of list) {
        try {
          if (!r.isNew) await adminDeleteAchievement(r.id);
          removed.add(r.key);
          ok++;
        } catch (err) {
          failed.push(`«${r.name || r.id}»: ${(err as Error).message}`);
        }
      }
      setRows((rs) => rs.filter((r) => !removed.has(r.key)));
      setSaved((m) => {
        if (!m) return m;
        const next = new Map(m);
        removed.forEach((k) => next.delete(k));
        return next;
      });
      setSelected(new Set());
      if (ok) showToast(ok === 1 ? '1 logro eliminado' : `${ok} logros eliminados`, 'success');
    } else {
      const on = kind === 'activate';
      const done = new Set<string>();
      for (const r of list) {
        const base = saved?.get(r.key);
        try {
          // Se cambia solo el estado de lo guardado; el resto de ediciones sin guardar se conserva en la fila
          if (!r.isNew && base && base.active !== on) await adminSaveAchievement({ ...base, active: on }, false);
          done.add(r.key);
          ok++;
        } catch (err) {
          failed.push(`«${r.name || r.id}»: ${(err as Error).message}`);
        }
      }
      setSaved((m) => {
        if (!m) return m;
        const next = new Map(m);
        done.forEach((k) => {
          const d = next.get(k);
          if (d) next.set(k, { ...d, active: on });
        });
        return next;
      });
      setRows((rs) => rs.map((r) => (done.has(r.key) ? { ...r, active: on } : r)));
      if (ok) showToast(on ? `${ok} ${ok === 1 ? 'logro activo' : 'logros activos'}` : `${ok} ${ok === 1 ? 'logro retirado' : 'logros retirados'}: nadie más los podrá conseguir`, 'success');
    }
    setSaving(false);
    if (failed.length) showToast(`No se pudo con ${failed.length}: ${failed[0]}`, 'error');
  };

  const removeOne = async (r: Row) => {
    if (r.isNew) {
      setRows((rs) => rs.filter((x) => x.key !== r.key));
      return;
    }
    setBusyKey(r.key);
    try {
      await adminDeleteAchievement(r.id);
      setRows((rs) => rs.filter((x) => x.key !== r.key));
      setSaved((m) => {
        if (!m) return m;
        const next = new Map(m);
        next.delete(r.key);
        return next;
      });
      setSelected((s) => {
        const next = new Set(s);
        next.delete(r.key);
        return next;
      });
      showToast(`«${r.name || r.id}» eliminado`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  /* ---- Mis logros (solo en la cuenta del creador, sin premio ni notificación) ---- */
  const setMine = async (r: Row, on: boolean) => {
    setBusyKey(r.key);
    try {
      await adminSetMyAchievement(r.id, on);
      setOwned((s) => {
        const next = new Set(s);
        if (on) next.add(r.id);
        else next.delete(r.id);
        return next;
      });
      showToast(on ? `Ahora tienes «${r.name || r.id}» (sin premio ni aviso)` : `Te quitaste «${r.name || r.id}»`, 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const preview = (r: Row) =>
    triggerAchievementCelebration({
      name: r.name.trim() || 'Logro sin nombre',
      icon: r.icon.trim() || '🏅',
      rarity: r.rarity,
      description: r.description.trim() || undefined,
      prize: Math.max(0, Math.round(Number(r.prize) || 0)),
    });

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

  const nSel = selectedRows.length;
  const BULK_TEXT: Record<Bulk, { title: string; message: string; confirm: string; danger?: boolean }> = {
    activate: {
      title: `¿Activar ${nSel === 1 ? '1 logro' : `${nSel} logros`}?`,
      message: 'Se podrán volver a conseguir desde ya.',
      confirm: 'Activar',
    },
    deactivate: {
      title: `¿Retirar ${nSel === 1 ? '1 logro' : `${nSel} logros`}?`,
      message: 'Nadie más los podrá conseguir; quien ya los tiene los conserva.',
      confirm: 'Retirar',
    },
    delete: {
      title: `¿Eliminar ${nSel === 1 ? '1 logro' : `${nSel} logros`}?`,
      message:
        'Las personas que ya los consiguieron los perderán (y desaparecen de sus perfiles). No se puede deshacer. Si solo quieres que nadie más los consiga, usa «Retirar».',
      confirm: 'Eliminar',
      danger: true,
    },
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Premios de las ligas</h2>
            <p className="card-sub">
              Son parte de la economía: se editan todos a la vez en su borrador y rigen al publicarlo.
              {league &&
                ` Vigente${league.version ? ` (v${league.version})` : ''}: suben los ${league.promote} primeros, se quedan los ${league.stay} siguientes y el resto baja; grupos de ${league.size}; si alguien queda solo en su grupo (menos de 2 clasificados) no sube ni baja y gana ${league.solo} monedas por participar.`}
            </p>
          </div>
          <button type="button" className="btn btn-secondary sm" onClick={onEditLeagues}>
            <Settings2 /> Editar en Economía
          </button>
        </div>
        {league ? <PrizeTable text={league.text} /> : <p className="muted">Cargando…</p>}
      </div>

      <div className="card lat-card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Logros</h2>
            <p className="card-sub">
              Edita varios a la vez y guárdalos juntos. Retirar un logro evita que alguien más lo consiga; quien ya lo tiene lo conserva.
            </p>
          </div>
          <button type="button" className="btn btn-primary sm" onClick={addRow} disabled={saving}>
            <Plus /> Nuevo logro
          </button>
        </div>

        {saved === null ? (
          <p className="muted">Cargando los logros…</p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Todavía no hay logros.
          </p>
        ) : (
          <>
            <div className="lat-toolbar" role="toolbar" aria-label="Acciones con los logros seleccionados">
              <Check3
                checked={allSelected ? true : someSelected ? 'mixed' : false}
                onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)))}
                label="Seleccionar todos los logros"
              />
              <span className="lat-toolbar-count">{nSel ? `${nSel} ${nSel === 1 ? 'seleccionado' : 'seleccionados'}` : 'Seleccionar todos'}</span>
              <div className="lat-toolbar-actions">
                <button type="button" className="btn btn-ghost sm" disabled={!nSel || saving} onClick={() => setBulk('activate')}>
                  Activar
                </button>
                <button type="button" className="btn btn-ghost sm" disabled={!nSel || saving} onClick={() => setBulk('deactivate')}>
                  Retirar
                </button>
                <button type="button" className="btn btn-ghost sm lat-danger" disabled={!nSel || saving} onClick={() => setBulk('delete')}>
                  <Trash2 aria-hidden="true" /> Eliminar
                </button>
              </div>
            </div>

            <ul className="lat-list" aria-label="Logros">
              {rows.map((r) => (
                <AchievementRow
                  key={r.key}
                  anchorId={`lat-row-${r.key}`}
                  row={r}
                  changed={changes.get(r.key) ?? new Set()}
                  error={errors[r.key]}
                  selected={selected.has(r.key)}
                  owned={owned.has(r.id)}
                  busy={busyKey === r.key || saving}
                  locked={saving}
                  onChange={(p) => patchRow(r.key, p)}
                  onSelect={() => toggleSelect(r.key)}
                  onPreview={() => preview(r)}
                  onMine={(on) => (on ? void setMine(r, true) : setUnmarking(r))}
                  onDelete={() => setDeleting(r)}
                />
              ))}
            </ul>
          </>
        )}

        {dirtyRows.length > 0 && (
          <div className="lat-savebar" role="region" aria-label="Guardar los cambios de los logros">
            <span className="lat-savebar-text">
              {dirtyRows.length === 1 ? '1 logro con cambios sin guardar' : `${dirtyRows.length} logros con cambios sin guardar`}
            </span>
            <div className="lat-savebar-actions">
              <button type="button" className="btn btn-ghost sm" onClick={() => setDiscardOpen(true)} disabled={saving}>
                <RotateCcw aria-hidden="true" /> Descartar
              </button>
              <button type="button" className="btn btn-primary sm" onClick={() => void saveAll()} disabled={saving}>
                <Save aria-hidden="true" /> {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
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
          <div className="field" style={{ flex: 1, minWidth: 180 }}>
            <span className="label">Lunes de la semana</span>
            <CustomDatePicker value={week} onChange={setWeek} />
            {!isMonday(week) && <span className="field-error">Elige un lunes</span>}
          </div>
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

      <ConfirmModal
        isOpen={Boolean(bulk)}
        onClose={() => setBulk(null)}
        onConfirm={() => bulk && void applyBulk(bulk)}
        title={bulk ? BULK_TEXT[bulk].title : ''}
        message={bulk ? BULK_TEXT[bulk].message : ''}
        confirmText={bulk ? BULK_TEXT[bulk].confirm : 'Confirmar'}
        danger={bulk ? Boolean(BULK_TEXT[bulk].danger) : false}
      />
      <ConfirmModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void removeOne(deleting)}
        title={`¿Eliminar «${deleting?.name || deleting?.id || 'logro nuevo'}»?`}
        message={
          deleting?.isNew
            ? 'Se quita esta fila sin guardar.'
            : 'Las personas que ya lo consiguieron lo perderán (y desaparece de sus perfiles). Si solo quieres que nadie más lo consiga, usa «Retirado».'
        }
        confirmText="Eliminar"
        danger
      />
      <ConfirmModal
        isOpen={Boolean(unmarking)}
        onClose={() => setUnmarking(null)}
        onConfirm={() => unmarking && void setMine(unmarking, false)}
        title={`¿Quitarte «${unmarking?.name || unmarking?.id || ''}»?`}
        message="Se borra de tu cuenta de creador (y de tus logros destacados, si lo tenías elegido). Puedes volver a marcártelo cuando quieras."
        confirmText="Quitármelo"
        danger
      />
      <ConfirmModal
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={discard}
        title="¿Descartar los cambios?"
        message="Se pierden las ediciones sin guardar y las filas nuevas; los logros vuelven a como están en el servidor."
        confirmText="Descartar"
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
