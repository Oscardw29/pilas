/**
 * Disposición del mapa de hábitos.
 *
 * Cada objetivo es una «región»: su nodo arriba y, debajo, en columna, los hábitos que más
 * aportan a él, colgados de un riel de su color. Las regiones se acomodan en filas y columnas
 * según la forma del contenedor y se ordenan para que las regiones con más conexiones entre sí
 * queden juntas. Nada se calcula con aleatoriedad: el mismo dato da siempre el mismo dibujo.
 *
 * Las flechas entre hábitos de una misma región se curvan por el costado derecho (con espacio
 * reservado) para no pasar por encima de los hábitos de en medio.
 */

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface ClusterInput {
  id: string;
  /** Nodo del objetivo; sin él, la región es «Sin objetivo» y lleva solo un título */
  goal?: LayoutNode;
  /** Hábitos ya ordenados de arriba abajo */
  habits: LayoutNode[];
}

export interface Point { x: number; y: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface ClusterBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** x del riel vertical que une los hábitos con el objetivo */
  railX: number;
  /** Borde derecho de los hábitos (de ahí salen las curvas internas) */
  contentRight: number;
  hasGoal: boolean;
}

export interface MapLayout {
  positions: Map<string, Point>;
  sizes: Map<string, { w: number; h: number }>;
  clusterOf: Map<string, string>;
  clusters: ClusterBox[];
  bounds: Bounds;
}

const PAD = 14;
const HEADER_NO_GOAL = 26;
const RAIL_OFFSET = 24;
const HABIT_INDENT = 46;
const STEP_GAP = 14;
const COL_GAP = 64;
const ROW_GAP = 52;
const ARC_BASE = 22;
const ARC_STEP = 12;

/**
 * @param edges flechas entre hábitos (para reservar el espacio de las curvas y ordenar regiones)
 * @param fit 'all': elige columnas para que todo quepa en un contenedor de proporción `aspect` (alto/ancho);
 *            'width': tantas columnas como quepan en `maxWidth` px (móvil: se recorre deslizando).
 */
export function computeMapLayout(
  clusters: ClusterInput[],
  edges: { from: string; to: string }[],
  opts: { fit: 'all'; aspect: number } | { fit: 'width'; maxWidth: number },
): MapLayout {
  const clusterOf = new Map<string, string>();
  const indexIn = new Map<string, number>();
  clusters.forEach((c) => {
    if (c.goal) clusterOf.set(c.goal.id, c.id);
    c.habits.forEach((h, i) => { clusterOf.set(h.id, c.id); indexIn.set(h.id, i); });
  });

  /* ---------- Tamaño de cada región ---------- */
  const maxSpan = new Map<string, number>();
  const crossWeight = new Map<string, number>();
  edges.forEach((e) => {
    const ca = clusterOf.get(e.from);
    const cb = clusterOf.get(e.to);
    if (!ca || !cb) return;
    if (ca === cb) {
      const span = Math.abs((indexIn.get(e.from) ?? 0) - (indexIn.get(e.to) ?? 0));
      maxSpan.set(ca, Math.max(maxSpan.get(ca) ?? 0, span));
    } else {
      const key = [ca, cb].sort().join('|');
      crossWeight.set(key, (crossWeight.get(key) ?? 0) + 1);
    }
  });

  const dims = new Map<string, { w: number; h: number; contentW: number }>();
  clusters.forEach((c) => {
    const headH = c.goal ? c.goal.h : HEADER_NO_GOAL;
    const habitsW = c.habits.length ? Math.max(...c.habits.map((h) => h.w)) + (c.goal ? HABIT_INDENT : 0) : 0;
    const contentW = Math.max(c.goal?.w ?? 110, habitsW);
    const span = maxSpan.get(c.id) ?? 0;
    const arc = span > 0 ? ARC_BASE + ARC_STEP * span : 0;
    const habitsH = c.habits.reduce((a, h) => a + h.h + STEP_GAP, 0);
    dims.set(c.id, {
      contentW,
      w: PAD * 2 + contentW + arc,
      h: PAD * 2 + headH + (c.habits.length ? 16 + habitsH - STEP_GAP : 0),
    });
  });

  /* ---------- Orden de las regiones: las que se conectan, juntas ---------- */
  let order = clusters.map((c) => c.id);
  if (crossWeight.size && order.length <= 7) {
    const fixedLast = order[order.length - 1] === '__none' ? order.pop() : undefined;
    const cost = (perm: string[]) => {
      const pos = new Map(perm.map((id, i) => [id, i]));
      let s = 0;
      crossWeight.forEach((w, key) => {
        const [a, b] = key.split('|');
        if (pos.has(a) && pos.has(b)) s += w * Math.abs(pos.get(a)! - pos.get(b)!);
      });
      return s;
    };
    let best = order;
    let bestCost = cost(order);
    const permute = (arr: string[], k: number) => {
      if (k === arr.length) {
        const c = cost(arr);
        if (c < bestCost) { bestCost = c; best = [...arr]; }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        permute(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    permute([...order], 0);
    order = fixedLast ? [...best, fixedLast] : best;
  }

  /* ---------- Filas ---------- */
  const rowsFor = (cols: number) => {
    const rows: string[][] = [];
    for (let i = 0; i < order.length; i += cols) rows.push(order.slice(i, i + cols));
    const widths = rows.map((r) => r.reduce((a, id) => a + dims.get(id)!.w, 0) + COL_GAP * (r.length - 1));
    const heights = rows.map((r) => Math.max(...r.map((id) => dims.get(id)!.h)));
    return { rows, w: Math.max(...widths), h: heights.reduce((a, b) => a + b, 0) + ROW_GAP * (rows.length - 1), heights };
  };

  let pick = rowsFor(1);
  if (opts.fit === 'all') {
    let bestScore = -Infinity;
    for (let cols = 1; cols <= order.length; cols++) {
      const r = rowsFor(cols);
      const score = Math.min(1 / r.w, opts.aspect / r.h);
      if (score > bestScore + 1e-9) { bestScore = score; pick = r; }
    }
  } else {
    for (let cols = 1; cols <= order.length; cols++) {
      const r = rowsFor(cols);
      if (r.w <= opts.maxWidth) pick = r; else break;
    }
  }

  /* ---------- Coordenadas ---------- */
  const positions = new Map<string, Point>();
  const sizes = new Map<string, { w: number; h: number }>();
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const boxes: ClusterBox[] = [];
  let y = 0;
  pick.rows.forEach((row, ri) => {
    const rowW = row.reduce((a, id) => a + dims.get(id)!.w, 0) + COL_GAP * (row.length - 1);
    let x = (pick.w - rowW) / 2;
    row.forEach((id) => {
      const c = byId.get(id)!;
      const d = dims.get(id)!;
      const left = x + PAD;
      let top = y + PAD;
      if (c.goal) {
        positions.set(c.goal.id, { x: left + c.goal.w / 2, y: top + c.goal.h / 2 });
        sizes.set(c.goal.id, { w: c.goal.w, h: c.goal.h });
        top += c.goal.h + 16;
      } else {
        top += HEADER_NO_GOAL + 16;
      }
      const habitLeft = left + (c.goal ? HABIT_INDENT : 0);
      c.habits.forEach((h) => {
        positions.set(h.id, { x: habitLeft + h.w / 2, y: top + h.h / 2 });
        sizes.set(h.id, { w: h.w, h: h.h });
        top += h.h + STEP_GAP;
      });
      boxes.push({ id, x, y, w: d.w, h: d.h, railX: left + RAIL_OFFSET, contentRight: left + d.contentW, hasGoal: !!c.goal });
      x += d.w + COL_GAP;
    });
    y += pick.heights[ri] + ROW_GAP;
  });

  return {
    positions,
    sizes,
    clusterOf,
    clusters: boxes,
    bounds: { minX: 0, minY: 0, maxX: pick.w, maxY: pick.h },
  };
}

/* ---------- Trazado de líneas ---------- */

export interface EdgeRouteInput {
  id: string;
  from: string;
  to: string;
  /** 'rail': hábito colgado del riel de su objetivo; 'curve': cualquier otra línea */
  route: 'rail' | 'curve';
}

export interface EdgeRoute { d: string; mid: Point }

const cubicMid = (p0: Point, c1: Point, c2: Point, p3: Point): Point => ({
  x: 0.125 * p0.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p3.x,
  y: 0.125 * p0.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p3.y,
});

export function routeEdges(edges: EdgeRouteInput[], layout: MapLayout): Map<string, EdgeRoute> {
  const out = new Map<string, EdgeRoute>();
  const box = new Map(layout.clusters.map((c) => [c.id, c]));
  // Curvas internas de una misma región: cuanto más lejos, más abierta (y repartidas si hay varias).
  const arcUse = new Map<string, number>();

  edges.forEach((e) => {
    const pa = layout.positions.get(e.from);
    const pb = layout.positions.get(e.to);
    const sa = layout.sizes.get(e.from);
    const sb = layout.sizes.get(e.to);
    if (!pa || !pb || !sa || !sb) return;
    const ca = layout.clusterOf.get(e.from);
    const cb = layout.clusterOf.get(e.to);

    if (e.route === 'rail') {
      const c = box.get(ca!);
      if (!c) return;
      const top = pb.y + sb.h / 2;
      const left = pa.x - sa.w / 2;
      out.set(e.id, { d: `M${left - 2},${pa.y} H${c.railX} V${top}`, mid: { x: c.railX, y: (pa.y + top) / 2 } });
      return;
    }

    if (ca && ca === cb) {
      const c = box.get(ca)!;
      const span = Math.max(1, Math.round(Math.abs(pb.y - pa.y) / 54));
      const key = `${ca}:${span}`;
      const n = arcUse.get(key) ?? 0;
      arcUse.set(key, n + 1);
      const xr = c.contentRight + ARC_BASE - 6 + ARC_STEP * (span - 1) + n * 6;
      const s = { x: pa.x + sa.w / 2 + 2, y: pa.y + (pb.y > pa.y ? 4 : -4) };
      const t = { x: pb.x + sb.w / 2 + 5, y: pb.y + (pb.y > pa.y ? -4 : 4) };
      const c1 = { x: xr, y: s.y };
      const c2 = { x: xr, y: t.y };
      out.set(e.id, { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`, mid: cubicMid(s, c1, c2, t) });
      return;
    }

    // Entre regiones: salen por el lado que mira hacia el destino.
    const dir = pb.x >= pa.x ? 1 : -1;
    const overlapX = Math.abs(pb.x - pa.x) < (sa.w + sb.w) / 2 + 20;
    let s: Point, t: Point, c1: Point, c2: Point;
    if (overlapX) {
      // Uno encima del otro (otra fila): rodean por la derecha.
      s = { x: pa.x + sa.w / 2 + 2, y: pa.y };
      t = { x: pb.x + sb.w / 2 + 5, y: pb.y };
      const xr = Math.max(s.x, t.x) + 40;
      c1 = { x: xr, y: s.y };
      c2 = { x: xr, y: t.y };
    } else {
      s = { x: pa.x + dir * (sa.w / 2 + 2), y: pa.y };
      t = { x: pb.x - dir * (sb.w / 2 + 5), y: pb.y };
      const k = Math.max(36, Math.abs(t.x - s.x) * 0.45);
      c1 = { x: s.x + dir * k, y: s.y };
      c2 = { x: t.x - dir * k, y: t.y };
    }
    out.set(e.id, { d: `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${t.x},${t.y}`, mid: cubicMid(s, c1, c2, t) });
  });
  return out;
}
