import { describe, expect, it } from 'vitest';
import { leaderIndex, scientistLine, type LabBrief } from '@/components/lab/labLine';

const brief = (over: Partial<LabBrief> = {}): LabBrief => ({
  name: 'Estudio',
  day: 5,
  durationDays: 14,
  startsIn: 0,
  planned: false,
  paused: false,
  leader: null,
  topPct: 0,
  ...over,
});

describe('leaderIndex', () => {
  it('señala la variante con más adherencia y nada si hay empate', () => {
    expect(leaderIndex([40, 70])).toBe(1);
    expect(leaderIndex([70, 40])).toBe(0);
    expect(leaderIndex([50, 50])).toBe(-1);
    expect(leaderIndex([50])).toBe(-1);
  });
});

describe('scientistLine', () => {
  it('invita a empezar con el laboratorio vacío', () => {
    expect(scientistLine([], 0, null)).toContain('hipótesis');
  });

  it('cuenta los concluidos si no hay nada en curso, con el número bien concordado', () => {
    expect(scientistLine([], 1, null)).toContain('1 experimento concluido');
    expect(scientistLine([], 3, null)).toContain('3 experimentos concluidos');
  });

  it('celebrar la variante adoptada va antes que todo lo demás', () => {
    expect(scientistLine([brief({ paused: true })], 2, 'Por la mañana')).toContain('«Por la mañana»');
  });

  it('avisa de un hábito en pausa antes de hablar de resultados', () => {
    const leader = { label: 'A', pct: 80 };
    expect(scientistLine([brief({ leader, topPct: 80 }), brief({ name: 'Lectura', paused: true })], 0, null)).toContain('«Lectura» está en pausa');
  });

  it('habla del experimento más avanzado', () => {
    const line = scientistLine([brief({ name: 'Corto', day: 2, leader: { label: 'A', pct: 10 }, topPct: 10 }), brief({ name: 'Largo', day: 9, leader: { label: 'B', pct: 60 }, topPct: 60 })], 0, null);
    expect(line).toBe('En «Largo» va ganando «B» con 60%.');
  });

  it('pide elegir ganadora al terminar, pero solo si hay datos', () => {
    expect(scientistLine([brief({ day: 14, topPct: 40 })], 0, null)).toContain('elige la variante ganadora');
    expect(scientistLine([brief({ day: 14, topPct: 0 })], 0, null)).toContain('Faltan datos');
  });

  it('distingue empate de falta de datos', () => {
    expect(scientistLine([brief({ topPct: 50 })], 0, null)).toContain('empatado al 50%');
    expect(scientistLine([brief()], 0, null)).toBe('Día 5 de 14 en «Estudio». Faltan datos: registra una sesión.');
  });

  it('anuncia cuándo arranca lo que está preparado', () => {
    expect(scientistLine([brief({ planned: true, day: 0, startsIn: 1 })], 0, null)).toContain('Arranca mañana');
    expect(scientistLine([brief({ planned: true, day: 0, startsIn: 4 })], 0, null)).toContain('en 4 días');
    expect(scientistLine([brief({ planned: true, startsIn: 0 })], 0, null)).toContain('¡Cuando quieras!');
  });

  it('acorta los nombres largos para que quepan en el bocadillo', () => {
    const line = scientistLine([brief({ name: 'Un experimento con un nombre larguísimo de verdad' })], 0, null);
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(80);
  });
});
