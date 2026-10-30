import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useStore } from '@/store/useStore';
import { useToast } from '@/components/ui/ToastContext';
import { CustomSelect, type CustomSelectOption } from '@/components/ui/CustomSelect';
import { CustomTimePicker } from '@/components/ui/CustomTimePicker';
import { CustomDatePicker } from '@/components/ui/CustomDatePicker';
import type { Habit, HabitKind, Priority, TimeOfDay } from '@/types';
import { DAY_SHORT, todayKey } from '@/lib/dates';
import { CHIP_HINTS, COIN_CHIPS, ECONOMY, timeHabitCoins } from '@/lib/economyRules';

interface HabitModalProps {
  isOpen: boolean;
  onClose: () => void;
  habitToEdit?: Habit;
  zIndex?: number;
}

export const HABIT_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Salud y Deporte', icon: '🏃' },
  { name: 'Estudio y Programación', icon: '💻' },
  { name: 'Bienestar y Mente', icon: '🧘' },
  { name: 'Productividad y Trabajo', icon: '🛠️' },
  { name: 'Lectura y Aprendizaje', icon: '📚' },
  { name: 'Sueño y Descanso', icon: '😴' },
  { name: 'Nutrición e Hidratación', icon: '💧' },
  { name: 'Creatividad y Arte', icon: '🎨' },
  { name: 'Finanzas Personales', icon: '💰' },
  { name: 'Desarrollo Personal', icon: '🌱' },
];

const HABIT_ICONS = [
  '🏃', '📚', '🧘', '💧', '💻', '🥗', '😴', '✍️', '💪', '🚶',
  '🎸', '🧹', '🌱', '💊', '🧠', '🎨', '📵', '☀️', '🙏', '🛠️', '📖', '🐍'
];

const COLORS = [
  '#8b5cf6', '#22d3ee', '#34d399', '#f472b6', '#fbbf24',
  '#60a5fa', '#fb7185', '#a3e635', '#f97316', '#2dd4bf'
];

/** Chips de monedas permitidos (los hábitos de tiempo no tienen chip: la app calcula sus monedas) */
const POINT_OPTIONS = [10, 20, 30, 40];

export const UNIT_PRESETS = [
  { group: 'Repeticiones y Conteo', units: ['reps', 'páginas', 'vasos', 'veces'] },
  { group: 'Longitud', units: ['km', 'm', 'cm', 'ft'] },
  { group: 'Peso', units: ['kg', 'g', 'mg', 'lb'] },
  { group: 'Volumen', units: ['L', 'ml', 'gal'] },
];

export const HabitModal: React.FC<HabitModalProps> = ({ isOpen, onClose, habitToEdit, zIndex }) => {
  const addHabit = useStore((s) => s.addHabit);
  const updateHabit = useStore((s) => s.updateHabit);
  const goals = useStore((s) => s.goals);
  const minimumRatio = useStore((s) => s.settings.minimumRatio);
  const ratioPct = Math.round(minimumRatio * 100);
  const { toast } = useToast();

  const [name, setName] = useState(habitToEdit?.name ?? '');
  const [kind, setKind] = useState<HabitKind>(
    habitToEdit?.kind ?? (habitToEdit?.targetQuantity ? 'quantity' : habitToEdit?.targetMinutes ? 'time' : 'action')
  );
  const [category, setCategory] = useState<string>(
    habitToEdit?.category ?? HABIT_CATEGORIES[0].name
  );
  const [icon, setIcon] = useState(habitToEdit?.icon ?? HABIT_CATEGORIES[0].icon);
  const [color, setColor] = useState(habitToEdit?.color ?? COLORS[0]);
  const [days, setDays] = useState<number[]>(habitToEdit?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [points, setPoints] = useState<number>(
    habitToEdit?.points && POINT_OPTIONS.includes(habitToEdit.points) ? habitToEdit.points : 20
  );
  useEffect(() => {
    if (kind !== 'time' && points > ECONOMY.chipMax[kind]) setPoints(ECONOMY.chipMax[kind]);
  }, [kind, points]);
  const [priority, setPriority] = useState<Priority>(habitToEdit?.priority ?? 2);
  const [targetMinutes, setTargetMinutes] = useState<string>(
    habitToEdit?.targetMinutes ? String(habitToEdit.targetMinutes) : '30'
  );
  // Vacío = mínimo automático (porcentaje de la meta). Un valor guardado se respeta al editar.
  const [minimumMinutes, setMinimumMinutes] = useState<string>(
    habitToEdit?.minimumMinutes ? String(habitToEdit.minimumMinutes) : ''
  );
  const [minimumQuantity, setMinimumQuantity] = useState<string>(
    habitToEdit?.minimumQuantity ? String(habitToEdit.minimumQuantity) : ''
  );
  const [targetQuantity, setTargetQuantity] = useState<string>(
    habitToEdit?.targetQuantity ? String(habitToEdit.targetQuantity) : '100'
  );
  const [quantityUnit, setQuantityUnit] = useState<string>(
    habitToEdit?.quantityUnit ?? 'reps'
  );
  const [targetLabel, setTargetLabel] = useState(habitToEdit?.targetLabel ?? '');
  const [minimumLabel, setMinimumLabel] = useState(habitToEdit?.minimumLabel ?? '');
  const [reminderTime, setReminderTime] = useState<string>(
    habitToEdit?.reminderTime ?? (
      habitToEdit?.preferredTime === 'morning' ? '08:00'
      : habitToEdit?.preferredTime === 'afternoon' ? '15:00'
      : habitToEdit?.preferredTime === 'evening' ? '20:00'
      : '09:00'
    )
  );

  // Fechas de inicio y fin
  const [startDate, setStartDate] = useState<string>(habitToEdit?.startDate ?? '');
  const [endDate, setEndDate] = useState<string>(habitToEdit?.endDate ?? '');

  const [selectedGoals, setSelectedGoals] = useState<{ goalId: string; weight: number }[]>(
    habitToEdit?.goals ?? []
  );
  // Perfil público: apagado por defecto; al editar se respeta lo que ya tenía
  const [publicVisible, setPublicVisible] = useState<boolean>(Boolean(habitToEdit?.publicVisible));

  const handleCategoryChange = (newCat: string) => {
    setCategory(newCat);
    const matched = HABIT_CATEGORIES.find((c) => c.name === newCat);
    if (matched) {
      setIcon(matched.icon);
    }
  };

  const toggleDay = (d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  };

  const toggleGoal = (goalId: string) => {
    setSelectedGoals((prev) => {
      const exists = prev.find((g) => g.goalId === goalId);
      if (exists) return prev.filter((g) => g.goalId !== goalId);
      return [...prev, { goalId, weight: 25 }];
    });
  };

  const updateGoalWeight = (goalId: string, weight: number) => {
    setSelectedGoals((prev) =>
      prev.map((g) => (g.goalId === goalId ? { ...g, weight: Math.max(1, Math.min(100, weight)) } : g)),
    );
  };

  const autoMinMinutes = Math.max(1, Math.round((Number(targetMinutes) || 30) * minimumRatio));
  const autoMinQuantity = Math.max(1, Math.round((Number(targetQuantity) || 100) * minimumRatio));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (days.length === 0) {
      toast('Selecciona al menos un día de la semana', 'warning');
      return;
    }

    const tMin = Number(targetMinutes) || 30;
    const mMin = Number(minimumMinutes) > 0 ? Math.min(tMin, Math.round(Number(minimumMinutes))) : autoMinMinutes;
    const tQty = Number(targetQuantity) || 100;
    const mQty = Number(minimumQuantity) > 0 ? Math.min(tQty, Number(minimumQuantity)) : autoMinQuantity;

      const hour = parseInt(reminderTime.split(':')[0], 10);
      const derivedPreferredTime: TimeOfDay =
        isNaN(hour) ? 'any'
        : hour >= 5 && hour < 12 ? 'morning'
        : hour >= 12 && hour < 19 ? 'afternoon'
        : 'evening';

      const payload = {
        name: name.trim(),
        kind,
        category,
        icon,
        color,
        days,
        // Tiempo: la app calcula las monedas según la duración. Acción y cantidad: el chip, con su máximo por tipo
        points: kind === 'time' ? timeHabitCoins(tMin) : Math.min(Number(points) || 20, ECONOMY.chipMax[kind]),
        priority,
        targetMinutes: kind === 'time' ? tMin : undefined,
        minimumMinutes: kind === 'time' ? mMin : undefined,
        targetQuantity: kind === 'quantity' ? tQty : undefined,
        minimumQuantity: kind === 'quantity' ? mQty : undefined,
        quantityUnit: kind === 'quantity' ? (quantityUnit.trim() || 'reps') : undefined,
        targetLabel: targetLabel.trim() || undefined,
        minimumLabel: minimumLabel.trim() || undefined,
        reminderTime: reminderTime.trim() || '09:00',
        preferredTime: derivedPreferredTime,
        goals: selectedGoals,
        startDate: startDate.trim() || undefined,
        endDate: endDate.trim() || undefined,
        status: habitToEdit?.status ?? ('active' as const),
        publicVisible,
      };

    if (habitToEdit) {
      updateHabit(habitToEdit.id, payload);
      toast(`Hábito «${name}» actualizado`, 'success');
    } else {
      addHabit(payload);
      toast(`Hábito «${name}» creado`, 'success');
    }

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={habitToEdit ? 'Editar hábito' : 'Nuevo hábito'}
      wide
      zIndex={zIndex}
      preventBackdropClose={true}
    >
      <form onSubmit={handleSubmit} className="form">
        {/* Nombre y Categoría */}
        <div className="form-row">
          <div className="field">
            <span className="label">Nombre del hábito</span>
            <input
              className="input"
              required
              placeholder="Ej. Estudiar C#, Hacer ejercicio..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="label">Categoría (define icono predeterminado)</span>
            <CustomSelect
              value={category}
              onChange={handleCategoryChange}
              options={HABIT_CATEGORIES.map((cat) => ({
                value: cat.name,
                label: cat.name,
                icon: cat.icon,
              }))}
            />
          </div>
        </div>

        {/* Hora de notificación del día y Prioridad */}
        <div className="form-row">
          <div className="field">
            <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⏰</span>
              <span>Hora de notificación (del día)</span>
            </span>
            <CustomTimePicker
              value={reminderTime}
              onChange={setReminderTime}
            />
            <span className="hint">
              Recibirás una notificación del sistema en Windows y celulares a esta hora para realizar este hábito.
            </span>
          </div>

          <div className="field">
            <span className="label">Prioridad</span>
            <CustomSelect<Priority>
              value={priority}
              onChange={setPriority}
              options={[
                { value: 3, label: 'Alta (esencial)', badge: 'P3' },
                { value: 2, label: 'Media', badge: 'P2' },
                { value: 1, label: 'Baja (opcional)', badge: 'P1' },
              ]}
            />
          </div>
        </div>

        {/* Fechas de inicio y fin */}
        <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Vigencia del hábito (Fechas de inicio y fin)</div>
          <div className="form-row">
            <div className="field">
              <span className="label">Fecha de inicio (opcional)</span>
              <CustomDatePicker
                value={startDate}
                onChange={(val) => {
                  setStartDate(val);
                  if (!val) setEndDate('');
                }}
                placeholder="Por defecto hoy..."
              />
              <span className="hint">
                {startDate ? `Inicia el ${startDate}` : 'Por defecto inicia hoy automáticamente'}
              </span>
            </div>

            <div className="field">
              <span className="label">Fecha de fin (opcional)</span>
              <CustomDatePicker
                value={endDate}
                onChange={setEndDate}
                min={startDate || undefined}
                disabled={!startDate}
                placeholder="Indefinida..."
              />
              <span className="hint">
                {!startDate
                  ? 'Define primero una fecha de inicio'
                  : endDate
                  ? `Al llegar al ${endDate} quedará inactivo`
                  : 'Continúa indefinidamente'}
              </span>
            </div>
          </div>
        </div>

        {/* Icono y Color */}
        <div className="form-row">
          <div className="field">
            <span className="label">Icono personalizado</span>
            <div className="emoji-grid" style={{ maxHeight: 86, overflowY: 'auto' }}>
              {HABIT_ICONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className={`emoji-opt ${icon === em ? 'active' : ''}`}
                  onClick={() => setIcon(em)}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="label">Color</span>
            <div className="swatches" style={{ marginTop: 6 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch ${color === c ? 'active' : ''}`}
                  style={{ '--c': c } as React.CSSProperties}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Días de la semana */}
        <div className="field">
          <span className="label">Frecuencia semanal</span>
          <div className="day-picker">
            {DAY_SHORT.map((label, idx) => (
              <button
                key={label}
                type="button"
                className={days.includes(idx) ? 'active' : ''}
                onClick={() => toggleDay(idx)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Monedas al completar: chips con criterio de esfuerzo; en hábitos de tiempo las calcula la app */}
        <div className="field">
          <span className="label">Monedas al completar</span>
          {kind === 'time' ? (
            <span className="hint" style={{ marginTop: 4 }}>
              La app las calcula según la duración: <strong>+{timeHabitCoins(Number(targetMinutes) || 30)} pts</strong> al cumplir la meta
              completa, y la parte proporcional si haces menos minutos.
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                {COIN_CHIPS[kind].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`chip ${points === p ? 'active' : ''}`}
                    style={{ padding: '8px 18px', fontWeight: 700, fontSize: 13.5 }}
                    onClick={() => setPoints(p)}
                    title={CHIP_HINTS[p]}
                  >
                    +{p} pts
                  </button>
                ))}
              </div>
              <span className="hint" style={{ marginTop: 6 }}>
                {CHIP_HINTS[Math.min(points, ECONOMY.chipMax[kind])]}.{' '}
                {kind === 'quantity'
                  ? 'Si haces solo una parte, recibes la parte proporcional.'
                  : `El modo mínimo otorga el ${ratioPct}% (+${Math.round(Math.min(points, ECONOMY.chipMax[kind]) * minimumRatio * 10) / 10} pts).`}
              </span>
            </>
          )}
        </div>

        {/* Selector de Tipo de Hábito */}
        <div className="field">
          <span className="label">Tipo de hábito</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setKind('time')}
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: kind === 'time' ? 'rgba(139, 92, 246, 0.16)' : 'var(--surface-2)',
                border: `1.5px solid ${kind === 'time' ? 'var(--accent)' : 'var(--border-2)'}`,
                color: kind === 'time' ? 'var(--text-strong)' : 'var(--text-2)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                transition: 'all .15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: kind === 'time' ? 'var(--accent-2)' : 'inherit' }}>
                <span>⏱️</span>
                <span>Tiempo / Duración</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.35 }}>
                Cronometrado en minutos. Aparece en el temporizador y descuenta tiempo completado.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setKind('action')}
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: kind === 'action' ? 'rgba(139, 92, 246, 0.16)' : 'var(--surface-2)',
                border: `1.5px solid ${kind === 'action' ? 'var(--accent)' : 'var(--border-2)'}`,
                color: kind === 'action' ? 'var(--text-strong)' : 'var(--text-2)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                transition: 'all .15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: kind === 'action' ? 'var(--accent-2)' : 'inherit' }}>
                <span>⚡</span>
                <span>Acción directa</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.35 }}>
                1 solo clic (sí/no). Para hábitos directos sin cronómetro ni conteo numérico.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setKind('quantity')}
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: kind === 'quantity' ? 'rgba(139, 92, 246, 0.16)' : 'var(--surface-2)',
                border: `1.5px solid ${kind === 'quantity' ? 'var(--accent)' : 'var(--border-2)'}`,
                color: kind === 'quantity' ? 'var(--text-strong)' : 'var(--text-2)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                transition: 'all .15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: kind === 'quantity' ? 'var(--accent-2)' : 'inherit' }}>
                <span>🔢</span>
                <span>Cantidad</span>
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.35 }}>
                Meta numérica acumulable por partes (ej. 100 flexiones, 2L de agua, 10 páginas).
              </span>
            </button>
          </div>
        </div>

        {/* CONTENEDOR SEGÚN TIPO DE HÁBITO */}
        {kind === 'time' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⏱️ Niveles de cumplimiento (Modo Mínimo 🌱)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              {/* Columna Izquierda: Objetivo Completo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="field">
                  <span className="label">Objetivo completo (minutos)</span>
                  <input
                    type="number"
                    min={1}
                    max={360}
                    className="input"
                    placeholder="Ej. 60"
                    value={targetMinutes}
                    onChange={(e) => setTargetMinutes(e.target.value)}
                  />
                </div>
                <div className="field">
                  <span className="label">Descripción de meta completa (opcional)</span>
                  <input
                    className="input"
                    placeholder="Ej. 60 min de sesión completa"
                    value={targetLabel}
                    onChange={(e) => setTargetLabel(e.target.value)}
                  />
                </div>
              </div>

              {/* Columna Derecha: Modo Mínimo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="field">
                  <span className="label">Versión mínima (min) 🌱</span>
                  <input
                    type="number"
                    min={1}
                    max={Number(targetMinutes) || 360}
                    className="input"
                    placeholder={`Automático: ${autoMinMinutes} min (${ratioPct}%)`}
                    value={minimumMinutes}
                    onChange={(e) => setMinimumMinutes(e.target.value)}
                  />
                  <span className="hint">Déjalo vacío para usar el {ratioPct}% de la meta. Es lo mínimo que mantiene tu racha.</span>
                </div>
                <div className="field">
                  <span className="label">Descripción de meta mínima (opcional)</span>
                  <input
                    className="input"
                    placeholder="Ej. 24 min como mínimo para racha"
                    value={minimumLabel}
                    onChange={(e) => setMinimumLabel(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, background: 'rgba(139, 92, 246, 0.08)', padding: '8px 12px', borderRadius: 8 }}>
              💡 Este hábito aparecerá en la página de <strong>Temporizador</strong>. Al marcarlo como completado podrás insertar el tiempo dedicado y se deducirá del temporizador.
            </div>
          </div>
        )}

        {kind === 'quantity' && (
          <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>🔢 Configuración de Cantidad y Unidad</span>
            </div>
            <div className="form-row">
              <div className="field">
                <span className="label">Meta de cantidad por día</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  className="input"
                  placeholder="Ej. 100"
                  value={targetQuantity}
                  onChange={(e) => setTargetQuantity(e.target.value)}
                />
                <span className="hint">Cantidad total a alcanzar en el día (se puede registrar por partes).</span>
              </div>

              <div className="field">
                <span className="label">Unidad de medida</span>
                <input
                  className="input"
                  placeholder="Ej. flexiones, páginas, km, vasos, ml..."
                  value={quantityUnit}
                  onChange={(e) => setQuantityUnit(e.target.value)}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {UNIT_PRESETS.flatMap((p) => p.units).slice(0, 8).map((u) => (
                    <button
                      key={u}
                      type="button"
                      className={`chip sm ${quantityUnit === u ? 'active' : ''}`}
                      onClick={() => setQuantityUnit(u)}
                      style={{ fontSize: 11, padding: '3px 8px' }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="field">
              <span className="label">Versión mínima ({quantityUnit || 'reps'}) 🌱</span>
              <input
                type="number"
                min={1}
                max={Number(targetQuantity) || 100000}
                className="input"
                placeholder={`Automático: ${autoMinQuantity} ${quantityUnit || 'reps'} (${ratioPct}%)`}
                value={minimumQuantity}
                onChange={(e) => setMinimumQuantity(e.target.value)}
              />
              <span className="hint">
                Alcanzarás la versión mínima para encender tu racha con{' '}
                <strong>{Number(minimumQuantity) > 0 ? minimumQuantity : autoMinQuantity} {quantityUnit || 'reps'}</strong>. Los contadores se reinician a 0 cada nuevo día programado.
              </span>
            </div>
          </div>
        )}

        {kind === 'action' && (
          <div style={{ padding: 12, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border-2)', fontSize: 12.5, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⚡</span>
            <span>Hábito de acción directa: se completa con un solo clic. No usa temporizador ni métricas numéricas.</span>
          </div>
        )}

        {/* Relación con Objetivos y Peso */}
        {goals.length > 0 && (
          <div className="field">
            <span className="label">Objetivos vinculados y peso (%)</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {goals.map((g) => {
                const link = selectedGoals.find((l) => l.goalId === g.id);
                return (
                  <div
                    key={g.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: link ? 'var(--surface-3)' : 'var(--surface-2)',
                      border: `1px solid ${link ? 'var(--accent)' : 'var(--border)'}`,
                      gap: 12,
                    }}
                  >
                    {/* Interruptor propio (el control nativo queda oculto) */}
                    <label className="custom-switch" style={{ flex: 1, minWidth: 0, gap: 10 }}>
                      <input type="checkbox" checked={!!link} onChange={() => toggleGoal(g.id)} />
                      <span className="custom-switch-track">
                        <span className="custom-switch-thumb" />
                      </span>
                      <span aria-hidden="true">{g.icon}</span>
                      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{g.name}</span>
                    </label>

                    {link && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Peso:</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          className="input"
                          style={{ width: 70, textAlign: 'center', padding: '4px 8px' }}
                          value={link.weight}
                          onChange={(e) => updateGoalWeight(g.id, Number(e.target.value))}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700 }}>%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Perfil público: solo los hábitos marcados salen del dispositivo (nombre, icono y cumplimiento por día) */}
        <div className="field">
          <label className="custom-switch">
            <input
              type="checkbox"
              checked={publicVisible}
              onChange={(e) => setPublicVisible(e.target.checked)}
              aria-describedby="habit-public-hint"
            />
            <span className="custom-switch-track">
              <span className="custom-switch-thumb" />
            </span>
            <span style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 500 }}>Visible en mi perfil</span>
          </label>
          <span className="hint" id="habit-public-hint">
            Su nombre, icono y cumplimiento por día se verán en tu perfil público. Los demás hábitos nunca salen cifrados de tu
            dispositivo.
          </span>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            {habitToEdit ? 'Guardar cambios' : 'Crear hábito'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
