/**
 * ESQUELETO DEL COACH (Pilo / Pila)
 * Un solo motor mueve todo el cuerpo: cada fotograma calcula la postura objetivo (gesto + reposo + voz),
 * la persigue con muelles (así cualquier cambio de gesto enlaza sin saltos) y resuelve brazos y piernas
 * con cinemática inversa: las poses dicen dónde va la mano o el pie y el codo o la rodilla se colocan solos.
 * Los pies quedan plantados aunque se mueva la cadera. Escribe atributos SVG directamente, sin re-renderizar React.
 */
import { CLIPS } from './coachClips';
import { REST, REST_FLAGS, RIG, type CoachExpression, type CoachGesture, type Flags, type HandShape, type Pose, type PropName } from './coachPose';
import { isLowPowerDevice } from '@/lib/perf';

/* ---------------- Cálculo puro de los miembros ---------------- */

export interface Limb {
  ex: number;
  ey: number;
  wx: number;
  wy: number;
}

/**
 * Cinemática inversa de dos huesos. Si el objetivo queda lejos, el miembro se estira hasta donde llega.
 * `bend` (-1 a 1) decide hacia qué lado sale la articulación y es continuo: pasar de un lado al otro no da saltos.
 */
export function solveLimb(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, bend: number): Limb {
  let dx = tx - ax;
  let dy = ty - ay;
  let d = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.5;
  const min = Math.abs(l1 - l2) + 6;
  if (d > max || d < min) {
    const k = (d > max ? max : min) / d;
    dx *= k;
    dy *= k;
    d = Math.hypot(dx, dy);
  }
  const ux = dx / d;
  const uy = dy / d;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a)) * bend;
  return { ex: ax + ux * a - uy * h, ey: ay + uy * a + ux * h, wx: ax + dx, wy: ay + dy };
}

/**
 * Brazo con el codo lo más cerca posible de `px, py`. El brazo se ve de frente, así que un hueso que apunta
 * hacia la cámara se ve más corto: el codo puede estar en cualquier punto a su alcance desde el hombro y desde
 * la muñeca. Es el punto de esa zona más cercano al de referencia, así que se mueve siempre de forma continua:
 * nunca da la vuelta ni se dobla al revés, y una mano en la boca deja el codo abajo, como en la realidad.
 */
export function reachElbow(ax: number, ay: number, tx: number, ty: number, l1: number, l2: number, px: number, py: number): Limb {
  const full = solveLimb(ax, ay, tx, ty, l1, l2, 1);
  const { wx, wy } = full;
  const inA = (x: number, y: number) => Math.hypot(x - ax, y - ay) <= l1 + 0.01;
  const inT = (x: number, y: number) => Math.hypot(x - wx, y - wy) <= l2 + 0.01;
  if (inA(px, py) && inT(px, py)) return { ex: px, ey: py, wx, wy };
  const toward = (cx: number, cy: number, r: number) => {
    const d = Math.hypot(px - cx, py - cy) || 0.001;
    return [cx + ((px - cx) / d) * r, cy + ((py - cy) / d) * r];
  };
  const [qx, qy] = toward(ax, ay, l1);
  if (inT(qx, qy)) return { ex: qx, ey: qy, wx, wy };
  const [rx, ry] = toward(wx, wy, l2);
  if (inA(rx, ry)) return { ex: rx, ey: ry, wx, wy };
  // Sin holgura: el brazo va entero y solo queda elegir el lado
  const other = solveLimb(ax, ay, tx, ty, l1, l2, -1);
  return Math.hypot(full.ex - px, full.ey - py) <= Math.hypot(other.ex - px, other.ey - py) ? full : other;
}

const f = (n: number) => n.toFixed(1);
const deg = (y: number, x: number) => (Math.atan2(y, x) * 180) / Math.PI;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Línea paralela a un miembro doblado (las rayas del chándal): rodea el codo por fuera y se recorta por dentro */
export function offsetLimb(ax: number, ay: number, l: Limb, off: number): string {
  const unit = (x: number, y: number) => {
    const m = Math.hypot(x, y) || 1;
    return [x / m, y / m];
  };
  const [u1x, u1y] = unit(l.ex - ax, l.ey - ay);
  const [u2x, u2y] = unit(l.wx - l.ex, l.wy - l.ey);
  const start = `M${f(ax - u1y * off)} ${f(ay + u1x * off)}`;
  const end = `${f(l.wx - u2y * off)} ${f(l.wy + u2x * off)}`;
  const turn = (-u1y * u2x + u1x * u2y) * off;
  if (turn <= 0) {
    // Por fuera de la curva: arco alrededor del codo
    const r = Math.abs(off);
    const sweep = u1x * u2y - u1y * u2x > 0 ? 1 : 0;
    return `${start}L${f(l.ex - u1y * off)} ${f(l.ey + u1x * off)}A${r} ${r} 0 0 ${sweep} ${f(l.ex - u2y * off)} ${f(l.ey + u2x * off)}L${end}`;
  }
  const [mx, my] = unit(-u1y - u2y, u1x + u2x);
  const k = off / Math.max(0.6, mx * -u1y + my * u1x);
  return `${start}L${f(l.ex + mx * k)} ${f(l.ey + my * k)}L${end}`;
}

/* ---------------- Muelles ---------------- */

type Spring = [stiffness: number, damping: number];
const SOFT: Spring = [95, 13];
const BODY: Spring = [150, 18];
const ARM: Spring = [190, 21];
const FOOT: Spring = [620, 48];
const SNAP: Spring = [340, 20];
const TIGHT: Spring = [1100, 66];
const springFor = (key: keyof Pose): Spring => {
  if (key.startsWith('foot') || key.startsWith('toe') || key.startsWith('knee') || key.startsWith('dir')) return FOOT;
  if (key.startsWith('prop') || key.startsWith('lift') || key === 'puff') return SNAP;
  if (key.startsWith('hand') || key.startsWith('pole') || key.startsWith('palm') || key.startsWith('tilt')) return ARM;
  if (key === 'head' || key === 'turn' || key === 'nod' || key === 'wind') return SOFT;
  return BODY;
};
const KEYS = Object.keys(REST) as (keyof Pose)[];
const SPRINGS = KEYS.map(springFor);

/* ---------------- Reloj compartido: un solo requestAnimationFrame para todos los avatares ---------------- */
const running = new Set<CoachRig>();
let raf = 0;
let last = 0;
/**
 * En teléfonos y equipos modestos el personaje se dibuja a ~30 fps en vez de a 60: cada fotograma reescribe
 * decenas de atributos del SVG y, a 60, competía con el desplazamiento y las animaciones de la página (tirones).
 * Los muelles integran con el tiempo real transcurrido, así que el movimiento es el mismo, solo con menos pasos.
 */
const MIN_FRAME_MS = isLowPowerDevice() ? 1000 / 31 : 0;
function frame(now: number) {
  if (MIN_FRAME_MS && now - last < MIN_FRAME_MS) {
    raf = running.size ? requestAnimationFrame(frame) : 0;
    return;
  }
  const dt = Math.min(1 / 24, (now - last) / 1000 || 1 / 60);
  last = now;
  // Con la app en segundo plano no se dibuja nada (el navegador ya frena requestAnimationFrame, esto lo asegura)
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') running.forEach((r) => r.step(now, dt));
  raf = running.size ? requestAnimationFrame(frame) : 0;
}

interface ArmParts {
  group: Element | null;
  sleeve: Element | null;
  edge: Element | null;
  fore: Element | null;
  stripe: Element | null;
  cuff: Element | null;
  wrist: Element | null;
  hand: Element | null;
  shapes: Partial<Record<HandShape, Element | null>>;
  prop: Element | null;
  items: Partial<Record<PropName, Element | null>>;
}
interface LegParts {
  leg: Element | null;
  stripe: Element | null;
  foot: Element | null;
}

export interface PonyShape {
  /** Nudo de la coleta y punta en reposo, en el marco de la cabeza */
  bx: number;
  by: number;
  tx: number;
  ty: number;
  /** Grosor junto al nudo */
  w: number;
}

const PROP_NAMES: PropName[] = ['dumbbell', 'sign', 'gift', 'crate', 'coin', 'receipt', 'clipboard', 'flaskBlue', 'flaskGreen', 'flaskOrange', 'tube'];
const SHAPES: HandShape[] = ['fist', 'open', 'point'];
const PART_NAMES = [
  'world',
  'shadow',
  'torso',
  'chest',
  'chest2',
  'tail',
  'whistle',
  'cord',
  'head',
  'face',
  'hair',
  'earL',
  'earR',
  'pony',
  'ponyLight',
  'tuft',
  'pupilL',
  'pupilR',
  'slotBack',
  'slotFront',
  'fxNotes',
  'fxSparkles',
  'cheek',
];

/** Límite de la mirada en unidades del dibujo */
const LOOK = { x: 6.5, y: 6 };

/** Silbato colgado del cuello y su boca, en el marco del tronco y de la cabeza */
const WHISTLE_CHEST = { x: 5, y: -262 };
const WHISTLE_MOUTH = { x: 26, y: -372 };

export class CoachRig {
  private cur: Pose = { ...REST };
  private vel = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<keyof Pose, number>;
  private flags: Flags = { ...REST_FLAGS };
  private clip: { name: CoachGesture; t0: number } | null = null;
  private written = new WeakMap<Element, Record<string, string>>();
  private lookX = 0;
  private lookY = 0;
  private gazeX = 0;
  private gazeY = 0;
  private voice = 0;
  private talking = false;
  private calm = false;
  /** Avanza el motor sin tocar el dibujo */
  private quiet = false;
  private visible = true;
  private pony = { x: 0, y: 0, vx: 0, vy: 0 };
  /** Silbato: sigue a su sitio (cuello, mano o boca) sin saltos, en el marco del tronco */
  private whistle = { x: WHISTLE_CHEST.x, y: WHISTLE_CHEST.y, a: 0 };
  /** Lado del pulgar (1 o -1, pasa por 0 al girar la muñeca) y punto de agarre de la mano derecha */
  private thumb = { L: 1, R: 1 };
  private thumbGoal = { L: 1, R: 1 };
  private gripR = { x: 0, y: 0 };
  private ponyShape: PonyShape | null = null;
  private armL!: ArmParts;
  private armR!: ArmParts;
  private legL!: LegParts;
  private legR!: LegParts;
  private parts: Record<string, Element | null> = {};
  private observer: IntersectionObserver | null = null;
  private svg: SVGSVGElement | null = null;

  /** Avisa de la cara que pide el gesto en curso (null = la que toque por fuera) */
  onFace: (face: CoachExpression | null) => void = () => {};

  /** Conecta el motor al SVG; se repite cuando cambian las piezas (ropa, género o encuadre) */
  bind(svg: SVGSVGElement, pony: PonyShape | null) {
    this.svg = svg;
    this.ponyShape = pony;
    this.written = new WeakMap();
    if (pony) this.pony = { x: pony.tx, y: pony.ty, vx: 0, vy: 0 };
    const q = (n: string) => svg.querySelector(`[data-rig="${n}"]`);
    this.parts = Object.fromEntries(PART_NAMES.map((n) => [n, q(n)]));
    const arm = (s: 'L' | 'R'): ArmParts => ({
      group: q(`arm${s}`),
      sleeve: q(`sleeve${s}`),
      edge: q(`edge${s}`),
      fore: q(`fore${s}`),
      stripe: q(`armStripe${s}`),
      cuff: q(`cuff${s}`),
      wrist: q(`wrist${s}`),
      hand: q(`hand${s}`),
      shapes: Object.fromEntries(SHAPES.map((h) => [h, q(`${h}${s}`)])),
      prop: q(`prop${s}`),
      items: Object.fromEntries(PROP_NAMES.map((p) => [p, q(`${p}${s}`)])),
    });
    this.armL = arm('L');
    this.armR = arm('R');
    const leg = (s: 'L' | 'R'): LegParts => ({ leg: q(`leg${s}`), stripe: q(`legStripe${s}`), foot: q(`foot${s}`) });
    this.legL = leg('L');
    this.legR = leg('R');
    this.applyFlags();
    this.render(performance.now());
  }

  start() {
    this.calm = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.svg && typeof IntersectionObserver !== 'undefined') {
      this.observer?.disconnect();
      this.observer = new IntersectionObserver((entries) => {
        this.visible = entries[entries.length - 1].isIntersecting;
        this.syncRunning();
      });
      this.observer.observe(this.svg);
    }
    this.syncRunning();
  }

  stop() {
    this.observer?.disconnect();
    this.observer = null;
    running.delete(this);
  }

  private syncRunning() {
    if (this.visible) {
      running.add(this);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    } else running.delete(this);
  }

  /** Reproduce un gesto; lo que esté haciendo enlaza con él sin cortes */
  play(name: CoachGesture) {
    if (this.calm) return;
    this.clip = { name, t0: performance.now() };
  }

  get busy() {
    return this.clip !== null;
  }

  setLook(x: number, y: number) {
    this.lookX = x;
    this.lookY = y;
  }

  setVoice(level: number) {
    this.voice = level;
  }

  setTalking(on: boolean) {
    this.talking = on;
    if (!on) this.voice = 0;
  }

  /** Coloca un gesto en un instante (0 a 1) tal como se vería al reproducirlo, muelles incluidos */
  freeze(name: CoachGesture, at: number) {
    this.stop();
    this.cur = { ...REST };
    KEYS.forEach((k) => (this.vel[k] = 0));
    this.clip = { name, t0: 0 };
    this.quiet = true;
    const end = at * CLIPS[name].dur;
    for (let t = 0; t <= end; t += 1000 / 60) this.step(t, 1 / 60);
    this.quiet = false;
    this.clip = null;
    this.onFace(this.flags.face);
    this.applyFlags();
    this.render(end);
  }

  /** Un paso del motor; lo llama el reloj compartido */
  step(now: number, dt: number) {
    const target: Pose = { ...REST };
    let flags = REST_FLAGS;
    let energy = 1;
    let live: Partial<Pose> | undefined;
    if (this.clip) {
      const clip = CLIPS[this.clip.name];
      const t = now - this.clip.t0;
      if (t >= clip.dur) this.clip = null;
      else {
        const s = clip.sample(t);
        Object.assign(target, s.pose);
        flags = s.flags;
        live = s.live;
        energy = live ? 0.15 : 0.45;
      }
    }

    if (!this.calm) {
      const s = now / 1000;
      // Reposo: respira, carga el peso de una pierna a otra y los brazos se mecen
      const sway = Math.sin(s * 0.62) + 0.45 * Math.sin(s * 1.41 + 1);
      target.x += 7 * sway * energy;
      target.lean += 0.9 * sway * energy;
      target.head += (1.6 * Math.sin(s * 0.83 + 2) - 0.9 * sway) * energy;
      target.y += (1.6 * Math.sin(s * 1.6) + 1.2) * energy;
      target.handLX += 3.5 * Math.sin(s * 0.91) * energy;
      target.handRX += 3.5 * Math.sin(s * 0.77 + 1) * energy;
      target.handLY += 2.5 * Math.sin(s * 1.6 + 0.4) * energy;
      target.handRY += 2.5 * Math.sin(s * 1.6 + 0.4) * energy;
      if (this.talking) {
        // La voz empuja la cabeza: asiente con las sílabas fuertes
        target.nod += this.voice * 0.5;
        target.head += this.voice * 3.2 * Math.sin(s * 3.3);
        target.turn += 0.14 * Math.sin(s * 1.9);
      }
    }
    if (!flags.gaze) {
      target.turn += this.lookX * 0.34;
      target.nod += this.lookY * 0.22;
      target.head += this.lookX * 1.8;
    }

    const steps = dt > 1 / 90 ? Math.ceil(dt * 120) : 1;
    const h = dt / steps;
    for (let n = 0; n < steps; n++) {
      for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i];
        const [k, c] = live && key in live ? TIGHT : SPRINGS[i];
        const accel = k * (target[key] - this.cur[key]) - c * this.vel[key];
        this.vel[key] += accel * h;
        this.cur[key] += this.vel[key] * h;
      }
    }

    // Mirada: rápida, como las sacadas de los ojos
    const gx = flags.gaze ? flags.gaze[0] : this.lookX;
    const gy = flags.gaze ? flags.gaze[1] : this.lookY;
    const eye = 1 - Math.exp(-dt * 26);
    this.gazeX += (gx - this.gazeX) * eye;
    this.gazeY += (gy - this.gazeY) * eye;

    this.stepPony(now, dt);

    const wrist = 1 - Math.exp(-dt * 24);
    this.thumb.L += (this.thumbGoal.L - this.thumb.L) * wrist;
    this.thumb.R += (this.thumbGoal.R - this.thumb.R) * wrist;

    if (flags !== this.flags) {
      const faceChanged = flags.face !== this.flags.face;
      this.flags = flags;
      if (!this.quiet) {
        this.applyFlags();
        if (faceChanged) this.onFace(flags.face);
      }
    }
    this.solveArm(this.cur, -1);
    this.solveArm(this.cur, 1);
    this.stepWhistle(dt);
    if (!this.quiet) this.render(now);
  }

  /** Silbato: va hacia su sitio deprisa pero sin saltar; así viaja de verdad en la mano hasta la boca */
  private stepWhistle(dt: number) {
    const p = this.cur;
    const w = this.whistle;
    const where = this.flags.whistle;
    let x = WHISTLE_CHEST.x + p.twist * 13 - this.vel.x * 0.05;
    let y = WHISTLE_CHEST.y;
    let a = this.vel.x * -0.1;
    if (where === 'hand') {
      x = this.gripR.x;
      y = this.gripR.y;
      a = 0;
    } else if (where === 'mouth') {
      // La boca gira con la cabeza alrededor del cuello
      const r = (p.head * Math.PI) / 180;
      const mx = WHISTLE_MOUTH.x + p.turn * 20;
      const my = WHISTLE_MOUTH.y + p.nod * 14 - RIG.neckY;
      x = mx * Math.cos(r) - my * Math.sin(r);
      y = mx * Math.sin(r) + my * Math.cos(r) + RIG.neckY;
      a = p.head;
    }
    const k = 1 - Math.exp(-dt * 34);
    w.x += (x - w.x) * k;
    w.y += (y - w.y) * k;
    w.a += (a - w.a) * k;
  }

  /** Coleta: una masa con muelle sujeta a la cabeza que sigue el movimiento con retraso */
  private stepPony(now: number, dt: number) {
    const shape = this.ponyShape;
    if (!shape) return;
    const p = this.pony;
    const wind = this.cur.wind;
    const tx = shape.tx - wind * (shape.tx + 215) + 5 * Math.sin(now / 900);
    const ty = shape.ty - wind * 100;
    const ax = 58 * (tx - p.x) - 6.5 * p.vx - this.vel.x * 9 - this.vel.head * 24;
    const ay = 58 * (ty - p.y) - 6.5 * p.vy - this.vel.y * 7;
    p.vx += ax * dt;
    p.vy += ay * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  /** Solo escribe lo que cambia: en reposo fijo no hay repintados */
  private put(el: Element | null | undefined, attr: string, value: string) {
    if (!el) return;
    let seen = this.written.get(el);
    if (!seen) this.written.set(el, (seen = {}));
    if (seen[attr] === value) return;
    seen[attr] = value;
    el.setAttribute(attr, value);
  }

  /** Muestra u oculta una pieza; con `.on` sus animaciones CSS corren solo mientras se ve */
  private show(el: Element | null | undefined, on: boolean) {
    this.put(el, 'display', on ? 'inline' : 'none');
    this.put(el, 'class', on ? 'on' : '');
  }

  /** Aplica los estados discretos: forma de las manos, objetos, capas y efectos */
  private applyFlags() {
    const fl = this.flags;
    const side = (arm: ArmParts, grip: HandShape, item: PropName | null, front: boolean) => {
      SHAPES.forEach((h) => this.put(arm.shapes[h], 'display', h === grip ? 'inline' : 'none'));
      PROP_NAMES.forEach((p) => this.show(arm.items[p], p === item));
      // SVG no tiene z-index: el brazo se muda de capa
      const slot = front ? this.parts.slotFront : this.parts.slotBack;
      if (arm.group && slot && arm.group.parentNode !== slot) slot.appendChild(arm.group);
    };
    side(this.armL, fl.gripL, fl.itemL, fl.frontL);
    side(this.armR, fl.gripR, fl.itemR, fl.frontR);
    const top = fl.over === 'L' ? this.armL : this.armR;
    if (fl.frontL && fl.frontR && top.group && top.group.nextSibling) this.parts.slotFront?.appendChild(top.group);
    this.show(this.parts.fxNotes, fl.fx === 'notes');
    this.show(this.parts.fxSparkles, fl.fx === 'sparkles');
  }

  /** Resuelve un brazo, decide el lado del pulgar y guarda el punto de agarre */
  private solveArm(p: Pose, side: 1 | -1): Limb {
    const R = side > 0;
    const sx = side * p.shW;
    const sy = RIG.shoulderY;
    const hx = R ? p.handRX : p.handLX;
    const hy = R ? p.handRY : p.handLY;
    const l = reachElbow(sx, sy, hx, hy, RIG.upperArm, RIG.foreArm, R ? p.poleRX : p.poleLX, R ? p.poleRY : p.poleLY);
    const angle = ((deg(l.wy - l.ey, l.wx - l.ex) - 90 + (R ? p.palmR : p.palmL)) * Math.PI) / 180;
    // Pulgar arriba o, con la mano en vertical, hacia la cabeza: es como se ve una mano real en cualquier postura
    const tx = -Math.cos(angle) * side;
    const ty = -Math.sin(angle) * side;
    const score = -ty - 0.5 * side * tx;
    const key = R ? 'R' : 'L';
    if (Math.abs(score) > 0.12) this.thumbGoal[key] = score > 0 ? 1 : -1;
    if (R) {
      this.gripR.x = l.wx - Math.sin(angle) * RIG.grip;
      this.gripR.y = l.wy + Math.cos(angle) * RIG.grip;
    }
    return l;
  }

  private drawArm(arm: ArmParts, side: 1 | -1, p: Pose) {
    if (!arm.group) return;
    const R = side > 0;
    const sx = side * p.shW;
    const sy = RIG.shoulderY;
    const l = this.solveArm(p, side);
    const whole = `M${f(sx)} ${f(sy)}L${f(l.ex)} ${f(l.ey)}L${f(l.wx)} ${f(l.wy)}`;
    if (arm.fore) {
      // Manga remangada: la tela acaba antes del codo y sigue el brazo desnudo
      const cx = sx + (l.ex - sx) * 0.74;
      const cy = sy + (l.ey - sy) * 0.74;
      this.put(arm.sleeve, 'd', `M${f(sx)} ${f(sy)}L${f(cx)} ${f(cy)}`);
      this.put(arm.fore, 'd', `M${f(cx)} ${f(cy)}L${f(l.ex)} ${f(l.ey)}L${f(l.wx)} ${f(l.wy)}`);
      this.put(arm.cuff, 'transform', `translate(${f(cx)} ${f(cy)})rotate(${f(deg(l.ey - sy, l.ex - sx) - 90)})`);
    } else this.put(arm.sleeve, 'd', whole);
    this.put(arm.edge, 'd', whole);
    if (arm.stripe) this.put(arm.stripe, 'd', offsetLimb(sx, sy, l, -side * 11));

    const foreAngle = deg(l.wy - l.ey, l.wx - l.ex) - 90;
    const palm = R ? p.palmR : p.palmL;
    const thumb = this.thumb[R ? 'R' : 'L'];
    const turned = Math.abs(thumb) < 0.6 ? 0.6 * (thumb < 0 ? -1 : 1) : thumb;
    this.put(arm.wrist, 'transform', `translate(${f(l.wx)} ${f(l.wy)})rotate(${f(foreAngle)})`);
    this.put(arm.hand, 'transform', `rotate(${f(palm)})scale(${((R ? 1 : -1) * turned).toFixed(2)} 1)`);

    const handAngle = ((foreAngle + palm + 90) * Math.PI) / 180;
    const gx = l.wx + Math.cos(handAngle) * RIG.grip;
    const gy = l.wy + Math.sin(handAngle) * RIG.grip;
    const scale = Math.max(0, R ? p.propR : p.propL);
    const lift = R ? p.liftR : p.liftL;
    // Lo que se lanza gira en el aire
    this.put(arm.prop, 'transform', `translate(${f(gx)} ${f(gy - lift)})rotate(${f(R ? p.tiltR : p.tiltL)})scale(${(scale * Math.cos(lift * 0.12)).toFixed(3)} ${scale.toFixed(3)})`);
  }

  private drawLeg(leg: LegParts, side: 1 | -1, p: Pose) {
    if (!leg.leg) return;
    const R = side > 0;
    const hx = p.x + side * p.hipW;
    const hy = p.y + RIG.hipY;
    const l = solveLimb(hx, hy, R ? p.footRX : p.footLX, R ? p.footRY : p.footLY, RIG.thigh, RIG.shin, (R ? p.kneeR : p.kneeL) * -side);
    this.put(leg.leg, 'd', `M${f(hx)} ${f(hy)}L${f(l.ex)} ${f(l.ey)}L${f(l.wx)} ${f(l.wy)}`);
    if (leg.stripe) this.put(leg.stripe, 'd', offsetLimb(hx, hy, l, -side * 12));
    const dir = R ? p.dirR : p.dirL;
    const sx = Math.abs(dir) < 0.15 ? 0.15 * (dir < 0 ? -1 : 1) : dir;
    // De perfil el pie acompaña a la espinilla; en el suelo solo apoya talón o punta, y de frente queda plano
    const shin = wrap(deg(l.wy - l.ey, l.wx - l.ex) - 90);
    const air = clamp01((-(R ? p.footRY : p.footLY) - REST.footRY * -1 - 2) / 26);
    const profile = clamp01((REST.hipW - p.hipW) / 18);
    const planted = Math.max(-26, Math.min(38, shin)) * 0.75;
    const side3 = (planted + (shin + 10 - planted) * air) * profile + dir * 14 * air * (1 - profile);
    this.put(leg.foot, 'transform', `translate(${f(l.wx)} ${f(l.wy)})rotate(${f(side3 + (R ? p.toeR : p.toeL))})scale(${sx.toFixed(2)} 1)`);
  }

  private render(now: number) {
    const p = this.cur;
    const parts = this.parts;
    this.put(parts.world, 'transform', `scale(${(1 + p.squash * 0.5).toFixed(3)} ${(1 - p.squash).toFixed(3)})`);
    const lift = Math.max(0, -Math.min(p.footLY, p.footRY) - 31);
    this.put(parts.shadow, 'transform', `translate(${f(p.x * 0.6)} 0)scale(${(1 - Math.min(0.4, lift / 240)).toFixed(3)} 1)`);
    this.drawLeg(this.legR, 1, p);
    this.drawLeg(this.legL, -1, p);

    const breath = this.calm ? 0 : 0.009 * Math.sin(now / 625);
    this.put(
      parts.torso,
      'transform',
      `translate(${f(p.x)} ${f(p.y)})rotate(${f(p.lean)} 0 ${RIG.hipY})translate(0 ${RIG.hipY})scale(1 ${(1 + breath).toFixed(4)})translate(0 ${-RIG.hipY})`,
    );
    const chest = `translate(${f(p.twist * 13)} 0)`;
    this.put(parts.chest, 'transform', chest);
    this.put(parts.chest2, 'transform', chest);
    this.put(parts.tail, 'transform', `translate(0 -232)skewX(${f(p.wind * 24 + this.vel.x * -0.06)})translate(0 232)`);

    this.drawArm(this.armL, -1, p);
    this.drawArm(this.armR, 1, p);

    const w = this.whistle;
    this.put(parts.whistle, 'transform', `translate(${f(w.x)} ${f(w.y)})rotate(${f(w.a)})`);
    const sag = Math.max(0, w.y + 300) * 0.3;
    this.put(parts.cord, 'd', `M-30 -333Q${f(w.x * 0.2 - 26)} ${f((w.y - 333) / 2 + 14 + sag)} ${f(w.x - 3)} ${f(w.y)}M30 -333Q${f(w.x * 0.2 + 26)} ${f((w.y - 333) / 2 + 14 + sag)} ${f(w.x + 3)} ${f(w.y)}`);

    this.put(parts.head, 'transform', `rotate(${f(p.head)} 0 ${RIG.neckY})translate(0 ${f(p.nod * 5)})`);
    this.put(parts.face, 'transform', `translate(${f(p.turn * 20)} ${f(p.nod * 9)})`);
    this.put(parts.hair, 'transform', `translate(${f(p.turn * 7)} ${f(p.nod * 3)})`);
    this.put(parts.earL, 'transform', `translate(${f(p.turn * 13)} 0)`);
    this.put(parts.earR, 'transform', `translate(${f(p.turn * 13)} 0)`);
    this.put(parts.tuft, 'transform', `rotate(${f(this.vel.x * -0.1 + this.vel.head * -1.1 + p.wind * -9)} 6 -528)`);
    if (parts.cheek) (parts.cheek as SVGElement).style.setProperty('--puff', p.puff.toFixed(2));

    const look = `translate(${f(this.gazeX * LOOK.x)} ${f(this.gazeY * LOOK.y)})`;
    this.put(parts.pupilL, 'transform', look);
    this.put(parts.pupilR, 'transform', look);

    const shape = this.ponyShape;
    if (shape && parts.pony) {
      const { x, y } = this.pony;
      const { bx, by, w } = shape;
      // Sube desde el nudo, se abomba hacia fuera y cae hasta la punta, que sigue a la masa.
      // El grosor va perpendicular al recorrido: la coleta conserva su cuerpo también ondeando de lado
      const dx = x - bx;
      const dy = y - by;
      const d = Math.hypot(dx, dy) || 1;
      // Al correr la coleta se levanta sobre la cabeza y engorda: se ve entera en vez de quedar tapada por el pelo
      const flow = clamp01(p.wind);
      const nx = (-dy / d) * w * (1.25 + 0.75 * flow);
      const ny = (dx / d) * w * (1.25 + 0.75 * flow);
      const out = Math.max(-1, Math.min(1, dx / 70));
      const c1x = bx + 58 * out + (x - shape.tx) * 0.12;
      const c1y = by - 26 - 46 * flow;
      const c2x = x + 22 * out;
      const c2y = y - 92 + Math.abs(dx) * 0.28 * (1 - flow);
      const edge = `M${f(bx - w)} ${f(by + 6)}C${f(c1x + nx)} ${f(c1y + ny)} ${f(c2x + nx)} ${f(c2y + ny)} ${f(x)} ${f(y)}C${f(c2x - nx)} ${f(c2y - ny)} ${f(c1x - nx)} ${f(c1y - ny)} ${f(bx + w * 0.7)} ${f(by - 8)}Z`;
      this.put(parts.pony, 'd', edge);
      this.put(parts.ponyLight, 'd', `M${f(bx + 6 * out)} ${f(by - 6)}C${f(c1x)} ${f(c1y + 4)} ${f(c2x + 4 * out)} ${f(c2y + 4)} ${f(x + (c2x - x) * 0.3)} ${f(y - 34)}`);
    }
  }
}
