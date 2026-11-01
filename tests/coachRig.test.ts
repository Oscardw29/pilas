import { describe, expect, it } from 'vitest';
import { CLIPS } from '@/components/coach/coachClips';
import { REST, RIG, type CoachGesture } from '@/components/coach/coachPose';
import { reachElbow, solveLimb } from '@/components/coach/coachRig';

const gestures = Object.keys(CLIPS) as CoachGesture[];

describe('solveLimb', () => {
  it('conserva la longitud de los huesos con el miembro doblado del todo', () => {
    const l = solveLimb(0, 0, 60, 90, 90, 88, 1);
    expect(Math.hypot(l.ex, l.ey)).toBeCloseTo(90, 3);
    expect(Math.hypot(l.wx - l.ex, l.wy - l.ey)).toBeCloseTo(88, 3);
  });

  it('se queda estirado si el objetivo está fuera de alcance', () => {
    const l = solveLimb(0, 0, 500, 0, 90, 88, 1);
    expect(l.wx).toBeCloseTo(177.5, 3);
    expect(l.wy).toBeCloseTo(0, 3);
  });

  it('cambiar de lado la articulación pasa por el miembro recto, sin saltos', () => {
    const a = solveLimb(0, 0, 0, 120, 90, 88, 0.01);
    const b = solveLimb(0, 0, 0, 120, 90, 88, -0.01);
    expect(Math.abs(a.ex - b.ex)).toBeLessThan(3);
  });
});

describe('reachElbow', () => {
  const l1 = RIG.upperArm;
  const l2 = RIG.foreArm;

  it('nunca estira un hueso más de lo que mide', () => {
    for (let a = 0; a < 360; a += 15) {
      const tx = 120 * Math.cos((a * Math.PI) / 180);
      const ty = 120 * Math.sin((a * Math.PI) / 180);
      const l = reachElbow(0, 0, tx, ty, l1, l2, 10, 90);
      expect(Math.hypot(l.ex, l.ey)).toBeLessThanOrEqual(l1 + 0.02);
      expect(Math.hypot(l.wx - l.ex, l.wy - l.ey)).toBeLessThanOrEqual(l2 + 0.02);
    }
  });

  it('el codo no salta aunque la mano dé la vuelta entera al hombro', () => {
    let prev = reachElbow(0, 0, 150, 0, l1, l2, 10, 90);
    for (let a = 1; a <= 360; a++) {
      const r = (a * Math.PI) / 180;
      const l = reachElbow(0, 0, 150 * Math.cos(r), 150 * Math.sin(r), l1, l2, 10, 90);
      expect(Math.hypot(l.ex - prev.ex, l.ey - prev.ey), `a ${a}°`).toBeLessThan(40);
      prev = l;
    }
  });

  it('con la mano en la boca el codo queda abajo, sin cruzar el pecho', () => {
    const l = reachElbow(60, RIG.shoulderY, 40, -351, l1, l2, REST.poleRX, REST.poleRY);
    expect(l.ey).toBeGreaterThan(RIG.shoulderY);
    expect(l.ex).toBeGreaterThan(40);
  });
});

describe('gestos', () => {
  it('empiezan y acaban con valores válidos', () => {
    for (const name of gestures) {
      const clip = CLIPS[name];
      for (let t = 0; t <= clip.dur; t += 40) {
        const { pose } = clip.sample(t);
        for (const v of Object.values(pose)) expect(Number.isFinite(v), `${name} a ${t} ms`).toBe(true);
      }
    }
  });

  it('terminan en la postura de reposo con el objeto guardado', () => {
    for (const name of gestures) {
      const clip = CLIPS[name];
      const { pose, flags } = clip.sample(clip.dur);
      expect(pose.propL, name).toBe(0);
      expect(pose.propR, name).toBe(0);
      expect(pose.hipW, name).toBe(REST.hipW);
      expect(pose.footLY, name).toBe(REST.footLY);
      expect(pose.footRY, name).toBe(REST.footRY);
      expect(flags.frontL && flags.frontR, name).toBe(true);
      expect(flags.whistle, name).toBe('chest');
    }
  });

  it('dejan las manos al alcance del brazo y los pies al de la pierna', () => {
    const arm = RIG.upperArm + RIG.foreArm;
    const leg = RIG.thigh + RIG.shin;
    for (const name of gestures) {
      const clip = CLIPS[name];
      for (let t = 0; t <= clip.dur; t += 40) {
        const { pose: p } = clip.sample(t);
        const hy = RIG.hipY + p.y;
        expect(Math.hypot(p.handRX - p.shW, p.handRY - RIG.shoulderY), `${name} a ${t} ms`).toBeLessThan(arm + 8);
        expect(Math.hypot(p.handLX + p.shW, p.handLY - RIG.shoulderY), `${name} a ${t} ms`).toBeLessThan(arm + 8);
        expect(Math.hypot(p.footRX - p.hipW, p.footRY - hy), `${name} a ${t} ms`).toBeLessThan(leg + 12);
        expect(Math.hypot(p.footLX + p.hipW, p.footLY - hy), `${name} a ${t} ms`).toBeLessThan(leg + 12);
      }
    }
  });
});
