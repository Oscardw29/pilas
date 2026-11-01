/** Vocabulario del esqueleto del coach: partes del gesto que comparten el motor, los gestos y el dibujo */

/** Medidas del cuerpo: origen en el suelo, centrado; «y» negativa hacia arriba */
export const RIG = {
  hipY: -205,
  neckY: -338,
  shoulderY: -312,
  upperArm: 90,
  foreArm: 88,
  thigh: 92,
  shin: 92,
  /** Del centro de la muñeca al punto donde la mano agarra un objeto */
  grip: 21,
};

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
  | 'determined'
  | 'whistle';

export type CoachGesture =
  | 'wave'
  | 'cheer'
  | 'bounce'
  | 'nod'
  | 'explain'
  // Entrenador
  | 'run'
  | 'lift'
  | 'whistle'
  | 'stretch'
  // Tendero
  | 'sign'
  | 'gift'
  | 'crate'
  | 'coin'
  // Científico
  | 'labRun'
  | 'flask'
  | 'point'
  | 'think';

export type CoachOutfit = 'coach' | 'shop' | 'lab';

export type HandShape = 'fist' | 'open' | 'point';
export type PropName =
  | 'dumbbell'
  | 'sign'
  | 'gift'
  | 'crate'
  | 'coin'
  | 'receipt'
  | 'clipboard'
  | 'flaskBlue'
  | 'flaskGreen'
  | 'flaskOrange'
  | 'tube';
export type FxName = 'notes' | 'sparkles';

/** Valores continuos: todos pasan por un muelle. «L» y «R» son los lados de la pantalla. */
export interface Pose {
  /** Cadera respecto al suelo */
  x: number;
  y: number;
  /** Inclinación del tronco en grados */
  lean: number;
  /** Giro del pecho (-1 a 1): desplaza los detalles de la ropa */
  twist: number;
  /** Inclinación de la cabeza en grados */
  head: number;
  /** Giro de la cara a los lados y arriba/abajo (-1 a 1) */
  turn: number;
  nod: number;
  /** Aplastar y estirar todo el cuerpo */
  squash: number;
  /** Muñecas (en el marco del tronco) */
  handLX: number;
  handLY: number;
  handRX: number;
  handRY: number;
  /** Dónde quiere estar cada codo (marco del tronco): se acerca a ese punto todo lo que el brazo permite */
  poleLX: number;
  poleLY: number;
  poleRX: number;
  poleRY: number;
  /** Giro de la mano respecto al antebrazo */
  palmL: number;
  palmR: number;
  /** Ángulo del objeto en la mano, respecto al mundo (un matraz sigue derecho aunque el brazo gire) */
  tiltL: number;
  tiltR: number;
  /** Tamaño del objeto (0 = guardado, 1 = en la mano) */
  propL: number;
  propR: number;
  /** Altura del objeto sobre la mano: para lanzar la moneda */
  liftL: number;
  liftR: number;
  /** Tobillos (en el marco del mundo) */
  footLX: number;
  footLY: number;
  footRX: number;
  footRY: number;
  toeL: number;
  toeR: number;
  /** Rodillas: positivo hacia fuera; -1 en L y 1 en R las llevan hacia la derecha (de perfil) */
  kneeL: number;
  kneeR: number;
  /** Hacia dónde apunta el pie (-1 izquierda, 1 derecha) */
  dirL: number;
  dirR: number;
  /** Separación de caderas y hombros (se estrechan al ponerse de perfil) */
  hipW: number;
  shW: number;
  /** Viento de la carrera: coleta y bajos de la bata */
  wind: number;
  /** Mejillas infladas al soplar */
  puff: number;
}

export const REST: Pose = {
  x: 0,
  y: 0,
  lean: 0,
  twist: 0,
  head: 0,
  turn: 0,
  nod: 0,
  squash: 0,
  handLX: -82,
  handLY: -140,
  handRX: 82,
  handRY: -140,
  poleLX: -76,
  poleLY: -226,
  poleRX: 76,
  poleRY: -226,
  palmL: 0,
  palmR: 0,
  tiltL: 0,
  tiltR: 0,
  propL: 0,
  propR: 0,
  liftL: 0,
  liftR: 0,
  footLX: -36,
  footLY: -31,
  footRX: 36,
  footRY: -31,
  toeL: 0,
  toeR: 0,
  kneeL: 0.2,
  kneeR: 0.2,
  dirL: -1,
  dirR: 1,
  hipW: 30,
  shW: 60,
  wind: 0,
  puff: 0,
};

/** Estados discretos: cambian de golpe en cada fotograma clave */
export interface Flags {
  gripL: HandShape;
  gripR: HandShape;
  /** El brazo va por delante del cuerpo y la cabeza; solo el brazo lejano de perfil pasa por detrás */
  frontL: boolean;
  frontR: boolean;
  /** Con los dos brazos delante, el que queda encima */
  over: 'L' | 'R' | null;
  itemL: PropName | null;
  itemR: PropName | null;
  face: CoachExpression | null;
  fx: FxName | null;
  /** Dónde está el silbato: colgado del cuello, en la mano derecha de la pantalla o en la boca */
  whistle: 'chest' | 'hand' | 'mouth';
  /** Mirada fija durante el gesto (-1 a 1) */
  gaze: [number, number] | null;
}

export const REST_FLAGS: Flags = {
  gripL: 'fist',
  gripR: 'fist',
  frontL: true,
  frontR: true,
  over: null,
  itemL: null,
  itemR: null,
  face: null,
  fx: null,
  whistle: 'chest',
  gaze: null,
};
