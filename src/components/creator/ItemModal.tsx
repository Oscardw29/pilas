import React, { useEffect, useRef, useState } from 'react';
import { Coins, Crop, ImagePlus, Save, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { ImageCropModal } from '@/components/ui/ImageCropModal';
import { useToast } from '@/components/ui/ToastContext';
import { Avatar, useMyAvatarSrc } from '@/components/profile/Avatar';
import { ProfileHero } from '@/components/profile/ProfileSections';
import { RankCard, cosmeticOf } from '@/components/social/Identity';
import { useStore } from '@/store/useStore';
import { useSocial } from '@/social/useSocial';
import { adminSaveItem, removeCatalogFiles, uploadCatalogFile } from '@/social/api';
import { checkCatalogFile, imageDimensions, isAnimatedWebp, isOtherAnimated, isWebp, readBytes, stillFrame } from '@/social/images';
import { KIND_LABEL, RARITY, personName } from '@/social/texts';
import type { CatalogItem, CatalogKind, CatalogStatus, Cosmetic, Rarity } from '@/social/types';
import './itemModal.css';

/** Tamaño de cada tipo (ancho × alto). Los marcos son cuadrados de 256 o 512 px */
export const KIND_SIZE: Record<Exclude<CatalogKind, 'reward'>, { w: number; h: number; hint: string }> = {
  banner: { w: 1200, h: 400, hint: '1200 × 400 px (3:1)' },
  frame: { w: 512, h: 512, hint: 'Cuadrado de 256 o 512 px con el centro transparente' },
  card: { w: 1200, h: 160, hint: '1200 × 160 px (7,5:1)' },
};

export const STATUS_LABEL: Record<CatalogStatus, string> = { draft: 'Borrador', published: 'Publicado', retired: 'Retirado' };

const MAX_SOURCE = 15 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;

/** ¿Mide exactamente lo pedido? */
const sizeOk = (kind: Exclude<CatalogKind, 'reward'>, w: number, h: number) =>
  kind === 'frame' ? w === h && (w === 256 || w === 512) : w === KIND_SIZE[kind].w && h === KIND_SIZE[kind].h;

/** Medida a la que se recorta una imagen estática que no cumple (los marcos pequeños, a 256 px) */
const cropTarget = (kind: Exclude<CatalogKind, 'reward'>, w: number, h: number) =>
  kind === 'frame' ? (Math.min(w, h) >= 512 ? { w: 512, h: 512 } : { w: 256, h: 256 }) : { w: KIND_SIZE[kind].w, h: KIND_SIZE[kind].h };

interface Picked {
  file: File;
  /** Nombre del archivo elegido (el recortado se llama distinto) */
  name: string;
  animated: boolean;
  url: string;
  thumbUrl: string | null;
  width: number;
  height: number;
  /** Imagen original, si se recortó (para volver a encuadrarla) */
  source: File | null;
}

interface CropJob {
  file: File;
  w: number;
  h: number;
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
  const photo = useMyAvatarSrc();
  const userName = useStore((s) => s.settings.userName);
  const profile = useSocial((s) => s.profile);
  const me = personName({ alias: profile?.alias, display_name: profile?.display_name || userName || 'Tu nombre' });

  if (kind === 'banner') {
    return (
      <ProfileHero
        className="is-compact"
        label="Vista previa del banner en un perfil"
        name={me}
        avatarSrc={photo}
        avatarSize={72}
        banner={cosmetic}
        bannerColor={profile?.banner_color}
        meta={<span className="ph-meta-text">Miembro desde octubre de 2026</span>}
      />
    );
  }
  if (kind === 'frame') {
    return (
      <div className="preview-frames">
        <figure>
          <Avatar src={photo} name={me} size={96} frame={cosmetic} />
          <figcaption>Perfil · 96 px</figcaption>
        </figure>
        <figure>
          <Avatar src={photo} name={me} size={48} frame={cosmetic} />
          <figcaption>Listas · 48 px</figcaption>
        </figure>
        <figure>
          <Avatar src={photo} name={me} size={32} frame={cosmetic} />
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
            <strong>ana_lee</strong>
            <span>🔥 21 días de racha</span>
          </div>
          <span className="preview-rank-xp">1.480 XP</span>
        </RankCard>
        <RankCard card={cosmetic} highlight>
          <span className="preview-rank-pos">5</span>
          <Avatar src={photo} name={me} size={36} />
          <div className="preview-rank-name">
            <strong>{me} (tú)</strong>
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
      <span className="rarity" style={{ '--r': RARITY[rarity].color, '--r-text': RARITY[rarity].text } as React.CSSProperties}>
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
 * Imágenes: un WebP animado debe medir exactamente lo pedido (no se puede recortar); una imagen estática (WebP, PNG o
 * JPG) que no mida lo pedido se encuadra en ImageCropModal y se guarda como WebP a la medida exacta.
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
  const [crop, setCrop] = useState<CropJob | null>(null);
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

  const hasImage = kind !== 'reward';
  const size = hasImage ? KIND_SIZE[kind] : null;

  /** Acepta un WebP ya a la medida (el original o el recortado) */
  const accept = async (file: File, width: number, height: number, name: string, source: File | null) => {
    const { animated } = await checkCatalogFile(file, MAX_FILE);
    const thumb = animated ? await stillFrame(file, 256) : null;
    // Se cerró el diálogo mientras se comprobaba: no se crean URL que ya nadie liberaría
    if (!alive.current) return;
    replacePicked({ file, name, animated, url: URL.createObjectURL(file), thumbUrl: thumb ? URL.createObjectURL(thumb) : null, width, height, source });
  };

  const onFile = async (file: File | undefined) => {
    if (!file || kind === 'reward') return;
    setChecking(true);
    try {
      if (file.size > MAX_SOURCE) throw new Error('La imagen pesa demasiado (máximo 15 MB).');
      const bytes = await readBytes(file);
      const webp = isWebp(bytes);
      if (!webp && !file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
      if (isOtherAnimated(bytes)) {
        throw new Error('Los GIF y PNG animados no se admiten: conviértelo a WebP animado a la medida exacta, o usa una imagen fija.');
      }
      const animated = webp && isAnimatedWebp(bytes);
      const { width, height } = await imageDimensions(file);
      if (animated) {
        if (!sizeOk(kind, width, height)) {
          throw new Error(
            `Este WebP animado mide ${width} × ${height} px y debe medir exactamente ${KIND_SIZE[kind].hint}. Los animados no se pueden recortar: prepáralo a esa medida.`,
          );
        }
        await accept(file, width, height, file.name, null);
      } else if (webp && sizeOk(kind, width, height) && file.size <= MAX_FILE) {
        await accept(file, width, height, file.name, null);
      } else {
        const t = cropTarget(kind, width, height);
        setCrop({ file, w: t.w, h: t.h });
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setChecking(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onCropped = async (blob: Blob) => {
    if (!crop || kind === 'reward') return;
    const base = crop.file.name.replace(/\.[^.]+$/, '') || 'imagen';
    const out = new File([blob], `${base}-recorte.webp`, { type: 'image/webp' });
    await accept(out, crop.w, crop.h, out.name, crop.file);
    setCrop(null);
  };

  const priceNum = Number(price);
  const cosmetic: Cosmetic | null = picked ? { path: picked.url, thumb: picked.thumbUrl, animated: picked.animated } : cosmeticOf(item);

  const validate = (): string | null => {
    if (!name.trim() || name.trim().length > 60) return 'El nombre debe tener entre 1 y 60 caracteres.';
    if (description.length > 300) return 'La descripción admite hasta 300 caracteres.';
    // Vacío no es 0: así un campo borrado sin querer no publica el artículo gratis
    if (price.trim() === '' || !Number.isInteger(priceNum) || priceNum < 0 || priceNum > 100000) return 'El precio debe ser un número entero entre 0 y 100 000.';
    if (hasImage && !picked && !item?.asset_path) return 'Elige la imagen del artículo.';
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

  const kindOptions = (Object.keys(KIND_LABEL) as CatalogKind[]).map((k) => ({ value: k, label: KIND_LABEL[k].one }));
  const statusOptions: { value: CatalogStatus; label: string; sublabel: string }[] = [
    { value: 'draft', label: 'Borrador', sublabel: 'Solo tú lo ves' },
    { value: 'published', label: 'Publicado', sublabel: 'A la venta' },
    ...(item ? [{ value: 'retired' as const, label: 'Retirado', sublabel: 'No se vende; quien lo tiene lo conserva' }] : []),
  ];
  const rarityOptions = (Object.keys(RARITY) as Rarity[]).map((r) => ({ value: r, label: RARITY[r].label, color: RARITY[r].color }));

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
            <div className="field">
              <span className="label">Tipo</span>
              <CustomSelect<CatalogKind>
                value={kind}
                options={kindOptions}
                ariaLabel="Tipo"
                disabled={Boolean(item)}
                onChange={(k) => {
                  if (k === kind) return;
                  setKind(k);
                  // La imagen elegida era para otra medida
                  replacePicked(null);
                }}
              />
            </div>
            <div className="field">
              <span className="label">Estado</span>
              <CustomSelect<CatalogStatus> value={status} options={statusOptions} ariaLabel="Estado" onChange={setStatus} />
            </div>
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
              <input
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
            <div className="field">
              <span className="label">Rareza</span>
              <CustomSelect<Rarity> value={rarity} options={rarityOptions} ariaLabel="Rareza" onChange={setRarity} />
            </div>
          </div>
          {hasImage && size ? (
            <div className="field">
              <span className="label" id="item-file-label">
                Imagen
              </span>
              <div className="item-file">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/webp,image/png,image/jpeg"
                  hidden
                  tabIndex={-1}
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <div className="item-file-row">
                  <button
                    type="button"
                    className="btn btn-secondary sm"
                    aria-describedby="item-file-hint"
                    onClick={() => fileInput.current?.click()}
                    disabled={checking || busy}
                  >
                    <ImagePlus aria-hidden="true" /> {checking ? 'Comprobando…' : picked || item?.asset_path ? 'Cambiar imagen' : 'Elegir imagen'}
                  </button>
                  {picked?.source && (
                    <button
                      type="button"
                      className="btn btn-ghost sm"
                      onClick={() => picked.source && setCrop({ file: picked.source, w: picked.width, h: picked.height })}
                      disabled={checking || busy}
                    >
                      <Crop aria-hidden="true" /> Reencuadrar
                    </button>
                  )}
                  <span className="item-file-name" aria-live="polite">
                    {picked ? picked.name : item?.asset_path ? 'Se conserva la imagen actual' : 'Ninguna imagen elegida'}
                  </span>
                </div>
                <span className="hint" id="item-file-hint">
                  {size.hint}. Un WebP animado debe medir exactamente eso; una imagen estática (WebP, PNG o JPG) que no mida eso se
                  encuadra aquí. Máximo 2 MB.
                  {picked &&
                    ` · ${picked.width} × ${picked.height} px · ${(picked.file.size / 1024).toFixed(0)} KB · ${picked.animated ? 'animado' : 'estático'}${picked.source ? ' (recortado)' : ''}.`}
                </span>
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
          {hasImage && !cosmetic && <p className="card-sub">Elige una imagen para verla aquí.</p>}
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

      {hasImage && (
        <ImageCropModal
          source={crop?.file ?? null}
          shape="rect"
          width={crop?.w ?? 1}
          height={crop?.h ?? 1}
          title={`Encuadra: ${KIND_LABEL[kind].one.toLowerCase()}`}
          hint={KIND_LABEL[kind].one}
          quality={0.9}
          onCancel={() => setCrop(null)}
          onDone={onCropped}
        />
      )}
    </Modal>
  );
};
