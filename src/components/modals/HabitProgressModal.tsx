import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useStore, minimumMinutesFor } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { getLog, pointsFor } from '@/lib/metrics';
import { todayKey } from '@/lib/dates';
import { fireHabitPop } from '@/lib/confetti';
import { playSound } from '@/lib/sound';
import { celebrateStreakChange, streakSnapshot } from '@/lib/streakCelebration';
import type { Habit, LogStatus } from '@/types';
import { Clock, CheckCircle2, RotateCcw, Zap, Check, Timer, Sprout } from 'lucide-react';

interface HabitProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  habit: Habit;
  dateKey?: string;
  onSuccess?: () => void;
}

export const HabitProgressModal: React.FC<HabitProgressModalProps> = ({
  isOpen,
  onClose,
  habit,
  dateKey,
  onSuccess,
}) => {
  const logs = useStore((s) => s.logs);
  const minimumRatio = useStore((s) => s.settings.minimumRatio);
  const logHabit = useStore((s) => s.logHabit);
  const clearLog = useStore((s) => s.clearLog);
  const { toast } = useToast();

  const T = todayKey();
  const targetDate = dateKey || T;
  const prevLog = getLog({ logs }, habit.id, targetDate);
  const minimumPoints = pointsFor(habit, 'minimum', minimumRatio);

  const isTime = habit.kind === 'time' || (!habit.kind && !!habit.targetMinutes);
  const isQuantity = habit.kind === 'quantity';

  // Métricas para Tiempo
  const targetMin = habit.targetMinutes || 30;
  const minMin = minimumMinutesFor({ ...habit, targetMinutes: targetMin }, minimumRatio);
  const prevMinutes = prevLog?.minutes || 0;
  const remainingMinutes = Math.max(0, targetMin - prevMinutes);

  // Métricas para Cantidad
  const targetQty = habit.targetQuantity || 100;
  const minQty = habit.minimumQuantity || Math.max(1, Math.round(targetQty * minimumRatio));
  const unit = habit.quantityUnit || 'reps';
  const prevQuantity = prevLog?.quantity || 0;
  const remainingQty = Math.max(0, targetQty - prevQuantity);

  // Estados locales de entrada
  const [minutesToAdd, setMinutesToAdd] = useState<number>(
    remainingMinutes > 0 ? remainingMinutes : targetMin
  );
  const [quantityToAdd, setQuantityToAdd] = useState<number>(
    remainingQty > 0 ? remainingQty : Math.min(20, targetQty)
  );

  // Cálculos dinámicos
  const newTotalMin = prevMinutes + (Number(minutesToAdd) || 0);
  const newTotalQty = prevQuantity + (Number(quantityToAdd) || 0);

  const isTimeMinAchieved = newTotalMin >= minMin;
  const isTimeFullAchieved = newTotalMin >= targetMin;

  const isQtyMinAchieved = newTotalQty >= minQty;
  const isQtyFullAchieved = newTotalQty >= targetQty;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const before = streakSnapshot();

    if (isTime) {
      if (newTotalMin <= 0) {
        clearLog(habit.id, targetDate);
        toast(`Registro limpiado para «${habit.name}»`, 'info');
        onClose();
        return;
      }

      // Por debajo del mínimo solo se guarda el avance: no suma puntos ni racha
      const status: LogStatus = isTimeFullAchieved ? 'full' : isTimeMinAchieved ? 'minimum' : 'partial';
      logHabit(habit.id, targetDate, status, { minutes: newTotalMin });

      if (isTimeFullAchieved) {
        playSound.complete();
      } else {
        playSound.pop();
      }

      toast(
        isTimeFullAchieved
          ? `«${habit.name}» completado (+${habit.points} pts · ${newTotalMin} min)`
          : isTimeMinAchieved
          ? `«${habit.name}» en modo mínimo (+${minimumPoints} pts · ${newTotalMin} min)`
          : `Avance guardado: ${newTotalMin} de ${minMin} min para el mínimo`,
        isTimeMinAchieved ? 'success' : 'info'
      );
    } else if (isQuantity) {
      if (newTotalQty <= 0) {
        clearLog(habit.id, targetDate);
        toast(`Registro limpiado para «${habit.name}»`, 'info');
        onClose();
        return;
      }

      const status: LogStatus = isQtyFullAchieved ? 'full' : isQtyMinAchieved ? 'minimum' : 'partial';
      logHabit(habit.id, targetDate, status, { quantity: newTotalQty });

      if (isQtyFullAchieved) {
        playSound.complete();
      } else {
        playSound.pop();
      }

      toast(
        isQtyFullAchieved
          ? `«${habit.name}» completado (+${habit.points} pts · ${newTotalQty} ${unit})`
          : isQtyMinAchieved
          ? `«${habit.name}» en modo mínimo (+${minimumPoints} pts · ${newTotalQty} ${unit})`
          : `Avance guardado: ${newTotalQty} de ${minQty} ${unit} para el mínimo`,
        isQtyMinAchieved ? 'success' : 'info'
      );
    }

    if (isTime ? isTimeMinAchieved : isQtyMinAchieved) fireHabitPop(window.innerWidth / 2, window.innerHeight / 2);

    // Celebración si este registro activó la racha o la súper racha de hoy
    celebrateStreakChange(before, targetDate);

    onSuccess?.();
    onClose();
  };

  // «Borrar registro» siempre pide confirmación antes de quitar lo anotado ese día
  const [confirmClear, setConfirmClear] = useState(false);
  const handleClear = () => {
    clearLog(habit.id, targetDate);
    playSound.delete();
    toast(targetDate === T ? `Registro de hoy borrado para «${habit.name}»` : `Registro borrado para «${habit.name}»`, 'info');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isTime ? `Registrar tiempo: ${habit.name}` : `Registrar cantidad: ${habit.name}`}
      zIndex={1250}
      preventBackdropClose={true}
    >
      <form onSubmit={handleSave} className="form">
        {/* Cabecera del hábito */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 16px',
            borderRadius: 14,
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
          }}
        >
          <span style={{ fontSize: 32 }}>{habit.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{habit.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {isTime ? (
                <>
                  Meta diaria: <strong>{targetMin} min</strong> · Modo mínimo:{' '}
                  <strong>{minMin} min</strong> (mínimo)
                </>
              ) : (
                <>
                  Meta diaria: <strong>{targetQty} {unit}</strong> · Modo mínimo:{' '}
                  <strong>{minQty} {unit}</strong> (mínimo)
                </>
              )}
            </div>
          </div>
        </div>

        {/* SECCIÓN DE HÁBITO DE TIEMPO */}
        {isTime && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Estado actual de minutos */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ya realizado hoy</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-2)' }}>
                  {prevMinutes} min
                </div>
              </div>

              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>A sumar ahora</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)' }}>
                  +{Number(minutesToAdd) || 0} min
                </div>
              </div>

              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: isTimeFullAchieved
                    ? 'rgba(34, 197, 94, 0.15)'
                    : isTimeMinAchieved
                    ? 'color-mix(in srgb, var(--orange) 15%, transparent)'
                    : 'var(--surface-2)',
                  border: `1px solid ${
                    isTimeFullAchieved
                      ? 'var(--success)'
                      : isTimeMinAchieved
                      ? 'var(--orange)'
                      : 'var(--border-2)'
                  }`,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nuevo total hoy</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: isTimeFullAchieved ? 'var(--success)' : isTimeMinAchieved ? 'var(--orange)' : 'var(--text-strong)',
                  }}
                >
                  {newTotalMin} / {targetMin}m
                </div>
              </div>
            </div>

            {/* Input de minutos */}
            <div className="field">
              <span className="label">¿Cuántos minutos dedicaste en esta sesión?</span>
              <input
                type="number"
                min={0}
                max={360}
                className="input"
                style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}
                value={minutesToAdd}
                onChange={(e) => setMinutesToAdd(Math.max(0, Number(e.target.value)))}
                data-autofocus
              />
            </div>

            {/* Botones rápidos de minutos */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[10, 15, 20, 30, 45].map((m) => (
                <button
                  key={m}
                  type="button"
                  className="chip sm"
                  onClick={() => setMinutesToAdd(m)}
                >
                  +{m} min
                </button>
              ))}
              {remainingMinutes > 0 && (
                <button
                  type="button"
                  className="chip sm active"
                  onClick={() => setMinutesToAdd(remainingMinutes)}
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Check size={12} strokeWidth={3} aria-hidden="true" /> Faltante ({remainingMinutes} min)
                </button>
              )}
            </div>

            {/* Deducción del temporizador info */}
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                lineHeight: 1.45,
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                padding: '10px 14px',
                borderRadius: 12,
              }}
            >
              <Timer size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--accent-2)' }} />
              <strong>Deducción en el temporizador:</strong> Estos minutos se restan del temporizador. Si inicias el temporizador hoy, arrancará en{' '}
              <strong>{Math.max(0, targetMin - newTotalMin)}:00 minutos</strong> hasta llegar a 0.
            </div>
          </div>
        )}

        {/* SECCIÓN DE HÁBITO DE CANTIDAD */}
        {isQuantity && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Estado actual de cantidad */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Ya hecho hoy</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-2)' }}>
                  {prevQuantity} {unit}
                </div>
              </div>

              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-2)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>A sumar ahora</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-strong)' }}>
                  +{Number(quantityToAdd) || 0} {unit}
                </div>
              </div>

              <div
                style={{
                  padding: '10px 8px',
                  borderRadius: 12,
                  background: isQtyFullAchieved
                    ? 'rgba(34, 197, 94, 0.15)'
                    : isQtyMinAchieved
                    ? 'color-mix(in srgb, var(--orange) 15%, transparent)'
                    : 'var(--surface-2)',
                  border: `1px solid ${
                    isQtyFullAchieved
                      ? 'var(--success)'
                      : isQtyMinAchieved
                      ? 'var(--orange)'
                      : 'var(--border-2)'
                  }`,
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nuevo total hoy</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: isQtyFullAchieved ? 'var(--success)' : isQtyMinAchieved ? 'var(--orange)' : 'var(--text-strong)',
                  }}
                >
                  {newTotalQty} / {targetQty}
                </div>
              </div>
            </div>

            {/* Input de cantidad */}
            <div className="field">
              <span className="label">Cantidad a sumar en este momento ({unit}):</span>
              <input
                type="number"
                min={0}
                max={100000}
                className="input"
                style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }}
                value={quantityToAdd}
                onChange={(e) => setQuantityToAdd(Math.max(0, Number(e.target.value)))}
                data-autofocus
              />
            </div>

            {/* Botones rápidos de cantidad */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[5, 10, 20, 25, 50].map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chip sm"
                  onClick={() => setQuantityToAdd(q)}
                >
                  +{q} {unit}
                </button>
              ))}
              {remainingQty > 0 && (
                <button
                  type="button"
                  className="chip sm active"
                  onClick={() => setQuantityToAdd(remainingQty)}
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Check size={12} strokeWidth={3} aria-hidden="true" /> Faltante ({remainingQty} {unit})
                </button>
              )}
            </div>

            {/* Explicación de racha con la versión mínima */}
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                lineHeight: 1.45,
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                padding: '10px 14px',
                borderRadius: 12,
              }}
            >
              <Sprout size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--minimum)' }} />
              <strong>Regla de racha:</strong> Con solo completar <strong>{minQty} {unit}</strong> se activa el modo mínimo y sumas tu día de racha. Puedes acumular tantas tandas como quieras hasta llegar a {targetQty} {unit}.
            </div>
          </div>
        )}

        <div className="modal-foot">
          {prevLog && (
            <button
              type="button"
              className="btn btn-ghost sm danger"
              onClick={() => setConfirmClear(true)}
              style={{ marginRight: 'auto' }}
            >
              <RotateCcw size={14} /> Borrar registro
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar avance
          </button>
        </div>
      </form>

      <ConfirmModal
        isOpen={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={handleClear}
        title="¿Borrar el registro?"
        message={`Se borra lo anotado ${targetDate === T ? 'hoy' : 'ese día'} en «${habit.name}» (tiempo o cantidad y su estado). Los puntos de ese día se recalculan.`}
        confirmLabel="Borrar registro"
        danger
        zIndex={1350}
      />
    </Modal>
  );
};
