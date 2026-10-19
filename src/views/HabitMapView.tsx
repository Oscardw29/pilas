import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import type { Goal, Habit, HabitRelation } from '../types';
import { logKey } from '../lib/metrics';
import { computeMapLayout, type ClusterInput } from '../lib/habitMapLayout';
import {
  Network, Plus, Trash2, Sparkles, Link, Pause, X, HelpCircle, Play, Pencil, Target, ChevronDown, ArrowRight,
} from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { HabitModal } from '../components/modals/HabitModal';
import { HabitMapCanvas, type MapEdgeData, type MapNodeData, type MapRegionData } from '../components/habitMap/HabitMapCanvas';
import { RelationModal, EdgeSwatch, type RelationDraft } from '../components/habitMap/RelationModal';
import { EDGE_KINDS, EDGE_KIND_ORDER, RELATION_PHRASE, edgeKindOf, flowOf, type EdgeKind } from '../components/habitMap/relationMeta';
import '../components/habitMap/habitMap.css';

const GUIDE_KEY = 'constancia-habit-map-guide-v1';

/* ---------- Medida del texto de los nodos ---------- */
let measureCtx: CanvasRenderingContext2D | null = null;
const measure = (text: string, font: string) => {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7.4;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};
/** Recorta el nombre con «…» para que no pase de maxW px. */
const fitLabel = (text: string, font: string, maxW: number) => {
  if (measure(text, font) <= maxW) return { label: text, width: measure(text, font) };
  let t = text;
  while (t.length > 1 && measure(`${t.trimEnd()}…`, font) > maxW) t = t.slice(0, -1);
  const label = `${t.trimEnd()}…`;
  return { label, width: measure(label, font) };
};
const HABIT_FONT = '600 13px Inter, system-ui, sans-serif';
const GOAL_FONT = '700 14px Inter, system-ui, sans-serif';

const useIsNarrow = () => {
  const query = '(max-width: 639.98px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
};

const readGuideSeen = () => {
  try { return localStorage.getItem(GUIDE_KEY) === '1'; } catch { return false; }
};

/** «{pre} A {mid} B» con los hábitos como botones (o «este hábito» si es el elegido). */
const RelationSentence: React.FC<{
  rel: HabitRelation;
  selfId?: string;
  habitById: Map<string, Habit>;
  onPick?: (id: string) => void;
}> = ({ rel, selfId, habitById, onPick }) => {
  const phrase = RELATION_PHRASE[rel.type];
  const part = (id: string, first: boolean) => {
    const h = habitById.get(id);
    if (!h) return <span className="muted">(hábito eliminado)</span>;
    if (id === selfId) return <span className="hm-self">{first ? 'Este hábito' : 'este hábito'}</span>;
    return onPick ? (
      <button type="button" className="hm-link" onClick={() => onPick(id)}>{h.icon} {h.name}</button>
    ) : (
      <b>{h.icon} {h.name}</b>
    );
  };
  return (
    <span>
      {phrase.pre && `${phrase.pre} `}{part(rel.fromId, !phrase.pre)} {phrase.mid} {part(rel.toId, false)}
    </span>
  );
};

export const HabitMapView: React.FC = () => {
  const { habits, goals, relations, addRelation, deleteRelation, logs, setHabitStatus } = useStore(useShallow((s) => ({
    habits: s.habits, goals: s.goals, relations: s.relations, addRelation: s.addRelation, deleteRelation: s.deleteRelation, logs: s.logs, setHabitStatus: s.setHabitStatus,
  })));
  const { showToast } = useToast();
  const navigate = useNavigate();
  const isNarrow = useIsNarrow();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<Set<EdgeKind>>(new Set());
  const [relationModal, setRelationModal] = useState<{ open: boolean; initial: Partial<RelationDraft> }>({ open: false, initial: {} });
  const [relationToDelete, setRelationToDelete] = useState<{ id: string; sourceName: string; targetName: string } | null>(null);
  const [showGuide, setShowGuide] = useState(() => !readGuideSeen());
  const [habitModal, setHabitModal] = useState<{ open: boolean; habit?: Habit }>({ open: false });

  const activeHabits = useMemo(() => habits.filter((h) => h.status === 'active'), [habits]);
  const habitById = useMemo(() => new Map(habits.map((h) => [h.id, h])), [habits]);
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  /* ---------- Qué aparece en el mapa ---------- */
  const { mapHabits, mapGoals, mapRelations } = useMemo(() => {
    const related = new Set<string>();
    relations.forEach((r) => { related.add(r.fromId); related.add(r.toId); });
    // Los archivados solo aparecen si todavía tienen conexiones (para poder verlas o borrarlas).
    const mh = habits.filter((h) => h.status !== 'archived' || related.has(h.id));
    const shownHabitIds = new Set(mh.map((h) => h.id));
    const linkedGoals = new Set(mh.flatMap((h) => h.goals.map((l) => l.goalId)));
    const mg = goals.filter((g) => g.status === 'active' || g.status === 'paused' || linkedGoals.has(g.id));
    const mr = relations.filter((r) => shownHabitIds.has(r.fromId) && shownHabitIds.has(r.toId));
    return { mapHabits: mh, mapGoals: mg, mapRelations: mr };
  }, [habits, goals, relations]);

  const { nodes, edges, clusters, regions, flowEdges } = useMemo(() => {
    const shownGoalIds = new Set(mapGoals.map((g) => g.id));
    const labelMax = isNarrow ? 132 : 150;
    const nodes: MapNodeData[] = [];
    const nodeById = new Map<string, MapNodeData>();
    const push = (n: MapNodeData) => { nodes.push(n); nodeById.set(n.id, n); };
    mapGoals.forEach((g: Goal) => {
      const h = 48;
      const { label, width } = fitLabel(g.name, GOAL_FONT, labelMax + 20);
      push({
        id: g.id, kind: 'goal', icon: g.icon, label, fullName: g.name, color: g.color,
        inactive: g.status !== 'active', paused: g.status === 'paused', h, w: Math.ceil(h + width + 18),
      });
    });
    mapHabits.forEach((hb) => {
      const h = 40;
      const { label, width } = fitLabel(hb.name, HABIT_FONT, labelMax);
      push({
        id: hb.id, kind: 'habit', icon: hb.icon, label, fullName: hb.name, color: hb.color,
        inactive: hb.status !== 'active', paused: hb.status === 'paused', h, w: Math.ceil(h + width + 16),
      });
    });

    // Flechas entre hábitos, ya en el sentido en que se leen.
    const edges: MapEdgeData[] = [];
    const flowEdges = mapRelations.map((r) => ({ id: r.id, ...flowOf(r), kind: edgeKindOf(r.type) }));
    flowEdges.forEach((f) => edges.push({ id: f.id, from: f.from, to: f.to, kind: f.kind, route: 'curve' }));

    // Profundidad en la cadena: lo que va primero queda más arriba dentro de su región.
    const depth = new Map<string, number>();
    const incoming = new Map<string, string[]>();
    flowEdges.forEach((f) => incoming.set(f.to, [...(incoming.get(f.to) ?? []), f.from]));
    const depthOf = (id: string, seen: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (seen.has(id)) return 0; // ciclo: se corta aquí
      seen.add(id);
      const d = Math.max(-1, ...(incoming.get(id) ?? []).map((p) => depthOf(p, seen))) + 1;
      seen.delete(id);
      depth.set(id, d);
      return d;
    };

    const members = new Map<string, Habit[]>();
    const loose: Habit[] = [];
    mapHabits.forEach((hb) => {
      const links = hb.goals.filter((l) => shownGoalIds.has(l.goalId)).sort((a, b) => b.weight - a.weight);
      links.forEach((l, i) => {
        const goal = goalById.get(l.goalId)!;
        edges.push({ id: `goal:${hb.id}:${l.goalId}`, from: hb.id, to: l.goalId, kind: 'goal', color: goal.color, route: i === 0 ? 'rail' : 'curve' });
      });
      if (links[0]) members.set(links[0].goalId, [...(members.get(links[0].goalId) ?? []), hb]);
      else loose.push(hb);
    });

    const sortHabits = (list: Habit[], goalId?: string) =>
      [...list].sort((a, b) =>
        depthOf(a.id, new Set()) - depthOf(b.id, new Set())
        || (goalId ? (b.goals.find((l) => l.goalId === goalId)?.weight ?? 0) - (a.goals.find((l) => l.goalId === goalId)?.weight ?? 0) : 0)
        || a.name.localeCompare(b.name, 'es'));

    const toLayout = (n: MapNodeData) => ({ id: n.id, w: n.w, h: n.h });
    const clusters: ClusterInput[] = [];
    const regions = new Map<string, MapRegionData>();
    [...mapGoals]
      .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.priority - a.priority)
      .forEach((g) => {
        clusters.push({ id: g.id, goal: toLayout(nodeById.get(g.id)!), habits: sortHabits(members.get(g.id) ?? [], g.id).map((h) => toLayout(nodeById.get(h.id)!)) });
        regions.set(g.id, { color: g.color, inactive: g.status !== 'active' });
      });
    if (loose.length) {
      clusters.push({ id: '__none', habits: sortHabits(loose).map((h) => toLayout(nodeById.get(h.id)!)) });
      regions.set('__none', { color: '#8b8b99', inactive: false, title: 'Sin objetivo' });
    }
    return { nodes, edges, clusters, regions, flowEdges };
  }, [mapGoals, mapHabits, mapRelations, goalById, isNarrow]);

  const [canvasWidth, setCanvasWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const on = () => setCanvasWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const layout = useMemo(
    () => computeMapLayout(
      clusters,
      flowEdges,
      // En el móvil, tantas regiones por fila como quepan a tamaño legible; en escritorio, todo a la vista.
      isNarrow ? { fit: 'width', maxWidth: (canvasWidth - 32) / 0.85 } : { fit: 'all', aspect: 0.55 },
    ),
    [clusters, flowEdges, isNarrow, canvasWidth],
  );

  /* ---------- Patrones detectados en los registros (sin cambios de criterio) ---------- */
  const empiricalCorrelations = useMemo(() => {
    const results: { sourceId: string; targetId: string; pctWhenDone: number; pctWhenNotDone: number; deltaPct: number }[] = [];
    const dates = Array.from(new Set(Object.values(logs).map((l) => l.date)));
    const isDone = (date: string, habitId: string) => {
      const l = logs[logKey(date, habitId)];
      return !!l && (l.status === 'full' || l.status === 'minimum');
    };
    activeHabits.forEach((source) => {
      activeHabits.forEach((target) => {
        if (source.id === target.id) return;
        let sDone = 0, both = 0, sNot = 0, tWhenSNot = 0;
        dates.forEach((d) => {
          const t = isDone(d, target.id);
          if (isDone(d, source.id)) { sDone++; if (t) both++; } else { sNot++; if (t) tWhenSNot++; }
        });
        if (sDone >= 5 && sNot >= 5) {
          const pctWhenDone = Math.round((both / sDone) * 100);
          const pctWhenNotDone = Math.round((tWhenSNot / sNot) * 100);
          const deltaPct = pctWhenDone - pctWhenNotDone;
          if (deltaPct >= 20) results.push({ sourceId: source.id, targetId: target.id, pctWhenDone, pctWhenNotDone, deltaPct });
        }
      });
    });
    return results.sort((a, b) => b.deltaPct - a.deltaPct);
  }, [activeHabits, logs]);

  /* ---------- Acciones ---------- */
  const closeAll = useCallback(() => { setSelectedId(null); setConnectFromId(null); }, []);

  const onNodeTap = (id: string) => {
    if (connectFromId) {
      const target = habitById.get(id);
      if (!target || id === connectFromId) return;
      setRelationModal({ open: true, initial: { fromId: connectFromId, toId: id, type: 'facilitates' } });
      return;
    }
    setSelectedId((cur) => (cur === id ? null : id));
  };

  const startConnect = (fromId: string) => {
    setConnectFromId(fromId);
    setSelectedId(null);
  };

  const openNewRelation = (initial: Partial<RelationDraft> = {}) => setRelationModal({ open: true, initial });

  const saveRelation = (rel: Omit<HabitRelation, 'id'>) => {
    addRelation(rel);
    const a = habitById.get(rel.fromId);
    const b = habitById.get(rel.toId);
    showToast(`Conexión creada: ${a?.name ?? ''} → ${b?.name ?? ''}`, 'success');
    setRelationModal({ open: false, initial: {} });
    setConnectFromId(null);
    setSelectedId(rel.fromId);
  };

  const askDelete = (rel: HabitRelation) => {
    setRelationToDelete({ id: rel.id, sourceName: habitById.get(rel.fromId)?.name ?? '', targetName: habitById.get(rel.toId)?.name ?? '' });
  };

  const confirmDeleteRelation = () => {
    if (!relationToDelete) return;
    deleteRelation(relationToDelete.id);
    showToast(`Conexión «${relationToDelete.sourceName} → ${relationToDelete.targetName}» eliminada`, 'info');
    setRelationToDelete(null);
  };

  const resume = (h: Habit) => {
    setHabitStatus(h.id, 'active');
    showToast(`Hábito «${h.name}» reanudado`, 'success');
  };

  const dismissGuide = () => {
    setShowGuide(false);
    try { localStorage.setItem(GUIDE_KEY, '1'); } catch { /* sin almacenamiento: se volverá a mostrar */ }
  };

  const toggleKind = (k: EdgeKind) => setHiddenKinds((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // Esc: cancela la conexión en curso, cierra el detalle o sale de pantalla completa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || relationModal.open || relationToDelete || habitModal.open) return;
      if (connectFromId || selectedId) closeAll();
      else if (fullscreen) setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectFromId, selectedId, fullscreen, relationModal.open, relationToDelete, habitModal.open, closeAll]);

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // Si el nodo elegido desaparece (p. ej. se archivó), se cierra el detalle.
  useEffect(() => {
    if (selectedId && !nodes.some((n) => n.id === selectedId)) setSelectedId(null);
    if (connectFromId && !habitById.has(connectFromId)) setConnectFromId(null);
  }, [nodes, selectedId, connectFromId, habitById]);

  const kindCounts = useMemo(() => {
    const c = new Map<EdgeKind, number>();
    edges.forEach((e) => c.set(e.kind, (c.get(e.kind) ?? 0) + 1));
    return c;
  }, [edges]);

  const connectable = mapHabits.filter((h) => h.status !== 'archived');
  const canConnect = connectable.length >= 2;
  const selectedHabit = selectedId ? habitById.get(selectedId) : undefined;
  const selectedGoal = selectedId && !selectedHabit ? goalById.get(selectedId) : undefined;
  const connectFrom = connectFromId ? habitById.get(connectFromId) : undefined;

  /* ---------- Panel de detalle ---------- */
  const renderDetail = () => {
    if (selectedHabit) {
      const h = selectedHabit;
      const rels = mapRelations.filter((r) => r.fromId === h.id || r.toId === h.id);
      const totalWeight = h.goals.reduce((a, l) => a + l.weight, 0) || 1;
      return (
        <>
          <div className="hm-detail-head">
            <span className="hm-detail-icon" style={{ background: `${h.color}26` }}>{h.icon}</span>
            <div className="grow">
              <div className="hm-detail-kind">Hábito</div>
              <div className="hm-detail-title">{h.name}</div>
            </div>
            <button type="button" className="icon-btn sm" onClick={() => setSelectedId(null)} aria-label="Cerrar detalle"><X /></button>
          </div>

          {h.status === 'paused' && (
            <div className="hm-paused-note">
              <Pause size={14} strokeWidth={2.6} aria-hidden="true" /> <span className="grow">En pausa: sus conexiones no cuentan por ahora.</span>
              <button type="button" className="btn btn-secondary sm" onClick={() => resume(h)}><Play size={13} /> Reanudar</button>
            </div>
          )}
          {h.status === 'archived' && <div className="hm-paused-note">Archivado. Puedes borrar sus conexiones si ya no te sirven.</div>}

          <div className="hm-detail-sec">
            <div className="hm-detail-label">Aporta a</div>
            {h.goals.length === 0 ? (
              <p className="small muted">A ningún objetivo todavía. Edita el hábito para vincularlo a uno.</p>
            ) : (
              <div className="chips">
                {h.goals.map((l) => {
                  const g = goalById.get(l.goalId);
                  if (!g) return null;
                  return (
                    <button key={l.goalId} type="button" className="chip" onClick={() => setSelectedId(g.id)}>
                      {g.icon} {g.name} · {Math.round((l.weight / totalWeight) * 100)}%
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="hm-detail-sec">
            <div className="hm-detail-label">Conexiones ({rels.length})</div>
            {rels.length === 0 ? (
              <p className="small muted">Sin conexiones. Pulsa «Conectar» y toca otro hábito en el mapa.</p>
            ) : (
              <ul className="hm-rel-list">
                {rels.map((r) => (
                  <li key={r.id}>
                    <EdgeSwatch type={r.type} />
                    <div className="grow">
                      <RelationSentence rel={r} selfId={h.id} habitById={habitById} onPick={setSelectedId} />
                      {r.note && <div className="xs muted">{r.note}</div>}
                    </div>
                    <button type="button" className="icon-btn sm danger" onClick={() => askDelete(r)} aria-label="Eliminar conexión" title="Eliminar conexión"><Trash2 /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="hm-detail-actions">
            {h.status !== 'archived' && (
              <button type="button" className="btn btn-primary sm" onClick={() => startConnect(h.id)} disabled={!canConnect} title={canConnect ? undefined : 'Necesitas al menos dos hábitos'}>
                <Link size={14} /> Conectar con otro
              </button>
            )}
            <button type="button" className="btn btn-secondary sm" onClick={() => setHabitModal({ open: true, habit: h })}>
              <Pencil size={14} /> Editar hábito
            </button>
          </div>
        </>
      );
    }
    if (selectedGoal) {
      const g = selectedGoal;
      const contributors = mapHabits
        .map((h) => ({ h, link: h.goals.find((l) => l.goalId === g.id) }))
        .filter((x): x is { h: Habit; link: { goalId: string; weight: number } } => !!x.link);
      const total = contributors.reduce((a, c) => a + c.link.weight, 0) || 1;
      return (
        <>
          <div className="hm-detail-head">
            <span className="hm-detail-icon" style={{ background: `${g.color}26` }}>{g.icon}</span>
            <div className="grow">
              <div className="hm-detail-kind">Objetivo{g.status === 'paused' ? ' · en pausa' : g.status === 'completed' ? ' · completado' : ''}</div>
              <div className="hm-detail-title">{g.name}</div>
            </div>
            <button type="button" className="icon-btn sm" onClick={() => setSelectedId(null)} aria-label="Cerrar detalle"><X /></button>
          </div>
          <div className="hm-detail-sec">
            <div className="hm-detail-label">Hábitos que aportan ({contributors.length})</div>
            {contributors.length === 0 ? (
              <p className="small muted">Ningún hábito aporta a este objetivo. Edita un hábito y vincúlalo aquí.</p>
            ) : (
              <ul className="hm-rel-list">
                {contributors.sort((a, b) => b.link.weight - a.link.weight).map(({ h, link }) => (
                  <li key={h.id}>
                    <button type="button" className="hm-link grow" onClick={() => setSelectedId(h.id)}>{h.icon} {h.name}</button>
                    <span className="badge">{Math.round((link.weight / total) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="hm-detail-actions">
            <button type="button" className="btn btn-secondary sm" onClick={() => navigate(`/objetivos/${g.id}`)}>
              <Target size={14} /> Ver objetivo
            </button>
          </div>
        </>
      );
    }
    return null;
  };

  const detail = renderDetail();
  const hasHabits = mapHabits.length > 0;

  return (
    // fade-up deja un transform en el contenedor, que encerraría la pantalla completa (position: fixed).
    <div className={`stack${fullscreen ? '' : ' fade-up'}`}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Cómo se conectan tus hábitos y objetivos</p>
          <h1>Mapa de hábitos</h1>
        </div>
        {hasHabits && (
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={() => setShowGuide((v) => !v)} aria-expanded={showGuide}>
              <HelpCircle size={16} /> Cómo leerlo
            </button>
            <button type="button" className="btn btn-primary" onClick={() => openNewRelation()} disabled={!canConnect} title={canConnect ? undefined : 'Necesitas al menos dos hábitos'}>
              <Plus size={16} /> Nueva conexión
            </button>
          </div>
        )}
      </div>

      {!hasHabits ? (
        <div className="card empty">
          <div className="empty-icon"><Network size={24} /></div>
          <h3>Tu mapa todavía está en blanco</h3>
          <p>
            Aquí verás tus objetivos con los hábitos que aportan a cada uno, y flechas entre los hábitos que se ayudan o van en cadena.
            Empieza creando tu primer hábito.
          </p>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary" onClick={() => setHabitModal({ open: true })}><Plus size={16} /> Crear hábito</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/objetivos')}><Target size={16} /> Ver objetivos</button>
          </div>
        </div>
      ) : (
        <>
          {showGuide && (
            <div className="callout neutral hm-guide" role="note">
              <HelpCircle aria-hidden="true" />
              <div className="grow">
                <div className="title">Cómo leer el mapa</div>
                <ul className="hm-guide-list">
                  <li><b>Cada recuadro es un objetivo</b>; debajo cuelgan los hábitos que aportan a él.</li>
                  <li><b>Las flechas</b> van de lo que ocurre primero (o ayuda) a lo que viene después. Su color está en la leyenda.</li>
                  <li><b>Toca un hábito</b> para ver sus conexiones o conectarlo con otro.</li>
                </ul>
              </div>
              <button type="button" className="btn btn-secondary sm" onClick={dismissGuide}>Entendido</button>
            </div>
          )}

          {mapRelations.length === 0 && !showGuide && (
            <div className="callout neutral hm-guide" role="note">
              <Link aria-hidden="true" />
              <div className="grow">
                <div className="title">Aún no conectas hábitos entre sí</div>
                <div className="detail">
                  {canConnect
                    ? 'Toca un hábito en el mapa y pulsa «Conectar», o usa «Nueva conexión». Ejemplo: «Dormir temprano facilita hacer ejercicio».'
                    : 'Necesitas al menos dos hábitos activos para crear una conexión.'}
                </div>
              </div>
              {canConnect ? (
                <button type="button" className="btn btn-primary sm" onClick={() => openNewRelation()}>Crear conexión</button>
              ) : (
                <button type="button" className="btn btn-secondary sm" onClick={() => setHabitModal({ open: true })}><Plus size={14} /> Crear hábito</button>
              )}
            </div>
          )}

          <section className={`card hm-card${fullscreen ? ' is-full' : ''}${detail ? ' has-detail' : ''}`} aria-label="Mapa">
            <HabitMapCanvas
              nodes={nodes}
              edges={edges}
              layout={layout}
              regions={regions}
              fitMode={isNarrow ? 'width' : 'all'}
              selectedId={selectedId}
              hiddenKinds={hiddenKinds}
              connectFromId={connectFromId}
              onNodeTap={onNodeTap}
              onBackgroundTap={() => { if (!connectFromId) setSelectedId(null); }}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreen((v) => !v)}
              bottomInsetRatio={isNarrow && detail ? 0.55 : 0}
              rightInset={!isNarrow && detail ? 340 : 0}
            >
              {connectFrom && (
                <div className="hm-banner" role="status">
                  <span className="grow">Toca el hábito que quieres conectar con <b>{connectFrom.icon} {connectFrom.name}</b></span>
                  <button type="button" className="btn btn-secondary sm" onClick={() => setConnectFromId(null)}>Cancelar</button>
                </div>
              )}
              {detail && !connectFrom && (
                <aside className="hm-detail" aria-label="Detalle del nodo">{detail}</aside>
              )}
            </HabitMapCanvas>

            <div className="hm-legend" aria-label="Leyenda: toca un tipo para mostrarlo u ocultarlo">
              {EDGE_KIND_ORDER.map((k) => {
                const meta = EDGE_KINDS[k];
                const off = hiddenKinds.has(k);
                const count = kindCounts.get(k) ?? 0;
                return (
                  <button
                    key={k}
                    type="button"
                    className={`hm-legend-item${off ? ' off' : ''}${count === 0 ? ' is-zero' : ''}`}
                    onClick={() => toggleKind(k)}
                    aria-pressed={!off}
                    title={`${meta.hint}${off ? ' (oculto)' : ''}`}
                  >
                    <svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">
                      <line x1="1" y1="5" x2={k === 'goal' ? 25 : 19} y2="5" strokeLinecap="round" strokeDasharray={meta.dash} style={{ stroke: k === 'goal' ? 'var(--accent-2)' : meta.color, strokeWidth: meta.width + 0.4 }} />
                      {k !== 'goal' && <path d="M18,1 L25,5 L18,9 z" style={{ fill: meta.color }} />}
                    </svg>
                    <span>{meta.label}</span>
                    <span className="hm-legend-count">{count}</span>
                  </button>
                );
              })}
              <span className="hm-legend-hint xs faint">{isNarrow ? 'Arrastra para moverte · pellizca para zoom' : 'Arrastra para moverte · Ctrl + rueda para zoom'}</span>
            </div>
          </section>
        </>
      )}

      {/* Patrones detectados en los registros */}
      {empiricalCorrelations.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="row">
              <Sparkles size={18} style={{ color: 'var(--warning)' }} />
              <div>
                <div className="card-title">Patrones en tus registros</div>
                <div className="card-sub">Hábitos que suelen ir juntos. Añádelos al mapa si tiene sentido para ti.</div>
              </div>
            </div>
          </div>
          <ul className="hm-rel-list">
            {empiricalCorrelations.map((c) => {
              const s = habitById.get(c.sourceId)!;
              const t = habitById.get(c.targetId)!;
              const linked = relations.some((r) => (r.fromId === c.sourceId && r.toId === c.targetId) || (r.fromId === c.targetId && r.toId === c.sourceId));
              return (
                <li key={`${c.sourceId}-${c.targetId}`} className="hm-pattern">
                  <div className="grow">
                    <div className="row wrap gap-sm">
                      <span className="bold">{s.icon} {s.name}</span>
                      <ArrowRight size={14} className="muted" aria-hidden="true" />
                      <span className="bold">{t.icon} {t.name}</span>
                    </div>
                    <div className="small muted">
                      Cuando haces el primero, completas el segundo el <b className="success">{c.pctWhenDone}%</b> de los días (vs {c.pctWhenNotDone}% cuando no).
                    </div>
                  </div>
                  {linked ? (
                    <span className="badge accent">Ya en el mapa</span>
                  ) : (
                    <button type="button" className="btn btn-secondary sm" onClick={() => openNewRelation({ fromId: c.sourceId, toId: c.targetId, type: 'facilitates' })}>
                      <Plus size={14} /> Añadir al mapa
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Lista de todas las conexiones: alternativa accesible al mapa */}
      {relations.length > 0 && (
        <details className="card hm-all">
          <summary>
            <span className="card-title">Todas las conexiones</span>
            <span className="badge accent">{relations.length}</span>
            <ChevronDown size={16} className="hm-all-chevron" aria-hidden="true" />
          </summary>
          <ul className="hm-rel-list">
            {relations.map((r) => {
              const a = habitById.get(r.fromId);
              const b = habitById.get(r.toId);
              if (!a || !b) return null;
              const paused = [a, b].filter((h) => h.status === 'paused');
              return (
                <li key={r.id}>
                  <EdgeSwatch type={r.type} />
                  <div className="grow">
                    <RelationSentence rel={r} habitById={habitById} onPick={(id) => { setSelectedId(id); setFullscreen(false); }} />
                    {r.note && <div className="xs muted">{r.note}</div>}
                    {paused.length > 0 && (
                      <div className="row wrap gap-sm" style={{ marginTop: 6 }}>
                        {paused.map((h) => (
                          <button key={h.id} type="button" className="btn btn-secondary sm" onClick={() => resume(h)}>
                            <Play size={13} /> Reanudar {h.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className="icon-btn sm danger" onClick={() => askDelete(r)} aria-label="Eliminar conexión" title="Eliminar conexión"><Trash2 /></button>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <RelationModal
        isOpen={relationModal.open}
        onClose={() => setRelationModal({ open: false, initial: {} })}
        habits={connectable}
        relations={relations}
        initial={relationModal.initial}
        onSave={saveRelation}
      />

      {habitModal.open && (
        <HabitModal isOpen={habitModal.open} onClose={() => setHabitModal({ open: false })} habitToEdit={habitModal.habit} />
      )}

      <ConfirmModal
        isOpen={relationToDelete !== null}
        onClose={() => setRelationToDelete(null)}
        onConfirm={confirmDeleteRelation}
        title="Eliminar conexión de hábitos"
        message={`¿Seguro que quieres eliminar la conexión entre «${relationToDelete?.sourceName}» y «${relationToDelete?.targetName}»? Los hábitos no se borran.`}
        confirmLabel="Eliminar conexión"
        confirmVariant="danger"
      />
    </div>
  );
};
