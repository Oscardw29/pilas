import { clickableProps } from '@/lib/a11y';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Target, ArrowRight, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts';
import { useData } from '@/store/useStore';
import { goalProgress, goalHabits } from '@/lib/metrics';
import { GoalModal } from '@/components/modals/GoalModal';
import type { Goal } from '@/types';

export const GoalsView: React.FC = () => {
  const navigate = useNavigate();
  const data = useData();

  const [showGoalModal, setShowGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | undefined>();
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const categories = ['all', ...new Set(data.goals.map((g) => g.category))];

  const filteredGoals = data.goals.filter((g) => {
    if (filterCategory !== 'all' && g.category !== filterCategory) return false;
    return true;
  });

  const goalsChartData = useMemo(() => {
    return filteredGoals.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      color: g.color || '#8b5cf6',
      progress: Math.min(100, Math.round(goalProgress(data, g) * 100)),
      habitsCount: goalHabits(data, g.id).length,
    }));
  }, [filteredGoals, data]);

  return (
    <div className="stack fade-up">
      <div className="page-head">
        <div>
          <p className="eyebrow">Dirección y propósito</p>
          <h1>Objetivos</h1>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingGoal(undefined);
              setShowGoalModal(true);
            }}
          >
            <Plus size={16} /> Nuevo objetivo
          </button>
        </div>
      </div>

      <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
        Los hábitos no son tareas aisladas: cada hábito suma avance a uno o más objetivos estratégicos según su peso configurado.
      </p>

      {/* Categorías */}
      {categories.length > 2 && (
        <div className="chips">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${filterCategory === c ? 'active' : ''}`}
              onClick={() => setFilterCategory(c)}
            >
              {c === 'all' ? 'Todas las categorías' : c}
            </button>
          ))}
        </div>
      )}

      {/* Gráfica de avance comparativo de objetivos */}
      {goalsChartData.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Avance comparativo de objetivos</h3>
              <p className="card-sub">Porcentaje de cumplimiento estratégico ponderado</p>
            </div>
            <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#c4b5fd', border: '1px solid rgba(139, 92, 246, 0.3)' }}>
              {goalsChartData.length} objetivos
            </span>
          </div>

          <div style={{ width: '100%', height: Math.max(160, goalsChartData.length * 42), overflow: 'hidden' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={goalsChartData}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
              >
                <XAxis type="number" domain={[0, 100]} unit="%" stroke="var(--muted)" fontSize={11} tickLine={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="var(--muted)"
                  fontSize={12}
                  tickLine={false}
                  width={140}
                  tickFormatter={(val) => (val.length > 16 ? `${val.slice(0, 15)}…` : val)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload;
                      return (
                        <div
                          style={{
                            background: 'rgba(20, 21, 33, 0.96)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: 10,
                            padding: '8px 12px',
                            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
                            fontSize: 12,
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                            {item.icon} {item.name}
                          </div>
                          <div style={{ color: item.color, fontWeight: 600 }}>
                            Progreso: {item.progress}%
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                            {item.habitsCount} hábitos vinculados
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                  wrapperStyle={{ pointerEvents: 'none', zIndex: 50 }}
                />
                <Bar dataKey="progress" radius={[0, 6, 6, 0]}>
                  {goalsChartData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Grid de objetivos */}
      {filteredGoals.length > 0 ? (
        <div className="grid-auto">
          {filteredGoals.map((g) => {
            const prog = Math.round(goalProgress(data, g) * 100);
            const habits = goalHabits(data, g.id);

            return (
              <div
                key={g.id}
                className="card interactive goal-card"
                style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                {...clickableProps(() => navigate(`/objetivos/${g.id}`), `Abrir objetivo ${g.name}`)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 32 }}>{g.icon}</span>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700 }}>{g.name}</h3>
                      <span className="badge sm" style={{ marginTop: 2 }}>{g.category}</span>
                    </div>
                  </div>
                  <span className={`badge ${g.status === 'completed' ? 'success' : g.status === 'paused' ? 'warning' : 'accent'}`}>
                    {g.status === 'active' ? 'Activo' : g.status === 'completed' ? 'Completado' : 'Pausado'}
                  </span>
                </div>

                {g.description && (
                  <p style={{ fontSize: 13, color: 'var(--muted)', lineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {g.description}
                  </p>
                )}

                {/* Barra de progreso */}
                <div style={{ marginTop: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                    <span style={{ color: 'var(--muted)' }}>Progreso del objetivo</span>
                    <strong style={{ color: 'var(--accent-2)', fontSize: 14 }}>{prog}%</strong>
                  </div>
                  <div className="progress">
                    <div style={{ width: `${prog}%`, background: g.color }} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                  <span>{habits.length} hábitos ponderados</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent-2)', fontWeight: 500 }}>
                    Ver detalle <ArrowRight size={13} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card empty">
          <div className="empty-icon">
            <Target />
          </div>
          <h3>Aún no has creado ningún objetivo</h3>
          <p>Define lo que quieres conseguir y vincula hábitos con pesos específicos.</p>
          <button className="btn btn-primary" onClick={() => setShowGoalModal(true)}>
            <Plus size={15} /> Crear primer objetivo
          </button>
        </div>
      )}

      {showGoalModal && (
        <GoalModal
          isOpen={showGoalModal}
          onClose={() => setShowGoalModal(false)}
          goalToEdit={editingGoal}
        />
      )}
    </div>
  );
};
