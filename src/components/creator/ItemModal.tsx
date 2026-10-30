import React, { useEffect, useRef, useState } from 'react';
import { Coins, Save, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/ToastContext';
import { Avatar } from '@/components/profile/Avatar';
import { ProfileBanner, RankCard, cosmeticOf } from '@/components/social/Identity';
import { useStore } from '@/store/useStore';
import { useSocial } from '@/social/useSocial';
import { adminSaveItem, removeCatalogFiles, uploadCatalogFile } from '@/social/api';
import { checkCatalogFile, stillFrame } from '@/social/images';
import { KIND_LABEL, RARITY } from '@/social/texts';
import type { CatalogItem, CatalogKind, CatalogStatus, Cosmetic, Rarity } from '@/social/types';

/** Tamaño recomendado de cada tipo (ancho × alto) */
export const KIND_SIZE: Record<Exclude<CatalogKind, 'reward'>, { w: number; h: number; hint: string }> = {
  banner: { w: 1200, h: 400, hint: '1200 × 400 px (3:1)' },
  frame: { w: 256, h: 256, hint: 'Cuadrado (256 o 512 px) con el centro transparente' },
  card: { w: 1200, h: 160, hint: '1200 × 160 px (7,5:1)' },
};

export const STATUS_LABEL: Record<CatalogStatus, string> = { draft: 'Borrador', published: 'Publicado', retired: 'Retirado' };

interface Picked {
  file: File;
  animated: boolean;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
}

/** Vista previa del artículo donde se usa: perfil, avatar en varios tamaños, filas del ranking o la tienda */
export const ItemPreview: React.FC<{ kind: CatalogKind; cosmetic: Cosmetic | null; name: string; description: string; price: number; icon: string; rarity: Rarity }> = ({
  kind,
  cosmetic,
  name,
  description,
  price,
  icon,
  rarity,
}) => {
  const photo = useStore((s) => s.settings.avatarDataUrl);
  const alias = useSocial((s) => s.profile?.alias) ?? 'tu_alias';

  if (kind === 'banner') {
    return (
      <div className="profile-hero">
        <ProfileBanner banner={cosmetic} />
        <div className="profile-hero-body">
          <Avatar src={photo} name={alias} size={80} />
          <div className="profile-hero-name">
            <h1>@{alias}</h1>
            <p>Miembro desde octubre de 2026</p>
          </div>
        </div>
      </div>
    );
  }
  if (kind === 'frame') {
    return (
      <div className="preview-frames">
        <figure>
          <Avatar src={photo} name={alias} size={96} frame={cosmetic} />
          <figcaption>Perfil · 96 px</figcaption>
        </figure>
        <figure>
          <Avatar src={photo} name={alias} size={48} frame={cosmetic} />
          <figcaption>Listas · 48 px</figcaption>
        </figure>
        <figure>
          <Avatar src={photo} name={alias} size={32} frame={cosmetic} />
          <figcaption>Pequeño · 32 px (fijo)</figcaption>
        </figure>
      </div>
    );
  }
  if (kind === 'card') {
    return (
      <div className="preview-rank" aria-label="Filas del ranking de ejemplo">
        <RankCard card={cosmetic}>
          <span className="preview-rank-pos">4</span>
          <Avatar name="ana_lee" size={36} />
          <div className="preview-rank-name">
            <strong>@ana_lee</strong>
            <span>🔥 21 días de racha</span>
          </div>
          <span className="preview-rank-xp">1.480 XP</span>
        </RankCard>
        <RankCard card={cosmetic} highlight>
          <span className="preview-rank-pos">5</span>
          <Avatar src={photo} name={alias} size={36} />
          <div className="preview-rank-name">
            <strong>@{alias} (tú)</strong>
            <span>🔥 12 días de racha</span>
          </div>
          <span className="preview-rank-xp">1.215 XP</span>
        </RankCard>
      </div>
    );
  }
  return (
    <div className="reward-preview">
      <span className="reward-preview-icon" aria-hidden="true">
        {icon || '🎁'}
      </span>
      <strong>{name || 'Nombre de la recompensa'}</strong>
      {description && <p>{description}</p>}
      <span className="rarity" style={{ '--r': RARITY[rarity].color } as React.CSSProperties}>
        {RARITY[rarity].label}
      </span>
      <span className="preview-price">
        <Coins size={15} aria-hidden="true" /> {price.toLocaleString('es')}
      </span>
    </div>
  );
};

/**
 * Crear o editar un artículo del catálogo. Al guardar se suben los archivos nuevos y después se guarda la fila;
 * los archivos reemplazados se borran (si falla, quedan huérfanos pero no rompen nada).
 */
export const ItemModal: React.FC<{
  item: CatalogItem | null;
  initialKind: CatalogKind;
  nextSort: number;
  onClose: () => void;
  onSaved: () => void;
}> = ({ item, initialKind, nextSort, onClose, onSaved }) => {
  const { showToast } = useToast();
  const [kind, setKind] = useState<CatalogKind>(item?.kind ?? initialKind);
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(String(item?.price ?? 300));
  const [rarity, setRarity] = useState<Rarity>(item?.rarity ?? 'common');
  const [status, setStatus] = useState<CatalogStatus>(item?.status ?? 'draft');
  const [icon, setIcon] = useState(item?.icon ?? '🎁');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickedRef = useRef<Picked | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Las URL de los archivos aún sin subir se liberan al cambiar de archivo y al cerrar
  const replacePicked = (next: Picked | null) => {
    const prev = pickedRef.current;
    if (prev) {
      URL.revokeObjectURL(prev.url);
      if (prev.thumbUrl) URL.revokeObjectURL(prev.thumbUrl);
    }
    pickedRef.current = next;
    setPicked(next);
  };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      replacePicked(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setChecking(true);
    try {
      const { animated } = await checkCatalogFile(file);
      const thumb = animated ? await stillFrame(file, 256) : null;
      let width: number | null = null;
      let height: number | null = null;
      try {
        const bmp = await createImageBitmap(file);
        width = bmp.width;
        height = bmp.height;
        bmp.close();
      } catch {
        /* sin medidas: solo se pierde el aviso de proporción */
      }
      // Se cerró el diálogo mientras se comprobaba: no se crean URL que ya nadie liberaría
      if (!alive.current) return;
      replacePicked({ file, animated, url: URL.createObjectURL(file), thumbUrl: thumb ? URL.createObjectURL(thumb) : null, width, height });
    } catch (err) {
      showToast((err as Error).message, 'error');
      if (fileInput.current) fileInput.current.value = '';
    } finally {
      setChecking(false);
    }
  };

  const hasImage = kind !== 'reward';
  const priceNum = Number(price);
  const cosmetic: Cosmetic | null = picked ? { path: picked.url, thumb: picked.thumbUrl, animated: picked.animated } : cosmeticOf(item);
  const size = hasImage ? KIND_SIZE[kind] : null;
  const ratioWarning =
    size && picked?.width && picked.height && Math.abs(picked.width / picked.height - size.w / size.h) / (size.w / size.h) > 0.1
      ? `La imagen mide ${picked.width} × ${picked.height} px; se recomienda ${size.hint}.`
      : null;

  const validate = (): string | null => {
    if (!name.trim() || name.trim().length > 60) return 'El nombre debe tener entre 1 y 60 caracteres.';
    if (description.length > 300) return 'La descripción admite hasta 300 caracteres.';
    // Vacío no es 0: así un campo borrado sin querer no publica el artículo gratis
    if (price.trim() === '' || !Number.isInteger(priceNum) || priceNum < 0 || priceNum > 100000) return 'El precio debe ser un número entero entre 0 y 100 000.';
    if (hasImage && !picked && !item?.asset_path) return 'Elige el archivo WebP del artículo.';
    if (!hasImage && [...icon].length === 0) return 'Elige un icono para la recompensa.';
    return null;
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      showToast(problem, 'warning');
      return;
    }
    setBusy(true);
    const uploaded: string[] = [];
    try {
      let asset_path = hasImage ? (item?.asset_path ?? null) : null;
      let thumb_path = hasImage ? (item?.thumb_path ?? null) : null;
      let animated = hasImage ? Boolean(item?.animated) : false;
      if (hasImage && picked) {
        const folder = `${kind}s`;
        asset_path = await uploadCatalogFile(folder, picked.file);
        uploaded.push(asset_path);
        animated = picked.animated;
        thumb_path = null;
        if (animated) {
          // Fotograma fijo: los banners y tarjetas se ven anchos, así que más grande que el de los marcos
          const thumb = await stillFrame(picked.file, kind === 'frame' ? 256 : 600);
          thumb_path = await uploadCatalogFile(folder, thumb);
          uploaded.push(thumb_path);
        }
      }
      await adminSaveItem({
        ...(item ? { id: item.id } : { sort: nextSort }),
        kind,
        name: name.trim(),
        description: description.trim() || null,
        price: priceNum,
        rarity,
        status,
        icon: hasImage ? null : icon.trim(),
        asset_path,
        thumb_path,
        animated,
      });
      // Archivos que ya no usa nadie
      const old = [item?.asset_path, item?.thumb_path].filter((p): p is string => Boolean(p) && p !== asset_path && p !== thumb_path);
      if (old.length) void removeCatalogFiles(old).catch(() => {});
      showToast(item ? 'Artículo guardado' : 'Artículo creado', 'success');
      onSaved();
      onClose();
    } catch (err) {
      if (uploaded.length) void removeCatalogFiles(uploaded).catch(() => {});
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={item ? `Editar: ${item.name}` : `Nuevo artículo`} wide preventBackdropClose>
      <div className="item-modal-grid">
        <form
          id="catalog-item-form"
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="form-row">
            <label className="field">
              <span className="label">Tipo</span>
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CatalogKind)} disabled={Boolean(item)}>
                {(Object.keys(KIND_LABEL) as CatalogKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k].one}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Estado</span>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value as CatalogStatus)}>
                <option value="draft">Borrador (solo tú lo ves)</option>
                <option value="published">Publicado (a la venta)</option>
                {item && <option value="retired">Retirado (no se vende)</option>}
              </select>
            </label>
          </div>
          <label className="field">
            <span className="label">Nombre</span>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Descripción</span>
            <textarea className="textarea" value={description} maxLength={300} rows={2} onChange={(e) => setDescription(e.target.value)} />
            <span className="hint">{description.length}/300</span>
          </label>
          <div className="form-row">
            <label className="field">
              <span className="label">Precio (monedas)</span>
              <input className="input" type="number" inputMode="numeric" min={0} max={100000} step={1} value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Rareza</span>
              <select className="select" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
                {(Object.keys(RARITY) as Rarity[]).map((r) => (
                  <option key={r} value={r}>
                    {RARITY[r].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {hasImage ? (
            <div className="field">
              <span className="label" id="item-file-label">
                Archivo WebP {item?.asset_path && !picked ? '(deja vacío para conservar el actual)' : ''}
              </span>
              <div className="file-drop">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/webp"
                  aria-labelledby="item-file-label"
                  disabled={checking || busy}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <span className="hint">
                  Estático o animado, máximo 2 MB. {size?.hint}.
                  {picked && ` ${(picked.file.size / 1024).toFixed(0)} KB · ${picked.animated ? 'animado' : 'estático'}.`}
                </span>
                {ratioWarning && <span className="field-error">{ratioWarning}</span>}
              </div>
            </div>
          ) : (
            <label className="field">
              <span className="label">Icono</span>
              <input className="input" value={icon} maxLength={16} onChange={(e) => setIcon(e.target.value)} style={{ maxWidth: 120, fontSize: 20 }} />
              <span className="hint">Un emoji</span>
            </label>
          )}
        </form>

        <aside className="item-preview" aria-label="Vista previa">
          <span className="card-sub">Vista previa · así se verá</span>
          <ItemPreview kind={kind} cosmetic={cosmetic} name={name} description={description} price={Number.isFinite(priceNum) ? priceNum : 0} icon={icon} rarity={rarity} />
          {hasImage && !cosmetic && <p className="card-sub">Elige un archivo para verlo aquí.</p>}
        </aside>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" form="catalog-item-form" className="btn btn-primary" disabled={busy || checking}>
          {busy ? <Upload /> : <Save />} {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
};
