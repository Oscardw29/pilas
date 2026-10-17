import React from 'react';
import { Sparkles, Check, FlaskConical, Link2, ArrowRight } from 'lucide-react';
import type { ParsedAction } from '@/lib/coachActions';

/** Tarjeta de confirmación de una acción propuesta por el Coach IA (crear/editar hábitos, retos, etc.) */
export const ActionConfirmationCard: React.FC<{
  action: ParsedAction;
  status: 'pending' | 'applied' | 'dismissed';
  onConfirm: () => void;
  onDismiss: () => void;
}> = ({ action, status, onConfirm, onDismiss }) => {
  const { action: type } = action;
  // Datos libres del modelo: solo se muestran como texto (React escapa el contenido)
  const data = action.data as Record<string, any>;

  return (
    <div
      style={{
        marginTop: 12,
        padding: '14px 16px',
        borderRadius: 14,
        background:
          status === 'applied'
            ? 'rgba(16, 185, 129, 0.08)'
            : status === 'dismissed'
            ? 'rgba(255, 255, 255, 0.03)'
            : 'linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(20, 21, 33, 0.9) 100%)',
        border: `1px solid ${
          status === 'applied'
            ? 'rgba(16, 185, 129, 0.35)'
            : status === 'dismissed'
            ? 'rgba(255, 255, 255, 0.08)'
            : 'rgba(139, 92, 246, 0.35)'
        }`,
        boxShadow: status === 'pending' ? '0 4px 20px rgba(139, 92, 246, 0.15)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: '100%',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontWeight: 700,
            fontSize: 13,
            color: status === 'applied' ? '#34d399' : 'var(--accent-2)',
          }}
        >
          <Sparkles size={14} />
          <span>
            {type === 'create_habit' && 'Sugerencia: Crear nuevo hábito'}
            {type === 'update_habit' && 'Sugerencia: Modificar hábito'}
            {type === 'delete_habit' && 'Sugerencia: Eliminar hábito'}
            {type === 'create_experiment' && 'Sugerencia: Iniciar experimento'}
            {type === 'create_connection' && 'Sugerencia: Conectar hábitos'}
            {type === 'create_reward' && 'Sugerencia: Crear recompensa'}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 999,
            background:
              status === 'applied'
                ? 'rgba(16, 185, 129, 0.2)'
                : status === 'dismissed'
                ? 'rgba(255, 255, 255, 0.06)'
                : 'rgba(139, 92, 246, 0.2)',
            color: status === 'applied' ? '#34d399' : status === 'dismissed' ? 'var(--muted)' : '#c084fc',
          }}
        >
          {status === 'applied' ? 'Aplicado' : status === 'dismissed' ? 'Descartado' : 'Requiere confirmación'}
        </span>
      </div>

      {/* Detalles visuales */}
      <div
        style={{
          fontSize: 12.5,
          color: 'var(--text-1)',
          lineHeight: 1.5,
          background: 'rgba(0,0,0,0.25)',
          padding: '10px 12px',
          borderRadius: 10,
        }}
      >
        {type === 'create_habit' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
              {data.icon || '🎯'} {data.name}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              {data.targetMinutes ? `Meta: ${data.targetMinutes} min` : 'Objetivo directo'}
              {data.minimumMinutes ? ` · Mínimo: ${data.minimumMinutes} min` : ''}
              {data.preferredTime ? ` · Horario: ${data.preferredTime}` : ''}
              {data.points ? ` · ${data.points} pts` : ''}
            </div>
          </div>
        )}

        {type === 'update_habit' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
              {data.habitName || 'Hábito'}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Modificaciones sugeridas: {JSON.stringify(data.patch || {})}
            </div>
          </div>
        )}

        {type === 'delete_habit' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#f87171' }}>
              Eliminar hábito: {data.habitName || 'Hábito'}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              El hábito será retirado de tu lista activa.
            </div>
          </div>
        )}

        {type === 'create_experiment' && (
          <div>
            <div className="icon-label" style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
              <FlaskConical size={14} color="var(--accent-2)" aria-hidden="true" /> {data.name} ({data.durationDays || 14} días)
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Hipótesis: {data.hypothesis || 'Validar cambios en la rutina'}
            </div>
          </div>
        )}

        {type === 'create_connection' && (
          <div>
            <div className="icon-label" style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
              <Link2 size={14} color="var(--info)" aria-hidden="true" /> {data.fromHabitName}
              <ArrowRight size={13} color="var(--muted)" aria-hidden="true" /> {data.toHabitName}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Tipo de conexión: {data.type || 'before'} {data.note ? `(${data.note})` : ''}
            </div>
          </div>
        )}

        {type === 'create_reward' && (
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 2 }}>
              {data.icon || '🎁'} {data.name}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Costo: {data.cost || 100} puntos
            </div>
          </div>
        )}
      </div>

      {/* Botones de acción */}
      {status === 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
          <button
            type="button"
            className="btn btn-ghost sm"
            onClick={onDismiss}
            style={{ fontSize: 12 }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary sm"
            onClick={onConfirm}
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            <Check size={13} /> Confirmar y Aplicar
          </button>
        </div>
      )}

      {status === 'applied' && (
        <div style={{ fontSize: 11.5, color: '#34d399', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
          <Check size={12} /> Acción confirmada y aplicada a tus datos
        </div>
      )}

      {status === 'dismissed' && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          Acción descartada por el usuario
        </div>
      )}
    </div>
  );
};
