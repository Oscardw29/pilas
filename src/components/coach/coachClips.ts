/**
 * GESTOS DEL COACH
 * Cada gesto son fotogramas clave con la postura de manos, pies y tronco (coordenadas de coachPose.ts);
 * los ciclos de carrera y paseo se calculan con una función. Lo que un fotograma no dice se mantiene del anterior.
 * Los codos no se indican: salen solos hacia su punto de referencia (`pole`), que solo se mueve en las posturas
 * con el brazo doblado a un lado. Los brazos van por delante del cuerpo salvo el lejano al ponerse de perfil.
 */
import { REST, REST_FLAGS, RIG, type CoachGesture, type CoachOutfit, type Flags, type Pose } from './coachPose';

interface Key {
  t: number;
  pose: Partial<Pose>;
  flags: Partial<Flags>;
}
type Resolved = { t: number; pose: Pose; flags: Flags };
export interface Clip {
  dur: number;
  /** `live`: valores que cambian tan deprisa (ciclos de carrera) que el motor debe seguirlos casi sin muelle */
  sample: (t: number) => { pose: Pose; flags: Flags; live?: Partial<Pose> };
}

const at = (t: number, pose: Partial<Pose> = {}, flags: Partial<Flags> = {}): Key => ({ t, pose, flags });

const smooth = (x: number) => x * x * (3 - 2 * x);

function clip(dur: number, keys: Key[], cycle?: (t: number) => Partial<Pose>): Clip {
  const resolved: Resolved[] = [];
  let pose: Pose = { ...REST };
  let flags: Flags = { ...REST_FLAGS };
  for (const k of keys) {
    pose = { ...pose, ...k.pose };
    flags = { ...flags, ...k.flags };
    resolved.push({ t: k.t, pose, flags });
  }
  const names = Object.keys(REST) as (keyof Pose)[];
  return {
    dur,
    sample(t) {
      let i = resolved.length - 1;
      while (i > 0 && resolved[i].t > t) i--;
      const a = resolved[i];
      const b = resolved[i + 1];
      const live = cycle?.(t);
      if (!b) return { pose: live ? { ...a.pose, ...live } : a.pose, flags: a.flags, live };
      const u = smooth(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
      const out = { ...a.pose };
      for (const n of names) out[n] = a.pose[n] + (b.pose[n] - a.pose[n]) * u;
      return { pose: live ? { ...out, ...live } : out, flags: a.flags, live };
    },
  };
}

/* ---------------- Trozos de postura que se repiten ---------------- */

/** De vuelta a la postura de reposo con el objeto guardado */
const home: Partial<Pose> = {
  handLX: REST.handLX,
  handLY: REST.handLY,
  handRX: REST.handRX,
  handRY: REST.handRY,
  poleLX: REST.poleLX,
  poleLY: REST.poleLY,
  poleRX: REST.poleRX,
  poleRY: REST.poleRY,
  palmL: 0,
  palmR: 0,
  tiltL: 0,
  tiltR: 0,
  propL: 0,
  propR: 0,
  lean: 0,
  head: 0,
  turn: 0,
  nod: 0,
  x: 0,
  y: 0,
  twist: 0,
  footLX: REST.footLX,
  footRX: REST.footRX,
  puff: 0,
};

/** Fin de un gesto de perfil: vuelve de frente con los pies en el suelo */
const homeFront: Partial<Pose> = {
  ...home,
  hipW: REST.hipW,
  shW: REST.shW,
  kneeL: REST.kneeL,
  kneeR: REST.kneeR,
  dirL: REST.dirL,
  dirR: REST.dirR,
  footLY: REST.footLY,
  footRY: REST.footRY,
  toeL: 0,
  toeR: 0,
  wind: 0,
};

/** Piernas abiertas y algo flexionadas */
const wide = (depth: number): Partial<Pose> => ({ y: depth, footLX: -56, footRX: 56 });

/** Codos hacia fuera: brazos que cargan peso a los lados */
const outL: Partial<Pose> = { poleLX: -190, poleLY: -240 };
const outR: Partial<Pose> = { poleRX: 190, poleRY: -240 };

/** Mano en la cadera, con el codo hacia fuera */
const hipL: Partial<Pose> = { handLX: -74, handLY: -224, poleLX: -170, poleLY: -270, palmL: 20 };

/** Brazo derecho señalando */
const pointR: Partial<Pose> = { handRX: 232, handRY: -350, palmR: 0, twist: 0.3, turn: 0.42, head: 3 };

/** La muñeca donde la mano agarra el silbato colgado y donde lo deja en la boca (con la cara girada a la derecha) */
const atChest: Partial<Pose> = { handRX: 26, handRY: -256 };
const atMouth: Partial<Pose> = { handRX: 40, handRY: -351, turn: 0.42, head: 3 };

/* ---------------- Ciclos de carrera y paseo (de perfil, hacia la derecha) ---------------- */

/** Recorrido del tobillo en una zancada: pisa delante, empuja hacia atrás, el talón sube y la rodilla lo trae al frente */
const STRIDE: [phase: number, x: number, y: number][] = [
  [0, 96, -31],
  [0.2, 40, -31],
  [0.42, -60, -40],
  [0.55, -140, -112],
  [0.7, -70, -120],
  [0.85, 50, -92],
];

/** Punto de la zancada (curva suave que pasa por todos los puntos); `sx` y `sy` escalan el paso */
const leg = (phase: number, sx: number, sy: number) => {
  const u = phase - Math.floor(phase);
  const n = STRIDE.length;
  let i = n - 1;
  while (STRIDE[i][0] > u) i--;
  const at0 = STRIDE[i][0];
  const at1 = i + 1 < n ? STRIDE[i + 1][0] : 1;
  const t = (u - at0) / (at1 - at0);
  const pick = (k: number) => STRIDE[(i + k + n) % n];
  const curve = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  const x = curve(pick(-1)[1], pick(0)[1], pick(1)[1], pick(2)[1]);
  const y = curve(pick(-1)[2], pick(0)[2], pick(1)[2], pick(2)[2]);
  return { x: x * sx, y: Math.min(REST.footLY, REST.footLY + (y - REST.footLY) * sy) };
};

/** Brazo de carrera con el codo a unos 85°: `swing` es 1 delante y -1 detrás (ángulos desde la vertical) */
const pumpArm = (shoulderX: number, swing: number) => {
  const r = Math.PI / 180;
  const upper = (-15 + 55 * swing) * r;
  const fore = upper + 85 * r;
  const ex = shoulderX + RIG.upperArm * Math.sin(upper);
  const ey = RIG.shoulderY + RIG.upperArm * Math.cos(upper);
  return { ex, ey, wx: ex + RIG.foreArm * Math.sin(fore), wy: ey + RIG.foreArm * Math.cos(fore) };
};

const gait =
  (period: number, sx: number, sy: number, low: number, bob: number, arms: boolean) =>
  (t: number): Partial<Pose> => {
    const ph = t / period;
    const l = leg(ph, sx, sy);
    const r = leg(ph + 0.5, sx, sy);
    const pose: Partial<Pose> = {
      // Más baja la cadera al pisar y sube al impulsarse
      y: low - Math.abs(Math.sin(ph * Math.PI * 2 + 0.5)) * bob,
      footLX: l.x,
      footLY: l.y,
      footRX: r.x,
      footRY: r.y,
    };
    if (arms) {
      // Cada brazo va al revés que su pierna
      const swing = -Math.cos(ph * Math.PI * 2 - 0.5);
      const al = pumpArm(-profile.shW!, swing);
      const ar = pumpArm(profile.shW!, -swing);
      Object.assign(pose, { handLX: al.wx, handLY: al.wy, poleLX: al.ex, poleLY: al.ey, handRX: ar.wx, handRY: ar.wy, poleRX: ar.ex, poleRY: ar.ey });
    }
    return pose;
  };

/** De perfil: caderas y hombros juntos y las rodillas y los pies hacia la derecha */
const profile: Partial<Pose> = { hipW: 9, shW: 36, kneeL: -1, kneeR: 1, dirL: 1, dirR: 1, turn: 0.82, twist: 0.7, head: 3 };

/* ---------------- Gestos ---------------- */

const liftUpL: Partial<Pose> = { handLX: -146, handLY: -438, handRX: 116, handRY: -168, tiltL: -16, tiltR: 14, lean: -2, head: -3, nod: -0.25 };
const liftUpR: Partial<Pose> = { handRX: 146, handRY: -438, handLX: -116, handLY: -168, tiltL: -14, tiltR: 16, lean: 2, head: 3, nod: -0.25 };

export const CLIPS: Record<CoachGesture, Clip> = {
  /* ---------- Comunes ---------- */
  wave: clip(2300, [
    at(0, {}, { face: 'happy' }),
    at(150, { handLX: -122, handLY: -300, lean: -1 }, { gripL: 'open' }),
    at(430, { handLX: -146, handLY: -414, head: -3, palmL: -6, turn: -0.12 }),
    at(630, { handLX: -160, palmL: -22, lean: -2.5 }),
    at(830, { handLX: -128, palmL: 14, lean: -0.5 }),
    at(1030, { handLX: -160, palmL: -22, lean: -2.5 }),
    at(1230, { handLX: -128, palmL: 14, lean: -0.5 }),
    at(1430, { handLX: -158, palmL: -18, lean: -2 }),
    at(1640, { handLX: -132, palmL: 6 }),
    at(1820, { handLX: -122, handLY: -300, palmL: 0, head: 0, turn: 0, lean: 0 }, { gripL: 'fist' }),
    at(2300, home),
  ]),
  cheer: clip(1800, [
    at(0, { y: 16, squash: 0.05, handLX: -104, handLY: -176, handRX: 104, handRY: -176, ...outL, ...outR }, { face: 'excited' }),
    at(220, { y: 20, squash: 0.07 }),
    at(440, { y: -46, squash: -0.04, footLY: -62, footRY: -62, handLX: -132, handLY: -462, handRX: 132, handRY: -462, nod: -0.4 }),
    at(680, { y: 12, squash: 0.06, footLY: -31, footRY: -31, handLX: -128, handLY: -436, handRX: 128, handRY: -436 }),
    at(920, { y: -28, squash: -0.03, footLY: -52, footRY: -52, handLX: -134, handLY: -462, handRX: 134, handRY: -462 }),
    at(1150, { y: 10, squash: 0.05, footLY: -31, footRY: -31, handLX: -128, handLY: -430, handRX: 128, handRY: -430 }),
    at(1460, { ...home, squash: 0, footLY: -31, footRY: -31 }),
  ]),
  bounce: clip(850, [
    at(0, { y: 16, squash: 0.06, handLX: -92, handRX: 92 }, { face: 'grin' }),
    at(180, { y: 20, squash: 0.08 }),
    at(380, { y: -40, squash: -0.05, footLY: -58, footRY: -58, handLX: -122, handLY: -214, handRX: 122, handRY: -214, ...outL, ...outR }),
    at(600, { y: 10, squash: 0.05, footLY: -31, footRY: -31, handLX: -92, handLY: -160, handRX: 92, handRY: -160 }),
    at(850, { ...home, squash: 0 }),
  ]),
  nod: clip(1000, [
    at(0, { nod: 0.9, head: 1.5, y: 3 }, { face: 'happy' }),
    at(240, { nod: -0.25, y: 0 }),
    at(470, { nod: 0.75, y: 3 }),
    at(700, { nod: 0, head: 0, y: 0 }),
  ]),
  /** Al hablar: una mano acompaña la frase, con el codo pegado al costado */
  explain: clip(2600, [
    at(0, { handRX: 132, handRY: -262 }, { gripR: 'open' }),
    at(420, { handRX: 144, handRY: -288, palmR: -10, twist: 0.18 }),
    at(800, { handRX: 128, handRY: -258, palmR: 6 }),
    at(1160, { handRX: 148, handRY: -294, palmR: -12 }),
    at(1560, { handRX: 130, handRY: -260, palmR: 2 }),
    at(1980, { handRX: 140, handRY: -280, palmR: -8 }),
    at(2300, { ...home }, { gripR: 'fist' }),
  ]),

  /* ---------- Entrenador ---------- */
  run: clip(
    3600,
    [
      at(0, { ...profile, lean: 3 }, { frontR: false, face: 'neutral', gaze: [0.8, 0] }),
      at(300, { lean: 10, wind: 0.95 }),
      at(3200, { lean: 10, wind: 0.95 }),
      at(3600, homeFront, { frontR: true, gaze: null }),
    ],
    (t) => (t < 3250 ? gait(560, 1, 1, 22, 14, true)(t) : {}),
  ),
  lift: clip(5000, [
    at(0, { ...wide(8), ...outL, ...outR, handLX: -110, handLY: -172, handRX: 110, handRY: -172, propL: 0, propR: 0 }, { itemL: 'dumbbell', itemR: 'dumbbell', face: 'determined' }),
    at(240, { propL: 1, propR: 1, tiltL: -8, tiltR: 8 }),
    at(620, { ...wide(16), ...liftUpL }, { face: 'excited' }),
    at(1150, { ...wide(16), ...liftUpL }),
    at(1500, { ...wide(8), handLX: -116, handLY: -168, lean: 0, head: 0, nod: 0 }, { face: 'determined' }),
    at(1860, { ...wide(16), ...liftUpR }, { face: 'excited' }),
    at(2380, { ...wide(16), ...liftUpR }),
    at(2740, { ...wide(8), handRX: 116, handRY: -168, lean: 0, head: 0, nod: 0 }, { face: 'determined' }),
    at(3100, { ...wide(16), ...liftUpL }, { face: 'excited' }),
    at(3640, { ...wide(16), ...liftUpL }),
    at(4040, { ...wide(6), handLX: -110, handLY: -170, handRX: 110, handRY: -170, tiltL: -6, tiltR: 6, lean: 0, head: 0, nod: 0 }, { face: 'happy' }),
    at(4400, { ...home }),
  ]),
  whistle: clip(5200, [
    // Coge el silbato del pecho, lo sube a la boca y lo deja allí para señalar
    at(0, atChest, { face: 'determined' }),
    at(420, {}, { whistle: 'hand' }),
    at(480, {}),
    at(800, atMouth),
    at(920, {}, { whistle: 'mouth', face: 'whistle' }),
    at(1000, { puff: 0.3 }),
    at(1300, { ...hipL, ...pointR, footLX: -46, footRX: 46 }, { gripR: 'point' }),
    at(1500, { puff: 1, handRX: 234, lean: 1.5 }, { fx: 'notes' }),
    at(1760, { puff: 0.15, handRX: 226, lean: 0 }),
    at(2000, { puff: 1, handRX: 234, handRY: -358, lean: 1.5 }),
    at(2280, { puff: 0.15, handRX: 226, handRY: -346, lean: 0 }),
    at(2520, { puff: 1, handRX: 234, handRY: -358, lean: 1.5 }),
    at(3100, { puff: 1, handRX: 234 }),
    at(3300, { puff: 0.1 }, { fx: null }),
    // Vuelve a por él y lo devuelve al pecho
    at(3380, {}, { gripR: 'fist' }),
    at(3760, { ...atMouth, lean: 0, puff: 0, handLX: REST.handLX, handLY: REST.handLY, poleLX: REST.poleLX, poleLY: REST.poleLY, palmL: 0 }),
    at(3880, {}, { whistle: 'hand', face: 'happy' }),
    at(3940, {}),
    at(4240, { ...atChest, turn: 0, head: 0, twist: 0, footLX: REST.footLX, footRX: REST.footRX }),
    at(4360, {}, { whistle: 'chest' }),
    at(4800, { ...home }),
  ]),
  stretch: clip(5200, [
    at(0, { handRX: 50, handRY: -262, twist: -0.2 }, { face: 'neutral' }),
    at(320, { handRX: -116, handRY: -318, handLX: -8, handLY: -314, twist: -0.45, turn: 0.28, head: 2, lean: 1 }, { gripR: 'open', over: 'L' }),
    at(1800, { handRX: -120, handRY: -316, head: 4, lean: 2 }, { face: 'happy' }),
    at(2200, { ...home }, { gripR: 'fist' }),
    at(2700, { handLX: 116, handLY: -318, handRX: 8, handRY: -314, twist: 0.45, turn: -0.28, head: -2, lean: -1 }, { gripL: 'open', over: 'R' }),
    at(4300, { handLX: 120, handLY: -316, head: -4, lean: -2 }),
    at(4700, { ...home }, { gripL: 'fist', over: null }),
  ]),

  /* ---------- Tendero ---------- */
  sign: clip(4000, [
    at(0, { handRX: 128, handRY: -300, propR: 0, tiltR: 0 }, { itemR: 'sign', face: 'happy' }),
    at(260, { propR: 1 }),
    at(320, { handLX: -122, handLY: -300 }, { gripL: 'open' }),
    at(560, { handLX: -148, handLY: -408, head: -3, palmL: -6 }),
    at(780, { handLX: -162, palmL: -22, lean: -2, tiltR: 3 }),
    at(1000, { handLX: -130, palmL: 14, lean: 0, tiltR: -3 }),
    at(1220, { handLX: -162, palmL: -22, lean: -2, tiltR: 3 }),
    at(1440, { handLX: -130, palmL: 14, lean: 0, tiltR: -3 }),
    at(1660, { handLX: -158, palmL: -18, lean: -2, tiltR: 2 }),
    at(1880, { handLX: -146, palmL: -4, lean: 0, tiltR: 0 }),
    at(3000, { handLX: -146 }),
    at(3220, { handLX: -122, handLY: -300, palmL: 0, head: 0 }, { gripL: 'fist' }),
    at(3600, { ...home }),
  ]),
  gift: clip(4200, [
    at(0, { handLX: -116, handLY: -272, propL: 0 }, { itemL: 'gift', gripL: 'open', face: 'excited' }),
    at(280, { propL: 1 }),
    at(640, { handLX: -140, handLY: -372, palmL: -60, head: -3, turn: -0.2, lean: -2, handRX: 12, handRY: -268, palmR: 8 }, { gripR: 'open' }),
    at(1000, { handLY: -388, y: 4, nod: 0.2 }),
    at(1360, { handLY: -372, y: 0, nod: 0 }),
    at(3100, { handLY: -378 }, { face: 'happy' }),
    at(3500, { ...home }, { gripL: 'fist', gripR: 'fist' }),
  ]),
  crate: clip(
    5200,
    [
      at(0, { handLX: -14, handLY: -206, handRX: 92, handRY: -226, poleRX: 150, poleRY: -250, propR: 0, tiltR: 0 }, { itemR: 'crate', over: 'L', face: 'grin' }),
      at(320, { propR: 1, ...profile, lean: -2, kneeL: -0.6, kneeR: 0.6 }),
      at(4400, { lean: -2 }),
      at(4800, homeFront, { over: null, gaze: null }),
    ],
    (t) => (t < 4450 ? gait(900, 0.46, 0.34, 10, 6, false)(t) : {}),
  ),
  coin: clip(4400, [
    at(0, { handLX: -116, handLY: -338, propL: 0, handRX: 30, handRY: -262, propR: 0 }, { itemL: 'coin', itemR: 'receipt', face: 'grin' }),
    at(280, { propL: 1, propR: 1 }),
    // Lanza la moneda y la atrapa
    at(1200, { handLY: -340 }, { gaze: [-0.5, -0.5] }),
    at(1340, { handLY: -320, palmL: 10 }),
    at(1500, { handLY: -358, palmL: -14, liftL: 150 }, { gaze: [-0.45, -1] }),
    at(1900, { liftL: 168 }),
    at(2280, { handLY: -334, liftL: 0, palmL: 0 }, { gaze: [-0.5, -0.5] }),
    at(2420, { handLY: -344 }, { face: 'proud', gaze: null }),
    at(3500, { handLY: -340 }),
    at(3900, { ...home }),
  ]),

  /* ---------- Científico ---------- */
  labRun: clip(
    3600,
    [
      at(0, { ...profile, lean: 3, propL: 0, propR: 0 }, { itemL: 'clipboard', itemR: 'flaskBlue', frontR: false, face: 'excited', gaze: [0.8, 0] }),
      at(300, { lean: 10, wind: 0.9, propL: 1, propR: 1 }),
      at(3200, { lean: 10, wind: 0.9 }),
      at(3600, homeFront, { frontR: true, gaze: null }),
    ],
    (t) => (t < 3250 ? gait(580, 0.95, 0.95, 20, 13, true)(t) : {}),
  ),
  flask: clip(4600, [
    at(0, { handLX: -120, handLY: -290, propL: 0, handRX: 128, handRY: -214, propR: 0, tiltR: 28 }, { itemL: 'flaskGreen', itemR: 'tube', face: 'grin' }),
    at(280, { propL: 1, propR: 1 }),
    at(700, { handLX: -112, handLY: -446, head: -3, turn: -0.22, nod: -0.3 }, { fx: 'sparkles', gaze: [-0.75, -0.9] }),
    at(1100, { tiltL: -8 }),
    at(1320, { tiltL: 8 }),
    at(1540, { tiltL: -6 }),
    at(1760, { tiltL: 5 }),
    at(1980, { tiltL: 0 }, { face: 'excited' }),
    at(3500, { tiltL: 0 }),
    at(3900, { ...home }, { fx: null, gaze: null }),
  ]),
  point: clip(3800, [
    at(0, hipL, { face: 'grin' }),
    at(340, { ...pointR, footLX: -46, footRX: 46 }, { gripR: 'point', fx: 'sparkles' }),
    at(620, { handRX: 236, lean: 2, y: 3 }),
    at(860, { handRX: 226, lean: 0, y: 0 }),
    at(1100, { handRX: 236, lean: 2, y: 3 }),
    at(1340, { handRX: 232, lean: 0, y: 0 }, { face: 'determined' }),
    at(2900, { handRX: 232 }),
    at(3250, { ...home }, { gripR: 'fist', fx: null }),
  ]),
  think: clip(5000, [
    at(0, { handLX: -120, handLY: -290, propL: 0 }, { itemL: 'flaskOrange', face: 'curious' }),
    at(280, { propL: 1 }),
    at(700, { handLX: -96, handLY: -420, handRX: 26, handRY: -326, head: 4, turn: 0.25 }, { gaze: [-0.7, -0.75] }),
    at(1500, { head: 2 }, { face: 'thinking' }),
    at(2300, { head: 5, nod: 0.15 }, { gaze: [0.5, -0.8] }),
    at(3100, { head: 2, nod: 0 }, { face: 'smirk', gaze: [-0.8, -0.7] }),
    at(4100, { head: 2 }),
    at(4500, { ...home }, { gaze: null }),
  ]),
};

/** Gestos que hace por su cuenta en reposo: con el cuerpo entero o, si solo se ve de cintura arriba, los que caben */
export const REPERTOIRE: Record<CoachOutfit, { full: CoachGesture[]; bust: CoachGesture[] }> = {
  coach: { full: ['lift', 'whistle', 'stretch', 'run', 'wave'], bust: ['whistle', 'stretch', 'wave'] },
  shop: { full: ['coin', 'sign', 'gift', 'crate'], bust: ['coin', 'sign', 'gift'] },
  lab: { full: ['flask', 'think', 'point', 'labRun'], bust: ['flask', 'think', 'point'] },
};
