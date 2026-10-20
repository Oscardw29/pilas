import React, { useEffect, useId, useRef, useState } from 'react';
import type { CoachGender } from './coachPersona';
import { onCoachVoiceLevel, useCoachSpeaking } from '@/lib/coachVoice';
import './coach.css';

export type CoachExpression = 'neutral' | 'happy' | 'thinking' | 'surprised' | 'excited' | 'wink';
export type CoachOutfit = 'coach' | 'shop' | 'lab';
export type CoachGesture = 'wave' | 'cheer' | 'bounce' | 'nod';

interface CoachAvatarProps {
  gender: CoachGender;
  /** «head»: solo la cara (botones, avatares) · «bust»: del pecho hacia arriba */
  crop?: 'head' | 'bust';
  /** Ancho en píxeles (el SVG escala sin perder nitidez) */
  size?: number;
  expression?: CoachExpression;
  outfit?: CoachOutfit;
  /** Gesto de una sola vez; cambia `gestureKey` para repetirlo */
  gesture?: CoachGesture | null;
  gestureKey?: number;
  /** Mueve la boca al ritmo de la voz del coach mientras habla */
  talk?: boolean;
  /** Los ojos siguen al puntero (en pantallas táctiles miran alrededor solos) */
  followPointer?: boolean;
  className?: string;
}

/* ---------------- Paleta (formas planas con «labio» más oscuro, como el regalo de la tienda) ---------------- */
const C = {
  skin: '#F6BC90',
  skinShade: '#E39C6E',
  skinDeep: '#D4875A',
  eye: '#221A33',
  mouth: '#4A1838',
  tongue: '#F472B6',
  cheek: '#FB7185',
  hairM: '#2F2232',
  hairF: '#8A3B22',
  hairFLight: '#A94D2C',
  amber: '#FBBF24',
  amberLip: '#D97706',
  violet: '#7C3AED',
  violetDark: '#5B21B6',
  violetLight: '#8B5CF6',
  lilac: '#C4B5FD',
  white: '#FFFFFF',
  teal: '#14B8A6',
  tealLip: '#0F766E',
  cream: '#FFF1D6',
  creamShade: '#F2D9AE',
  coat: '#F1F5F9',
  coatShade: '#CBD5E1',
  steel: '#334155',
  glass: '#67E8F9',
  glassRim: '#0E7490',
};

const GESTURE_MS: Record<CoachGesture, number> = { wave: 1900, cheer: 1300, bounce: 750, nod: 900 };

/** Ejes de los ojos (centro del SVG de 200 × 210) */
const EYE_L = { x: 78, y: 103 };
const EYE_R = { x: 122, y: 103 };
const LOOK_MAX = { x: 4.4, y: 3.8 };

/* ---------------- Puntero compartido por todos los avatares ---------------- */
const pointer = { x: 0, y: 0, t: 0 };
const pointerSubs = new Set<() => void>();
let pointerBound = false;
function bindPointer() {
  if (pointerBound || typeof window === 'undefined') return;
  pointerBound = true;
  let raf = 0;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.t = performance.now();
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          pointerSubs.forEach((f) => f());
        });
    },
    { passive: true },
  );
}

/** Boca abierta para hablar: `o` de 0 (cerrada) a 1 (muy abierta) */
function talkMouthPath(o: number) {
  const w = 22 - 3 * o;
  const h = 2.6 + 13 * o;
  const l = 100 - w / 2;
  const r = 100 + w / 2;
  return `M${l} 131 Q100 129.6 ${r} 131 Q${r + 1.2} ${131 + h} 100 ${131 + h} Q${l - 1.2} ${131 + h} ${l} 131 Z`;
}

const BROWS: Record<CoachExpression | 'talk', { l: [number, number]; r: [number, number] }> = {
  // [desplazamiento vertical, giro en grados]
  neutral: { l: [0, 0], r: [0, 0] },
  happy: { l: [-3, -2], r: [-3, 2] },
  excited: { l: [-5, -4], r: [-5, 4] },
  thinking: { l: [-6, -9], r: [1, -6] },
  surprised: { l: [-7, 0], r: [-7, 0] },
  wink: { l: [-3, -2], r: [1, 6] },
  talk: { l: [-2, 3], r: [-2, -3] },
};

/**
 * PERSONAJE DEL COACH (Pilo / Pila)
 * Ilustración vectorial plana: escala nítida en cualquier pantalla. Parpadea, mira alrededor
 * (o sigue al puntero), respira y gesticula. Con `talk` la boca sigue el nivel de la voz.
 */
export const CoachAvatar: React.FC<CoachAvatarProps> = ({
  gender,
  crop = 'bust',
  size = 160,
  expression = 'neutral',
  outfit = 'coach',
  gesture = null,
  gestureKey = 0,
  talk = false,
  followPointer = true,
  className = '',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilL = useRef<SVGGElement>(null);
  const pupilR = useRef<SVGGElement>(null);
  const talkMouth = useRef<SVGPathElement>(null);
  const talkTongue = useRef<SVGEllipseElement>(null);
  const talkTeeth = useRef<SVGRectElement>(null);
  const voiceOn = useCoachSpeaking();
  const talking = talk && voiceOn;
  const [activeGesture, setActiveGesture] = useState<CoachGesture | null>(null);

  // Gesto de una sola vez (se repite cuando cambia gestureKey)
  useEffect(() => {
    if (!gesture || !gestureKey) return;
    setActiveGesture(null);
    const raf = requestAnimationFrame(() => setActiveGesture(gesture));
    const t = setTimeout(() => setActiveGesture(null), GESTURE_MS[gesture] + 40);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [gesture, gestureKey]);

  // Parpadeo a intervalos irregulares (a veces doble)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const blinkOnce = (then?: () => void) => {
      svgRef.current?.classList.add('ca-blink');
      t = setTimeout(() => {
        svgRef.current?.classList.remove('ca-blink');
        then?.();
      }, 120);
    };
    const schedule = () => {
      t = setTimeout(() => {
        if (Math.random() < 0.18) blinkOnce(() => (t = setTimeout(() => blinkOnce(schedule), 140)));
        else blinkOnce(schedule);
      }, 2200 + Math.random() * 3600);
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  // Mirada: sigue al puntero si se mueve; si no, vistazos aleatorios. La expresión puede fijarla.
  const lookRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const apply = (x: number, y: number) => {
      lookRef.current = { x, y };
      const tr = `translate(${(x * LOOK_MAX.x).toFixed(2)}px, ${(y * LOOK_MAX.y).toFixed(2)}px)`;
      if (pupilL.current) pupilL.current.style.transform = tr;
      if (pupilR.current) pupilR.current.style.transform = tr;
    };

    if (expression === 'thinking') {
      apply(0.65, -0.85);
      return;
    }
    if (expression === 'surprised') {
      apply(0, 0);
      return;
    }

    const fromPointer = () => {
      const svg = svgRef.current;
      if (!svg || !followPointer) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * (crop === 'head' ? 0.62 : 0.49);
      const dx = pointer.x - cx;
      const dy = pointer.y - cy;
      const d = Math.hypot(dx, dy);
      const k = d / (d + 120);
      apply((dx / (d || 1)) * k, (dy / (d || 1)) * k);
    };

    let idle: ReturnType<typeof setTimeout>;
    const glance = () => {
      idle = setTimeout(() => {
        const pointerFresh = followPointer && performance.now() - pointer.t < 2500 && pointer.t > 0;
        if (!pointerFresh) {
          const r = Math.random();
          if (talking || r < 0.5) apply((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.25);
          else if (outfit === 'lab' && r < 0.75) apply(-0.75, 0.9); // revisa el matraz
          else if (outfit === 'shop' && r < 0.7) apply(0.2, 0.85); // mira el mostrador
          else {
            const a = Math.random() * Math.PI * 2;
            const m = 0.55 + Math.random() * 0.45;
            apply(Math.cos(a) * m, Math.sin(a) * m * 0.8);
          }
        }
        glance();
      }, (talking ? 900 : 1600) + Math.random() * 2600);
    };

    bindPointer();
    if (followPointer && pointer.t > 0) fromPointer();
    else apply(0, 0);
    pointerSubs.add(fromPointer);
    glance();
    return () => {
      pointerSubs.delete(fromPointer);
      clearTimeout(idle);
    };
  }, [expression, followPointer, crop, outfit, talking]);

  // Boca: sigue el nivel de la voz fotograma a fotograma sin re-renderizar
  useEffect(() => {
    if (!talking) return;
    const set = (level: number) => {
      const o = Math.min(1, Math.max(0, level));
      const h = 2.6 + 13 * o;
      talkMouth.current?.setAttribute('d', talkMouthPath(o));
      if (talkTongue.current) {
        talkTongue.current.setAttribute('cy', String(131 + h - 2.4));
        talkTongue.current.setAttribute('ry', String(Math.min(3.6, h * 0.32)));
        talkTongue.current.style.opacity = h > 6 ? '1' : '0';
      }
      if (talkTeeth.current) {
        talkTeeth.current.setAttribute('height', String(Math.min(3.4, h * 0.28)));
        talkTeeth.current.style.opacity = h > 5 ? '1' : '0';
      }
    };
    set(0);
    return onCoachVoiceLevel(set);
  }, [talking]);

  const isFemale = gender === 'female';
  const hair = isFemale ? C.hairF : C.hairM;
  const brows = BROWS[talking && expression === 'neutral' ? 'talk' : expression];
  const squint = expression === 'excited';
  const wink = expression === 'wink';
  const idleClass = outfit === 'shop' ? 'ca-idle-shop' : outfit === 'lab' ? 'ca-idle-lab' : 'ca-idle-calm';
  const viewBox = crop === 'head' ? '28 8 144 144' : '0 0 200 210';
  const height = crop === 'head' ? size : (size * 210) / 200;
  const showArms = crop === 'bust';

  const headClip = `ca-head-${uid}`;
  const mouthClip = `ca-mouth-${uid}`;
  const eyeClipL = `ca-eyel-${uid}`;
  const eyeClipR = `ca-eyer-${uid}`;

  const brow = (cx: number, [dy, rot]: [number, number]) => (
    <path
      className="ca-brow"
      d={`M${cx - 10} 84 Q${cx} 78.5 ${cx + 10} 84`}
      stroke={hair}
      strokeWidth={5.2}
      strokeLinecap="round"
      fill="none"
      style={{ transform: `translateY(${dy}px) rotate(${rot}deg)`, transformOrigin: `${cx}px 82px` }}
    />
  );

  const eye = (pos: { x: number; y: number }, ref: React.RefObject<SVGGElement | null>, clipId: string, closed: boolean, side: 'l' | 'r') =>
    closed ? (
      <path
        d={`M${pos.x - 11} ${pos.y + 3} Q${pos.x} ${pos.y - 9} ${pos.x + 11} ${pos.y + 3}`}
        stroke={C.eye}
        strokeWidth={4.6}
        strokeLinecap="round"
        fill="none"
      />
    ) : (
      <g className="ca-eye">
        <clipPath id={clipId}>
          <ellipse cx={pos.x} cy={pos.y} rx={12.5} ry={14.5} />
        </clipPath>
        <ellipse cx={pos.x} cy={pos.y} rx={12.5} ry={14.5} fill={C.white} />
        <g clipPath={`url(#${clipId})`}>
          <g ref={ref} className="ca-pupil">
            <circle cx={pos.x} cy={pos.y + 0.5} r={expression === 'surprised' ? 5.8 : 7.4} fill={C.eye} />
            <circle cx={pos.x + 2.6} cy={pos.y - 2.6} r={2.4} fill={C.white} />
          </g>
        </g>
        {isFemale && (
          <path
            d={side === 'l' ? `M${pos.x - 10} ${pos.y - 9} l-5 -4 M${pos.x - 6} ${pos.y - 13} l-3 -5` : `M${pos.x + 10} ${pos.y - 9} l5 -4 M${pos.x + 6} ${pos.y - 13} l3 -5`}
            stroke={C.eye}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
        )}
      </g>
    );

  const openMouth = (big: boolean) => {
    const d = big ? 'M84 129 H116 Q116 148 100 148 Q84 148 84 129 Z' : 'M87 130 H113 Q113 145.5 100 145.5 Q87 145.5 87 130 Z';
    return (
      <g>
        <clipPath id={mouthClip}>
          <path d={d} />
        </clipPath>
        <path d={d} fill={C.mouth} />
        <g clipPath={`url(#${mouthClip})`}>
          <rect x={84} y={128} width={32} height={big ? 5 : 4.2} rx={2} fill={C.white} />
          <ellipse cx={100} cy={big ? 146 : 143.5} rx={big ? 9 : 7} ry={big ? 4.6 : 3.6} fill={C.tongue} />
        </g>
      </g>
    );
  };

  const mouth = () => {
    if (talking)
      return (
        <g>
          <path ref={talkMouth} d={talkMouthPath(0)} fill={C.mouth} />
          <rect ref={talkTeeth} x={91} y={131} width={18} height={0} rx={1.4} fill={C.white} style={{ opacity: 0 }} />
          <ellipse ref={talkTongue} cx={100} cy={132} rx={5.4} ry={0} fill={C.tongue} style={{ opacity: 0 }} />
        </g>
      );
    switch (expression) {
      case 'happy':
      case 'wink':
        return openMouth(false);
      case 'excited':
        return openMouth(true);
      case 'surprised':
        return (
          <g>
            <ellipse cx={100} cy={137} rx={6.2} ry={7.4} fill={C.mouth} />
            <ellipse cx={100} cy={141.5} rx={3.6} ry={2.2} fill={C.tongue} />
          </g>
        );
      case 'thinking':
        return <path d="M91 137 Q99 132.5 109 135.5" stroke={C.mouth} strokeWidth={3.6} strokeLinecap="round" fill="none" />;
      default:
        return <path d="M89 132 Q100 141.5 111 132" stroke={C.mouth} strokeWidth={3.8} strokeLinecap="round" fill="none" />;
    }
  };

  /* ---------------- Torso según la ropa ---------------- */
  const torso = () => {
    if (outfit === 'shop')
      return (
        <g>
          <path d="M14 210 C16 182 40 166 72 162 L128 162 C160 166 184 182 186 210 Z" fill={C.cream} />
          <path d="M14 210 C16 190 30 176 50 169 C40 182 36 196 36 210 Z" fill={C.creamShade} />
          <path d="M186 210 C184 190 170 176 150 169 C160 182 164 196 164 210 Z" fill={C.creamShade} />
          {/* Cuello de camisa */}
          <path d="M80 158 L100 176 L92 184 L74 166 Z" fill={C.white} />
          <path d="M120 158 L100 176 L108 184 L126 166 Z" fill={C.white} />
          {/* Delantal */}
          <path d="M72 175 L84 160" stroke={C.teal} strokeWidth={6} strokeLinecap="round" />
          <path d="M128 175 L116 160" stroke={C.teal} strokeWidth={6} strokeLinecap="round" />
          <path d="M62 210 V184 Q62 175 71 175 H129 Q138 175 138 184 V210 Z" fill={C.tealLip} />
          <path d="M62 207 V184 Q62 175 71 175 H129 Q138 175 138 184 V207 Z" fill={C.teal} />
          <rect x={70} y={181} width={8} height={18} rx={4} fill={C.white} opacity={0.28} />
          {/* Bolsillo con un regalito */}
          <rect x={88} y={186} width={24} height={18} rx={5} fill={C.tealLip} />
          <rect x={93} y={189} width={14} height={10} rx={2.5} fill={C.amber} />
          <rect x={98.5} y={189} width={3} height={10} fill={C.amberLip} />
          <path d="M100 189 C96 184 92 186 95 189 Z M100 189 C104 184 108 186 105 189 Z" fill={C.amberLip} />
        </g>
      );
    if (outfit === 'lab')
      return (
        <g>
          <path d="M14 210 C16 182 40 166 72 162 L128 162 C160 166 184 182 186 210 Z" fill={C.coat} />
          <path d="M14 210 C16 190 30 176 50 169 C40 182 36 196 36 210 Z" fill={C.coatShade} />
          <path d="M186 210 C184 190 170 176 150 169 C160 182 164 196 164 210 Z" fill={C.coatShade} />
          {/* Camiseta violeta por dentro */}
          <path d="M82 162 L118 162 L106 210 L94 210 Z" fill={C.violet} />
          <path d="M86 162 Q100 174 114 162 Z" fill={C.skinShade} />
          {/* Solapas */}
          <path d="M78 159 L96 196 L90 210 L70 170 Z" fill={C.coatShade} />
          <path d="M122 159 L104 196 L110 210 L130 170 Z" fill={C.coatShade} />
          {/* Bolsillo con bolígrafos */}
          <rect x={134} y={180} width={22} height={6} rx={2} fill={C.coatShade} />
          <rect x={138} y={170} width={4} height={13} rx={2} fill={C.violetLight} />
          <rect x={145} y={172} width={4} height={11} rx={2} fill={C.amber} />
          <rect x={150} y={174} width={3.5} height={9} rx={1.75} fill={C.teal} />
        </g>
      );
    return (
      <g>
        <path d="M14 210 C16 182 40 166 72 162 L128 162 C160 166 184 182 186 210 Z" fill={C.violet} />
        <path d="M14 210 C16 190 30 176 50 169 C40 182 36 196 36 210 Z" fill={C.violetDark} />
        <path d="M186 210 C184 190 170 176 150 169 C160 182 164 196 164 210 Z" fill={C.violetDark} />
        {/* Franjas blancas del chándal */}
        <path d="M27 204 C34 186 50 174 70 167 L73 174 C56 180 43 190 37 206 Z" fill={C.white} opacity={0.92} />
        <path d="M173 204 C166 186 150 174 130 167 L127 174 C144 180 157 190 163 206 Z" fill={C.white} opacity={0.92} />
        {/* Cuello alto y cremallera */}
        <path d="M77 157 L100 177 L100 188 L72 167 Z" fill={C.violetLight} />
        <path d="M123 157 L100 177 L100 188 L128 167 Z" fill={C.violetLight} />
        <rect x={98.6} y={182} width={2.8} height={28} fill={C.white} opacity={0.75} />
        {/* Silbato */}
        <path d="M86 165 Q90 186 106 196" stroke={C.amber} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <path d="M116 165 Q116 184 108 195" stroke={C.amber} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <g className="ca-whistle">
          <rect x={100} y={193} width={20} height={12} rx={6} fill="#94A3B8" />
          <rect x={100} y={192} width={20} height={10.5} rx={5.25} fill="#E2E8F0" />
          <rect x={116} y={193.5} width={8} height={5} rx={2} fill="#E2E8F0" />
          <circle cx={106} cy={197} r={2.2} fill="#64748B" />
        </g>
        <rect x={44} y={186} width={7} height={16} rx={3.5} fill={C.white} opacity={0.18} />
      </g>
    );
  };

  /* ---------------- Lo que lleva en la cabeza según la ropa ---------------- */
  const headwear = () => {
    if (outfit === 'shop')
      return (
        <g>
          <path d="M42 70 C42 32 70 16 100 16 C130 16 158 32 158 70 Z" fill={C.amberLip} />
          <path d="M42 66 C42 30 70 16 100 16 C130 16 158 30 158 66 Z" fill={C.amber} />
          <path d="M60 50 C64 36 76 28 88 25" stroke={C.white} strokeWidth={4} strokeLinecap="round" opacity={0.4} fill="none" />
          <path d="M103 32 L93 46 H100 L97 56 L108 41 H101 Z" fill={C.violet} />
          <circle cx={100} cy={17} r={4.5} fill={C.amberLip} />
          <ellipse cx={100} cy={71} rx={64} ry={9.5} fill="#B45309" />
          <ellipse cx={100} cy={68.5} rx={63} ry={8} fill={C.amberLip} />
        </g>
      );
    if (outfit === 'lab')
      return (
        <g>
          <g clipPath={`url(#${headClip})`}>
            <path d="M40 64 C70 52 130 52 160 64 L160 76 C130 64 70 64 40 76 Z" fill={C.steel} />
          </g>
          {[80, 120].map((x) => (
            <g key={x}>
              <circle cx={x} cy={63} r={12.5} fill={C.glassRim} />
              <circle cx={x} cy={63} r={9.5} fill={C.glass} />
              <path d={`M${x - 5} ${60} q3 -4 7 -3`} stroke={C.white} strokeWidth={2.6} strokeLinecap="round" fill="none" opacity={0.8} />
            </g>
          ))}
          <rect x={92} y={60} width={16} height={5} rx={2.5} fill={C.glassRim} />
        </g>
      );
    return (
      <g clipPath={`url(#${headClip})`}>
        <path d="M40 64 C70 52 130 52 160 64 L160 80 C130 68 70 68 40 80 Z" fill={C.amber} />
        <path d="M40 76 C70 64 130 64 160 76 L160 80 C130 68 70 68 40 80 Z" fill={C.amberLip} />
        <path d="M58 60 C74 56 88 54.5 98 54.5" stroke={C.white} strokeWidth={2.6} strokeLinecap="round" opacity={0.4} fill="none" />
        <path d="M103 55.5 L95.5 64 H100.5 L98 70.5 L106 61 H101 Z" fill={C.violet} />
      </g>
    );
  };

  const hairBack = () =>
    isFemale ? (
      <g className="ca-ponytail" style={{ transformOrigin: '132px 30px' }}>
        <path d="M124 36 C138 8 178 10 180 42 C182 70 166 92 172 114 C150 100 144 72 150 54 C146 46 136 42 124 36 Z" fill={C.hairF} />
        <path d="M160 26 C172 34 174 52 168 70" stroke={C.hairFLight} strokeWidth={4} strokeLinecap="round" fill="none" />
      </g>
    ) : null;

  const hairFront = () => {
    if (isFemale)
      return (
        <g>
          <g clipPath={`url(#${headClip})`}>
            <path d="M40 28 H160 V66 C150 56 132 50 112 52 C96 54 84 62 74 76 C68 64 58 60 40 68 Z" fill={C.hairF} />
            <path d="M118 40 C130 40 142 44 150 50" stroke={C.hairFLight} strokeWidth={3.5} strokeLinecap="round" fill="none" />
          </g>
          <path d="M52 58 C38 70 36 98 41 120 C47 113 51 100 53 86 Z" fill={C.hairF} />
          <path d="M148 58 C162 70 164 98 159 120 C153 113 149 100 147 86 Z" fill={C.hairF} />
          {outfit !== 'shop' && (
            <g>
              <circle cx={131} cy={31} r={9.5} fill={C.violetDark} />
              <circle cx={131} cy={30} r={8} fill={C.lilac} />
              <circle cx={128} cy={27.5} r={2.2} fill={C.white} opacity={0.6} />
            </g>
          )}
        </g>
      );
    return (
      <g>
        <g clipPath={`url(#${headClip})`}>
          <path d="M40 28 H160 V68 C140 58 120 55 100 55 C80 55 60 58 40 68 Z" fill={C.hairM} />
          <rect x={42} y={76} width={10} height={22} rx={4} fill={C.hairM} />
          <rect x={148} y={76} width={10} height={22} rx={4} fill={C.hairM} />
        </g>
        {outfit !== 'shop' && (
          <g>
            {/* Tupé con dos puntas hacia delante */}
            <path
              d="M64 50 C60 30 76 16 96 19 C102 8 122 5 134 15 C127 16 123 20 121 26 C132 25 143 32 145 44 C132 37 116 36 102 40 C89 38 75 42 64 50 Z"
              fill={C.hairM}
            />
            <path d="M100 22 C108 15 118 13 126 15" stroke="#4A3A4E" strokeWidth={3.2} strokeLinecap="round" fill="none" />
          </g>
        )}
      </g>
    );
  };

  /* ---------------- Brazos (solo del pecho hacia arriba) ---------------- */
  const armRight = () => (
    <g className="ca-arm ca-arm-r" style={{ transformOrigin: '160px 206px' }}>
      <path d="M160 208 L176 152" stroke={outfit === 'lab' ? C.coat : outfit === 'shop' ? C.cream : C.violet} strokeWidth={24} strokeLinecap="round" />
      {outfit === 'coach' && <path d="M165 192 L171 170" stroke={C.white} strokeWidth={5} strokeLinecap="round" opacity={0.9} />}
      <g className="ca-hand-r" style={{ transformOrigin: '177px 146px' }}>
        <rect x={165} y={126} width={25} height={26} rx={11} fill={C.skin} />
        <rect x={160} y={137} width={10} height={8} rx={4} fill={C.skin} />
        <rect x={168} y={126} width={6} height={10} rx={3} fill={C.skinShade} opacity={0.5} />
        <rect x={175} y={125} width={6} height={10} rx={3} fill={C.skinShade} opacity={0.5} />
      </g>
      {outfit === 'shop' && (
        <g className="ca-coin" style={{ transformOrigin: '178px 112px' }}>
          <circle cx={178} cy={112} r={10} fill={C.amberLip} />
          <circle cx={178} cy={111} r={8.6} fill={C.amber} />
          <path d="M179.5 106 L175 112.5 H178.5 L177 117 L182 110 H178.5 Z" fill={C.amberLip} />
        </g>
      )}
    </g>
  );

  const armLeft = () => (
    <g className="ca-arm ca-arm-l" style={{ transformOrigin: '40px 206px' }}>
      <path d="M40 210 L64 186" stroke={outfit === 'lab' ? C.coatShade : outfit === 'shop' ? C.creamShade : C.violetDark} strokeWidth={24} strokeLinecap="round" />
      {outfit === 'lab' && (
        <g className="ca-flask" style={{ transformOrigin: '72px 196px' }}>
          <path d="M66 150 H80 V162 L92 190 Q94 198 86 198 H60 Q52 198 54 190 L66 162 Z" fill="#E0F2FE" opacity={0.95} />
          <path d="M59 182 H87 L91 191 Q92 196 86 196 H60 Q54 196 55 191 Z" fill={C.teal} />
          <circle className="ca-bubble b1" cx={68} cy={188} r={2.4} fill={C.white} opacity={0.8} />
          <circle className="ca-bubble b2" cx={76} cy={190} r={1.8} fill={C.white} opacity={0.8} />
          <circle className="ca-bubble b3" cx={72} cy={186} r={1.5} fill={C.white} opacity={0.8} />
          <rect x={64} y={146} width={18} height={6} rx={3} fill={C.coatShade} />
          <path d="M70 166 L62 186" stroke={C.white} strokeWidth={2.6} strokeLinecap="round" opacity={0.6} />
        </g>
      )}
      <rect x={56} y={176} width={22} height={20} rx={9} fill={C.skin} />
      <rect x={70} y={174} width={9} height={9} rx={4} fill={C.skin} />
    </g>
  );

  const classes = [
    'coach-avatar',
    `ca-${crop}`,
    `ca-${gender}`,
    `ca-outfit-${outfit}`,
    idleClass,
    `ca-expr-${expression}`,
    talking ? 'is-talking' : '',
    activeGesture ? `ca-g-${activeGesture}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <svg
      ref={svgRef}
      className={classes}
      viewBox={viewBox}
      width={size}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={headClip}>
          <rect x={46} y={32} width={108} height={118} rx={44} />
        </clipPath>
      </defs>

      <g className="ca-rig">
        <g className="ca-body" style={{ transformOrigin: '100px 210px' }}>
          {/* Cuello */}
          <rect x={84} y={136} width={32} height={34} rx={8} fill={C.skinShade} />
          {torso()}
          {showArms && armLeft()}
        </g>

        <g className="ca-head" style={{ transformOrigin: '100px 150px' }}>
          {hairBack()}
          {/* Orejas */}
          <circle cx={47} cy={102} r={11} fill={C.skin} />
          <circle cx={48} cy={102} r={5} fill={C.skinShade} />
          <circle cx={153} cy={102} r={11} fill={C.skin} />
          <circle cx={152} cy={102} r={5} fill={C.skinShade} />
          {/* Cabeza */}
          <rect x={46} y={32} width={108} height={118} rx={44} fill={C.skin} />
          <g clipPath={`url(#${headClip})`}>
            <path d="M46 132 C70 152 130 152 154 132 V152 H46 Z" fill={C.skinShade} opacity={0.45} />
          </g>
          {hairFront()}
          {headwear()}

          {/* Cara */}
          {brow(EYE_L.x, brows.l)}
          {brow(EYE_R.x, brows.r)}
          {eye(EYE_L, pupilL, eyeClipL, squint, 'l')}
          {eye(EYE_R, pupilR, eyeClipR, squint || wink, 'r')}
          <ellipse cx={64} cy={125} rx={8} ry={5} fill={C.cheek} opacity={0.32} />
          <ellipse cx={136} cy={125} rx={8} ry={5} fill={C.cheek} opacity={0.32} />
          <ellipse cx={100} cy={118} rx={5.6} ry={4.6} fill={C.skinDeep} />
          <ellipse cx={98.5} cy={116.6} rx={1.8} ry={1.3} fill={C.white} opacity={0.35} />
          <g className="ca-mouth">{mouth()}</g>
        </g>

        {showArms && armRight()}
      </g>
    </svg>
  );
};
