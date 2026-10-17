import React, { useState, useMemo } from 'react';
import {
  Lightbulb,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowRight,
  ShieldCheck,
  TrendingDown,
  Layers,
  Sparkles,
  X,
  RefreshCw,
  Check,
  Trash2,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useStore, useData } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { detectInsights, FAIL_REASON_LABELS } from '@/lib/insights';
import { generateDecisionSystem } from '@/lib/recommendations';
import { HabitAuditModal } from '@/components/modals/HabitAuditModal';
import { ExperimentModal } from '@/components/modals/ExperimentModal';
import type { DecisionCategory, RecommendationAction } from '@/types';

export const InsightsView: React.FC = () => {
  const data = useData();
  const updateHabit = useStore((s) => s.updateHabit);
  const setHabitStatus = useStore((s) => s.setHabitStatus);
  const setRecommendationFeedback = useStore((s) => s.setRecommendationFeedback);
  const dismissInsight = useStore((s) => s.dismissInsight);
  const { toast } = useToast();

  const [activeCategory, setActiveCategory] = useState<DecisionCategory | 'all'>('all');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showExpModal, setShowExpModal] = useState(false);

  // Insights descubiertos por el motor
  const insights = useMemo(() => detectInsights(data), [data]);

  // Sistema de decisiones
  const recommendations = useMemo(() => generateDecisionSystem(data), [data]);

  // Datos para gráfico de Razones de Falla
  const failLogs = Object.values(data.logs).filter((l) => l.status === 'missed' && l.failReason);
  const failCounts: Record<string, number> = {};
  failLogs.forEach((l) => { if (l.failReason) failCounts[l.failReason] = (failCounts[l.failReason] || 0) + 1; });

  const failChartData = Object.entries(failCounts)
    .map(([r, count]) => ({
      name: FAIL_REASON_LABELS[r as keyof typeof FAIL_REASON_LABELS] || r,
      cantidad: count,
      pct: Math.round((count / failLogs.length) * 100),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  // Ejecutor de acciones recomendadas
  const handleApplyAction = (recId: string, action: RecommendationAction) => {
    if (action.type === 'reduce_target' && action.habitId && action.payload?.newMinutes) {
      updateHabit(action.habitId, { targetMinutes: Number(action.payload.newMinutes) });
      toast('Duración del hábito reducida exitosamente', 'success');
    } else if (action.type === 'change_time' && action.habitId && action.payload?.preferredTime) {
      updateHabit(action.habitId, { preferredTime: action.payload.preferredTime as any });
      toast('Horario del hábito actualizado', 'success');
    } else if (action.type === 'pause_habit' && action.habitId) {
      setHabitStatus(action.habitId, 'paused');
      toast('Hábito pausado temporalmente', 'info');
    } else if (action.type === 'archive_habit' && action.habitId) {
      setHabitStatus(action.habitId, 'archived');
      toast('Hábito archivado: deja de contar desde hoy y conservas su historial', 'info');
    } else if (action.type === 'start_experiment') {
      setShowExpModal(true);
    } else {
      // Acción sin ejecutor en esta vista: no marcarla como aplicada
      toast('Esta recomendación no se puede aplicar automáticamente', 'warning');
      return;
    }

    setRecommendationFeedback(recId, 'applied');
  };

  const handleIgnore = (recId: string) => {
    setRecommendationFeedback(recId, 'ignored');
    toast('Recomendación descartada', 'info');
  };

  const filteredRecs = recommendations.filter((r) => {
    if (activeCategory !== 'all' && r.category !== activeCategory) return false;
    return true;
  });

  return (
    <div className="stack fade-up">
      <div className="page-head">
        <div>
          <p className="eyebrow">Aprendizaje y optimización</p>
          <h1>Insights & Sistema de decisiones</h1>
        </div>
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setShowAuditModal(true)}>
            <Layers size={15} /> Auditar hábitos activos
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        La app analiza tu historial continuo para descubrir tus patrones reales de rendimiento y orientar tus decisiones: qué hacer, qué cambiar, qué mantener, qué eliminar y qué experimentar.
      </p>

      {/* INSIGHTS DESCUBIERTOS */}
      <div className="card">
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={20} style={{ color: 'var(--accent-2)' }} />
            <div>
              <h3 className="card-title">Patrones descubiertos en tu comportamiento</h3>
              <p className="card-sub">Conclusiones derivadas de tus registros y sesiones</p>
            </div>
          </div>
          <span className="badge accent">{insights.length} patrones detectados</span>
        </div>

        {insights.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
            {insights.map((ins) => (
              <div
                key={ins.id}
                className={`callout ${ins.tone}`}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div className="title" style={{ fontSize: 14.5 }}>{ins.title}</div>
                  <button
                    className="icon-btn sm"
                    onClick={() => dismissInsight(ins.id)}
                    title="Descartar insight"
                    aria-label="Descartar insight"
                    style={{ marginTop: -4, marginRight: -6 }}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="detail" style={{ lineHeight: 1.5 }}>{ins.detail}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 'auto' }}>
                  Confianza estadística: {Math.round(ins.confidence * 100)}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Continúa registrando sesiones y hábitos para desbloquear más análisis de patrones.</p>
        )}
      </div>

      {/* RAZONES DE FALLO */}
      <div className="card">
        <div className="card-head">
          <div>
            <h3 className="card-title">Análisis de obstáculos (Razones de fallo)</h3>
            <p className="card-sub">¿Qué factores impiden más a menudo la realización de tus hábitos?</p>
          </div>
          <span className="badge warning">{failLogs.length} fallos analizados</span>
        </div>

        {failChartData.length > 0 ? (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={failChartData} layout="vertical">
                <XAxis type="number" stroke="var(--muted)" fontSize={12} tickLine={false} />
                <YAxis dataKey="name" type="category" stroke="var(--muted)" fontSize={12} tickLine={false} width={130} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#181822',
                    border: '1px solid var(--border-2)',
                    borderRadius: 12,
                    color: '#ffffff',
                    fontSize: 13,
                    boxShadow: '0 12px 32px rgba(0,0,0,0.85)',
                    padding: '8px 14px',
                  }}
                  itemStyle={{ color: '#ffffff', fontWeight: 600 }}
                  labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
                  formatter={(value) => [`${value} veces`, 'Frecuencia']}
                  cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                />
                <Bar dataKey="cantidad" radius={[0, 8, 8, 0]}>
                  {failChartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={index === 0 ? 'var(--danger)' : index === 1 ? 'var(--warning)' : '#8b5cf6'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="muted small">Aún no hay fallos registrados con motivo.</p>
        )}
      </div>

      {/* SISTEMA DE DECISIONES: Qué cambiar / mantener / eliminar */}
      <div className="card">
        <div className="card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lightbulb size={20} style={{ color: 'var(--warning)' }} />
            <div>
              <h3 className="card-title">Sistema de decisiones</h3>
              <p className="card-sub">Recomendaciones concretas accionables basadas en tus datos</p>
            </div>
          </div>
        </div>

        {/* Pestañas de categoría de decisiones */}
        <div className="chips" style={{ marginBottom: 16 }}>
          {(
            [
              { id: 'all', label: 'Todas las decisiones' },
              { id: 'change', label: 'Qué cambiar', icon: RefreshCw },
              { id: 'keep', label: 'Qué mantener', icon: Check },
              { id: 'remove', label: 'Qué eliminar o pausar', icon: Trash2 },
              { id: 'experiment', label: 'Qué experimentar', icon: FlaskConical },
            ] as { id: string; label: string; icon?: LucideIcon }[]
          ).map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`chip ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id as any)}
            >
              {cat.icon && <cat.icon size={13} aria-hidden="true" />}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Lista de recomendaciones con botones de acción */}
        {data.habits.length === 0 ? (
          <div className="empty" style={{ padding: '30px 16px', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>
              No tienes hábitos registrados aún. Agrega tus hábitos para que el sistema de decisiones genere recomendaciones inteligentes.
            </p>
          </div>
        ) : filteredRecs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredRecs.map((rec) => (
              <div
                key={rec.id}
                style={{
                  padding: '16px 20px',
                  borderRadius: 14,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: 1, minWidth: 'min(260px, 100%)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`badge sm ${rec.category === 'change' ? 'warning' : rec.category === 'keep' ? 'success' : rec.category === 'remove' ? 'danger' : 'info'}`}>
                      {rec.category === 'change' ? 'Cambiar' : rec.category === 'keep' ? 'Mantener' : rec.category === 'remove' ? 'Pausar/Eliminar' : 'Experimentar'}
                    </span>
                    <strong style={{ fontSize: 14.5 }}>{rec.title}</strong>
                  </div>
                  <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 4, lineHeight: 1.45 }}>
                    {rec.reason}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {rec.actions.map((act) => (
                    <button
                      key={`${act.type}-${act.label}`}
                      className="btn btn-primary sm"
                      onClick={() => handleApplyAction(rec.id, act)}
                    >
                      {act.label}
                    </button>
                  ))}
                  <button
                    className="btn btn-ghost sm"
                    onClick={() => handleIgnore(rec.id)}
                  >
                    Ignorar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">No hay sugerencias pendientes en esta categoría.</p>
        )}
      </div>

      {showAuditModal && (
        <HabitAuditModal
          isOpen={showAuditModal}
          onClose={() => setShowAuditModal(false)}
        />
      )}

      {showExpModal && (
        <ExperimentModal
          isOpen={showExpModal}
          onClose={() => setShowExpModal(false)}
        />
      )}
    </div>
  );
};
