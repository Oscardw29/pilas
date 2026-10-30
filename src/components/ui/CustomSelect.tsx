import React, { useState, useRef, useEffect, useId } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { playSound } from '@/lib/sound';

export interface CustomSelectOption<T = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  sublabel?: string;
  badge?: string;
  color?: string;
}

export interface CustomSelectProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: CustomSelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  searchable?: boolean;
  searchPlaceholder?: string;
  triggerIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  align?: 'left' | 'right';
  /** Nombre accesible si no hay una etiqueta visible asociada */
  ariaLabel?: string;
}

/**
 * Desplegable con semántica de listbox (WAI-ARIA):
 * flechas / Inicio / Fin para moverse, Enter o Espacio para elegir, Escape para cerrar
 * y búsqueda por letras tecleadas. El foco se queda en el disparador (o en el buscador).
 */
export function CustomSelect<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = 'Selecciona una opción...',
  disabled = false,
  style,
  searchable = false,
  searchPlaceholder = 'Buscar...',
  triggerIcon,
  size = 'md',
  align = 'left',
  ariaLabel,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ text: '', at: 0 });
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const selectedOption = options.find((opt) => opt.value === value);

  const filteredOptions =
    searchable && searchQuery.trim()
      ? options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (opt.sublabel && opt.sublabel.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      : options;

  const close = (returnFocus = false) => {
    setIsOpen(false);
    setSearchQuery('');
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  };

  // Cerrar al hacer clic o tocar fuera
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Al abrir: enfocar el buscador y marcar la opción seleccionada como activa
  useEffect(() => {
    if (!isOpen) return;
    if (searchable) searchInputRef.current?.focus();
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Mantener visible la opción activa
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, isOpen]);

  const open = () => {
    if (disabled) return;
    setIsOpen(true);
    playSound.pop();
  };

  const handleToggle = () => {
    if (disabled) return;
    if (isOpen) close();
    else open();
  };

  const handleSelect = (val: T) => {
    onChange(val);
    close(true);
    playSound.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const count = filteredOptions.length;

    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && e.target === triggerRef.current) {
        e.preventDefault();
        open();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        // No dejar que el Escape cierre también el diálogo que contiene al desplegable
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'Tab':
        close();
        return;
      case 'ArrowDown':
        e.preventDefault();
        if (count) setActiveIndex((i) => (i + 1) % count);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (count) setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1));
        return;
      case 'Home':
        if (e.target === searchInputRef.current) return;
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        if (e.target === searchInputRef.current) return;
        e.preventDefault();
        setActiveIndex(count - 1);
        return;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < count) handleSelect(filteredOptions[activeIndex].value);
        return;
      case ' ':
        if (e.target === searchInputRef.current) return;
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < count) handleSelect(filteredOptions[activeIndex].value);
        return;
    }

    // Búsqueda por letras (sin buscador visible)
    if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const ta = typeAhead.current;
      ta.text = now - ta.at > 700 ? e.key.toLowerCase() : ta.text + e.key.toLowerCase();
      ta.at = now;
      const idx = filteredOptions.findIndex((o) => o.label.toLowerCase().startsWith(ta.text));
      if (idx >= 0) setActiveIndex(idx);
    }
  };

  const padSize = size === 'sm' ? '7px 11px' : size === 'lg' ? '12px 16px' : '10px 14px';
  const fontSize = size === 'sm' ? '12.5px' : size === 'lg' ? '14.5px' : '13.5px';

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      style={{
        position: 'relative',
        width: '100%',
        userSelect: 'none',
        ...style,
      }}
    >
      {/* Botón Disparador (Trigger) */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && !searchable && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel}
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
          border: isOpen ? '1.5px solid var(--accent)' : '1px solid var(--border-2)',
          boxShadow: isOpen ? '0 0 0 3px var(--accent-soft)' : 'none',
          color: disabled ? 'var(--muted)' : selectedOption ? 'var(--text)' : 'var(--muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {triggerIcon && <span style={{ flexShrink: 0 }}>{triggerIcon}</span>}
          {selectedOption?.icon && (
            <span style={{ fontSize: size === 'lg' ? 22 : 16, flexShrink: 0 }}>{selectedOption.icon}</span>
          )}
          <div
            className="truncate"
            style={{
              display: 'flex',
              flexDirection: selectedOption?.sublabel ? 'column' : 'row',
              alignItems: selectedOption?.sublabel ? 'flex-start' : 'center',
              minWidth: 0,
            }}
          >
            <span className="truncate" style={{ fontWeight: selectedOption ? 600 : 400, fontSize }}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            {selectedOption?.sublabel && (
              <span style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{selectedOption.sublabel}</span>
            )}
          </div>
          {selectedOption?.badge && (
            <span
              className="badge sm"
              style={{ marginLeft: 4, fontSize: 10.5, background: 'var(--surface-3)', color: 'var(--accent-2)' }}
            >
              {selectedOption.badge}
            </span>
          )}
        </div>

        <ChevronDown
          size={16}
          aria-hidden="true"
          style={{
            color: isOpen ? 'var(--accent-2)' : 'var(--muted)',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease, color 0.15s ease',
            flexShrink: 0,
          }}
        />
      </button>

      {/* Menú desplegable */}
      {isOpen && (
        <div
          className="custom-select-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            ...(align === 'right' ? { right: 0, minWidth: '100%' } : { left: 0, right: 0 }),
            zIndex: 150,
            background: 'linear-gradient(180deg, var(--popover) 0%, var(--popover-end) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--border-2)',
            borderRadius: 14,
            boxShadow: '0 18px 48px color-mix(in srgb, var(--shadow-color) 80%, transparent), 0 0 24px rgba(139, 92, 246, 0.15)',
            padding: 6,
            maxHeight: 280,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            animation: 'fadeIn .15s ease',
          }}
        >
          {/* Buscador opcional */}
          {searchable && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                marginBottom: 4,
                borderRadius: 10,
                background: 'color-mix(in srgb, var(--tint) 4%, transparent)',
                border: '1px solid color-mix(in srgb, var(--tint) 8%, transparent)',
              }}
            >
              <Search size={14} style={{ color: 'var(--muted)' }} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listboxId}
                aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-strong)', width: '100%' }}
              />
            </div>
          )}

          {/* Opciones con scroll */}
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? placeholder}
            style={{
              overflowY: 'auto',
              maxHeight: searchable ? 210 : 260,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === activeIndex;
                return (
                  <div
                    key={String(opt.value)}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(opt.value)}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '9px 12px',
                      minHeight: 40,
                      borderRadius: 10,
                      background: isSelected ? 'var(--accent-soft)' : isActive ? 'color-mix(in srgb, var(--tint) 6%, transparent)' : 'transparent',
                      border: isSelected
                        ? '1px solid rgba(139, 92, 246, 0.35)'
                        : isActive
                        ? '1px solid var(--border-2)'
                        : '1px solid transparent',
                      color: isSelected ? 'var(--text-strong)' : 'var(--text)',
                      cursor: 'pointer',
                      transition: 'background 0.12s ease, border-color 0.12s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                      {opt.icon && <span style={{ fontSize: 16, flexShrink: 0 }}>{opt.icon}</span>}
                      <div className="truncate">
                        <div style={{ fontWeight: isSelected ? 600 : 500, fontSize: 13 }}>{opt.label}</div>
                        {opt.sublabel && (
                          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{opt.sublabel}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {opt.badge && (
                        <span
                          className="badge sm"
                          style={{
                            fontSize: 10.5,
                            background: isSelected ? 'rgba(139, 92, 246, 0.3)' : 'var(--surface-3)',
                            color: isSelected ? 'var(--text-strong)' : 'var(--muted)',
                          }}
                        >
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && <Check size={15} aria-hidden="true" style={{ color: 'var(--accent-2)', strokeWidth: 2.5 }} />}
                    </div>
                  </div>
                );
              })
            ) : (
              <div role="status" style={{ padding: '14px 12px', textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
                No se encontraron opciones
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
