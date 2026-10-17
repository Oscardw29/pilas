import React from 'react';

interface StreakFlameProps {
  days: number;
  size?: number;
  isSuperStreak?: boolean;
  isFrozen?: boolean;
}

export type FlameTier =
  | 'dormant'
  | 'tier_1'
  | 'tier_2'
  | 'tier_3'
  | 'tier_5'
  | 'tier_7'
  | 'tier_10'
  | 'tier_15'
  | 'tier_20'
  | 'tier_30'
  | 'tier_50'
  | 'tier_100';

export function getFlameTier(days: number): FlameTier {
  if (days <= 0) return 'dormant';
  if (days >= 100) return 'tier_100';
  if (days >= 50) return 'tier_50';
  if (days >= 30) return 'tier_30';
  if (days >= 20) return 'tier_20';
  if (days >= 15) return 'tier_15';
  if (days >= 10) return 'tier_10';
  if (days >= 7) return 'tier_7';
  if (days >= 5) return 'tier_5';
  if (days >= 3) return 'tier_3';
  if (days >= 2) return 'tier_2';
  return 'tier_1';
}

export const StreakFlame: React.FC<StreakFlameProps> = ({ days, size = 48, isSuperStreak = false, isFrozen = false }) => {
  const tier = getFlameTier(days);

  let primaryColor = '#71717a';
  let secondaryColor = '#a1a1aa';
  let accentColor = '#ffffff';
  let glowColor = 'rgba(161, 161, 170, 0.2)';
  let flameTitle = 'Llama apagada';
  let sparkCount = 0;

  if (isFrozen && days > 0) {
    // VARIANTE CONGELADA / PROTECTOR DE RACHA (Gama Azul Hielo / Cian / Glacial)
    primaryColor = '#0284c7';
    secondaryColor = '#38bdf8';
    accentColor = '#e0f2fe';
    glowColor = 'rgba(56, 189, 248, 0.9)';
    flameTitle = `Llama Congelada (Protector de Racha Activo)`;
    sparkCount = 4;
  } else if (isSuperStreak && days > 0) {
    // VARIANTES DE SÚPER RACHA (Gama Morada / Violeta / Amatista / Cósmica)
    switch (tier) {
      case 'tier_100':
        primaryColor = '#9333ea';
        secondaryColor = '#f43f5e';
        accentColor = '#ffffff';
        glowColor = 'rgba(147, 51, 234, 0.95)';
        flameTitle = 'Deidad Cósmica Suprema (100+ días)';
        sparkCount = 6;
        break;
      case 'tier_50':
        primaryColor = '#7e22ce';
        secondaryColor = '#ec4899';
        accentColor = '#fdf2f8';
        glowColor = 'rgba(126, 34, 206, 0.85)';
        flameTitle = 'Singularidad Astral (50+ días)';
        sparkCount = 5;
        break;
      case 'tier_30':
        primaryColor = '#6b21a8';
        secondaryColor = '#f472b6';
        accentColor = '#38bdf8';
        glowColor = 'rgba(107, 33, 168, 0.8)';
        flameTitle = 'Fénix Dimensional (30+ días)';
        sparkCount = 5;
        break;
      case 'tier_20':
        primaryColor = '#7c3aed';
        secondaryColor = '#fb7185';
        accentColor = '#e879f9';
        glowColor = 'rgba(124, 58, 237, 0.75)';
        flameTitle = 'Llama Galáctica (20+ días)';
        sparkCount = 4;
        break;
      case 'tier_15':
        primaryColor = '#8b5cf6';
        secondaryColor = '#f43f5e';
        accentColor = '#f0abfc';
        glowColor = 'rgba(139, 92, 246, 0.72)';
        flameTitle = 'Súper Infierno Amatista (15+ días)';
        sparkCount = 4;
        break;
      case 'tier_10':
        primaryColor = '#9333ea';
        secondaryColor = '#e879f9';
        accentColor = '#ffffff';
        glowColor = 'rgba(147, 51, 234, 0.68)';
        flameTitle = 'Plasma Cósmico (10+ días)';
        sparkCount = 3;
        break;
      case 'tier_7':
        primaryColor = '#a855f7';
        secondaryColor = '#ec4899';
        accentColor = '#ffffff';
        glowColor = 'rgba(168, 85, 247, 0.62)';
        flameTitle = 'Resplandor Místico (7+ días)';
        sparkCount = 3;
        break;
      case 'tier_5':
        primaryColor = '#a855f7';
        secondaryColor = '#e879f9';
        accentColor = '#ffffff';
        glowColor = 'rgba(168, 85, 247, 0.58)';
        flameTitle = 'Llama Astral (5+ días)';
        sparkCount = 2;
        break;
      case 'tier_3':
        primaryColor = '#8b5cf6';
        secondaryColor = '#c084fc';
        accentColor = '#ffffff';
        glowColor = 'rgba(139, 92, 246, 0.52)';
        flameTitle = 'Fuego Púrpura (3+ días)';
        sparkCount = 2;
        break;
      case 'tier_2':
        primaryColor = '#a855f7';
        secondaryColor = '#d8b4fe';
        accentColor = '#ffffff';
        glowColor = 'rgba(168, 85, 247, 0.46)';
        flameTitle = 'Chispa Amatista (2 días)';
        sparkCount = 1;
        break;
      case 'tier_1':
      default:
        primaryColor = '#c084fc';
        secondaryColor = '#e9d5ff';
        accentColor = '#ffffff';
        glowColor = 'rgba(192, 132, 252, 0.42)';
        flameTitle = 'Chispa Violeta (1 día)';
        sparkCount = 1;
        break;
    }
  } else if (days > 0) {
    // VARIANTES DE RACHA ESTÁNDAR (Gama Cálida: Oro / Ámbar / Naranja / Rojo / Solar)
    switch (tier) {
      case 'tier_100':
        primaryColor = '#b91c1c';
        secondaryColor = '#f59e0b';
        accentColor = '#ffffff';
        glowColor = 'rgba(220, 38, 38, 0.95)';
        flameTitle = 'Sol Eterno Dorado (100+ días)';
        sparkCount = 6;
        break;
      case 'tier_50':
        primaryColor = '#dc2626';
        secondaryColor = '#f59e0b';
        accentColor = '#fef08a';
        glowColor = 'rgba(220, 38, 38, 0.85)';
        flameTitle = 'Supernova Solar (50+ días)';
        sparkCount = 5;
        break;
      case 'tier_30':
        primaryColor = '#e11d48';
        secondaryColor = '#fbbf24';
        accentColor = '#fff';
        glowColor = 'rgba(225, 29, 72, 0.8)';
        flameTitle = 'Llama de Fénix (30+ días)';
        sparkCount = 5;
        break;
      case 'tier_20':
        primaryColor = '#dc2626';
        secondaryColor = '#f97316';
        accentColor = '#fef08a';
        glowColor = 'rgba(220, 38, 38, 0.75)';
        flameTitle = 'Fuego Volcánico (20+ días)';
        sparkCount = 4;
        break;
      case 'tier_15':
        primaryColor = '#dc2626';
        secondaryColor = '#fbbf24';
        accentColor = '#fff';
        glowColor = 'rgba(239, 68, 68, 0.72)';
        flameTitle = 'Infierno Solar (15+ días)';
        sparkCount = 4;
        break;
      case 'tier_10':
        primaryColor = '#ef4444';
        secondaryColor = '#f97316';
        accentColor = '#fff';
        glowColor = 'rgba(239, 68, 68, 0.68)';
        flameTitle = 'Llamarada Solar (10+ días)';
        sparkCount = 3;
        break;
      case 'tier_7':
        primaryColor = '#ea580c';
        secondaryColor = '#ef4444';
        accentColor = '#fff';
        glowColor = 'rgba(234, 88, 12, 0.62)';
        flameTitle = 'Fuego Radiante (7+ días)';
        sparkCount = 3;
        break;
      case 'tier_5':
        primaryColor = '#ea580c';
        secondaryColor = '#f97316';
        accentColor = '#fef08a';
        glowColor = 'rgba(234, 88, 12, 0.58)';
        flameTitle = 'Llama Ardiente (5+ días)';
        sparkCount = 2;
        break;
      case 'tier_3':
        primaryColor = '#f59e0b';
        secondaryColor = '#ea580c';
        accentColor = '#fff';
        glowColor = 'rgba(245, 158, 11, 0.52)';
        flameTitle = 'Chispa Creciente (3+ días)';
        sparkCount = 2;
        break;
      case 'tier_2':
        primaryColor = '#f59e0b';
        secondaryColor = '#f97316';
        accentColor = '#fff';
        glowColor = 'rgba(245, 158, 11, 0.46)';
        flameTitle = 'Chispa Naciente (2 días)';
        sparkCount = 1;
        break;
      case 'tier_1':
      default:
        primaryColor = '#fbbf24';
        secondaryColor = '#f59e0b';
        accentColor = '#fff';
        glowColor = 'rgba(251, 191, 36, 0.42)';
        flameTitle = 'Chispa Cálida (1 día)';
        sparkCount = 1;
        break;
    }
  }

  const gradId = `flameGrad-${isSuperStreak ? 'super' : 'warm'}-${tier}`;
  const coreGradId = `coreGrad-${isSuperStreak ? 'super' : 'warm'}-${tier}`;

  return (
    <div
      className={`streak-flame-wrapper ${tier} ${isSuperStreak ? 'super-streak' : ''}`}
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
      }}
      title={`${flameTitle} (${days} días)`}
    >
      {/* Halo de neón pulsante por detrás */}
      <div
        className="streak-flame-halo"
        style={{
          position: 'absolute',
          inset: days >= 15 ? -8 : -4,
          borderRadius: '50%',
          background: glowColor,
          filter: days >= 20 ? 'blur(16px)' : 'blur(12px)',
          opacity: days > 0 ? 0.9 : 0.15,
          animation: days > 0 ? 'flameHaloPulse 2s ease-in-out infinite' : 'none',
          pointerEvents: 'none',
        }}
      />

      {/* SVG animado con capas de fuego */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: days > 0 ? `drop-shadow(0 0 10px ${glowColor})` : 'none',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="24" y1="44" x2="24" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={secondaryColor} />
            <stop offset="55%" stopColor={primaryColor} />
            <stop offset="100%" stopColor={accentColor} stopOpacity={days > 0 ? 0.95 : 0.3} />
          </linearGradient>

          <linearGradient id={coreGradId} x1="24" y1="40" x2="24" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor={secondaryColor} />
            <stop offset="100%" stopColor={primaryColor} />
          </linearGradient>
        </defs>

        {/* Llama exterior animada */}
        <path
          className="flame-outer"
          d="M24 4C24 4 29 11 29 17C29 19.5 27.5 21 26 23C32 23 38 28 38 35C38 41.5 31.5 44 24 44C16.5 44 10 41.5 10 35C10 27 18 20 20 16C21.5 13 24 4 24 4Z"
          fill={`url(#${gradId})`}
          style={{
            transformOrigin: '24px 44px',
            animation: days > 0 ? 'flameFlickerOuter 1.4s ease-in-out infinite alternate' : 'none',
          }}
        />

        {/* Núcleo de calor interno */}
        {days > 0 && (
          <path
            className="flame-core"
            d="M24 20C24 20 27 25 27 29C27 31 26 32 25 33C28 33 30 36 30 39C30 42 27 43 24 43C21 43 18 42 18 39C18 34 22 30 22 28C23 26 24 20 24 20Z"
            fill={`url(#${coreGradId})`}
            opacity="0.9"
            style={{
              transformOrigin: '24px 43px',
              animation: 'flameFlickerCore 0.9s ease-in-out infinite alternate',
            }}
          />
        )}

        {/* Chispas flotantes escalonadas según milestone tier */}
        {sparkCount >= 1 && (
          <circle cx="16" cy="22" r="1.5" fill="#fff" className="spark spark-1" />
        )}
        {sparkCount >= 2 && (
          <circle
            cx="32"
            cy="18"
            r="1.4"
            fill={isSuperStreak ? '#f0abfc' : '#fef08a'}
            className="spark spark-2"
          />
        )}
        {sparkCount >= 3 && (
          <circle cx="21" cy="10" r="1.3" fill="#fff" className="spark spark-3" />
        )}
        {sparkCount >= 4 && (
          <circle
            cx="28"
            cy="12"
            r="1.2"
            fill={isSuperStreak ? '#e879f9' : '#fb923c'}
            className="spark spark-4"
          />
        )}
        {sparkCount >= 5 && (
          <circle cx="14" cy="30" r="1.1" fill={accentColor} className="spark spark-1" />
        )}
        {sparkCount >= 6 && (
          <circle cx="34" cy="28" r="1.3" fill="#fff" className="spark spark-2" />
        )}
        {isFrozen && (
          // Copo vectorial (antes era un emoji ❄️ que cambiaba según el sistema operativo)
          <g
            transform="translate(32 39)"
            stroke="#e0f2fe"
            strokeWidth="1.3"
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 3px #38bdf8)' }}
          >
            <line x1="0" y1="-5" x2="0" y2="5" />
            <line x1="-4.3" y1="-2.5" x2="4.3" y2="2.5" />
            <line x1="-4.3" y1="2.5" x2="4.3" y2="-2.5" />
            <circle r="1.1" fill="#38bdf8" stroke="none" />
          </g>
        )}
      </svg>
    </div>
  );
};
