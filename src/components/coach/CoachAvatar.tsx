import React, { useEffect, useId, useRef, useState } from 'react';
import type { CoachGender } from './coachPersona';
import { onCoachVoiceLevel, useCoachSpeaking } from '@/lib/coachVoice';
import './coach.css';

export type CoachExpression =
  | 'neutral'
  | 'happy'
  | 'grin'
  | 'thinking'
  | 'surprised'
  | 'excited'
  | 'wink'
  | 'smirk'
  | 'curious'
  | 'proud'
  | 'determined';
export type CoachOutfit = 'coach' | 'shop' | 'lab';
export type CoachGesture = 'wave' | 'cheer' | 'bounce' | 'nod';
/** Posturas de los brazos: los gestos de una vez y las que el personaje hace solo */
type Pose = CoachGesture | 'coin' | 'explain';

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
  /** Microexpresiones y gestos espontáneos mientras está en reposo */
  lively?: boolean;
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
  creamShade: '#EBCF9F',
  coat: '#F1F5F9',
  coatShade: '#C3CDDA',
  steel: '#334155',
  glass: '#67E8F9',
  glassRim: '#0E7490',
};

const POSE_MS: Record<Pose, number> = { wave: 2100, cheer: 1500, bounce: 750, nod: 900, coin: 3200, explain: 2800 };

/** Ejes de los ojos (centro del SVG de 200 × 210) */
const EYE_L = { x: 78, y: 103 };
const EYE_R = { x: 122, y: 103 };
const LOOK_MAX = { x: 4.4, y: 3.8 };

/** Hombros: el brazo gira desde aquí y el codo a 32 unidades (dentro del contorno del torso) */
const SH_R = { x: 142, y: 182 };
const SH_L = { x: 58, y: 182 };
const UPPER = 32;

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

/** Boca para hablar: `o` de 0 (cerrada, una línea) a 1 (muy abierta) */
function talkMouthPath(o: number) {
  const w = 21 - 3 * o;
  const h = 1.6 + 13 * o;
  const l = 100 - w / 2;
  const r = 100 + w / 2;
  return `M${l} 132 Q100 ${131.2 - o} ${r} 132 Q${r + 1} ${132 + h} 100 ${132 + h} Q${l - 1} ${132 + h} ${l} 132 Z`;
}

type BrowSet = { l: [number, number]; r: [number, number] };
const BROWS: Record<CoachExpression | 'talk' | 'talkUp' | 'talkFocus', BrowSet> = {
  // [desplazamiento vertical, giro en grados]
  neutral: { l: [0, 0], r: [0, 0] },
  happy: { l: [-2.5, -2], r: [-2.5, 2] },
  grin: { l: [-3.5, -3], r: [-3.5, 3] },
  excited: { l: [-5, -4], r: [-5, 4] },
  thinking: { l: [-6, -9], r: [1, -6] },
  surprised: { l: [-7, 0], r: [-7, 0] },
  wink: { l: [-3, -2], r: [1, 6] },
  smirk: { l: [1, 5], r: [-5, -7] },
  curious: { l: [-6, -7], r: [0, 2] },
  proud: { l: [-2, -5], r: [-2, 5] },
  determined: { l: [1, 11], r: [1, -11] },
  talk: { l: [-1.5, 2], r: [-1.5, -2] },
  talkUp: { l: [-5, -3], r: [-5, 3] },
  talkFocus: { l: [0.5, 8], r: [0.5, -8] },
};

/** Microexpresiones al azar según el estado de ánimo de base */
const MICRO: Partial<Record<CoachExpression, CoachExpression[]>> = {
  neutral: ['happy', 'smirk', 'curious', 'happy', 'proud'],
  // La sonrisa abierta es la excepción: casi siempre sonríe con la boca cerrada
  happy: ['proud', 'wink', 'smirk', 'curious', 'neutral', 'grin', 'proud'],
};
const TALK_BROWS: (keyof typeof BROWS)[] = ['talk', 'talkUp', 'talk', 'talkFocus', 'happy', 'curious'];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/**
 * PERSONAJE DEL COACH (Pilo / Pila)
 * Ilustración vectorial plana: escala nítida en cualquier pantalla. Parpadea, mira alrededor
 * (o sigue al puntero), respira, cambia de gesto y mueve los brazos (hombro y codo articulados).
 * Con `talk` la boca sigue el nivel de la voz.
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
  lively = true,
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
  const showArms = crop === 'bust';
  const [pose, setPose] = useState<Pose | null>(null);
  const poseRef = useRef<Pose | null>(null);
  poseRef.current = pose;
  const [micro, setMicro] = useState<CoachExpression | null>(null);
  const [talkBrow, setTalkBrow] = useState<keyof typeof BROWS>('talk');

  // Gesto de una sola vez (se repite cuando cambia gestureKey)
  useEffect(() => {
    if (!gesture || !gestureKey) return;
    setPose(null);
    // Temporizadores encadenados (no requestAnimationFrame: en pestañas ocultas se pausa
    // y el gesto podía quedarse puesto al volver)
    let end: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      setPose(gesture);
      end = setTimeout(() => setPose((p) => (p === gesture ? null : p)), POSE_MS[gesture]);
    }, 30);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [gesture, gestureKey]);

  // Gestos espontáneos: el tendero lanza una moneda y al hablar acompaña con la mano
  useEffect(() => {
    if (!showArms || !lively) return;
    const kind: Pose | null = talking ? 'explain' : outfit === 'shop' ? 'coin' : null;
    if (!kind) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(
        () => {
          if (!poseRef.current) {
            setPose(kind);
            t = setTimeout(() => {
              setPose((p) => (p === kind ? null : p));
              loop();
            }, POSE_MS[kind]);
          } else loop();
        },
        talking ? 1800 + Math.random() * 2600 : 4500 + Math.random() * 4000,
      );
    };
    loop();
    return () => {
      clearTimeout(t);
      setPose((p) => (p === kind ? null : p));
    };
  }, [showArms, lively, talking, outfit]);

  // Microexpresiones en reposo: sonrisas, guiños, cejas curiosas… y vuelta al gesto de base
  useEffect(() => {
    setMicro(null);
    const pool = MICRO[expression];
    if (!lively || talking || !pool) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setMicro(pick(pool));
        t = setTimeout(() => {
          setMicro(null);
          loop();
        }, 1000 + Math.random() * 1400);
      }, 2600 + Math.random() * 4200);
    };
    loop();
    return () => clearTimeout(t);
  }, [expression, talking, lively]);

  // Al hablar las cejas acompañan las frases
  useEffect(() => {
    if (!talking) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setTalkBrow(pick(TALK_BROWS));
        loop();
      }, 900 + Math.random() * 1600);
    };
    loop();
    return () => clearTimeout(t);
  }, [talking]);

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

  const face: CoachExpression = micro ?? expression;

  // Mirada: sigue al puntero si se mueve; si no, vistazos aleatorios. La expresión puede fijarla.
  useEffect(() => {
    const apply = (x: number, y: number) => {
      const tr = `translate(${(x * LOOK_MAX.x).toFixed(2)}px, ${(y * LOOK_MAX.y).toFixed(2)}px)`;
      if (pupilL.current) pupilL.current.style.transform = tr;
      if (pupilR.current) pupilR.current.style.transform = tr;
    };

    if (face === 'thinking' || face === 'curious') {
      apply(face === 'thinking' ? 0.65 : -0.5, -0.85);
      return;
    }
    if (face === 'surprised') {
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
  }, [face, followPointer, crop, outfit, talking]);

  // Boca: sigue el nivel de la voz fotograma a fotograma sin re-renderizar
  useEffect(() => {
    if (!talking) return;
    const set = (level: number) => {
      const o = Math.min(1, Math.max(0, level));
      const h = 1.6 + 13 * o;
      talkMouth.current?.setAttribute('d', talkMouthPath(o));
      if (talkTongue.current) {
        talkTongue.current.setAttribute('cy', String(132 + h - 2.4));
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
  const brows = BROWS[talking ? (face === 'neutral' || face === 'happy' ? talkBrow : face) : face];
  const squint = face === 'excited' || face === 'proud';
  const wink = face === 'wink';
  const idleClass = outfit === 'shop' ? 'ca-idle-shop' : outfit === 'lab' ? 'ca-idle-lab' : 'ca-idle-calm';
  const viewBox = crop === 'head' ? '28 8 144 144' : '0 0 200 210';
  const height = crop === 'head' ? size : (size * 210) / 200;

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
            <circle cx={pos.x} cy={pos.y + 0.5} r={face === 'surprised' ? 5.8 : 7.4} fill={C.eye} />
            <circle cx={pos.x + 2.6} cy={pos.y - 2.6} r={2.4} fill={C.white} />
          </g>
          {/* Párpado: entrecierra los ojos en las caras decididas o pícaras */}
          {(face === 'determined' || face === 'smirk') && (
            <rect x={pos.x - 14} y={pos.y - 17} width={28} height={face === 'determined' ? 11 : 9} fill={C.skin} />
          )}
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
    const d = big ? 'M85 129.5 H115 Q115 147 100 147 Q85 147 85 129.5 Z' : 'M88 131 H112 Q112 144 100 144 Q88 144 88 131 Z';
    return (
      <g>
        <clipPath id={mouthClip}>
          <path d={d} />
        </clipPath>
        <path d={d} fill={C.mouth} />
        <g clipPath={`url(#${mouthClip})`}>
          <rect x={84} y={128} width={32} height={big ? 5 : 4.2} rx={2} fill={C.white} />
          <ellipse cx={100} cy={big ? 145.5 : 142.5} rx={big ? 9 : 6.5} ry={big ? 4.6 : 3.4} fill={C.tongue} />
        </g>
      </g>
    );
  };

  const line = (d: string, w = 3.8) => <path d={d} stroke={C.mouth} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />;

  const mouth = () => {
    if (talking)
      return (
        <g>
          <path ref={talkMouth} d={talkMouthPath(0)} fill={C.mouth} />
          <rect ref={talkTeeth} x={91} y={132} width={18} height={0} rx={1.4} fill={C.white} style={{ opacity: 0 }} />
          <ellipse ref={talkTongue} cx={100} cy={133} rx={5.2} ry={0} fill={C.tongue} style={{ opacity: 0 }} />
        </g>
      );
    switch (face) {
      case 'happy':
      case 'wink':
      case 'proud':
        // Sonrisa amplia con la boca cerrada (media luna)
        return <path d="M86 131 Q100 146 114 131 Q100 138.5 86 131 Z" fill={C.mouth} stroke={C.mouth} strokeWidth={2.4} strokeLinejoin="round" />;
      case 'grin':
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
      case 'curious':
        return <ellipse cx={101} cy={136} rx={3.6} ry={4.2} fill={C.mouth} />;
      case 'smirk':
        return line('M90 136.5 Q99 138.5 112 131');
      case 'determined':
        return line('M91 135.5 Q100 138 109 135.5', 4);
      case 'thinking':
        return line('M91 137 Q99 132.5 109 135.5', 3.6);
      default:
        return line('M89 132.5 Q100 141 111 132.5');
    }
  };

  /* ---------------- Torso según la ropa (más estrecho que la cabeza) ---------------- */
  const TORSO = 'M38 210 C40 186 58 171 80 166 L120 166 C142 171 160 186 162 210 Z';
  const sleeve = outfit === 'lab' ? C.coatShade : outfit === 'shop' ? C.creamShade : C.violetDark;

  const torso = () => {
    if (outfit === 'shop')
      return (
        <g>
          <path d={TORSO} fill={C.cream} />
          {/* Cuello de camisa */}
          <path d="M82 161 L100 177 L93 184 L77 168 Z" fill={C.white} />
          <path d="M118 161 L100 177 L107 184 L123 168 Z" fill={C.white} />
          {/* Delantal */}
          <path d="M76 178 L86 164" stroke={C.teal} strokeWidth={5.5} strokeLinecap="round" />
          <path d="M124 178 L114 164" stroke={C.teal} strokeWidth={5.5} strokeLinecap="round" />
          <path d="M70 210 V186 Q70 178 78 178 H122 Q130 178 130 186 V210 Z" fill={C.tealLip} />
          <path d="M70 207 V186 Q70 178 78 178 H122 Q130 178 130 186 V207 Z" fill={C.teal} />
          <rect x={76} y={184} width={7} height={16} rx={3.5} fill={C.white} opacity={0.28} />
          {/* Bolsillo con un regalito */}
          <rect x={89} y={188} width={22} height={17} rx={5} fill={C.tealLip} />
          <rect x={93.5} y={191} width={13} height={9.5} rx={2.5} fill={C.amber} />
          <rect x={98.5} y={191} width={3} height={9.5} fill={C.amberLip} />
          <path d="M100 191 C96 186 92 188 95 191 Z M100 191 C104 186 108 188 105 191 Z" fill={C.amberLip} />
        </g>
      );
    if (outfit === 'lab')
      return (
        <g>
          <path d={TORSO} fill={C.coat} />
          {/* Camiseta violeta por dentro */}
          <path d="M84 166 L116 166 L105 210 L95 210 Z" fill={C.violet} />
          <path d="M87 165 Q100 176 113 165 Z" fill={C.skinShade} />
          {/* Solapas */}
          <path d="M80 163 L96 197 L91 210 L73 172 Z" fill={C.coatShade} />
          <path d="M120 163 L104 197 L109 210 L127 172 Z" fill={C.coatShade} />
          {/* Bolsillo con bolígrafos */}
          <rect x={113} y={186} width={18} height={5} rx={2} fill={C.coatShade} />
          <rect x={116} y={177} width={3.5} height={12} rx={1.75} fill={C.violetLight} />
          <rect x={121.5} y={179} width={3.5} height={10} rx={1.75} fill={C.amber} />
          <rect x={127} y={181} width={3} height={8} rx={1.5} fill={C.teal} />
        </g>
      );
    return (
      <g>
        <path d={TORSO} fill={C.violet} />
        {/* Cuello alto y cremallera */}
        <path d="M79 160 L100 178 L100 189 L74 170 Z" fill={C.violetLight} />
        <path d="M121 160 L100 178 L100 189 L126 170 Z" fill={C.violetLight} />
        <rect x={98.6} y={183} width={2.8} height={27} fill={C.white} opacity={0.75} />
        {/* Silbato */}
        <path d="M87 167 Q91 186 105 196" stroke={C.amber} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <path d="M114 167 Q114 184 107 195" stroke={C.amber} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        <g className="ca-whistle">
          <rect x={99} y={193} width={19} height={11.5} rx={5.75} fill="#94A3B8" />
          <rect x={99} y={192} width={19} height={10} rx={5} fill="#E2E8F0" />
          <rect x={114} y={193.5} width={7} height={5} rx={2} fill="#E2E8F0" />
          <circle cx={105} cy={197} r={2.1} fill="#64748B" />
        </g>
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

  /* ---------------- Brazos articulados (hombro → codo → mano) ----------------
     Se dibujan colgando hacia abajo desde el hombro, dentro del contorno del torso:
     en reposo son la manga del costado y, al levantarse, giran desde el hombro y el codo
     sin aparecer ni desvanecerse. */
  const arm = (side: 'r' | 'l') => {
    const sh = side === 'r' ? SH_R : SH_L;
    const elbowY = sh.y + UPPER;
    const out = side === 'r' ? 1 : -1; // hacia fuera del cuerpo
    return (
      <g className={`ca-up ca-up-${side}`} style={{ transformOrigin: `${sh.x}px ${sh.y}px` }}>
        <path d={`M${sh.x} ${sh.y} L${sh.x} ${elbowY}`} stroke={sleeve} strokeWidth={21} strokeLinecap="round" />
        {outfit === 'coach' && (
          <path d={`M${sh.x + 6.5 * out} ${sh.y + 2} L${sh.x + 6.5 * out} ${elbowY + 2}`} stroke={C.white} strokeWidth={3.4} strokeLinecap="round" opacity={0.9} />
        )}
        <g className={`ca-fore ca-fore-${side}`} style={{ transformOrigin: `${sh.x}px ${elbowY}px` }}>
          <path d={`M${sh.x} ${elbowY} L${sh.x} ${elbowY + 25}`} stroke={sleeve} strokeWidth={19} strokeLinecap="round" />
          <rect x={sh.x - 10.5} y={elbowY + 22} width={21} height={6} rx={3} fill={outfit === 'coach' ? C.white : C.skinShade} opacity={outfit === 'coach' ? 0.9 : 0.6} />
          <g className={`ca-hand ca-hand-${side}`} style={{ transformOrigin: `${sh.x}px ${elbowY + 28}px` }}>
            <rect x={sh.x - 11} y={elbowY + 27} width={22} height={22} rx={10} fill={C.skin} />
            <rect x={sh.x - 11 * out - 4} y={elbowY + 30} width={8} height={10} rx={4} fill={C.skin} />
            <rect x={sh.x - 6} y={elbowY + 41} width={5} height={7} rx={2.5} fill={C.skinShade} opacity={0.55} />
            <rect x={sh.x + 1} y={elbowY + 41} width={5} height={7} rx={2.5} fill={C.skinShade} opacity={0.55} />
            {side === 'r' && outfit === 'shop' && (
              <g className="ca-coin" style={{ transformOrigin: `${sh.x}px ${elbowY + 60}px` }}>
                <circle cx={sh.x} cy={elbowY + 60} r={9.5} fill={C.amberLip} />
                <circle cx={sh.x} cy={elbowY + 59} r={8.2} fill={C.amber} />
                <path d={`M${sh.x + 1.5} ${elbowY + 54} l-4.5 6.5 h3.5 l-1.5 4.5 l5 -7 h-3.5 Z`} fill={C.amberLip} />
              </g>
            )}
          </g>
        </g>
      </g>
    );
  };

  const flask = () => (
    <g className="ca-flask" style={{ transformOrigin: '70px 196px' }}>
      <path d="M64 152 H77 V164 L88 190 Q90 198 82 198 H59 Q51 198 53 190 L64 164 Z" fill="#E0F2FE" opacity={0.95} />
      <path d="M57 182 H84 L88 191 Q89 196 82 196 H59 Q53 196 54 191 Z" fill={C.teal} />
      <circle className="ca-bubble b1" cx={65} cy={188} r={2.3} fill={C.white} opacity={0.8} />
      <circle className="ca-bubble b2" cx={74} cy={190} r={1.7} fill={C.white} opacity={0.8} />
      <circle className="ca-bubble b3" cx={70} cy={186} r={1.4} fill={C.white} opacity={0.8} />
      <rect x={62} y={148} width={17} height={6} rx={3} fill={C.coatShade} />
      <path d="M68 168 L61 186" stroke={C.white} strokeWidth={2.4} strokeLinecap="round" opacity={0.6} />
    </g>
  );

  const classes = [
    'coach-avatar',
    `ca-${crop}`,
    `ca-${gender}`,
    `ca-outfit-${outfit}`,
    idleClass,
    `ca-expr-${face}`,
    talking ? 'is-talking' : '',
    pose ? `ca-g-${pose}` : '',
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
          <rect x={86} y={136} width={28} height={34} rx={8} fill={C.skinShade} />
          {torso()}
          {showArms && outfit === 'lab' && flask()}
          {showArms && arm('l')}
          {showArms && arm('r')}
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
          <ellipse className="ca-cheek" cx={64} cy={125} rx={8} ry={5} fill={C.cheek} opacity={squint || face === 'happy' || face === 'grin' ? 0.5 : 0.3} />
          <ellipse className="ca-cheek" cx={136} cy={125} rx={8} ry={5} fill={C.cheek} opacity={squint || face === 'happy' || face === 'grin' ? 0.5 : 0.3} />
          <ellipse cx={100} cy={118} rx={5.6} ry={4.6} fill={C.skinDeep} />
          <ellipse cx={98.5} cy={116.6} rx={1.8} ry={1.3} fill={C.white} opacity={0.35} />
          <g className="ca-mouth">{mouth()}</g>
        </g>
      </g>
    </svg>
  );
};
