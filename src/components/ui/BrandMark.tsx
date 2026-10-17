import React, { useId } from 'react';

/**
 * LOGO DE ¡PILAS!
 * Una pila cargada, inclinada hacia adelante, con un rayo que también se lee como el «!» del nombre.
 * Es el mismo dibujo que public/favicon.svg y los iconos de la PWA.
 */
export const BrandMark: React.FC<{ size?: number; className?: string }> = ({ size = 32, className }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.55" stopColor="#7c3aed" />
          <stop offset="1" stopColor="#4c1d95" />
        </linearGradient>
        <linearGradient id={`bolt-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fde047" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#bg-${id})`} />
      <g transform="rotate(12 32 33)" className="brand-mark-battery">
        <rect x="26" y="8.5" width="12" height="6" rx="2.2" fill="#fff" />
        <rect x="17.5" y="13" width="29" height="44" rx="8.5" fill="#fff" />
        <path
          className="brand-mark-bolt"
          d="M35.5 18 L23.5 37.5 H31 L28.5 52 L41 31.5 H33.5 Z"
          fill={`url(#bolt-${id})`}
          stroke="#b45309"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
};

/** Nombre con los signos de exclamación en el color de acento */
export const BrandWordmark: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`brand-wordmark ${className ?? ''}`}>
    <span className="brand-bang">¡</span>Pilas<span className="brand-bang">!</span>
  </span>
);
