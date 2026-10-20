import React, { useId } from 'react';

/**
 * Ilustraciones vectoriales del laboratorio (formas planas con labio oscuro, como el resto de personajes).
 */

interface BeakerProps {
  /** Nivel del líquido de 0 a 100 */
  level: number;
  /** Color del líquido y su sombra */
  color: string;
  shade: string;
  size?: number;
  className?: string;
}

/** Vaso de precipitado graduado: el líquido sube hasta `level` y burbujea */
export const Beaker: React.FC<BeakerProps> = ({ level, color, shade, size = 76, className = '' }) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const pct = Math.max(0, Math.min(100, level));
  const top = 92 - (pct / 100) * 70;
  const clip = `beaker-${uid}`;
  return (
    <svg className={`lab-beaker ${className}`} viewBox="0 0 80 100" width={size} height={(size * 100) / 80} aria-hidden="true" focusable="false">
      <clipPath id={clip}>
        <path d="M21 14 H59 V84 Q59 91 52 91 H28 Q21 91 21 84 Z" />
      </clipPath>
      {/* Cristal */}
      <path d="M12 8 H68 Q70 8 70 10 V12 Q70 14 68 14 H63 V84 Q63 96 51 96 H29 Q17 96 17 84 V14 H12 Q10 14 10 12 V10 Q10 8 12 8 Z" fill="rgba(255,255,255,0.1)" />
      <g clipPath={`url(#${clip})`}>
        <g className="lab-liquid" style={{ transform: `translateY(${top}px)` }}>
          <rect x={10} y={4} width={60} height={100} fill={shade} />
          <rect x={10} y={8} width={60} height={100} fill={color} />
          {/* Superficie con onda */}
          <path className="lab-wave" d="M-20 4 Q-10 0 0 4 T20 4 T40 4 T60 4 T80 4 T100 4 V12 H-20 Z" fill={color} />
          <circle className="lab-bub lb1" cx={30} cy={60} r={2.6} fill="#fff" opacity={0.55} />
          <circle className="lab-bub lb2" cx={44} cy={66} r={1.9} fill="#fff" opacity={0.55} />
          <circle className="lab-bub lb3" cx={52} cy={58} r={1.5} fill="#fff" opacity={0.55} />
        </g>
      </g>
      {/* Graduación y brillo */}
      {[30, 46, 62, 78].map((y) => (
        <rect key={y} x={48} y={y} width={y % 32 === 30 ? 11 : 7} height={2.4} rx={1.2} fill="#fff" opacity={0.45} />
      ))}
      <rect x={24} y={20} width={5} height={50} rx={2.5} fill="#fff" opacity={0.28} />
      <path d="M12 8 H68 Q70 8 70 10 V12 Q70 14 68 14 H63 V84 Q63 96 51 96 H29 Q17 96 17 84 V14 H12 Q10 14 10 12 V10 Q10 8 12 8 Z" fill="none" stroke="rgba(226,232,240,0.55)" strokeWidth={2.6} />
    </svg>
  );
};

/** Estante con matraces, tubos de ensayo y un mechero: fondo de la cabecera del laboratorio */
export const LabShelfArt: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={`lab-shelf-art ${className}`} viewBox="0 0 300 120" aria-hidden="true" focusable="false">
    {/* Balda */}
    <rect x={0} y={96} width={300} height={14} rx={4} fill="#1e3a5f" />
    <rect x={0} y={96} width={300} height={9} rx={4} fill="#2b5280" />
    <rect x={18} y={110} width={10} height={10} fill="#1e3a5f" />
    <rect x={272} y={110} width={10} height={10} fill="#1e3a5f" />

    {/* Erlenmeyer verde con vapor */}
    <g className="lab-art-flask">
      <path d="M40 26 H56 V44 L74 84 Q77 96 66 96 H30 Q19 96 22 84 L40 44 Z" fill="rgba(255,255,255,0.12)" />
      <path d="M27 72 H69 L73 84 Q75 94 66 94 H30 Q21 94 23 84 Z" fill="#22c55e" />
      <path d="M27 72 H69 L70 75 H26 Z" fill="#4ade80" />
      <rect x={37} y={20} width={22} height={8} rx={4} fill="#94a3b8" />
      <circle className="lab-art-vapor v1" cx={48} cy={14} r={5} fill="#fff" opacity={0.25} />
      <circle className="lab-art-vapor v2" cx={54} cy={8} r={4} fill="#fff" opacity={0.2} />
      <path d="M44 48 L32 80" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.35} />
    </g>

    {/* Matraz redondo violeta */}
    <g className="lab-art-round">
      <rect x={104} y={30} width={14} height={30} fill="rgba(255,255,255,0.12)" />
      <circle cx={111} cy={74} r={22} fill="rgba(255,255,255,0.12)" />
      <path d="M90 76 A21 21 0 0 0 132 76 Z" fill="#8b5cf6" />
      <ellipse cx={111} cy={76} rx={21} ry={3} fill="#a78bfa" />
      <rect x={102} y={26} width={18} height={7} rx={3.5} fill="#94a3b8" />
      <circle className="lab-art-bub b1" cx={104} cy={86} r={2.4} fill="#fff" opacity={0.5} />
      <circle className="lab-art-bub b2" cx={116} cy={88} r={1.8} fill="#fff" opacity={0.5} />
    </g>

    {/* Gradilla con tubos de ensayo */}
    <g>
      <rect x={156} y={70} width={84} height={8} rx={3} fill="#475569" />
      <rect x={160} y={88} width={76} height={8} rx={3} fill="#334155" />
      <rect x={160} y={70} width={5} height={26} fill="#334155" />
      <rect x={231} y={70} width={5} height={26} fill="#334155" />
      {[
        { x: 170, c: '#fbbf24', h: 26 },
        { x: 186, c: '#f472b6', h: 18 },
        { x: 202, c: '#2dd4bf', h: 30 },
        { x: 218, c: '#a78bfa', h: 22 },
      ].map((t, i) => (
        <g key={t.x} className={`lab-art-tube t${i}`}>
          <rect x={t.x} y={44} width={11} height={48} rx={5.5} fill="rgba(255,255,255,0.14)" />
          <rect x={t.x} y={92 - t.h} width={11} height={t.h} rx={5.5} fill={t.c} />
          <rect x={t.x + 2.5} y={50} width={2.5} height={18} rx={1.25} fill="#fff" opacity={0.4} />
        </g>
      ))}
    </g>

    {/* Mechero con llama */}
    <g>
      <path d="M262 96 H290 L284 86 H268 Z" fill="#64748b" />
      <rect x={272} y={66} width={8} height={22} rx={2} fill="#94a3b8" />
      <path className="lab-art-flame" d="M276 40 C284 52 286 60 276 66 C266 60 268 52 276 40 Z" fill="#38bdf8" style={{ transformOrigin: '276px 66px' }} />
      <path className="lab-art-flame" d="M276 50 C280 56 281 61 276 64 C271 61 272 56 276 50 Z" fill="#e0f2fe" style={{ transformOrigin: '276px 66px' }} />
    </g>
  </svg>
);

/** Tubo de ensayo horizontal que se llena con el avance del experimento */
export const TubeProgress: React.FC<{ value: number; label: string }> = ({ value, label }) => {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="lab-tube" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={label}>
      <div className="lab-tube-fill" style={{ width: `${Math.max(pct, 6)}%` }}>
        <i />
        <i />
        <i />
      </div>
      {[25, 50, 75].map((m) => (
        <span key={m} className="lab-tube-mark" style={{ left: `${m}%` }} />
      ))}
    </div>
  );
};
