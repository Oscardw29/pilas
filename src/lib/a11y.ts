import type React from 'react';

/**
 * Props para que un contenedor clicable (tarjeta) también funcione con teclado y lectores de pantalla:
 * foco con Tab y activación con Enter/Espacio. Las teclas en controles hijos no lo disparan.
 */
export function clickableProps(onActivate: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
