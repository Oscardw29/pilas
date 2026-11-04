import React, { useCallback, useEffect, useState } from 'react';
import { Award, Clock, LifeBuoy, RotateCcw, ShoppingBag, SlidersHorizontal, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { playSound } from '@/lib/sound';
import { adminSaveAchievement, getAchievementDefs } from '@/social/api';
import { METRIC_LABEL, RARITY } from '@/social/texts';
import type { AchievementDef } from '@/social/types';
import { DEFAULT_ACHIEVEMENTS, expiresAt, purgeEntry, restoreEntry, useCreatorTrash, type TrashEntry } from './creatorTrash';

const KIND_LABEL: Record<TrashEntry['kind'], string> = {
  achievement: 'Logro',
  catalog: 'Artículo del catálogo',
  economyDraft: 'Borrador de la economía',
};
const KIND_ICON: Record<TrashEntry['kind'], React.ReactNode> = {
  achievement: <Award aria-hidden="true" />,
  catalog: <ShoppingBag aria-hidden="true" />,
  economyDraft: <SlidersHorizontal aria-hidden="true" />,
};

const titleOf = (e: TrashEntry) =>
  e.kind === 'achievement' ? `${e.def.icon} ${e.def.name}` : e.kind === 'catalog' ? `${e.item.icon ?? ''} ${e.item.name}`.trim() : `Borrador v${e.version}`;

/** Qué era, para reconocerlo antes de restaurarlo */
const detailOf = (e: TrashEntry) => {
  if (e.kind === 'achievement') {
    const d = e.def;
    return `${RARITY[d.rarity]?.label ?? d.rarity} · ${d.threshold} ${METRIC_LABEL[d.metric] ?? d.metric}${d.prize ? ` · +${d.prize} monedas` : ''}${d.active ? '' : ' · estaba retirado'}${d.description ? ` · ${d.description}` : ''}`;
  }
  if (e.kind === 'catalog') return `${e.item.kind} · ${e.item.price} monedas · ${RARITY[e.item.rarity]?.label ?? e.item.rarity}`;
  return e.note ? `Nota: ${e.note}` : 'Sin nota';
};

const remaining = (e: TrashEntry, now: number) => {
  const ms = Math.max(0, expiresAt(e) - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(1, Math.round((ms % 3_600_000) / 60_000));
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

/**
 * PAPELERA (Panel del creador): lo eliminado en las otras pestañas, con 24 h para restaurarlo.
 * Debajo, los logros predeterminados que faltan en el servidor (p. ej. uno borrado antes de que existiera la papelera).
 */
export const TrashTab: React.FC = () => {
  const { showToast } = useToast();
  const entries = useCreatorTrash((s) => s.entries);
  const [busy, setBusy] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashEntry | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [missing, setMissing] = useState<AchievementDef[] | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const loadMissing = useCallback(async () => {
    try {
      const defs = await getAchievementDefs();
      const have = new Set(defs.map((d) => d.id));
      setMissing(DEFAULT_ACHIEVEMENTS.filter((d) => !have.has(d.id)));
    } catch {
      setMissing([]);
    }
  }, []);
  useEffect(() => {
    void loadMissing();
  }, [loadMissing]);

  const restore = async (e: TrashEntry) => {
    setBusy(e.key);
    try {
      await restoreEntry(e);
      playSound.pop();
      showToast(`${titleOf(e)} restaurado`, 'success');
    } catch (err) {
      showToast((err as Error).message || 'No se pudo restaurar', 'error');
    } finally {
      setBusy(null);
    }
  };

  const purge = async (e: TrashEntry) => {
    setBusy(e.key);
    try {
      await purgeEntry(e);
      playSound.delete();
      showToast(`${titleOf(e)} borrado para siempre`, 'info');
    } catch (err) {
      showToast((err as Error).message || 'No se pudo borrar', 'error');
    } finally {
      setBusy(null);
    }
  };

  const recreate = async (d: AchievementDef) => {
    setBusy(`default:${d.id}`);
    try {
      await adminSaveAchievement(d, true);
      playSound.pop();
      showToast(`${d.icon} ${d.name} vuelve a estar disponible`, 'success', 'Quien cumpla la meta lo recibe en su próxima comprobación de logros.');
      await loadMissing();
    } catch (err) {
      showToast((err as Error).message || 'No se pudo restaurar', 'error');
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...entries].sort((a, b) => b.deletedAt - a.deletedAt);

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Papelera</h3>
            <p className="card-sub">Lo que eliminas en el panel se queda aquí 24 h. Puedes restaurarlo tal como estaba; después se borra para siempre.</p>
          </div>
          {sorted.length > 0 && <span className="badge">{sorted.length} {sorted.length === 1 ? 'elemento' : 'elementos'}</span>}
        </div>

        {sorted.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">
              <Trash2 aria-hidden="true" />
            </div>
            <h3>La papelera está vacía</h3>
            <p>Los logros, artículos y borradores que elimines aparecerán aquí durante 24 h.</p>
          </div>
        ) : (
          <ul className="trash-list">
            {sorted.map((e) => (
              <li key={e.key} className="trash-row">
                <span className={`trash-kind trash-kind-${e.kind}`} title={KIND_LABEL[e.kind]}>
                  {KIND_ICON[e.kind]}
                </span>
                <div className="trash-info">
                  <strong>{titleOf(e)}</strong>
                  <span className="trash-detail">{detailOf(e)}</span>
                  <span className="trash-meta">
                    {KIND_LABEL[e.kind]} · eliminado el{' '}
                    {new Date(e.deletedAt).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ·{' '}
                    <span className="trash-left">
                      <Clock aria-hidden="true" /> se borra en {remaining(e, now)}
                    </span>
                  </span>
                </div>
                <div className="trash-actions">
                  <button type="button" className="btn btn-secondary sm" disabled={busy === e.key} onClick={() => void restore(e)}>
                    <RotateCcw size={14} /> Restaurar
                  </button>
                  <button
                    type="button"
                    className="icon-btn sm danger"
                    disabled={busy === e.key}
                    onClick={() => setPurging(e)}
                    aria-label={`Borrar para siempre ${titleOf(e)}`}
                    title="Borrar para siempre"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
          La papelera se guarda en este dispositivo: lo que elimines desde otro equipo aparece en la papelera de ese equipo.
        </p>
      </section>

      {missing && missing.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Logros predeterminados que faltan</h3>
              <p className="card-sub">
                Vienen con la app y ya no están en el servidor (se eliminaron antes de que existiera la papelera). Puedes volver a crearlos con sus
                valores originales.
              </p>
            </div>
            <LifeBuoy aria-hidden="true" style={{ color: 'var(--accent-2)' }} />
          </div>
          <ul className="trash-list">
            {missing.map((d) => (
              <li key={d.id} className="trash-row">
                <span className="trash-kind trash-kind-achievement" aria-hidden="true">
                  <span style={{ fontSize: 18 }}>{d.icon}</span>
                </span>
                <div className="trash-info">
                  <strong>{d.name}</strong>
                  <span className="trash-detail">
                    {d.description} · {RARITY[d.rarity]?.label ?? d.rarity}
                  </span>
                </div>
                <div className="trash-actions">
                  <button type="button" className="btn btn-primary sm" disabled={busy === `default:${d.id}`} onClick={() => void recreate(d)}>
                    <RotateCcw size={14} /> Restaurar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmModal
        isOpen={Boolean(purging)}
        onClose={() => setPurging(null)}
        onConfirm={() => {
          if (purging) void purge(purging);
          setPurging(null);
        }}
        title={`¿Borrar para siempre «${purging ? titleOf(purging) : ''}»?`}
        message={
          purging?.kind === 'achievement'
            ? 'Se borra del servidor y quienes lo consiguieron lo pierden. No se puede deshacer.'
            : purging?.kind === 'catalog'
              ? 'Se borran sus archivos. No se puede deshacer.'
              : 'Se quita de la papelera. No se puede deshacer.'
        }
        confirmText="Borrar para siempre"
        danger
      />
    </div>
  );
};
