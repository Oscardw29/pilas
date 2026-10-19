import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus, Scan, Pause } from 'lucide-react';
import { routeEdges, type MapLayout, type Point } from '@/lib/habitMapLayout';
import { EDGE_KINDS, type EdgeKind } from './relationMeta';

export interface MapNodeData {
  id: string;
  kind: 'goal' | 'habit';
  icon: string;
  /** Nombre ya recortado para que quepa en el nodo */
  label: string;
  fullName: string;
  color: string;
  /** Pausado, archivado o (objetivo) sin estar activo */
  inactive: boolean;
  paused: boolean;
  w: number;
  h: number;
}

export interface MapEdgeData {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Color propio (para las líneas hacia objetivos) */
  color?: string;
  /** 'rail': el hábito cuelga del riel de su objetivo principal */
  route: 'rail' | 'curve';
}

export interface MapRegionData {
  color: string;
  inactive: boolean;
  /** Título para la región sin objetivo */
  title?: string;
}

interface View { x: number; y: number; k: number }

interface Props {
  nodes: MapNodeData[];
  edges: MapEdgeData[];
  layout: MapLayout;
  regions: Map<string, MapRegionData>;
  /** 'all': todo el mapa a la vista; 'width': ocupa el ancho y se recorre deslizando (móvil) */
  fitMode: 'all' | 'width';
  selectedId: string | null;
  hiddenKinds: Set<EdgeKind>;
  /** Hábito desde el que se está creando una conexión */
  connectFromId: string | null;
  onNodeTap: (id: string) => void;
  onBackgroundTap: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Fracción del alto que tapa la hoja de detalle por abajo (móvil), para centrar el nodo elegido por encima */
  bottomInsetRatio: number;
  /** Ancho (px) que tapa el panel de detalle por la derecha */
  rightInset: number;
  children?: React.ReactNode;
}

const MIN_K = 0.2;
const MAX_K = 2.5;
const PAD = 28;
const CONTROLS_W = 52;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export const HabitMapCanvas: React.FC<Props> = ({
  nodes, edges, layout, regions, fitMode, selectedId, hiddenKinds, connectFromId, onNodeTap, onBackgroundTap,
  fullscreen, onToggleFullscreen, bottomInsetRatio, rightInset, children,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dragging, setDragging] = useState(false);

  /* ---------- Tamaño del contenedor ---------- */
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------- Ajustar a la pantalla ---------- */
  const computeFit = useCallback((mode: 'all' | 'width'): View | null => {
    if (!size.w || !size.h) return null;
    const { minX, minY, maxX, maxY } = layout.bounds;
    // A la izquierda quedan los botones de zoom (en escritorio): el mapa se centra en el resto.
    const left = size.w >= 520 ? CONTROLS_W : 0;
    const w = size.w - left;
    const bw = Math.max(1, maxX - minX + PAD * 2);
    const bh = Math.max(1, maxY - minY + PAD * 2);
    const k = clampK(mode === 'width' ? Math.min(w / bw, 1) : Math.min(w / bw, size.h / bh, 1.15));
    const tall = mode === 'width' && bh * k > size.h;
    return {
      k,
      x: left + w / 2 - ((minX + maxX) / 2) * k,
      // Si no cabe a lo alto, se ve desde arriba y se recorre deslizando.
      y: tall ? (PAD - minY) * k : size.h / 2 - ((minY + maxY) / 2) * k,
    };
  }, [layout, size.w, size.h]);

  const applyView = (v: View) => { viewRef.current = v; setView(v); };

  /** Encuadra el nodo elegido y sus vecinos en la zona que no tapa el panel (si hace falta). */
  const frameSelection = useCallback((v: View): View => {
    if (!selectedId || !size.w) return v;
    const ids = new Set([selectedId]);
    edges.forEach((e) => {
      if (!hiddenKinds.has(e.kind) && (e.from === selectedId || e.to === selectedId)) { ids.add(e.from); ids.add(e.to); }
    });
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    ids.forEach((id) => {
      const p = layout.positions.get(id);
      const s = layout.sizes.get(id);
      if (!p || !s) return;
      b.minX = Math.min(b.minX, p.x - s.w / 2); b.maxX = Math.max(b.maxX, p.x + s.w / 2);
      b.minY = Math.min(b.minY, p.y - s.h / 2); b.maxY = Math.max(b.maxY, p.y + s.h / 2);
    });
    if (!Number.isFinite(b.minX)) return v;
    const left = size.w >= 520 ? CONTROLS_W : 8;
    const right = size.w - rightInset - 8;
    const bottom = size.h * (1 - bottomInsetRatio) - 8;
    const inside = b.minX * v.k + v.x >= left && b.maxX * v.k + v.x <= right && b.minY * v.k + v.y >= 8 && b.maxY * v.k + v.y <= bottom;
    if (inside) return v;
    // Si el vecindario no cabe al zoom actual, se aleja lo justo (sin bajar de un tamaño legible).
    const k = Math.min(v.k, Math.max(0.55, Math.min((right - left - 16) / (b.maxX - b.minX), (bottom - 24) / (b.maxY - b.minY))));
    return { k, x: (left + right) / 2 - ((b.minX + b.maxX) / 2) * k, y: (8 + bottom) / 2 - ((b.minY + b.maxY) / 2) * k };
  }, [selectedId, edges, hiddenKinds, layout, size.w, size.h, bottomInsetRatio, rightInset]);

  // Un solo efecto para ajustar y encuadrar: si el lienzo cambia de tamaño al abrir el detalle,
  // primero se re-ajusta y luego se encuadra, sin que un paso pise al otro.
  const lastFit = useRef<{ layout: MapLayout; w: number; h: number; mode: string } | null>(null);
  useEffect(() => {
    let v = viewRef.current;
    const lf = lastFit.current;
    if (!lf || lf.layout !== layout || lf.w !== size.w || lf.h !== size.h || lf.mode !== fitMode) {
      const f = computeFit(fitMode);
      if (f) { v = f; lastFit.current = { layout, w: size.w, h: size.h, mode: fitMode }; }
    }
    v = frameSelection(v);
    if (v !== viewRef.current) applyView(v);
  }, [computeFit, frameSelection, layout, size.w, size.h, fitMode]);

  const fitAll = () => { const f = computeFit('all'); if (f) applyView(f); };

  /* ---------- Móvil: el lienzo mide lo que mide el mapa (sin huecos), salvo con el detalle abierto ---------- */
  const autoHeight = useMemo(() => {
    if (fitMode !== 'width' || fullscreen || !size.w) return undefined;
    const maxH = Math.min(window.innerHeight * 0.66, 560);
    if (selectedId || connectFromId) return Math.round(maxH);
    const { minX, minY, maxX, maxY } = layout.bounds;
    const bw = Math.max(1, maxX - minX + PAD * 2);
    const bh = Math.max(1, maxY - minY + PAD * 2);
    const k = Math.min(size.w / bw, 1);
    return Math.round(Math.min(maxH, Math.max(300, bh * k)));
  }, [fitMode, fullscreen, size.w, layout, selectedId, connectFromId]);

  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const v = viewRef.current;
    const k = clampK(v.k * factor);
    const f = k / v.k;
    applyView({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f });
  }, []);

  /* ---------- Rueda: zoom solo con Ctrl/⌘ (o pellizco del trackpad) para no atrapar el scroll ---------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0045), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  /* ---------- Arrastrar y pellizcar ---------- */
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ view: View; pts: Point[]; moved: boolean; nodeId: string | null } | null>(null);

  const localPoint = (e: React.PointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startGesture = (nodeId: string | null) => {
    gesture.current = { view: viewRef.current, pts: [...pointers.current.values()], moved: false, nodeId };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const nodeEl = (e.target as Element).closest('[data-node-id]');
    pointers.current.set(e.pointerId, localPoint(e));
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    startGesture(pointers.current.size === 1 ? nodeEl?.getAttribute('data-node-id') ?? null : null);
    if (pointers.current.size > 1 && gesture.current) gesture.current.moved = true;
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, localPoint(e));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 1 && g.pts.length === 1) {
      const dx = pts[0].x - g.pts[0].x;
      const dy = pts[0].y - g.pts[0].y;
      if (!g.moved && Math.hypot(dx, dy) < 5) return;
      if (!g.moved) { g.moved = true; setDragging(true); }
      setView({ k: g.view.k, x: g.view.x + dx, y: g.view.y + dy });
    } else if (pts.length >= 2 && g.pts.length >= 2) {
      const d0 = Math.hypot(g.pts[1].x - g.pts[0].x, g.pts[1].y - g.pts[0].y) || 1;
      const d1 = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const m0 = { x: (g.pts[0].x + g.pts[1].x) / 2, y: (g.pts[0].y + g.pts[1].y) / 2 };
      const m1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const k = clampK(g.view.k * (d1 / d0));
      // El punto del mapa que estaba bajo los dedos sigue bajo los dedos.
      const wx = (m0.x - g.view.x) / g.view.k;
      const wy = (m0.y - g.view.y) / g.view.k;
      setView({ k, x: m1.x - wx * k, y: m1.y - wy * k });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size === 0) {
      setDragging(false);
      if (g && !g.moved && e.type === 'pointerup') {
        if (g.nodeId) onNodeTap(g.nodeId);
        else onBackgroundTap();
      }
      gesture.current = null;
    } else {
      // Se levantó un dedo del pellizco: sigue arrastrando con el que queda.
      startGesture(null);
      if (gesture.current) gesture.current.moved = true;
    }
  };

  /* ---------- Vecindario del nodo elegido ---------- */
  const visibleEdges = useMemo(() => edges.filter((e) => !hiddenKinds.has(e.kind)), [edges, hiddenKinds]);
  const focus = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set<string>([selectedId]);
    const edgeIds = new Set<string>();
    visibleEdges.forEach((e) => {
      if (e.from === selectedId || e.to === selectedId) {
        ids.add(e.from); ids.add(e.to); edgeIds.add(e.id);
      }
    });
    return { ids, edgeIds };
  }, [selectedId, visibleEdges]);

  /* ---------- Geometría de las líneas ---------- */
  const routes = useMemo(() => routeEdges(edges, layout), [edges, layout]);
  // Las líneas resaltadas se dibujan al final para que queden por encima.
  const edgeGeo = useMemo(() => {
    const list = visibleEdges
      .map((e) => ({ e, r: routes.get(e.id) }))
      .filter((x): x is { e: MapEdgeData; r: { d: string; mid: Point } } => !!x.r);
    return focus ? [...list.filter((x) => !focus.edgeIds.has(x.e.id)), ...list.filter((x) => focus.edgeIds.has(x.e.id))] : list;
  }, [visibleEdges, routes, focus]);

  // ¿Queda mapa por debajo del borde? (móvil: invita a deslizar)
  const moreBelow = size.h > 0 && (layout.bounds.maxY + PAD) * view.k + view.y > size.h + 8;

  return (
    <div ref={wrapRef} className={`hm-canvas${dragging ? ' is-dragging' : ''}${connectFromId ? ' is-connecting' : ''}`} style={autoHeight ? { height: autoHeight } : undefined}>
      <svg
        ref={svgRef}
        className="hm-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="group"
        aria-label="Mapa de hábitos y objetivos. Arrastra para moverte; usa los botones para acercar o ajustar."
      >
        <defs>
          {(['facilitates', 'sequence', 'requires', 'blocks'] as EdgeKind[]).map((k) => (
            <marker key={k} id={`hm-arrow-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0,0.5 L10,5 L0,9.5 z" style={{ fill: EDGE_KINDS[k].color }} />
            </marker>
          ))}
          <pattern id="hm-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="hm-dot" />
          </pattern>
        </defs>

        <rect className="hm-bg" x={0} y={0} width={size.w} height={size.h} fill="url(#hm-dots)" />

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Regiones: un objetivo y los hábitos que aportan a él */}
          <g className="hm-regions" aria-hidden="true">
            {layout.clusters.map((c) => {
              const r = regions.get(c.id);
              if (!r) return null;
              const dim = !!focus && !focus.ids.has(c.id) && !nodes.some((n) => focus.ids.has(n.id) && layout.clusterOf.get(n.id) === c.id);
              return (
                <g key={c.id} className={`hm-region${r.inactive ? ' is-inactive' : ''}`} opacity={dim ? 0.45 : 1}>
                  <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={18} style={{ fill: r.color, stroke: r.color }} />
                  {r.title && <text x={c.x + 16} y={c.y + 14 + 17}>{r.title}</text>}
                </g>
              );
            })}
          </g>

          {/* Líneas */}
          <g className="hm-edges">
            {edgeGeo.map(({ e, r: { d, mid } }) => {
              const meta = EDGE_KINDS[e.kind];
              const isGoal = e.kind === 'goal';
              const lit = focus?.edgeIds.has(e.id);
              const dim = focus && !lit;
              return (
                <g key={e.id} opacity={dim ? 0.1 : isGoal ? (lit ? 0.9 : e.route === 'rail' ? 0.5 : 0.4) : 1}>
                  <path
                    d={d}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={isGoal && e.route === 'curve' ? '3 5' : meta.dash}
                    style={{ stroke: e.color ?? meta.color, strokeWidth: lit ? meta.width + 1 : meta.width }}
                    markerEnd={isGoal ? undefined : `url(#hm-arrow-${e.kind})`}
                  />
                  {lit && !isGoal && (
                    <g transform={`translate(${mid.x},${mid.y})`} className="hm-edge-tag">
                      <rect x={-meta.label.length * 3.4 - 8} y={-10} width={meta.label.length * 6.8 + 16} height={20} rx={10} style={{ stroke: meta.color }} />
                      <text textAnchor="middle" dy="0.35em" style={{ fill: meta.color }}>{meta.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Nodos */}
          <g className="hm-nodes">
            {nodes.map((n) => {
              const p = layout.positions.get(n.id);
              if (!p) return null;
              const selected = n.id === selectedId;
              const dim = (focus && !focus.ids.has(n.id)) || (connectFromId && (n.kind === 'goal' || n.id === connectFromId));
              const target = connectFromId && n.kind === 'habit' && n.id !== connectFromId;
              const isGoal = n.kind === 'goal';
              const r = isGoal ? 14 : n.h / 2;
              const iconR = n.h / 2 - 6;
              return (
                <g
                  key={n.id}
                  data-node-id={n.id}
                  transform={`translate(${p.x - n.w / 2},${p.y - n.h / 2})`}
                  className={`hm-node ${isGoal ? 'is-goal' : 'is-habit'}${selected ? ' is-selected' : ''}${n.inactive ? ' is-inactive' : ''}${target ? ' is-target' : ''}`}
                  opacity={dim ? 0.28 : 1}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selected}
                  aria-label={`${isGoal ? 'Objetivo' : 'Hábito'}: ${n.fullName}${n.paused ? ' (en pausa)' : ''}`}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onNodeTap(n.id); }
                  }}
                >
                  <title>{n.fullName}</title>
                  <rect className="hm-node-base" width={n.w} height={n.h} rx={r} />
                  <rect
                    className="hm-node-box"
                    width={n.w}
                    height={n.h}
                    rx={r}
                    style={isGoal ? { fill: n.color, stroke: n.color } : undefined}
                  />
                  <circle cx={n.h / 2} cy={n.h / 2} r={iconR} style={{ fill: n.color }} className="hm-node-icon-bg" />
                  <text x={n.h / 2} y={n.h / 2} dy="0.35em" textAnchor="middle" className="hm-node-icon">{n.icon}</text>
                  <text x={n.h - 2} y={n.h / 2} dy="0.35em" className="hm-node-label">{n.label}</text>
                  {n.paused && (
                    <g transform={`translate(${n.w - 8},${-2})`} className="hm-node-paused">
                      <circle r={9} />
                      <Pause x={-5} y={-5} width={10} height={10} strokeWidth={3} />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div className="hm-controls" role="toolbar" aria-label="Controles del mapa">
        <button type="button" className="hm-ctrl" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)} aria-label="Acercar" title="Acercar"><Plus /></button>
        <button type="button" className="hm-ctrl" onClick={() => zoomAt(0.8, size.w / 2, size.h / 2)} aria-label="Alejar" title="Alejar"><Minus /></button>
        <button type="button" className="hm-ctrl" onClick={fitAll} aria-label="Ajustar a la pantalla" title="Ajustar a la pantalla"><Scan /></button>
        <button type="button" className="hm-ctrl" onClick={onToggleFullscreen} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </button>
      </div>

      {moreBelow && fitMode === 'width' && (
        <div className="hm-more" aria-hidden="true">Desliza para ver más</div>
      )}

      {children}
    </div>
  );
};
