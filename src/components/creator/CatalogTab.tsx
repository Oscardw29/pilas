import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Archive, Coins, Eye, EyeOff, PackagePlus, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/ToastContext';
import { adminDeleteItem, adminSaveItem, assetUrl, getCatalog, removeCatalogFiles } from '@/social/api';
import { useCreatorTrash } from './creatorTrash';
import { loadCatalog } from '@/social/runtime';
import { KIND_LABEL, RARITY } from '@/social/texts';
import type { CatalogItem, CatalogKind, CatalogStatus } from '@/social/types';
import { ItemModal, STATUS_LABEL } from './ItemModal';
import { SAMPLES, importSamples } from './samples';

const KINDS: CatalogKind[] = ['banner', 'frame', 'card', 'reward'];
const STATUS_BADGE: Record<CatalogStatus, string> = { draft: 'warning', published: 'success', retired: '' };

const Thumb: React.FC<{ item: CatalogItem }> = ({ item }) => {
  // En la lista siempre el fotograma fijo: no se cargan los animados
  const src = assetUrl('catalog', item.thumb_path ?? item.asset_path);
  return (
    <span className={`catalog-thumb is-${item.kind}`} aria-hidden="true">
      {item.kind === 'reward' || !src ? item.icon || '🎁' : <img src={src} alt="" loading="lazy" decoding="async" />}
    </span>
  );
};

/** Catálogo de la tienda: todos los artículos (también los borradores), agrupados por tipo */
export const CatalogTab: React.FC = () => {
  const { showToast } = useToast();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [editing, setEditing] = useState<{ item: CatalogItem | null; kind: CatalogKind } | null>(null);
  const [deleting, setDeleting] = useState<CatalogItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await getCatalog());
      // También la copia de la app (tienda, perfiles)
      void loadCatalog();
    } catch (err) {
      showToast((err as Error).message, 'error');
      setItems((prev) => prev ?? []);
    }
  }, [showToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byKind = useMemo(() => {
    const map = new Map<CatalogKind, CatalogItem[]>(KINDS.map((k) => [k, []]));
    for (const it of [...(items ?? [])].sort((a, b) => a.sort - b.sort || (a.created_at ?? '').localeCompare(b.created_at ?? ''))) map.get(it.kind)?.push(it);
    return map;
  }, [items]);

  const nextSort = (kind: CatalogKind) => Math.max(0, ...(byKind.get(kind) ?? []).map((i) => i.sort)) + 10;

  const setStatus = async (item: CatalogItem, status: CatalogStatus) => {
    setBusyId(item.id);
    try {
      await adminSaveItem({ id: item.id, status });
      showToast(status === 'published' ? `«${item.name}» ya está a la venta` : status === 'retired' ? `«${item.name}» retirado` : `«${item.name}» pasó a borrador`, 'success');
      await refresh();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  /** Mueve un artículo dentro de su tipo y renumera el orden (de 10 en 10) */
  const move = async (kind: CatalogKind, index: number, delta: -1 | 1) => {
    const list = [...(byKind.get(kind) ?? [])];
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    [list[index], list[j]] = [list[j], list[index]];
    setBusyId(list[j].id);
    try {
      const changed = list.map((it, i) => ({ it, sort: (i + 1) * 10 })).filter(({ it, sort }) => it.sort !== sort);
      await Promise.all(changed.map(({ it, sort }) => adminSaveItem({ id: it.id, sort })));
      await refresh();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: CatalogItem) => {
    setBusyId(item.id);
    try {
      await adminDeleteItem(item.id);
      // Papelera: los archivos se quedan 24 h para poder restaurarlo completo (luego los borra creatorTrash)
      useCreatorTrash.getState().add({ kind: 'catalog', item });
      showToast(`«${item.name}» movido a la papelera`, 'success', 'Tienes 24 h para restaurarlo desde «Papelera».');
      await refresh();
    } catch (err) {
      // Si alguien ya lo compró el servidor no deja borrarlo: el mensaje sugiere retirarlo
      showToast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const existingKeys = useMemo(() => new Set((items ?? []).map((i) => i.sample_key).filter((k): k is string => Boolean(k))), [items]);
  const missingSamples = SAMPLES.filter((s) => !existingKeys.has(s.key)).length;

  const runImport = async () => {
    setImporting('Preparando…');
    try {
      const sorts = Object.fromEntries(KINDS.map((k) => [k, nextSort(k)])) as Record<CatalogKind, number>;
      const created = await importSamples(existingKeys, sorts, (done, total, name) =>
        setImporting(done < total ? `Generando ${done + 1}/${total}: ${name}…` : 'Terminando…'),
      );
      showToast(created.length ? `${created.length} muestras importadas como borrador` : 'Las muestras ya estaban en el catálogo', 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setImporting(null);
      await refresh();
    }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap' }}>
          <div>
            <h2 className="card-title">Catálogo de la tienda</h2>
            <p className="card-sub">Los borradores solo los ves tú. Retirar deja de venderlo, pero quien lo compró lo conserva.</p>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary sm" onClick={() => void runImport()} disabled={Boolean(importing) || items === null || missingSamples === 0} title="Genera 12 muestras en el dispositivo y las sube como borrador">
              <Sparkles /> {importing ?? (missingSamples ? `Importar muestras (${missingSamples})` : 'Muestras importadas')}
            </button>
            <button type="button" className="btn btn-primary sm" onClick={() => setEditing({ item: null, kind: 'banner' })}>
              <Plus /> Nuevo
            </button>
          </div>
        </div>
        {importing && (
          <p className="card-sub" role="status" aria-live="polite">
            {importing} No cierres esta página.
          </p>
        )}
        {items === null && <p className="muted">Cargando el catálogo…</p>}
      </div>

      {items !== null &&
        KINDS.map((kind) => {
          const list = byKind.get(kind) ?? [];
          return (
            <section key={kind} className="card" aria-labelledby={`catalog-${kind}`}>
              <div className="card-head">
                <div>
                  <h3 className="card-title" id={`catalog-${kind}`}>
                    {KIND_LABEL[kind].many}
                  </h3>
                  <p className="card-sub">
                    {list.length} {list.length === 1 ? 'artículo' : 'artículos'} · {list.filter((i) => i.status === 'published').length} a la venta
                  </p>
                </div>
                <button type="button" className="btn btn-ghost sm" onClick={() => setEditing({ item: null, kind })}>
                  <PackagePlus /> Nuevo
                </button>
              </div>
              {list.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  Todavía no hay {KIND_LABEL[kind].many.toLowerCase()}.
                </p>
              ) : (
                <ul className="catalog-list">
                  {list.map((it, i) => (
                    <li key={it.id} className="catalog-row">
                      <Thumb item={it} />
                      <div className="catalog-row-info">
                        <strong>{it.name}</strong>
                        <div className="catalog-row-meta">
                          <span className="preview-price" style={{ fontSize: 12.5 }}>
                            <Coins size={13} aria-hidden="true" /> {it.price.toLocaleString('es')}
                          </span>
                          <span className="rarity" style={{ '--r': RARITY[it.rarity].color, '--r-text': RARITY[it.rarity].text } as React.CSSProperties}>
                            {RARITY[it.rarity].label}
                          </span>
                          <span className={`badge ${STATUS_BADGE[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                          {it.animated && <span className="badge info">Animado</span>}
                          {it.sample_key && <span className="badge">Muestra</span>}
                        </div>
                      </div>
                      <div className="catalog-row-actions">
                        <button type="button" className="icon-btn sm" aria-label={`Subir ${it.name}`} disabled={i === 0 || busyId !== null} onClick={() => void move(kind, i, -1)}>
                          <ArrowUp />
                        </button>
                        <button type="button" className="icon-btn sm" aria-label={`Bajar ${it.name}`} disabled={i === list.length - 1 || busyId !== null} onClick={() => void move(kind, i, 1)}>
                          <ArrowDown />
                        </button>
                        {it.status !== 'published' && (
                          <button type="button" className="btn btn-success sm" disabled={busyId === it.id} onClick={() => void setStatus(it, 'published')}>
                            <Eye /> Publicar
                          </button>
                        )}
                        {it.status === 'published' && (
                          <button type="button" className="btn btn-secondary sm" disabled={busyId === it.id} onClick={() => void setStatus(it, 'retired')}>
                            <Archive /> Retirar
                          </button>
                        )}
                        {it.status !== 'draft' && (
                          <button type="button" className="btn btn-ghost sm" disabled={busyId === it.id} onClick={() => void setStatus(it, 'draft')}>
                            <EyeOff /> A borrador
                          </button>
                        )}
                        <button type="button" className="icon-btn sm" aria-label={`Editar ${it.name}`} onClick={() => setEditing({ item: it, kind })}>
                          <Pencil />
                        </button>
                        <button type="button" className="icon-btn sm danger" aria-label={`Eliminar ${it.name}`} disabled={busyId === it.id} onClick={() => setDeleting(it)}>
                          <Trash2 />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

      {editing && (
        <ItemModal
          key={editing.item?.id ?? `new-${editing.kind}`}
          item={editing.item}
          initialKind={editing.kind}
          nextSort={nextSort(editing.kind)}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
        title={`¿Eliminar «${deleting?.name ?? ''}»?`}
        message="Sale del catálogo y va a la papelera: durante 24 h puedes restaurarlo con sus archivos; después se borra para siempre. Si alguien ya lo compró no se puede borrar: en ese caso usa «Retirar»."
        confirmText="Eliminar"
        danger
      />
    </div>
  );
};
