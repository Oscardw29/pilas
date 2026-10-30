import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Clock, ChevronDown } from 'lucide-react';
import { playSound } from '@/lib/sound';

export interface CustomTimePickerProps {
  value: string; // Formato 'HH:mm', ej. '14:30'
  onChange: (value: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  presets?: string[]; // Mantenido para retrocompatibilidad de tipos
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
}

const ITEM_HEIGHT = 44; // Altura en px de cada fila del tambor
const VISIBLE_ITEMS = 5; // Mostrar 5 elementos (2 arriba, 1 centro seleccionado, 2 abajo)
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

interface WheelColumnProps {
  items: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const WheelColumn: React.FC<WheelColumnProps> = ({
  items,
  selectedIndex,
  onSelect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const activeIndexRef = useRef(selectedIndex);
  const isDraggingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    activeIndexRef.current = selectedIndex;
    setActiveIndex(selectedIndex);
    const frame = requestAnimationFrame(() => {
      if (containerRef.current && !isDraggingRef.current) {
        isProgrammaticScrollRef.current = true;
        containerRef.current.scrollTop = selectedIndex * ITEM_HEIGHT;
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 150);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedIndex]);

  // Manejo de scroll nativo (táctil / rueda del mouse)
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    if (isProgrammaticScrollRef.current) return;

    const top = containerRef.current.scrollTop;
    const newIdx = Math.max(0, Math.min(items.length - 1, Math.round(top / ITEM_HEIGHT)));

    if (newIdx !== activeIndexRef.current) {
      activeIndexRef.current = newIdx;
      setActiveIndex(newIdx);
      playSound.click();
    }

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      if (!isDraggingRef.current && !isProgrammaticScrollRef.current) {
        onSelect(newIdx);
      }
    }, 80);
  }, [items.length, onSelect]);

  // Arrastre con mouse para PC/Escritorio
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    if (containerRef.current) {
      startScrollTopRef.current = containerRef.current.scrollTop;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !containerRef.current) return;
    const delta = e.clientY - startYRef.current;
    containerRef.current.scrollTop = startScrollTopRef.current - delta;
  };

  const handleMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (containerRef.current) {
      const top = containerRef.current.scrollTop;
      const snapIdx = Math.max(0, Math.min(items.length - 1, Math.round(top / ITEM_HEIGHT)));
      containerRef.current.scrollTo({
        top: snapIdx * ITEM_HEIGHT,
        behavior: 'smooth',
      });
      activeIndexRef.current = snapIdx;
      setActiveIndex(snapIdx);
      onSelect(snapIdx);
    }
  }, [items.length, onSelect]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        handleMouseUp();
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [handleMouseUp]);

  // Clic directo en un número para centrarlo
  const handleItemClick = (idx: number) => {
    if (!containerRef.current) return;
    containerRef.current.scrollTo({
      top: idx * ITEM_HEIGHT,
      behavior: 'smooth',
    });
    activeIndexRef.current = idx;
    setActiveIndex(idx);
    onSelect(idx);
    playSound.click();
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        flex: 1,
        height: ITEM_HEIGHT * VISIBLE_ITEMS, // 220px exactos
        overflowY: 'scroll',
        scrollSnapType: 'y mandatory',
        overscrollBehavior: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        paddingTop: ITEM_HEIGHT * 2, // 88px espaciador superior
        paddingBottom: ITEM_HEIGHT * 2, // 88px espaciador inferior
        boxSizing: 'border-box',
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
    >
      {items.map((item, idx) => {
        const dist = Math.abs(idx - activeIndex);
        const isSelected = dist === 0;
        const isAdjacent = dist === 1;
        const isFar = dist === 2;

        return (
          <div
            key={item}
            onClick={() => handleItemClick(idx)}
            style={{
              height: ITEM_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              scrollSnapAlign: 'center',
              fontSize: isSelected ? 26 : isAdjacent ? 20 : isFar ? 16 : 13,
              fontWeight: isSelected ? 700 : isAdjacent ? 500 : 400,
              fontFamily: 'inherit',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              color: isSelected
                ? 'var(--text-strong)'
                : isAdjacent
                ? 'color-mix(in srgb, var(--text-strong) 55%, transparent)'
                : 'color-mix(in srgb, var(--text-strong) 20%, transparent)',
              transform: `scale(${isSelected ? 1.15 : isAdjacent ? 0.95 : 0.82})`,
              transition: 'transform 0.1s ease, font-size 0.1s ease, color 0.1s ease',
              userSelect: 'none',
              cursor: 'pointer',
            }}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
};

export const CustomTimePicker: React.FC<CustomTimePickerProps> = ({
  value,
  onChange,
  disabled = false,
  style,
  placeholder = 'Seleccionar hora...',
  size = 'md',
  align = 'left',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Analizar valor actual
  const [initHour, initMin] = value && value.includes(':')
    ? value.split(':')
    : ['08', '00'];

  const [selectedH, setSelectedH] = useState(initHour || '08');
  const [selectedM, setSelectedM] = useState(initMin || '00');
  const [typedH, setTypedH] = useState(initHour || '08');
  const [typedM, setTypedM] = useState(initMin || '00');

  const typedHRef = useRef(initHour || '08');
  const typedMRef = useRef(initMin || '00');

  const hourInputRef = useRef<HTMLInputElement>(null);
  const minInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && value.includes(':')) {
      const [h, m] = value.split(':');
      setSelectedH(h);
      setSelectedM(m);
      setTypedH(h);
      setTypedM(m);
      typedHRef.current = h;
      typedMRef.current = m;
    }
  }, [value]);

  // Manejo de escritura directa en horas
  const handleHourChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      setTypedH('');
      typedHRef.current = '';
      return;
    }

    // Si ya había 2 dígitos y se presionó una nueva tecla (longitud > 2)
    let digits = raw;
    if (raw.length > 2) {
      digits = raw.slice(-1); // Tomar el último dígito recién presionado
    }

    const num = parseInt(digits, 10);
    if (isNaN(num)) {
      setTypedH('');
      typedHRef.current = '';
      return;
    }

    if (digits.length === 2) {
      if (num <= 23) {
        const formatted = digits.padStart(2, '0');
        setTypedH(formatted);
        setSelectedH(formatted);
        typedHRef.current = formatted;
        setTimeout(() => {
          minInputRef.current?.focus();
          minInputRef.current?.select();
        }, 20);
      } else {
        // Si el número es mayor a 23 (ej. 25, 34), nos quedamos con el último dígito
        const lastDigit = digits.slice(-1);
        const lastNum = parseInt(lastDigit, 10);
        if (lastNum <= 2) {
          setTypedH(lastDigit);
          typedHRef.current = lastDigit;
        } else {
          const formatted = `0${lastNum}`;
          setTypedH(formatted);
          setSelectedH(formatted);
          typedHRef.current = formatted;
          setTimeout(() => {
            minInputRef.current?.focus();
            minInputRef.current?.select();
          }, 20);
        }
      }
    } else if (digits.length === 1) {
      if (num >= 3) {
        // Horas 3..9 corresponden directamente a 03..09 y avanzan a minutos
        const formatted = `0${num}`;
        setTypedH(formatted);
        setSelectedH(formatted);
        typedHRef.current = formatted;
        setTimeout(() => {
          minInputRef.current?.focus();
          minInputRef.current?.select();
        }, 20);
      } else {
        // 0, 1 o 2: se mantiene en pantalla esperando el segundo dígito
        setTypedH(digits);
        typedHRef.current = digits;
      }
    }
  };

  const handleHourBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.trim() || typedHRef.current;
    if (!rawVal) {
      setTypedH(selectedH);
      typedHRef.current = selectedH;
      return;
    }
    const num = parseInt(rawVal, 10);
    const valid = isNaN(num) ? 0 : Math.min(23, Math.max(0, num));
    const formatted = String(valid).padStart(2, '0');
    setTypedH(formatted);
    setSelectedH(formatted);
    typedHRef.current = formatted;
  };

  // Manejo de escritura directa en minutos
  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      setTypedM('');
      typedMRef.current = '';
      return;
    }

    let digits = raw;
    if (raw.length > 2) {
      digits = raw.slice(-1);
    }

    const num = parseInt(digits, 10);
    if (isNaN(num)) {
      setTypedM('');
      typedMRef.current = '';
      return;
    }

    if (digits.length === 2) {
      if (num <= 59) {
        const formatted = digits.padStart(2, '0');
        setTypedM(formatted);
        setSelectedM(formatted);
        typedMRef.current = formatted;
      } else {
        const lastDigit = digits.slice(-1);
        const lastNum = parseInt(lastDigit, 10);
        if (lastNum <= 5) {
          setTypedM(lastDigit);
          typedMRef.current = lastDigit;
        } else {
          const formatted = `0${lastNum}`;
          setTypedM(formatted);
          setSelectedM(formatted);
          typedMRef.current = formatted;
        }
      }
    } else if (digits.length === 1) {
      if (num >= 6) {
        // Minutos 6..9 corresponden directamente a 06..09
        const formatted = `0${num}`;
        setTypedM(formatted);
        setSelectedM(formatted);
        typedMRef.current = formatted;
      } else {
        // 0..5 se mantiene esperando el segundo dígito
        setTypedM(digits);
        typedMRef.current = digits;
      }
    }
  };

  const handleMinBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.trim() || typedMRef.current;
    if (!rawVal) {
      setTypedM(selectedM);
      typedMRef.current = selectedM;
      return;
    }
    const num = parseInt(rawVal, 10);
    const valid = isNaN(num) ? 0 : Math.min(59, Math.max(0, num));
    const formatted = String(valid).padStart(2, '0');
    setTypedM(formatted);
    setSelectedM(formatted);
    typedMRef.current = formatted;
  };

  // Teclado: Enter confirma, flechas navegan entre horas y minutos
  const handleKeyDownHour = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'ArrowRight') {
      minInputRef.current?.focus();
      minInputRef.current?.select();
    }
  };

  const handleKeyDownMin = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) {
      hourInputRef.current?.focus();
      hourInputRef.current?.select();
    } else if (e.key === 'Backspace' && typedM === '') {
      hourInputRef.current?.focus();
      hourInputRef.current?.select();
    }
  };

  // Cerrar al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Al hacer clic fuera, confirmar la hora seleccionada
        const finalTime = `${selectedH}:${selectedM}`;
        onChange(finalTime);
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
  }, [isOpen, selectedH, selectedM, onChange]);

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen((prev) => !prev);
    playSound.pop();
  };

  const handleConfirm = () => {
    const finalH = String(parseInt(typedH || selectedH, 10) || 0).padStart(2, '0');
    const finalM = String(parseInt(typedM || selectedM, 10) || 0).padStart(2, '0');
    const finalTime = `${finalH}:${finalM}`;
    onChange(finalTime);
    setIsOpen(false);
    playSound.pop();
  };

  const handleReset = () => {
    const [h, m] = value && value.includes(':') ? value.split(':') : ['08', '00'];
    setSelectedH(h);
    setSelectedM(m);
    setTypedH(h);
    setTypedM(m);
    playSound.click();
  };

  const formatDisplay = (val: string) => {
    if (!val || !val.includes(':')) return placeholder;
    const [hStr, mStr] = val.split(':');
    const h = parseInt(hStr, 10);
    const ampm = h >= 12 ? 'p. m.' : 'a. m.';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${val} (${h12}:${mStr} ${ampm})`;
  };

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
        onClick={handleToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
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
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
          <Clock size={size === 'sm' ? 13 : 15} style={{ color: 'var(--accent-2)', flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', fontSize: size === 'sm' ? '12.5px' : '13.5px', whiteSpace: 'nowrap' }}>
            {value || '00:00'}
          </span>
          {size !== 'sm' && (
            <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {formatDisplay(value).split('(')[1]?.replace(')', '') || ''}
            </span>
          )}
        </div>

        <ChevronDown
          size={15}
          style={{
            color: isOpen ? 'var(--accent-2)' : 'var(--muted)',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease, color 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {/* Menú Desplegable Tipo Rueda / Tambor (Estilo iOS & Android Roller) */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            ...(align === 'right' ? { right: 0, left: 'auto' } : { left: 0 }),
            zIndex: 150,
            width: 'min(270px, calc(100vw - 32px))',
            background: 'linear-gradient(180deg, var(--popover) 0%, var(--popover-end) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border-2)',
            borderRadius: 16,
            boxShadow: '0 18px 48px color-mix(in srgb, var(--shadow-color) 85%, transparent), 0 0 24px rgba(139, 92, 246, 0.18)',
            padding: '14px 14px 10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            animation: 'fadeIn .15s ease',
          }}
        >
          {/* Cabecera con lectura y campos de escritura directa */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 8,
              borderBottom: '1px solid var(--border-2)',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
              Hora seleccionada:
            </span>

            {/* Campos interactivos para escribir directamente la hora */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'color-mix(in srgb, var(--tint) 5%, transparent)',
                padding: '3px 8px',
                borderRadius: 8,
                border: '1px solid rgba(139, 92, 246, 0.25)',
              }}
            >
              <input
                ref={hourInputRef}
                type="text"
                inputMode="numeric"
                value={typedH}
                onChange={handleHourChange}
                onBlur={handleHourBlur}
                onFocus={(e) => e.target.select()}
                onKeyDown={handleKeyDownHour}
                placeholder="00"
                title="Escribe la hora (00-23)"
                style={{
                  width: 28,
                  padding: '2px 0',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--accent-2)',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-2)', userSelect: 'none' }}>:</span>
              <input
                ref={minInputRef}
                type="text"
                inputMode="numeric"
                value={typedM}
                onChange={handleMinChange}
                onBlur={handleMinBlur}
                onFocus={(e) => e.target.select()}
                onKeyDown={handleKeyDownMin}
                placeholder="00"
                title="Escribe los minutos (00-59)"
                style={{
                  width: 28,
                  padding: '2px 0',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 16,
                  fontWeight: 800,
                  color: 'var(--accent-2)',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, marginLeft: 2, userSelect: 'none' }}>
                {parseInt(typedH || selectedH || '0', 10) >= 12 ? 'PM' : 'AM'}
              </span>
            </div>
          </div>

          {/* Subtítulos de columnas */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              padding: '0 8px',
              fontSize: 10.5,
              fontWeight: 700,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              userSelect: 'none',
            }}
          >
            <span style={{ flex: 1, textAlign: 'center' }}>Horas</span>
            <span style={{ width: 20 }} />
            <span style={{ flex: 1, textAlign: 'center' }}>Minutos</span>
          </div>

          {/* Caja del tambor / rueda de dos columnas (Horas y Minutos) */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              height: ITEM_HEIGHT * VISIBLE_ITEMS, // 220px exactos
              borderRadius: 12,
              background: 'color-mix(in srgb, var(--tint) 2%, transparent)',
              overflow: 'hidden',
            }}
          >
            {/* Franja central de selección resaltada (Selection Highlight Strip) */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                top: ITEM_HEIGHT * 2, // Exactamente en la fila central (88px)
                height: ITEM_HEIGHT, // 44px
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--tint) 7%, transparent)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                boxShadow: '0 0 16px rgba(139, 92, 246, 0.16)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />

            {/* Máscaras de degradado superior e inferior para efecto 3D de tambor cilíndrico */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 72,
                background: 'linear-gradient(180deg, var(--popover) 15%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 72,
                background: 'linear-gradient(0deg, var(--popover-end) 15%, transparent 100%)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />

            {/* Rueda de Horas */}
            <WheelColumn
              items={HOURS}
              selectedIndex={Math.max(0, HOURS.indexOf(selectedH.padStart(2, '0')))}
              onSelect={(idx) => {
                setSelectedH(HOURS[idx]);
                setTypedH(HOURS[idx]);
              }}
            />

            {/* Separador ":" */}
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                fontSize: 22,
                fontWeight: 800,
                color: 'var(--accent-2)',
                zIndex: 3,
                userSelect: 'none',
                pointerEvents: 'none',
                fontFamily: 'inherit',
              }}
            >
              :
            </div>

            {/* Rueda de Minutos */}
            <WheelColumn
              items={MINUTES}
              selectedIndex={Math.max(0, MINUTES.indexOf(selectedM.padStart(2, '0')))}
              onSelect={(idx) => {
                setSelectedM(MINUTES[idx]);
                setTypedM(MINUTES[idx]);
              }}
            />
          </div>

          {/* Botonera inferior estilo modal (Restablecer a la izquierda, OK a la derecha) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 8,
              borderTop: '1px solid var(--border-2)',
              marginTop: 2,
            }}
          >
            <button
              type="button"
              onClick={handleReset}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 10px',
                borderRadius: 8,
                transition: 'color 0.15s ease, background 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-1)';
                e.currentTarget.style.background = 'color-mix(in srgb, var(--tint) 5%, transparent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--muted)';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              Restablecer
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              style={{
                background: 'color-mix(in srgb, var(--tint) 5%, transparent)',
                border: '1px solid color-mix(in srgb, var(--tint) 10%, transparent)',
                color: 'var(--text-1)',
                fontSize: 13.5,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '6px 18px',
                borderRadius: 8,
                boxShadow: 'none',
                transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.boxShadow = '0 2px 14px rgba(139, 92, 246, 0.45)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'color-mix(in srgb, var(--tint) 5%, transparent)';
                e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--tint) 10%, transparent)';
                e.currentTarget.style.color = 'var(--text-1)';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
