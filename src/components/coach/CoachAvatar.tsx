import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CoachGender } from './coachPersona';
import { onCoachVoiceLevel, useCoachSpeaking } from '@/lib/coachVoice';
import { REPERTOIRE } from './coachClips';
import type { CoachExpression, CoachGesture, CoachOutfit } from './coachPose';
import { CoachRig } from './coachRig';
import { CoachFigure, TALK_TOP, ponyFor, talkMouthPath, type BrowKey } from './CoachFigure';
import './coach.css';

export type { CoachExpression, CoachGesture, CoachOutfit } from './coachPose';
export type CoachCrop = 'head' | 'bust' | 'full';

interface CoachAvatarProps {
  gender: CoachGender;
  /** «head»: solo la cara (botones, avatares) · «bust»: de la cintura arriba · «full»: cuerpo entero */
  crop?: CoachCrop;
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
  /** Postura fija de un gesto en un instante (0 a 1), sin animar */
  still?: { gesture: CoachGesture; at: number };
  className?: string;
}

/** Encuadres sobre el dibujo y altura relativa de los ojos para calcular la mirada */
const CROP: Record<CoachCrop, { box: [number, number, number, number]; eyes: number }> = {
  head: { box: [-136, -596, 272, 272], eyes: 0.64 },
  bust: { box: [-215, -600, 430, 410], eyes: 0.44 },
  full: { box: [-245, -600, 490, 620], eyes: 0.29 },
};

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

/** Microexpresiones al azar según el estado de ánimo de base */
const MICRO: Partial<Record<CoachExpression, CoachExpression[]>> = {
  neutral: ['happy', 'smirk', 'curious', 'happy', 'proud'],
  // La sonrisa abierta es la excepción: casi siempre sonríe con la boca cerrada
  happy: ['proud', 'wink', 'smirk', 'curious', 'neutral', 'grin', 'proud'],
};
const TALK_BROWS: BrowKey[] = ['talk', 'talkUp', 'talk', 'talkFocus', 'happy', 'curious'];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/**
 * PERSONAJE DEL COACH (Pilo / Pila)
 * Ilustración vectorial animada por un esqueleto (coachRig.ts): respira, reparte el peso, mira alrededor
 * (o sigue al puntero), parpadea y hace por su cuenta los gestos de su oficio.
 * Con `talk` la boca, la cabeza y las manos siguen la voz.
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
  still,
  className = '',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const rigRef = useRef<CoachRig | null>(null);
  const talkMouth = useRef<SVGPathElement>(null);
  const talkTongue = useRef<SVGEllipseElement>(null);
  const talkTeeth = useRef<SVGRectElement>(null);
  const voiceOn = useCoachSpeaking();
  const talking = talk && voiceOn;
  const [micro, setMicro] = useState<CoachExpression | null>(null);
  const [clipFace, setClipFace] = useState<CoachExpression | null>(null);
  const [talkBrow, setTalkBrow] = useState<BrowKey>('talk');

  // El gesto en curso manda sobre la expresión; las microexpresiones, sobre la de base
  const face: CoachExpression = clipFace ?? micro ?? expression;

  // Conecta el motor al dibujo antes de pintar: los brazos y piernas no llegan a verse sin colocar
  const stillGesture = still?.gesture;
  const stillAt = still?.at;
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rig = (rigRef.current ??= new CoachRig());
    rig.onFace = setClipFace;
    rig.bind(svg, ponyFor(gender, outfit));
    if (stillGesture) rig.freeze(stillGesture, stillAt ?? 0.5);
    else rig.start();
    return () => rig.stop();
  }, [gender, outfit, crop, stillGesture, stillAt]);

  // Gesto de una sola vez (se repite cuando cambia gestureKey)
  useEffect(() => {
    if (gesture && gestureKey && !stillGesture) rigRef.current?.play(gesture);
  }, [gesture, gestureKey, stillGesture]);

  // Gestos espontáneos: los de su oficio en reposo y las manos al hablar
  useEffect(() => {
    rigRef.current?.setTalking(talking);
    if (!lively || crop === 'head' || stillGesture) return;
    const pool: CoachGesture[] = talking ? ['explain'] : REPERTOIRE[outfit][crop === 'full' ? 'full' : 'bust'];
    let t: ReturnType<typeof setTimeout>;
    let prev: CoachGesture | null = null;
    const loop = () => {
      t = setTimeout(
        () => {
          const rig = rigRef.current;
          if (rig && !rig.busy) {
            const options = pool.length > 1 ? pool.filter((g) => g !== prev) : pool;
            prev = pick(options);
            rig.play(prev);
          }
          loop();
        },
        talking ? 1200 + Math.random() * 2200 : 5500 + Math.random() * 6000,
      );
    };
    loop();
    return () => clearTimeout(t);
  }, [lively, crop, talking, outfit, stillGesture]);

  // Microexpresiones en reposo: sonrisas, guiños, cejas curiosas… y vuelta al gesto de base
  useEffect(() => {
    setMicro(null);
    const pool = MICRO[expression];
    if (!lively || talking || !pool || stillGesture) return;
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
  }, [expression, talking, lively, stillGesture]);

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
    if (stillGesture) return;
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
  }, [stillGesture]);

  // Mirada: sigue al puntero si se mueve; si no, vistazos aleatorios. La expresión puede fijarla.
  useEffect(() => {
    const apply = (x: number, y: number) => rigRef.current?.setLook(x, y);

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
      const cy = rect.top + rect.height * CROP[crop].eyes;
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

  // Boca: sigue el nivel de la voz fotograma a fotograma sin re-renderizar (salvo con el silbato en ella)
  const talkMouthOn = talking && clipFace !== 'whistle';
  useEffect(() => {
    if (!talkMouthOn) return;
    const set = (level: number) => {
      const o = Math.min(1, Math.max(0, level));
      const h = 3 + 25 * o;
      rigRef.current?.setVoice(o);
      talkMouth.current?.setAttribute('d', talkMouthPath(o));
      if (talkTongue.current) {
        talkTongue.current.setAttribute('cy', String(TALK_TOP + h - 5));
        talkTongue.current.setAttribute('ry', String(Math.min(7, h * 0.32)));
        talkTongue.current.style.opacity = h > 11 ? '1' : '0';
      }
      if (talkTeeth.current) {
        talkTeeth.current.setAttribute('height', String(Math.min(7, h * 0.28)));
        talkTeeth.current.style.opacity = h > 9 ? '1' : '0';
      }
    };
    set(0);
    return onCoachVoiceLevel(set);
  }, [talkMouthOn]);

  const browKey: BrowKey = talking && (face === 'neutral' || face === 'happy') ? talkBrow : face;
  const { box } = CROP[crop];
  const classes = ['coach-avatar', `ca-${crop}`, `ca-${gender}`, `ca-outfit-${outfit}`, `ca-expr-${face}`, talking ? 'is-talking' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    // Cambiar de encuadre monta otro SVG: el motor mueve los brazos entre capas y React no debe tocarlos
    <svg key={crop} ref={svgRef} className={classes} viewBox={box.join(' ')} width={size} height={(size * box[3]) / box[2]} aria-hidden="true" focusable="false">
      <CoachFigure
        gender={gender}
        outfit={outfit}
        crop={crop}
        face={face}
        browKey={browKey}
        talking={talkMouthOn}
        uid={uid}
        talkMouth={talkMouth}
        talkTongue={talkTongue}
        talkTeeth={talkTeeth}
      />
    </svg>
  );
};
