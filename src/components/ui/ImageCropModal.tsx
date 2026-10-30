import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, Minus, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { canvasToWebp } from '@/social/images';
import './ImageCropModal.css';

/**
 * RECORTE DE IMÁGENES (foto de perfil, banners, tarjetas de ranking y marcos estáticos)
 * Se abre cuando la imagen elegida no mide exactamente lo pedido. La persona encuadra arrastrando (ratón o dedo),
 * acerca con el deslizador, la rueda o pellizcando, y también con el teclado (flechas mueven, + y − acercan).
 * - Zoom mínimo: la imagen cubre justo la zona visible (no se puede alejar más, así nunca quedan huecos).
 * - Zoom máximo: 100 veces ese mínimo. El deslizador es logarítmico para que todo el recorrido sea útil.
 * - El resultado es un WebP con la medida exacta pedida. La foto de perfil se recorta en círculo solo a la vista:
 *   el archivo es cuadrado (el círculo lo dibuja `Avatar`).
 * Todo ocurre en el dispositivo: la imagen original no se sube a ningún sitio.
 */

const MAX_ZOOM = 100;
const LOG_MAX = Math.log(MAX_ZOOM);
const zoomToT = (z: number) => Math.log(z) / LOG_MAX;
const tToZoom = (t: number) => Math.exp(Math.min(1, Math.max(0, t)) * LOG_MAX);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Margen del deslizador: el centro del botón no sale de la pista */
const KNOB = 9;

/** Encuadre: zoom (≥ 1) y desplazamiento del centro de la imagen respecto al del recorte, en fracción de la imagen */
interface View {
  z: number;
  fx: number;
  fy: number;
}

/** Medidas en pantalla: ventana de recorte (cw × ch) y tamaño de la imagen con zoom 1 (bw × bh) */
interface Geo {
  cw: number;
  ch: number;
  bw: number;
  bh: number;
}

const CENTER: View = { z: 1, fx: 0, fy: 0 };

function clampView(v: View, g: Geo): View {
  const z = clamp(v.z, 1, MAX_ZOOM);
  const mx = Math.max(0, (1 - g.cw / (g.bw * z)) / 2);
  const my = Math.max(0, (1 - g.ch / (g.bh * z)) / 2);
  return { z, fx: clamp(v.fx, -mx, mx), fy: clamp(v.fy, -my, my) };
}

/* ---------------- Deslizador de zoom (propio, sin el control nativo) ---------------- */

const ZoomSlider: React.FC<{ t: number; onChange: (t: number) => void; valueText: string; disabled?: boolean }> = ({
  t,
  onChange,
  valueText,
  disabled,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width <= KNOB * 2) return;
    onChange(clamp((clientX - r.left - KNOB) / (r.width - KNOB * 2), 0, 1));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = { ArrowLeft: -0.02, ArrowDown: -0.02, ArrowRight: 0.02, ArrowUp: 0.02, PageDown: -0.1, PageUp: 0.1 };
    if (e.key in step) onChange(clamp(t + step[e.key], 0, 1));
    else if (e.key === 'Home') onChange(0);
    else if (e.key === 'End') onChange(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className={`crop-slider ${disabled ? 'is-disabled' : ''}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Zoom"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(t * 100)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      style={{ '--t': t } as React.CSSProperties}
      onKeyDown={disabled ? undefined : onKeyDown}
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromPointer(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <span className="crop-slider-track" aria-hidden="true">
        <span className="crop-slider-fill" />
      </span>
      <span className="crop-slider-rail" aria-hidden="true">
        <span className="crop-slider-knob" />
      </span>
    </div>
  );
};

/* ---------------- Diálogo ---------------- */

export interface ImageCropModalProps {
  /** Imagen a recortar; `null` = cerrado */
  source: Blob | null;
  /** `circle` = foto de perfil (fuera del círculo, oscurecido); `rect` = banner, tarjeta o marco con su proporción */
  shape: 'circle' | 'rect';
  /** Medida exacta del resultado, en píxeles */
  width: number;
  height: number;
  title?: string;
  /** Texto bajo la zona de recorte (para qué es la imagen) */
  hint?: string;
  quality?: number;
  zIndex?: number;
  onCancel: () => void;
  /** Recibe el WebP final. Si lanza un error, se muestra en el diálogo y sigue abierto */
  onDone: (blob: Blob) => void | Promise<void>;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  source,
  shape,
  width,
  height,
  title = 'Encuadra la imagen',
  hint,
  quality = 0.88,
  zIndex = 1050,
  onCancel,
  onDone,
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stageW, setStageW] = useState(0);
  const [view, setView] = useState<View>(CENTER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const helpId = useId();

  // Una URL por imagen; se libera al cambiarla o al cerrar
  useEffect(() => {
    setNatural(null);
    setView(CENTER);
    setError(null);
    if (!source) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(source);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [source]);

  // Ancho disponible (cambia al girar el móvil o redimensionar la ventana)
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!source || !el) return;
    setStageW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(([entry]) => setStageW(entry.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, [source]);

  /* ---------- Geometría ---------- */

  const ratio = width / height;
  const avail = Math.max(0, stageW - 48);
  let cw: number;
  let ch: number;
  if (shape === 'circle') {
    cw = ch = Math.min(avail, 300);
  } else {
    cw = Math.min(avail, 640);
    ch = cw / ratio;
    if (ch > 280) {
      ch = 280;
      cw = ch * ratio;
    }
  }
  const stageH = shape === 'circle' ? ch + 48 : Math.max(ch + 96, 180);
  const s0 = natural ? Math.max(cw / natural.w, ch / natural.h) : 1;
  const geo: Geo | null = natural && cw > 0 ? { cw, ch, bw: natural.w * s0, bh: natural.h * s0 } : null;
  const geoRef = useRef<Geo | null>(geo);
  geoRef.current = geo;

  // Si cambia la ventana (resize), el encuadre se recoloca dentro de los límites
  useEffect(() => {
    if (geo) setView((v) => clampView(v, geo));
  }, [geo?.cw, geo?.ch, geo?.bw, geo?.bh]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Movimientos ---------- */

  const panBy = useCallback((dx: number, dy: number) => {
    setView((v) => {
      const g = geoRef.current;
      return g ? clampView({ z: v.z, fx: v.fx + dx / (g.bw * v.z), fy: v.fy + dy / (g.bh * v.z) }, g) : v;
    });
  }, []);

  /** Cambia el zoom manteniendo fijo el punto `p` (px respecto al centro del recorte) */
  const zoomWith = useCallback((next: (z: number) => number, p = { x: 0, y: 0 }) => {
    setView((v) => {
      const g = geoRef.current;
      if (!g) return v;
      const nz = clamp(next(v.z), 1, MAX_ZOOM);
      const k = nz / v.z;
      const ox = v.fx * g.bw * v.z;
      const oy = v.fy * g.bh * v.z;
      return clampView({ z: nz, fx: (p.x - (p.x - ox) * k) / (g.bw * nz), fy: (p.y - (p.y - oy) * k) / (g.bh * nz) }, g);
    });
  }, []);

  const pointFrom = (clientX: number, clientY: number) => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) } : { x: 0, y: 0 };
  };

  // Arrastrar con un dedo o el ratón; pellizcar con dos dedos
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy || !geo || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    if (map.size === 1) {
      panBy(e.clientX - prev.x, e.clientY - prev.y);
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    // Dos dedos: zoom por la distancia y desplazamiento por el punto medio
    const [a, b] = [...map.entries()].slice(0, 2);
    const other = a[0] === e.pointerId ? b[1] : a[1];
    const oldMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
    const newMid = { x: (e.clientX + other.x) / 2, y: (e.clientY + other.y) / 2 };
    const oldDist = Math.hypot(prev.x - other.x, prev.y - other.y);
    const newDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (oldDist > 0) zoomWith((z) => z * (newDist / oldDist), pointFrom(oldMid.x, oldMid.y));
    panBy(newMid.x - oldMid.x, newMid.y - oldMid.y);
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  // Rueda del ratón (o gesto del panel táctil): hace falta un listener no pasivo para que la página no se desplace
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !source) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
      const r = el.getBoundingClientRect();
      zoomWith((z) => z * Math.exp(-delta * 0.0015), { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [source, zoomWith]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (busy || !geo) return;
    const step = e.shiftKey ? 40 : 10;
    switch (e.key) {
      case 'ArrowLeft':
        panBy(-step, 0);
        break;
      case 'ArrowRight':
        panBy(step, 0);
        break;
      case 'ArrowUp':
        panBy(0, -step);
        break;
      case 'ArrowDown':
        panBy(0, step);
        break;
      case '+':
      case '=':
        zoomWith((z) => z * 1.15);
        break;
      case '-':
      case '_':
        zoomWith((z) => z / 1.15);
        break;
      case '0':
        setView(CENTER);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /* ---------- Resultado ---------- */

  const apply = async () => {
    const img = imgRef.current;
    if (!img || !natural || !geo || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Zona visible en píxeles de la imagen original
      const s = s0 * view.z;
      const sw = geo.cw / s;
      const sh = geo.ch / s;
      const cx = natural.w * (0.5 - view.fx);
      const cy = natural.h * (0.5 - view.fy);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo procesar la imagen.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, width, height);
      await onDone(await canvasToWebp(canvas, quality));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'No se pudo recortar la imagen.');
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onCancel();
  };

  const ox = geo ? view.fx * geo.bw * view.z : 0;
  const oy = geo ? view.fy * geo.bh * view.z : 0;
  const t = zoomToT(view.z);
  const zoomText = `${view.z < 10 ? view.z.toFixed(1).replace('.', ',') : Math.round(view.z)}×`;
  // La zona elegida tiene menos píxeles que el resultado: se verá algo borrosa
  const upscaled = Boolean(geo && geo.cw / (s0 * view.z) < width * 0.98);

  return (
    <Modal isOpen={Boolean(source)} onClose={close} title={title} wide zIndex={zIndex} preventBackdropClose>
      <div className="crop">
        <div
          ref={stageRef}
          className={`crop-stage ${busy ? 'is-busy' : ''}`}
          style={{ height: stageH }}
          tabIndex={0}
          data-autofocus
          role="group"
          aria-roledescription="zona de recorte"
          aria-label="Encuadre de la imagen"
          aria-describedby={helpId}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          {url && (
            <img
              ref={imgRef}
              className="crop-img"
              src={url}
              alt=""
              draggable={false}
              style={{
                width: geo?.bw ?? 0,
                height: geo?.bh ?? 0,
                opacity: geo ? 1 : 0,
                transform: `translate(-50%, -50%) translate(${ox}px, ${oy}px) scale(${view.z})`,
              }}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => setError('No se pudo leer la imagen. Prueba con otra (JPG, PNG o WebP).')}
            />
          )}
          {cw > 0 && <span className={`crop-window is-${shape}`} style={{ width: cw, height: ch }} aria-hidden="true" />}
          {!natural && !error && (
            <span className="crop-loading" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> Cargando la imagen…
            </span>
          )}
        </div>

        <div className="crop-zoom">
          <button type="button" className="icon-btn sm" aria-label="Alejar" onClick={() => zoomWith((z) => z / 1.25)} disabled={busy || !geo || view.z <= 1}>
            <Minus aria-hidden="true" />
          </button>
          <ZoomSlider t={t} valueText={`Zoom ${zoomText}`} disabled={busy || !geo} onChange={(nt) => zoomWith(() => tToZoom(nt))} />
          <button
            type="button"
            className="icon-btn sm"
            aria-label="Acercar"
            onClick={() => zoomWith((z) => z * 1.25)}
            disabled={busy || !geo || view.z >= MAX_ZOOM}
          >
            <Plus aria-hidden="true" />
          </button>
          <span className="crop-zoom-value" aria-hidden="true">
            {zoomText}
          </span>
        </div>

        <div className="crop-meta">
          <span id={helpId}>
            Arrastra para encuadrar. Acerca con el deslizador, la rueda o pellizcando. Con el teclado: flechas para mover, + y − para el
            zoom.
          </span>
          <span className="crop-size">
            {hint ? `${hint} · ` : ''}
            {width} × {height} px
          </span>
        </div>
        {upscaled && <p className="crop-note">La imagen es más pequeña que el tamaño final: con tanto zoom puede verse algo borrosa.</p>}
        {error && (
          <p className="crop-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void apply()} disabled={busy || !geo}>
          <Check aria-hidden="true" /> {busy ? 'Recortando…' : 'Aplicar recorte'}
        </button>
      </div>
    </Modal>
  );
};
