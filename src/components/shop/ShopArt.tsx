import React from 'react';

/**
 * Ilustraciones de la tienda de recompensas (formas planas con labio oscuro, como el regalo).
 */

/** Carpa a rayas con festón: el borde ondulado se balancea suavemente */
export const ShopAwning: React.FC = () => (
  <div className="shop-awning" aria-hidden="true">
    <div className="shop-awning-rod" />
    <div className="shop-awning-stripes" />
    <div className="shop-awning-flap">
      <div className="shop-awning-lip" />
      <div className="shop-awning-scallops" />
    </div>
  </div>
);

/** Balda del fondo con un regalo, un bote de monedas y una caja sorpresa */
export const ShopBackShelf: React.FC = () => (
  <svg className="shop-back-shelf" viewBox="0 0 280 112" aria-hidden="true" focusable="false">
    {/* Regalo violeta con lazo ámbar */}
    <g className="shop-art-gift">
      <rect x={14} y={52} width={62} height={44} rx={8} fill="#6d28d9" />
      <rect x={14} y={52} width={62} height={38} rx={8} fill="#8b5cf6" />
      <rect x={39} y={52} width={12} height={44} fill="#d97706" />
      <rect x={39} y={52} width={12} height={38} fill="#fbbf24" />
      <rect x={10} y={42} width={70} height={16} rx={6} fill="#7c3aed" />
      <rect x={10} y={42} width={70} height={12} rx={6} fill="#a78bfa" />
      <rect x={39} y={42} width={12} height={16} fill="#fbbf24" />
      <path d="M45 42 C36 26 22 26 25 36 C27 42 38 43 45 42 Z M45 42 C54 26 68 26 65 36 C63 42 52 43 45 42 Z" fill="#fbbf24" />
      <rect x={19} y={60} width={6} height={20} rx={3} fill="#fff" opacity={0.3} />
    </g>

    {/* Bote de monedas */}
    <g className="shop-art-jar">
      <rect x={104} y={30} width={50} height={10} rx={4} fill="#94a3b8" />
      <path d="M106 40 H152 V88 Q152 96 144 96 H114 Q106 96 106 88 Z" className="art-glass" fill="rgba(255,255,255,0.14)" />
      {[
        [116, 86], [130, 88], [144, 86], [122, 77], [137, 78], [128, 68], [115, 66], [143, 69],
      ].map(([x, y], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y + 2} rx={8} ry={4.5} fill="#d97706" />
          <ellipse cx={x} cy={y} rx={8} ry={4.5} fill="#fbbf24" />
        </g>
      ))}
      <rect x={110} y={44} width={5} height={30} rx={2.5} fill="#fff" opacity={0.35} />
      <g className="shop-art-sparkle">
        <path d="M160 34 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 Z" fill="#fde68a" />
      </g>
    </g>

    {/* Caja sorpresa */}
    <g className="shop-art-mystery">
      <rect x={186} y={46} width={50} height={50} rx={9} fill="#14b8a6" />
      <rect x={186} y={46} width={50} height={44} rx={9} fill="#14b8a6" />
      <text x={211} y={80} textAnchor="middle" fontSize={30} fontWeight={900} fill="#fff" fontFamily="Inter, system-ui, sans-serif">
        ?
      </text>
      <rect x={191} y={52} width={6} height={16} rx={3} fill="#fff" opacity={0.3} />
    </g>
    <g>
      <rect x={244} y={70} width={26} height={26} rx={6} fill="#be185d" />
      <rect x={244} y={70} width={26} height={22} rx={6} fill="#f472b6" />
      <rect x={254} y={70} width={6} height={26} fill="#fbbf24" />
    </g>

    {/* Balda */}
    <rect x={0} y={96} width={280} height={14} rx={4} fill="var(--wood-dark, #5b3a29)" />
    <rect x={0} y={96} width={280} height={9} rx={4} fill="#8b5a3c" />
  </svg>
);

/** Caja registradora sobre el mostrador */
export const CashRegister: React.FC = () => (
  <svg className="shop-register" viewBox="0 0 90 70" aria-hidden="true" focusable="false">
    <rect x={20} y={2} width={46} height={18} rx={5} fill="#0f172a" />
    <rect x={24} y={6} width={38} height={10} rx={3} fill="#4ade80" opacity={0.9} />
    <rect x={38} y={20} width={10} height={8} fill="#475569" />
    <path d="M8 30 Q8 26 12 26 H78 Q82 26 82 30 L86 62 Q86 68 80 68 H10 Q4 68 4 62 Z" fill="#7c3aed" />
    <path d="M8 30 Q8 26 12 26 H78 Q82 26 82 30 L85 58 H5 Z" fill="#8b5cf6" />
    {[0, 1, 2].map((r) =>
      [0, 1, 2, 3].map((c) => <rect key={`${r}-${c}`} x={18 + c * 14} y={32 + r * 8} width={10} height={5} rx={2} fill="#ede9fe" opacity={0.85} />),
    )}
    <rect x={10} y={58} width={70} height={6} rx={2} fill="#5b21b6" />
  </svg>
);
