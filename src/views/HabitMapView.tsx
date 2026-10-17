import React, { useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store/useStore';
import { RelationType, HabitRelation, HabitLog } from '../types';
import { Network, Plus, ArrowRight, ArrowLeft, Trash2, Sparkles, Link, Zap, ShieldAlert, Pause } from 'lucide-react';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { useToast } from '../components/ui/ToastContext';
import { CustomSelect } from '../components/ui/CustomSelect';

export const HabitMapView: React.FC = () => {
  const { habits, relations, addRelation, deleteRelation, logs, setHabitStatus } = useStore(useShallow((s) => ({ habits: s.habits, relations: s.relations, addRelation: s.addRelation, deleteRelation: s.deleteRelation, logs: s.logs, setHabitStatus: s.setHabitStatus })));
  const { showToast } = useToast();

  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [relType, setRelType] = useState<RelationType>('facilitates');
  const [isAdding, setIsAdding] = useState(false);
  const [hoveredRelId, setHoveredRelId] = useState<string | null>(null);
  const [relationToDelete, setRelationToDelete] = useState<{ id: string; sourceName: string; targetName: string } | null>(null);

  const activeHabits = useMemo(() => habits.filter((h) => h.status === 'active'), [habits]);

  const empiricalCorrelations = useMemo(() => {
    const results: {
      sourceName: string;
      sourceIcon: string;
      targetName: string;
      targetIcon: string;
      pctWhenDone: number;
      pctWhenNotDone: number;
      deltaPct: number;
    }[] = [];

    const logList = Object.values(logs);
    const dateSet = Array.from(new Set(logList.map((l: HabitLog) => l.date)));

    activeHabits.forEach((source) => {
      activeHabits.forEach((target) => {
        if (source.id === target.id) return;

        let daysSourceDone = 0;
        let daysBothDone = 0;
        let daysSourceNotDone = 0;
        let daysTargetDoneWhenSourceNot = 0;

        dateSet.forEach((dateStr) => {
          const sLog = logList.find((l: HabitLog) => l.habitId === source.id && l.date === dateStr);
          const tLog = logList.find((l: HabitLog) => l.habitId === target.id && l.date === dateStr);

          const isSourceDone = sLog && (sLog.status === 'full' || sLog.status === 'minimum');
          const isTargetDone = tLog && (tLog.status === 'full' || tLog.status === 'minimum');

          if (isSourceDone) {
            daysSourceDone++;
            if (isTargetDone) daysBothDone++;
          } else {
            daysSourceNotDone++;
            if (isTargetDone) daysTargetDoneWhenSourceNot++;
          }
        });

        if (daysSourceDone >= 5 && daysSourceNotDone >= 5) {
          const pctWhenDone = Math.round((daysBothDone / daysSourceDone) * 100);
          const pctWhenNotDone = Math.round((daysTargetDoneWhenSourceNot / daysSourceNotDone) * 100);
          const deltaPct = pctWhenDone - pctWhenNotDone;

          if (deltaPct >= 20) {
            results.push({
              sourceName: source.name,
              sourceIcon: source.icon,
              targetName: target.name,
              targetIcon: target.icon,
              pctWhenDone,
              pctWhenNotDone,
              deltaPct,
            });
          }
        }
      });
    });

    return results.sort((a, b) => b.deltaPct - a.deltaPct);
  }, [activeHabits, logs]);

  const handleCreateRelation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromId || !toId) {
      showToast('Selecciona los dos hábitos a conectar', 'warning');
      return;
    }
    if (fromId === toId) {
      showToast('Un hábito no puede conectarse consigo mismo', 'warning');
      return;
    }

    const exists = relations.some(
      (r: HabitRelation) => r.fromId === fromId && r.toId === toId && r.type === relType
    );
    if (exists) {
      showToast('Esta relación ya existe', 'warning');
      return;
    }

    addRelation({
      fromId,
      toId,
      type: relType,
    });

    showToast('Relación agregada a la red', 'success');
    setIsAdding(false);
    setFromId('');
    setToId('');
  };

  const handleDeleteRelation = (rel: HabitRelation, sourceName: string, targetName: string) => {
    setRelationToDelete({ id: rel.id, sourceName, targetName });
  };

  const confirmDeleteRelation = () => {
    if (!relationToDelete) return;
    deleteRelation(relationToDelete.id);
    showToast(`Conexión «${relationToDelete.sourceName} → ${relationToDelete.targetName}» eliminada`, 'info');
    setRelationToDelete(null);
  };

  const getRelationBadge = (type: RelationType) => {
    switch (type) {
      case 'facilitates':
        return (
          <span className="badge success">
            <Zap size={12} /> Facilita
          </span>
        );
      case 'depends_on':
        return (
          <span className="badge accent">
            <Link size={12} /> Depende de
          </span>
        );
      case 'before':
        return (
          <span className="badge info">
            <ArrowRight size={12} /> Antes de
          </span>
        );
      case 'after':
        return (
          <span className="badge warning">
            <ArrowRight size={12} /> Después de
          </span>
        );
      case 'blocks':
        return (
          <span className="badge danger">
            <ShieldAlert size={12} /> Bloquea si falla
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="stack fade-up">
      {/* Cabecera */}
      <div className="page-head">
        <div>
          <p className="eyebrow">Cadenas de hábitos y dependencias</p>
          <h1>Mapa de hábitos</h1>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Plus size={16} />
            {isAdding ? 'Cerrar formulario' : 'Nueva conexión'}
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Los hábitos rara vez ocurren de forma aislada: encadenar un hábito difícil inmediatamente después de un hábito ancla automático multiplica tu probabilidad de éxito sin depender de la fuerza de voluntad.
      </p>

      {activeHabits.length === 0 && (
        <div className="card empty" style={{ padding: '36px 16px', textAlign: 'center' }}>
          <Network size={32} style={{ color: 'var(--accent-2)', margin: '0 auto 12px', opacity: 0.8 }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No tienes hábitos registrados aún</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, maxWidth: 420, margin: '0 auto' }}>
            Para encadenar hábitos y construir secuencias de habit-stacking, primero crea al menos dos hábitos.
          </p>
        </div>
      )}

      {/* Formulario para conectar hábitos */}
      {isAdding && (
        <form onSubmit={handleCreateRelation} className="card highlight form">
          <div className="card-head">
            <div className="row">
              <Link size={18} style={{ color: 'var(--accent-2)' }} />
              <div>
                <div className="card-title">Conectar dos hábitos</div>
                <div className="card-sub">Define una relación causa-efecto o secuencia temporal</div>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="field">
              <span className="label">Hábito Origen</span>
              <CustomSelect
                value={fromId}
                onChange={(val) => setFromId(val)}
                options={activeHabits.map((h) => ({
                  value: h.id,
                  label: h.name,
                  icon: h.icon,
                }))}
                placeholder="Selecciona hábito origen..."
                searchable
              />
            </div>

            <div className="field">
              <span className="label">Tipo de Relación</span>
              <CustomSelect<RelationType>
                value={relType}
                onChange={(val) => setRelType(val)}
                options={[
                  { value: 'facilitates', label: 'Facilita (aumenta la probabilidad)', icon: <Zap size={15} color="var(--success)" /> },
                  { value: 'before', label: 'Antes de (secuencia temporal)', icon: <ArrowRight size={15} color="var(--accent-2)" /> },
                  { value: 'after', label: 'Después de (anclaje inmediato)', icon: <ArrowLeft size={15} color="var(--accent-2)" /> },
                  { value: 'depends_on', label: 'Depende de (requiere completar primero)', icon: <Link size={15} color="var(--info)" /> },
                  { value: 'blocks', label: 'Bloquea si falla (obstáculo crítico)', icon: <ShieldAlert size={15} color="var(--danger)" /> },
                ]}
              />
            </div>
          </div>

          <div className="field">
            <span className="label">Hábito Destino</span>
            <CustomSelect
              value={toId}
              onChange={(val) => setToId(val)}
              options={activeHabits
                .filter((h) => h.id !== fromId)
                .map((h) => ({
                  value: h.id,
                  label: h.name,
                  icon: h.icon,
                }))}
              placeholder="Selecciona hábito destino..."
              searchable
            />
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setIsAdding(false)}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary">
              Guardar conexión
            </button>
          </div>
        </form>
      )}

      {/* Correlaciones empíricas descubiertas */}
      {empiricalCorrelations.length > 0 && (
        <div className="card highlight">
          <div className="card-head">
            <div className="row">
              <Sparkles size={18} style={{ color: 'var(--warning)' }} />
              <div>
                <div className="card-title">Correlaciones descubiertas en tus registros reales</div>
                <div className="card-sub">Patrones donde un hábito influye fuertemente en otro</div>
              </div>
            </div>
          </div>

          <div className="stack" style={{ gap: 10 }}>
            {empiricalCorrelations.map((c, i) => (
              <div
                key={i}
                className="row-between"
                style={{
                  padding: '12px 16px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-2)',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div className="row">
                  <span className="bold">{c.sourceIcon} {c.sourceName}</span>
                  <ArrowRight size={14} style={{ color: 'var(--muted)' }} />
                  <span className="bold">{c.targetIcon} {c.targetName}</span>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <span className="small muted">
                    Realización: <b className="success">{c.pctWhenDone}%</b> (vs {c.pctWhenNotDone}% cuando se omite)
                  </span>
                  <span className="badge success">+{c.deltaPct}% boost</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conexiones existentes */}
      <div className="stack" style={{ gap: 12 }}>
        <div className="row-between">
          <div className="card-title">Cadenas y relaciones activas</div>
          <span className="badge accent">{relations.length} conexiones</span>
        </div>

        {relations.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon">
              <Network size={24} />
            </div>
            <h3>No tienes relaciones configuradas</h3>
            <p>Conecta hábitos para visualizar su secuencia y descubrir cómo se influyen entre sí.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsAdding(true)}
            >
              <Plus size={16} /> Crear primera conexión
            </button>
          </div>
        ) : (
          <div className="grid-2">
            {relations.map((rel: HabitRelation) => {
              const source = habits.find((h) => h.id === rel.fromId);
              const target = habits.find((h) => h.id === rel.toId);

              if (!source || !target) return null;

              const isSourcePaused = source.status === 'paused';
              const isTargetPaused = target.status === 'paused';
              const isAnyPaused = isSourcePaused || isTargetPaused;
              const isHovered = hoveredRelId === rel.id;

              return (
                <div
                  key={rel.id}
                  className="card relation-card"
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    ...(isAnyPaused ? { border: '1.5px solid #eab308' } : {}),
                  }}
                  onMouseEnter={() => setHoveredRelId(rel.id)}
                  onMouseLeave={() => setHoveredRelId(null)}
                >
                  {isAnyPaused && isHovered && (
                    <div
                      className="resume-overlay"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(10, 10, 16, 0.88)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        zIndex: 10,
                        padding: 12,
                        textAlign: 'center',
                      }}
                    >
                      <span className="icon-label" style={{ color: '#eab308', fontWeight: 600, fontSize: 13 }}>
                        <Pause size={13} strokeWidth={2.6} aria-hidden="true" /> Conexión con hábito en pausa
                      </span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {isSourcePaused && (
                          <button
                            type="button"
                            className="btn btn-secondary sm resume-btn-animated"
                            style={{ background: '#eab308', color: '#000', borderColor: '#eab308', fontWeight: 600, fontSize: 11 }}
                            onClick={() => {
                              setHabitStatus(source.id, 'active');
                              showToast(`Hábito «${source.name}» reanudado`, 'success');
                            }}
                          >
                            ▶ Reanudar {source.name}
                          </button>
                        )}
                        {isTargetPaused && (
                          <button
                            type="button"
                            className="btn btn-secondary sm resume-btn-animated"
                            style={{ background: '#eab308', color: '#000', borderColor: '#eab308', fontWeight: 600, fontSize: 11 }}
                            onClick={() => {
                              setHabitStatus(target.id, 'active');
                              showToast(`Hábito «${target.name}» reanudado`, 'success');
                            }}
                          >
                            ▶ Reanudar {target.name}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="row" style={{ overflow: 'hidden' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 70 }}>
                      <span className="entity-icon">{source.icon}</span>
                      <span className="truncate xs bold muted" style={{ marginTop: 4, maxWidth: 70, textAlign: 'center' }}>
                        {source.name} {isSourcePaused && <Pause size={10} strokeWidth={3} color="#eab308" aria-label="en pausa" style={{ verticalAlign: '-1px' }} />}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 8px' }}>
                      {getRelationBadge(rel.type)}
                      <ArrowRight size={16} style={{ color: 'var(--muted)', marginTop: 4 }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 70 }}>
                      <span className="entity-icon">{target.icon}</span>
                      <span className="truncate xs bold muted" style={{ marginTop: 4, maxWidth: 70, textAlign: 'center' }}>
                        {target.name} {isTargetPaused && <Pause size={10} strokeWidth={3} color="#eab308" aria-label="en pausa" style={{ verticalAlign: '-1px' }} />}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteRelation(rel, source.name, target.name)}
                    className="icon-btn danger"
                    title="Eliminar conexión"
                    aria-label="Eliminar conexión"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Explicación de Habit Stacking */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">La técnica del encadenamiento de hábitos (Habit Stacking)</div>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
          La clave para la constancia no es la fuerza de voluntad, sino vincular un hábito nuevo directamente después de uno que ya ejecutas de forma automática todos los días:
        </p>

        <div className="grid-3">
          <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
            <div className="bold accent" style={{ marginBottom: 4 }}>1. Hábito Ancla (Consolidado)</div>
            <div className="small muted">"Tomarme mi primera taza de café a las 8:00 AM"</div>
          </div>
          <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
            <div className="bold warning" style={{ marginBottom: 4 }}>2. Hábito Objetivo (Nuevo)</div>
            <div className="small muted">"Abrir mi editor de código y programar 25 minutos"</div>
          </div>
          <div style={{ padding: 14, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)' }}>
            <div className="bold success" style={{ marginBottom: 4 }}>3. Recompensa Inmediata</div>
            <div className="small muted">"Escuchar 10 minutos de música o caminar al aire libre"</div>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={relationToDelete !== null}
        onClose={() => setRelationToDelete(null)}
        onConfirm={confirmDeleteRelation}
        title="Eliminar conexión de hábitos"
        message={`¿Estás seguro de que deseas eliminar la conexión entre «${relationToDelete?.sourceName}» y «${relationToDelete?.targetName}»? Esta acción quitará el vínculo de la cadena.`}
        confirmLabel="Eliminar conexión"
        confirmVariant="danger"
      />
    </div>
  );
};
