import React from 'react';
import type { CoachGender } from './coachPersona';
import type { CoachExpression, CoachOutfit, HandShape, PropName } from './coachPose';
import type { PonyShape } from './coachRig';

/* El dibujo de Pilo y Pila: ilustración plana, sin contornos, con el origen en el suelo (ver coachRig.ts).
   Las piezas marcadas con data-rig las coloca el motor en cada fotograma. */

const C = {
  skin: '#F5BF97',
  skinShade: '#E6A279',
  skinDeep: '#D88C60',
  eye: '#2B1B3D',
  mouth: '#6E1F31',
  mouthIn: '#7D1F2F',
  tongue: '#E8504F',
  cheek: '#F48C8C',
  hairM: '#33253F',
  hairMLight: '#54445F',
  hairF: '#8C3F22',
  hairFLight: '#B5633B',
  amber: '#FBBF24',
  amberLip: '#E08A0B',
  violet: '#7C3AED',
  violetDark: '#5B21B6',
  violetDeep: '#4C1D95',
  violetLight: '#9F75F5',
  lilac: '#C4B5FD',
  stripe: '#E4DDFF',
  white: '#FFFFFF',
  teal: '#1EB5A6',
  tealLip: '#0F8F84',
  cream: '#F6E9CC',
  creamShade: '#DFC89A',
  coat: '#F5F7FB',
  coatShade: '#D3DAE7',
  brown: '#4A2A2E',
  metal: '#E2E8F0',
  metalShade: '#94A3B8',
  iron: '#8E9AAB',
  ironDark: '#5F6B7C',
  strap: '#20394A',
  glass: '#67E8F9',
  glassRim: '#0E7490',
  flask: '#E0F4FE',
  flaskEdge: '#A9DCF3',
  wood: '#CE9559',
  woodDark: '#9C6A38',
  woodMid: '#B9814A',
  woodText: '#5A3418',
  pink: '#EC4899',
  blue: '#38BDF8',
};

const LIMB = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const PANTS: Record<CoachOutfit, string> = { coach: C.violetDark, shop: C.brown, lab: C.violetDark };
const SLEEVE: Record<CoachOutfit, string> = { coach: C.violetDark, shop: C.cream, lab: C.coat };

export function ponyFor(gender: CoachGender, outfit: CoachOutfit): PonyShape | null {
  if (gender !== 'female') return null;
  return outfit === 'shop' ? { bx: 76, by: -488, tx: 132, ty: -372, w: 20 } : { bx: 42, by: -538, tx: 128, ty: -386, w: 18 };
}

/* ---------------- Piernas y zapatillas ---------------- */

const Shoe: React.FC = () => (
  <g>
    <path d="M-25 -22 C-29 -2 -29 8 -28 16 H52 C62 16 62 2 50 -4 C38 -9 28 -10 17 -23 C4 -32 -15 -32 -25 -22 Z" fill={C.amber} />
    <path d="M30 -8 C46 -8 66 2 60 16 H24 Z" fill={C.white} />
    <path d="M3 -15 L16 -6 M12 -21 L25 -11" stroke={C.white} strokeWidth={5} strokeLinecap="round" />
    <rect x={-32} y={12} width={96} height={16} rx={8} fill={C.white} />
    <rect x={-32} y={22} width={96} height={6} rx={3} fill={C.coatShade} />
  </g>
);

const Leg: React.FC<{ side: 'L' | 'R'; outfit: CoachOutfit }> = ({ side, outfit }) => (
  <g>
    <path data-rig={`leg${side}`} stroke={PANTS[outfit]} strokeWidth={46} {...LIMB} />
    {outfit === 'coach' && <path data-rig={`legStripe${side}`} stroke={C.stripe} strokeWidth={6} fill="none" strokeLinejoin="round" />}
    <g data-rig={`foot${side}`}>
      <Shoe />
    </g>
  </g>
);

/* ---------------- Manos: la muñeca en el origen y los dedos hacia +y ---------------- */

const finger = (x1: number, y1: number, x2: number, y2: number, w = 10) => (
  <g key={`${x1}${y1}`}>
    <path d={`M${x1} ${y1}L${x2} ${y2}`} stroke={C.skinShade} strokeWidth={w + 2.6} strokeLinecap="round" />
    <path d={`M${x1} ${y1}L${x2} ${y2}`} stroke={C.skin} strokeWidth={w} strokeLinecap="round" />
  </g>
);

const Fist: React.FC = () => (
  <g>
    <ellipse cx={0} cy={18} rx={21.5} ry={22.5} fill={C.skinShade} />
    <ellipse cx={0} cy={17} rx={20} ry={21} fill={C.skin} />
    <path d="M-10 30 q4 6 8 1 M-1 32 q4 6 8 0 M8 30 q4 5 7 -2" stroke={C.skinShade} strokeWidth={2.6} strokeLinecap="round" fill="none" />
    {finger(-15, 6, -19, 22, 11)}
  </g>
);

const OpenHand: React.FC = () => (
  <g>
    {finger(-13, 22, -16, 46)}
    {finger(-4, 26, -5.5, 53)}
    {finger(6, 26, 6, 53)}
    {finger(14, 22, 16.5, 46)}
    <ellipse cx={0} cy={15} rx={19} ry={19} fill={C.skin} />
    {finger(-16, 8, -32, 24, 10.5)}
    <path d="M-9 18 q9 6 18 0" stroke={C.skinShade} strokeWidth={2.4} strokeLinecap="round" fill="none" />
  </g>
);

const Pointing: React.FC = () => (
  <g>
    {finger(-9, 24, -10, 60, 11)}
    <ellipse cx={0} cy={18} rx={21.5} ry={22.5} fill={C.skinShade} />
    <ellipse cx={0} cy={17} rx={20} ry={21} fill={C.skin} />
    <path d="M1 32 q4 5 7 0 M9 30 q4 4 6 -2" stroke={C.skinShade} strokeWidth={2.6} strokeLinecap="round" fill="none" />
    {finger(-17, 8, -19, 24, 11)}
  </g>
);

const HAND: Record<HandShape, React.FC> = { fist: Fist, open: OpenHand, point: Pointing };

/* ---------------- Objetos: el origen es el punto de agarre ---------------- */

const Bubbles: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g>
    <circle className="ca-bubble b1" cx={x - 8} cy={y} r={4.5} fill={C.white} opacity={0.75} />
    <circle className="ca-bubble b2" cx={x + 9} cy={y + 4} r={3.4} fill={C.white} opacity={0.75} />
    <circle className="ca-bubble b3" cx={x} cy={y - 2} r={2.8} fill={C.white} opacity={0.75} />
  </g>
);

const Flask: React.FC<{ liquid: string; lip: string }> = ({ liquid, lip }) => (
  <g>
    <path d="M-13 -26 H13 V6 L46 66 Q52 82 36 82 H-36 Q-52 82 -46 66 L-13 6 Z" fill={C.flask} stroke={C.flaskEdge} strokeWidth={3} opacity={0.95} />
    <path d="M-27 40 H27 L46 68 Q51 80 36 80 H-36 Q-51 80 -46 68 Z" fill={liquid} />
    <path d="M-27 40 H27 L30 45 H-30 Z" fill={lip} opacity={0.5} />
    <Bubbles x={0} y={62} />
    <rect x={-17} y={-32} width={34} height={11} rx={5.5} fill={C.coatShade} />
    <path d="M-8 10 L-34 62" stroke={C.white} strokeWidth={4.5} strokeLinecap="round" opacity={0.65} />
  </g>
);

const RoundFlask: React.FC = () => (
  <g>
    <path d="M-12 -32 H12 V6 A40 40 0 1 1 -12 6 Z" fill={C.flask} stroke={C.flaskEdge} strokeWidth={3} />
    <path d="M-38 48 A40 40 0 0 0 38 48 Q0 36 -38 48 Z" fill="#F97316" />
    <Bubbles x={0} y={64} />
    <rect x={-16} y={-36} width={32} height={10} rx={5} fill={C.coatShade} />
    <path d="M-26 28 Q-30 42 -22 52" stroke={C.white} strokeWidth={4.5} strokeLinecap="round" fill="none" opacity={0.7} />
  </g>
);

const Coin: React.FC = () => (
  // Asoma por encima del puño, sujeta entre los dedos
  <g transform="translate(0 -30)">
    <circle r={19} cy={1.5} fill={C.amberLip} />
    <circle r={18} fill={C.amber} />
    <circle r={13} fill="none" stroke={C.amberLip} strokeWidth={2.2} />
    <path d="M2.5 -10 L-6 2 H-1 L-3 10 L6 -2 H1 Z" fill={C.amberLip} />
  </g>
);

const PROP: Record<PropName, () => React.ReactElement> = {
  dumbbell: () => (
    <g>
      <rect x={-50} y={-5} width={100} height={10} rx={5} fill={C.ironDark} />
      {[-1, 1].map((d) => (
        <g key={d}>
          <rect x={d * 46 - 13} y={-27} width={26} height={54} rx={7} fill={C.iron} />
          <rect x={d * 62 - 8} y={-19} width={16} height={38} rx={6} fill={C.ironDark} />
          <rect x={d * 46 - 9} y={-23} width={6} height={24} rx={3} fill={C.white} opacity={0.3} />
        </g>
      ))}
    </g>
  ),
  sign: () => (
    <g>
      <path d="M0 -2 L-46 42 M0 -2 L46 42" stroke={C.woodDark} strokeWidth={4} strokeLinecap="round" />
      <rect x={-68} y={38} width={136} height={66} rx={10} fill={C.woodDark} />
      <rect x={-68} y={36} width={136} height={62} rx={10} fill={C.wood} />
      <text x={0} y={76} textAnchor="middle" fontSize={25} fontWeight={800} letterSpacing={0.5} fill={C.woodText} fontFamily="ui-rounded, 'Segoe UI', system-ui, sans-serif">
        ABIERTO
      </text>
    </g>
  ),
  gift: () => (
    <g>
      <rect x={-54} y={-92} width={108} height={84} rx={7} fill={C.teal} />
      <path d="M-54 -66 q27 -15 54 0 t54 0" stroke={C.pink} strokeWidth={15} fill="none" />
      <path d="M-54 -38 q27 -15 54 0 t54 0" stroke={C.blue} strokeWidth={15} fill="none" />
      <path d="M-54 -16 q27 -9 54 0 t54 0" stroke={C.violet} strokeWidth={10} fill="none" />
      <rect x={-13} y={-92} width={26} height={84} fill={C.amber} />
      <rect x={-62} y={-104} width={124} height={22} rx={6} fill={C.teal} />
      <rect x={-13} y={-104} width={26} height={22} fill={C.amberLip} />
      <path d="M0 -104 C-20 -134 -52 -128 -36 -108 Z M0 -104 C20 -134 52 -128 36 -108 Z" fill={C.amber} stroke={C.amberLip} strokeWidth={4} strokeLinejoin="round" />
    </g>
  ),
  crate: () => (
    <g>
      {/* Paquetes asomando */}
      <rect x={-112} y={-126} width={66} height={72} rx={5} fill={C.wood} />
      <rect x={-104} y={-112} width={50} height={20} rx={4} fill={C.white} />
      <rect x={-62} y={-104} width={54} height={50} rx={5} fill={C.metal} />
      <path d="M-62 -92 H-8" stroke={C.metalShade} strokeWidth={4} />
      <rect x={-30} y={-122} width={48} height={68} rx={5} fill={C.teal} />
      <rect x={-12} y={-122} width={12} height={68} fill={C.amber} />
      <rect x={-6} y={-96} width={56} height={42} rx={5} fill={C.violet} />
      <rect x={16} y={-96} width={11} height={42} fill={C.amber} />
      <path d="M-6 -122 C-18 -142 -36 -136 -24 -124 Z M-6 -122 C6 -142 24 -136 12 -124 Z" fill={C.amber} />
      {/* Caja de madera */}
      <rect x={-150} y={-66} width={196} height={80} rx={4} fill={C.woodDark} />
      <rect x={-150} y={-66} width={196} height={21} rx={3} fill={C.wood} />
      <rect x={-150} y={-37} width={196} height={21} rx={3} fill={C.wood} />
      <rect x={-150} y={-8} width={196} height={22} rx={3} fill={C.wood} />
      <rect x={-150} y={-66} width={17} height={80} rx={3} fill={C.woodMid} />
      <rect x={29} y={-66} width={17} height={80} rx={3} fill={C.woodMid} />
    </g>
  ),
  coin: () => <Coin />,
  receipt: () => (
    <g>
      <path d="M-22 -14 H24 V54 l-7.6 -7 -7.7 7 -7.6 -7 -7.7 7 -7.6 -7 -7.6 7 Z" fill={C.white} />
      <path d="M-13 2 H15 M-13 13 H15 M-13 24 H4" stroke={C.coatShade} strokeWidth={4} strokeLinecap="round" />
    </g>
  ),
  clipboard: () => (
    <g transform="rotate(-24)">
      <rect x={-46} y={-52} width={92} height={120} rx={8} fill={C.woodDark} />
      <rect x={-37} y={-40} width={74} height={100} rx={4} fill={C.white} />
      <path d="M-24 -14 H24 M-24 4 H24 M-24 22 H8" stroke={C.coatShade} strokeWidth={5} strokeLinecap="round" />
      <rect x={-19} y={-60} width={38} height={18} rx={5} fill={C.metalShade} />
    </g>
  ),
  flaskBlue: () => <Flask liquid="#3B82F6" lip="#BFDBFE" />,
  flaskGreen: () => <Flask liquid="#4ADE80" lip="#BBF7D0" />,
  flaskOrange: () => <RoundFlask />,
  tube: () => (
    <g>
      <rect x={-13} y={-58} width={26} height={118} rx={13} fill={C.flask} stroke={C.flaskEdge} strokeWidth={3} />
      <path d="M-13 -6 H13 V47 A13 13 0 0 1 -13 47 Z" fill={C.violetLight} />
      <rect x={-17} y={-64} width={34} height={11} rx={5.5} fill={C.coatShade} />
    </g>
  ),
};

/** Objetos que puede llevar cada mano según la ropa */
const PROPS: Record<CoachOutfit, { L: PropName[]; R: PropName[] }> = {
  coach: { L: ['dumbbell'], R: ['dumbbell'] },
  shop: { L: ['gift', 'coin'], R: ['sign', 'crate', 'receipt'] },
  lab: { L: ['clipboard', 'flaskGreen', 'flaskOrange'], R: ['flaskBlue', 'tube'] },
};

/* ---------------- Brazos ---------------- */

const Arm: React.FC<{ side: 'L' | 'R'; outfit: CoachOutfit }> = ({ side, outfit }) => (
  <g data-rig={`arm${side}`}>
    {outfit === 'lab' && <path data-rig={`edge${side}`} stroke={C.coatShade} strokeWidth={44} {...LIMB} />}
    <path data-rig={`sleeve${side}`} stroke={SLEEVE[outfit]} strokeWidth={38} {...LIMB} />
    {outfit === 'coach' && <path data-rig={`armStripe${side}`} stroke={C.stripe} strokeWidth={6} fill="none" strokeLinejoin="round" />}
    {outfit === 'shop' && <path data-rig={`fore${side}`} stroke={C.skin} strokeWidth={31} {...LIMB} />}
    {outfit === 'shop' && (
      // Manga remangada
      <g data-rig={`cuff${side}`}>
        <rect x={-21.5} y={-16} width={43} height={25} rx={10} fill={C.creamShade} />
        <rect x={-21.5} y={-16} width={43} height={9} rx={4.5} fill={C.cream} opacity={0.75} />
      </g>
    )}
    <g data-rig={`prop${side}`}>
      {PROPS[outfit][side].map((p) => (
        <g key={p} data-rig={`${p}${side}`} display="none">
          {PROP[p]()}
        </g>
      ))}
    </g>
    <g data-rig={`wrist${side}`}>
      {outfit !== 'shop' && <rect x={-20} y={-13} width={40} height={15} rx={7} fill={outfit === 'coach' ? C.violetDeep : C.coatShade} />}
      <g data-rig={`hand${side}`}>
        {(Object.keys(HAND) as HandShape[]).map((h) => {
          const Shape = HAND[h];
          return (
            <g key={h} data-rig={`${h}${side}`} display="none">
              <Shape />
            </g>
          );
        })}
      </g>
    </g>
  </g>
);

/* ---------------- Tronco según la ropa ---------------- */

const CHEST = 'M-32 -336 C-48 -333 -66 -326 -68 -306 L-63 -216 Q-62 -205 -52 -205 H52 Q62 -205 63 -216 L68 -306 C66 -326 48 -333 32 -336 Q0 -326 -32 -336 Z';

/** Silbato con su cordón: el motor lo lleva del cuello a la mano y a la boca */
const Whistle: React.FC = () => (
  <g>
    <path data-rig="cord" stroke={C.amber} strokeWidth={3.6} fill="none" strokeLinecap="round" />
    <g data-rig="whistle">
      <rect x={-18} y={-9} width={34} height={21} rx={10.5} fill={C.metalShade} />
      <rect x={-18} y={-11} width={34} height={20} rx={10} fill={C.metal} />
      <rect x={10} y={-12} width={15} height={11} rx={3} fill={C.metal} />
      <circle cx={-5} cy={-1} r={3.8} fill={C.metalShade} />
    </g>
  </g>
);

const Torso: React.FC<{ outfit: CoachOutfit }> = ({ outfit }) => {
  const pelvis = <path d="M-56 -226 H56 L58 -176 H-58 Z" fill={PANTS[outfit]} />;
  if (outfit === 'shop')
    return (
      <g>
        {pelvis}
        <path d={CHEST} fill={C.cream} />
        <g data-rig="chest">
          {/* Cuello y tirantes del delantal */}
          <path d="M-32 -338 L0 -316 L-14 -304 L-40 -328 Z" fill={C.white} />
          <path d="M32 -338 L0 -316 L14 -304 L40 -328 Z" fill={C.white} />
          <path d="M-30 -318 L-36 -334 M30 -318 L36 -334" stroke={C.teal} strokeWidth={10} strokeLinecap="round" />
        </g>
        <g data-rig="tail">
          <path d="M-32 -318 H32 Q38 -318 39 -312 L47 -264 C60 -252 62 -240 63 -226 L68 -146 Q69 -135 58 -135 H-58 Q-69 -135 -68 -146 L-63 -226 C-62 -240 -60 -252 -47 -264 L-39 -312 Q-38 -318 -32 -318 Z" fill={C.teal} />
          <path d="M-60 -226 L-65 -148" stroke={C.white} strokeWidth={8} strokeLinecap="round" opacity={0.18} />
        </g>
        <g data-rig="chest2">
          <rect x={-16} y={-300} width={32} height={26} rx={7} fill={C.tealLip} />
          <rect x={-9} y={-293} width={18} height={14} rx={3} fill={C.amber} />
          <rect x={-2} y={-293} width={4} height={14} fill={C.amberLip} />
          <path d="M0 -293 C-6 -301 -12 -297 -7 -293 Z M0 -293 C6 -301 12 -297 7 -293 Z" fill={C.amberLip} />
          <path d="M-58 -226 Q0 -216 58 -226" stroke={C.tealLip} strokeWidth={5} fill="none" strokeLinecap="round" />
        </g>
      </g>
    );
  if (outfit === 'lab')
    return (
      <g>
        {pelvis}
        <path d="M-32 -336 H32 L34 -226 H-34 Z" fill={C.violet} />
        <g data-rig="tail">
          <path d="M-70 -236 L-76 -146 Q-77 -130 -62 -130 H-6 L0 -232 L6 -130 H62 Q77 -130 76 -146 L70 -236 Z" fill={C.coat} />
          <path d="M-70 -236 L-76 -146 Q-77 -130 -62 -130 H-52 L-58 -236 Z" fill={C.coatShade} opacity={0.5} />
          <path d="M0 -232 L-6 -130 H6 Z" fill={C.violetDark} />
        </g>
        <path d="M-32 -336 C-50 -333 -68 -326 -70 -306 L-71 -228 H-14 L-20 -336 Z" fill={C.coat} />
        <path d="M32 -336 C50 -333 68 -326 70 -306 L71 -228 H14 L20 -336 Z" fill={C.coat} />
        <g data-rig="chest">
          <path d="M-34 -338 L-13 -268 L-14 -238 L-44 -302 L-30 -314 Z" fill={C.coatShade} />
          <path d="M34 -338 L13 -268 L14 -238 L44 -302 L30 -314 Z" fill={C.coatShade} />
          {/* Bolsillo con rotuladores */}
          <rect x={28} y={-284} width={6} height={22} rx={3} fill={C.violetLight} />
          <rect x={37} y={-280} width={6} height={18} rx={3} fill={C.amber} />
          <rect x={46} y={-282} width={6} height={20} rx={3} fill={C.teal} />
          <rect x={23} y={-266} width={34} height={9} rx={3} fill={C.coatShade} />
        </g>
      </g>
    );
  return (
    <g>
      {pelvis}
      <path d={CHEST} fill={C.violet} />
      <path d="M-63 -226 L-62.6 -216 Q-62 -205 -52 -205 H52 Q62 -205 62.6 -216 L63 -226 Z" fill={C.violetDeep} />
      <g data-rig="chest">
        <path d="M-34 -338 L0 -310 L0 -294 L-44 -326 Z" fill={C.violetLight} />
        <path d="M34 -338 L0 -310 L0 -294 L44 -326 Z" fill={C.violetLight} />
        <rect x={-1.8} y={-300} width={3.6} height={95} fill={C.stripe} />
        <path d="M-46 -262 L-28 -252 M46 -262 L28 -252" stroke={C.violetDark} strokeWidth={5} strokeLinecap="round" />
      </g>
    </g>
  );
};

/* ---------------- Cabeza ---------------- */

const HEAD = 'M-89 -440 C-89 -498 -52 -522 0 -522 C52 -522 89 -498 89 -440 C89 -396 62 -350 0 -350 C-62 -350 -89 -396 -89 -440 Z';

/** Banda elástica que abraza la cabeza */
const BAND = 'M-90 -482 C-58 -505 58 -505 90 -482 L90 -446 C58 -473 -58 -473 -90 -446 Z';

const Bolt: React.FC<{ x?: number; y?: number; s?: number }> = ({ x = 0, y = 0, s = 1 }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M3 -13 L-8 2 H-1 L-4 13 L8 -3 H1 Z" fill={C.violet} />
);

const Hair: React.FC<{ gender: CoachGender; outfit: CoachOutfit }> = ({ gender, outfit }) => {
  const female = gender === 'female';
  const hair = female ? C.hairF : C.hairM;
  const light = female ? C.hairFLight : C.hairMLight;
  const locks = female ? (
    <g>
      <path d="M-90 -470 C-104 -432 -102 -396 -86 -372 C-80 -396 -74 -432 -70 -468 Z" fill={hair} />
      <path d="M90 -470 C104 -432 102 -396 86 -372 C80 -396 74 -432 70 -468 Z" fill={hair} />
    </g>
  ) : (
    <g>
      <path d="M-92 -462 L-90 -418 Q-82 -414 -78 -420 L-72 -466 Z" fill={hair} />
      <path d="M92 -462 L90 -418 Q82 -414 78 -420 L72 -466 Z" fill={hair} />
    </g>
  );

  if (outfit === 'shop')
    return (
      <g>
        {locks}
        {/* Gorra de la tienda */}
        <path d="M-90 -474 C-92 -530 -50 -558 0 -558 C50 -558 92 -530 90 -474 Z" fill={C.amber} />
        <path d="M-66 -520 C-56 -538 -38 -546 -20 -549" stroke={C.white} strokeWidth={7} strokeLinecap="round" fill="none" opacity={0.5} />
        <circle cy={-558} r={8} fill={C.amberLip} />
        <Bolt y={-516} s={1.5} />
        <path d="M-116 -468 C-82 -500 82 -500 116 -468 C120 -456 104 -452 92 -458 C44 -480 -44 -480 -92 -458 C-104 -452 -120 -456 -116 -468 Z" fill={C.amberLip} />
      </g>
    );

  const cap = <path d="M-94 -470 C-102 -518 -56 -550 0 -550 C56 -550 102 -518 94 -470 Q0 -504 -94 -470 Z" fill={hair} />;
  const crown = female ? (
    <path d="M-40 -530 C-20 -542 20 -542 52 -522" stroke={light} strokeWidth={6} strokeLinecap="round" fill="none" />
  ) : outfit === 'lab' ? (
    // Pelo revuelto del laboratorio
    <g data-rig="tuft">
      <path
        d="M-90 -492 C-104 -506 -108 -522 -96 -532 C-90 -526 -84 -524 -78 -526 C-84 -546 -72 -562 -54 -564 C-54 -554 -48 -548 -38 -548 C-40 -566 -24 -580 -6 -578 C-10 -568 -6 -560 2 -556 C8 -574 30 -584 44 -574 C34 -568 34 -560 40 -554 C54 -564 78 -560 84 -544 C74 -546 68 -542 66 -536 C82 -534 100 -526 100 -508 C96 -512 92 -512 88 -506 L84 -490 Z"
        fill={hair}
      />
    </g>
  ) : (
    // Tupé con la punta hacia la derecha
    <g data-rig="tuft">
      <path
        d="M-62 -530 C-54 -560 -18 -576 12 -568 C30 -588 66 -592 88 -572 C74 -574 62 -568 56 -558 C74 -552 86 -538 86 -520 C62 -540 30 -548 0 -546 C-22 -546 -44 -540 -62 -530 Z"
        fill={hair}
      />
      <path d="M2 -556 C18 -568 40 -576 58 -574" stroke={light} strokeWidth={5.5} strokeLinecap="round" fill="none" />
    </g>
  );

  return (
    <g>
      {locks}
      {cap}
      {crown}
      {outfit === 'lab' ? (
        <g>
          <path d="M-90 -484 C-58 -507 58 -507 90 -484 L90 -456 C58 -481 -58 -481 -90 -456 Z" fill={C.strap} />
          {[-36, 36].map((x) => (
            <g key={x}>
              <circle cx={x} cy={-494} r={27} fill={C.glassRim} />
              <circle cx={x} cy={-494} r={20} fill={C.glass} />
              <path d={`M${x - 11} -500 q5 -8 13 -7`} stroke={C.white} strokeWidth={4.5} strokeLinecap="round" fill="none" opacity={0.85} />
            </g>
          ))}
          <rect x={-12} y={-500} width={24} height={11} rx={5} fill={C.glassRim} />
        </g>
      ) : (
        <g>
          <path d={BAND} fill={C.amber} />
          <path d="M-90 -456 C-58 -483 58 -483 90 -456 L90 -446 C58 -473 -58 -473 -90 -446 Z" fill={C.amberLip} />
          <Bolt y={-484} s={1.05} />
        </g>
      )}
    </g>
  );
};

/* ---------------- Cara ---------------- */

const EYE = { x: 37, y: -424 };
const EYE_R = 22;

type BrowSet = { l: [number, number]; r: [number, number] };
export type BrowKey = CoachExpression | 'talk' | 'talkUp' | 'talkFocus';
const BROWS: Record<BrowKey, BrowSet> = {
  // [desplazamiento vertical, giro en grados]
  neutral: { l: [0, 5], r: [0, -5] },
  happy: { l: [-3, -3], r: [-3, 3] },
  grin: { l: [-5, -5], r: [-5, 5] },
  excited: { l: [-7, 7], r: [-7, -7] },
  thinking: { l: [-8, -11], r: [2, -8] },
  surprised: { l: [-10, -4], r: [-10, 4] },
  wink: { l: [-5, -3], r: [2, 8] },
  smirk: { l: [2, 7], r: [-8, -9] },
  curious: { l: [-9, -9], r: [1, 3] },
  proud: { l: [-3, -7], r: [-3, 7] },
  determined: { l: [3, 15], r: [3, -15] },
  whistle: { l: [4, 17], r: [4, -17] },
  talk: { l: [-2, 3], r: [-2, -3] },
  talkUp: { l: [-7, -4], r: [-7, 4] },
  talkFocus: { l: [1, 10], r: [1, -10] },
};

export const TALK_TOP = -384;

/** Boca para hablar: `o` de 0 (cerrada, una línea) a 1 (muy abierta) */
export function talkMouthPath(o: number) {
  const w = 42 - 8 * o;
  const h = 3 + 25 * o;
  const l = -w / 2;
  const r = w / 2;
  return `M${l} ${TALK_TOP} Q0 ${TALK_TOP - 1.5 * o} ${r} ${TALK_TOP} Q${r + 2} ${TALK_TOP + h} 0 ${TALK_TOP + h} Q${l - 2} ${TALK_TOP + h} ${l} ${TALK_TOP} Z`;
}

interface FaceProps {
  gender: CoachGender;
  face: CoachExpression;
  browKey: BrowKey;
  talking: boolean;
  uid: string;
  talkMouth: React.RefObject<SVGPathElement | null>;
  talkTongue: React.RefObject<SVGEllipseElement | null>;
  talkTeeth: React.RefObject<SVGRectElement | null>;
}

const Face: React.FC<FaceProps> = ({ gender, face, browKey, talking, uid, talkMouth, talkTongue, talkTeeth }) => {
  const female = gender === 'female';
  const hair = female ? C.hairF : C.hairM;
  const brows = BROWS[browKey];
  const squint = face === 'proud';
  const blow = face === 'whistle';

  const brow = (cx: number, [dy, rot]: [number, number]) => (
    <path
      className="ca-brow"
      d={`M${cx - 19} -455 Q${cx} -466 ${cx + 19} -455`}
      stroke={hair}
      strokeWidth={female ? 6 : 7.5}
      strokeLinecap="round"
      fill="none"
      style={{ transform: `translateY(${dy}px) rotate(${rot}deg)`, transformOrigin: `${cx}px -459px` }}
    />
  );

  const eye = (side: 'L' | 'R', closed: boolean) => {
    const out = side === 'L' ? -1 : 1;
    const x = EYE.x * out;
    const y = EYE.y;
    const clipId = `ca-eye${side}-${uid}`;
    return (
      <g>
        {closed && <path d={`M${x - 20} ${y + 5} Q${x} ${y - 16} ${x + 20} ${y + 5}`} stroke={C.eye} strokeWidth={6.5} strokeLinecap="round" fill="none" />}
        {/* El ojo sigue montado aunque esté cerrado: el motor conserva su referencia a la pupila */}
        <g className="ca-eye" display={closed ? 'none' : 'inline'}>
          <clipPath id={clipId}>
            <ellipse cx={x} cy={y} rx={EYE_R} ry={EYE_R + 1.5} />
          </clipPath>
          <ellipse cx={x} cy={y} rx={EYE_R} ry={EYE_R + 1.5} fill={C.white} />
          <g clipPath={`url(#${clipId})`}>
            <g data-rig={`pupil${side}`}>
              <circle cx={x} cy={y + 1} r={face === 'surprised' ? 9.5 : 13} fill={C.eye} />
              <circle cx={x + 4.5} cy={y - 3.5} r={4.2} fill={C.white} />
            </g>
            {/* Párpado: entrecierra los ojos en las caras decididas o pícaras */}
            {(face === 'determined' || face === 'smirk' || blow) && <rect x={x - 26} y={y - 28} width={52} height={face === 'smirk' ? 14 : 11} fill={C.skin} />}
          </g>
          {female && (
            // Tres pestañas en el lado de fuera
            <path
              d={`M${x + 21 * out} ${y - 3} l${9 * out} -1 M${x + 19 * out} ${y - 11} l${9 * out} -4 M${x + 13 * out} ${y - 18} l${7 * out} -7`}
              stroke={C.eye}
              strokeWidth={3.4}
              strokeLinecap="round"
            />
          )}
        </g>
      </g>
    );
  };

  const openMouth = (big: boolean) => {
    const d = big ? 'M-33 -389 Q0 -383 33 -389 Q30 -354 0 -354 Q-30 -354 -33 -389 Z' : 'M-27 -387 Q0 -382 27 -387 Q24 -360 0 -360 Q-24 -360 -27 -387 Z';
    const clipId = `ca-mouth-${uid}`;
    return (
      <g>
        <clipPath id={clipId}>
          <path d={d} />
        </clipPath>
        <path d={d} fill={C.mouthIn} />
        <g clipPath={`url(#${clipId})`}>
          <rect x={-36} y={-392} width={72} height={big ? 13 : 11} rx={3} fill={C.white} />
          <ellipse cx={0} cy={big ? -353 : -358} rx={big ? 20 : 15} ry={big ? 13 : 9.5} fill={C.tongue} />
        </g>
      </g>
    );
  };

  const line = (d: string, w = 5.6) => <path d={d} stroke={C.mouth} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />;

  const mouth = () => {
    if (talking)
      return (
        <g>
          <path ref={talkMouth} d={talkMouthPath(0)} fill={C.mouthIn} />
          <rect ref={talkTeeth} x={-15} y={TALK_TOP} width={30} height={0} rx={2.5} fill={C.white} style={{ opacity: 0 }} />
          <ellipse ref={talkTongue} cx={0} cy={TALK_TOP + 1} rx={10} ry={0} fill={C.tongue} style={{ opacity: 0 }} />
        </g>
      );
    switch (face) {
      case 'happy':
      case 'wink':
      case 'proud':
        return <path d="M-29 -386 Q0 -357 29 -386 Q0 -373 -29 -386 Z" fill={C.mouth} stroke={C.mouth} strokeWidth={4} strokeLinejoin="round" />;
      case 'grin':
        return openMouth(false);
      case 'excited':
        return openMouth(true);
      case 'surprised':
        return (
          <g>
            <ellipse cx={0} cy={-371} rx={13} ry={16} fill={C.mouthIn} />
            <ellipse cx={0} cy={-362} rx={8} ry={5} fill={C.tongue} />
          </g>
        );
      case 'curious':
        return <ellipse cx={4} cy={-374} rx={7.5} ry={8.5} fill={C.mouthIn} />;
      case 'smirk':
        return line('M-18 -373 Q2 -368 26 -386');
      case 'determined':
        return line('M-18 -376 Q0 -371 18 -376');
      case 'thinking':
        return line('M-18 -371 Q-2 -380 18 -375');
      case 'whistle':
        return (
          <g>
            <path d="M-20 -393 C-44 -386 -44 -360 -18 -354" stroke={C.skinShade} strokeWidth={4} strokeLinecap="round" fill="none" />
            <ellipse cx={4} cy={-373} rx={10} ry={9} fill={C.skinDeep} />
          </g>
        );
      default:
        return line('M-23 -383 Q0 -364 23 -383');
    }
  };

  return (
    <g data-rig="face">
      {eye('L', squint)}
      {eye('R', squint || face === 'wink')}
      {brow(-EYE.x, brows.l)}
      {brow(EYE.x, brows.r)}
      <ellipse cx={0} cy={-400} rx={7} ry={6} fill={C.skinDeep} />
      <g className="ca-mouth">{mouth()}</g>
    </g>
  );
};

/* ---------------- Efectos que acompañan a algunos gestos ---------------- */

const SPARKS = [
  { x: 128, y: -486, s: 1.1, fill: C.amber, c: 's1' },
  { x: 172, y: -540, s: 0.7, fill: C.lilac, c: 's2' },
  { x: -176, y: -520, s: 0.8, fill: C.teal, c: 's3' },
  { x: 182, y: -442, s: 0.55, fill: C.pink, c: 's2' },
];

const star = (x: number, y: number, s: number) => {
  const a = 20 * s;
  const b = 3 * s;
  return `M${x} ${y - a} Q${x + b} ${y - b} ${x + a} ${y} Q${x + b} ${y + b} ${x} ${y + a} Q${x - b} ${y + b} ${x - a} ${y} Q${x - b} ${y - b} ${x} ${y - a} Z`;
};

const Fx: React.FC = () => (
  <g>
    <g data-rig="fxNotes" display="none">
      <g className="ca-note n1">
        <path d="M0 0 V-30 L18 -35 V-6" stroke={C.violet} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx={-5} cy={1} rx={8} ry={6} fill={C.violet} />
        <ellipse cx={13} cy={-5} rx={8} ry={6} fill={C.violet} />
      </g>
      <g className="ca-note n2">
        <path d="M0 0 V-28 Q10 -26 14 -16" stroke={C.amber} strokeWidth={5} fill="none" strokeLinecap="round" />
        <ellipse cx={-5} cy={1} rx={8} ry={6} fill={C.amber} />
      </g>
      <path className="ca-toot" d="M112 -392 L134 -402 M116 -374 L142 -376 M112 -356 L134 -348" stroke={C.metalShade} strokeWidth={5} strokeLinecap="round" />
    </g>
    <g data-rig="fxSparkles" display="none">
      {SPARKS.map((s) => (
        <path key={s.x} className={`ca-spark ${s.c}`} style={{ transformOrigin: `${s.x}px ${s.y}px` }} d={star(s.x, s.y, s.s)} fill={s.fill} />
      ))}
      <circle className="ca-spark s1" style={{ transformOrigin: '150px -500px' }} cx={150} cy={-500} r={9} fill="none" stroke={C.metalShade} strokeWidth={3} />
      <circle className="ca-spark s3" style={{ transformOrigin: '118px -520px' }} cx={118} cy={-520} r={6} fill="none" stroke={C.metalShade} strokeWidth={3} />
    </g>
  </g>
);

/* ---------------- Figura completa ---------------- */

interface CoachFigureProps extends FaceProps {
  outfit: CoachOutfit;
  crop: 'head' | 'bust' | 'full';
}

export const CoachFigure: React.FC<CoachFigureProps> = ({ outfit, crop, ...face }) => {
  const hasArms = crop !== 'head';
  const female = face.gender === 'female';
  const rosy = face.face === 'proud' || face.face === 'happy' || face.face === 'grin' || face.face === 'excited';
  return (
    <g data-rig="world">
      {crop === 'full' && (
        <g>
          <ellipse data-rig="shadow" cx={0} cy={-2} rx={104} ry={10} fill="currentColor" opacity={0.14} />
          <Leg side="L" outfit={outfit} />
          <Leg side="R" outfit={outfit} />
        </g>
      )}
      <g data-rig="torso">
        <g data-rig="slotBack">
          {hasArms && <Arm side="L" outfit={outfit} />}
          {hasArms && <Arm side="R" outfit={outfit} />}
        </g>
        <rect x={-24} y={-362} width={48} height={40} rx={12} fill={C.skinShade} />
        <Torso outfit={outfit} />
        <g data-rig="head">
          {female && (
            <g>
              <path data-rig="pony" fill={C.hairF} />
              <path data-rig="ponyLight" stroke={C.hairFLight} strokeWidth={6} strokeLinecap="round" fill="none" />
            </g>
          )}
          <g data-rig="earL">
            <circle cx={-90} cy={-424} r={16} fill={C.skin} />
            <circle cx={-90} cy={-424} r={7.5} fill={C.skinShade} />
          </g>
          <g data-rig="earR">
            <circle cx={90} cy={-424} r={16} fill={C.skin} />
            <circle cx={90} cy={-424} r={7.5} fill={C.skinShade} />
          </g>
          <path d={HEAD} fill={C.skin} />
          {/* Las mejillas se recortan con la cabeza: al girar la cara no pueden salirse */}
          <clipPath id={`ca-head-${face.uid}`}>
            <path d={HEAD} />
          </clipPath>
          <g clipPath={`url(#ca-head-${face.uid})`}>
            <g data-rig="cheek" className="ca-cheeks">
              <ellipse className="ca-cheek" cx={-61} cy={-394} rx={13.5} ry={9} fill={C.cheek} opacity={rosy ? 0.8 : 0.6} />
              <ellipse className="ca-cheek" cx={61} cy={-394} rx={13.5} ry={9} fill={C.cheek} opacity={rosy ? 0.8 : 0.6} />
            </g>
          </g>
          <Face {...face} />
          <g data-rig="hair">
            <Hair gender={face.gender} outfit={outfit} />
            {female && outfit !== 'shop' && (
              <g>
                <circle cx={42} cy={-540} r={15} fill={C.violetLight} />
                <circle cx={38} cy={-544} r={5} fill={C.white} opacity={0.6} />
              </g>
            )}
          </g>
        </g>
        {outfit === 'coach' && <Whistle />}
        <g data-rig="slotFront" />
      </g>
      {hasArms && <Fx />}
    </g>
  );
};
