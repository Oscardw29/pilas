import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { playSound } from '@/lib/sound';
import { todayKey } from '@/lib/dates';

export interface CustomDatePickerProps {
  value?: string; // Formato 'YYYY-MM-DD'
  onChange: (value: string) => void;
  min?: string; // 'YYYY-MM-DD'
  max?: string; // 'YYYY-MM-DD'
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const WEEKDAY_NAMES = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

export const CustomDatePicker: React.FC<CustomDatePickerProps> = ({
  value = '',
  onChange,
  min,
  max,
  placeholder = 'dd/mm/aaaa',
  disabled = false,
  style,
  size = 'md',
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Inicializar vista de mes y año con la fecha seleccionada o la actual
  const initialDate = value ? new Date(value + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth()); // 0-11

  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear());
        setViewMonth(d.getMonth());
      }
    }
  }, [value]);

  // Cerrar al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // stopPropagation: el Escape cierra solo el selector, no el diálogo que lo contiene
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    playSound.pop();
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    playSound.pop();
  };

  const handleSelectDay = (day: number) => {
    const formattedMonth = String(viewMonth + 1).padStart(2, '0');
    const formattedDay = String(day).padStart(2, '0');
    const dateStr = `${viewYear}-${formattedMonth}-${formattedDay}`;

    if (min && dateStr < min) return;
    if (max && dateStr > max) return;

    onChange(dateStr);
    setIsOpen(false);
    playSound.click();
  };

  const handleSelectToday = () => {
    const t = todayKey();
    if (min && t < min) return;
    if (max && t > max) return;
    onChange(t);
    setIsOpen(false);
    playSound.click();
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    playSound.pop();
  };

  // Generar cuadrícula de días para viewYear y viewMonth
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Día de la semana del primer día (0 = Domingo, ..., 6 = Sábado) -> Convertir a 0 = Lunes, 6 = Domingo
  let startWeekday = firstDayOfMonth.getDay() - 1;
  if (startWeekday < 0) startWeekday = 6;

  // Días del mes anterior para rellenar
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

  const formattedDisplay = () => {
    if (!value) return placeholder;
    const parts = value.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts;
      const monthIdx = parseInt(m, 10) - 1;
      const mName = MONTH_NAMES[monthIdx]?.slice(0, 3).toLowerCase() || m;
      return `${d} de ${mName}. ${y}`;
    }
    return value;
  };

  const today = todayKey();
  const padSize = size === 'sm' ? '7px 11px' : size === 'lg' ? '12px 16px' : '10px 14px';
  const fontSize = size === 'sm' ? '12.5px' : size === 'lg' ? '14.5px' : '13.5px';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* Botón Disparador (Trigger) */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen((prev) => !prev);
            playSound.pop();
          }
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: padSize,
          fontSize,
          borderRadius: 12,
          background: 'var(--surface-2)',
          border: isOpen
            ? '1.5px solid var(--accent)'
            : '1px solid var(--border-2)',
          boxShadow: isOpen ? '0 0 0 3px var(--accent-soft)' : 'none',
          color: disabled ? 'var(--muted)' : value ? 'var(--text)' : 'var(--muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <CalendarIcon size={15} style={{ color: 'var(--accent-2)', flexShrink: 0 }} />
          <span style={{ fontWeight: value ? 500 : 400 }} className="truncate">
            {formattedDisplay()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {value && !disabled && (
            <span
              onClick={handleClear}
              title="Borrar fecha"
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'color-mix(in srgb, var(--tint) 8%, transparent)',
                color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              <X size={11} />
            </span>
          )}
          <ChevronDown
            size={16}
            style={{
              color: isOpen ? 'var(--accent-2)' : 'var(--muted)',
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
      </button>

      {/* Calendario Desplegable Coherente */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            ...(align === 'right' ? { right: 0, left: 'auto' } : { left: 0 }),
            zIndex: 150,
            minWidth: 'min(295px, calc(100vw - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            background: 'linear-gradient(180deg, var(--popover) 0%, var(--popover-end) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border-2)',
            borderRadius: 14,
            boxShadow: '0 18px 48px color-mix(in srgb, var(--shadow-color) 80%, transparent), 0 0 24px rgba(139, 92, 246, 0.15)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            animation: 'fadeIn .15s ease',
          }}
        >
          {/* Header de navegación Mes y Año */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="icon-btn sm"
              onClick={handlePrevMonth}
              title="Mes anterior"
              aria-label="Mes anterior"
            >
              <ChevronLeft size={16} />
            </button>

            <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-strong)' }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>

            <button
              type="button"
              className="icon-btn sm"
              onClick={handleNextMonth}
              title="Mes siguiente"
              aria-label="Mes siguiente"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Días de la semana */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, textAlign: 'center' }}>
            {WEEKDAY_NAMES.map((wd) => (
              <span key={wd} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                {wd}
              </span>
            ))}
          </div>

          {/* Cuadrícula de días */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {/* Días previos del mes anterior */}
            {Array.from({ length: startWeekday }).map((_, i) => {
              const prevDayNum = prevMonthDays - startWeekday + i + 1;
              return (
                <div
                  key={`prev-${i}`}
                  style={{
                    height: 32,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 11.5,
                    color: 'color-mix(in srgb, var(--tint) 15%, transparent)',
                    cursor: 'default',
                  }}
                >
                  {prevDayNum}
                </div>
              );
            })}

            {/* Días del mes activo */}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const formattedM = String(viewMonth + 1).padStart(2, '0');
              const formattedD = String(dayNum).padStart(2, '0');
              const dayStr = `${viewYear}-${formattedM}-${formattedD}`;

              const isSelected = value === dayStr;
              const isToday = today === dayStr;
              const isDisabled = Boolean((min && dayStr < min) || (max && dayStr > max));

              return (
                <button
                  key={dayNum}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectDay(dayNum)}
                  style={{
                    height: 32,
                    borderRadius: 8,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12.5,
                    fontWeight: isSelected ? 700 : isToday ? 700 : 500,
                    background: isSelected
                      ? 'var(--accent)'
                      : isToday
                      ? 'rgba(139, 92, 246, 0.15)'
                      : 'transparent',
                    border: isSelected
                      ? '1px solid var(--accent)'
                      : isToday
                      ? '1px solid rgba(139, 92, 246, 0.4)'
                      : '1px solid transparent',
                    color: isSelected ? '#fff' : isDisabled ? 'color-mix(in srgb, var(--tint) 18%, transparent)' : 'var(--text-strong)',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.12s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = 'color-mix(in srgb, var(--tint) 8%, transparent)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isDisabled) {
                      e.currentTarget.style.background = isToday ? 'rgba(139, 92, 246, 0.15)' : 'transparent';
                    }
                  }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>

          {/* Footer con acciones rápidas */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--border-2)' }}>
            <button
              type="button"
              className="btn btn-ghost sm"
              onClick={handleClear}
              style={{ fontSize: 11.5, padding: '3px 8px' }}
            >
              Borrar
            </button>

            <button
              type="button"
              className="btn btn-secondary sm"
              onClick={handleSelectToday}
              style={{ fontSize: 11.5, padding: '3px 10px', color: 'var(--accent-2)' }}
            >
              Hoy
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
