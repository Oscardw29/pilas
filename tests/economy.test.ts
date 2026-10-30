import { describe, expect, it } from 'vitest';
import type { Habit, HabitLog } from '@/types';
import { boostPrice, dayCoins, dayXp, dayXpCap, freezePrice, habitCoinValue, logBaseXp, logCoins, rewardEquivalence, timeHabitCoins } from '@/lib/economyRules';
import { boostOffer, economySummary, freezeOffer, isBackdated } from '@/lib/economy';
import { createEmptyData } from '@/data/seed';

const RATIO = 0.4;
const action = (points: number): Habit => ({ id: `a${points}`, kind: 'action', points } as Habit);
const time = (targetMinutes: number): Habit => ({ id: `t${targetMinutes}`, kind: 'time', points: 0, targetMinutes } as Habit);
const qty = (points: number, targetQuantity: number): Habit => ({ id: `q${points}`, kind: 'quantity', points, targetQuantity } as Habit);

/** Suma un día como en los ejemplos del documento */
function day(items: { h: Habit; status?: HabitLog['status']; minutes?: number; quantity?: number }[], streak: number, perfect: boolean) {
  const coins = items.reduce((s, i) => s + logCoins(i.h, i.status ?? 'full', i, RATIO), 0);
  const entries = items.map((i) => ({ xp: logBaseXp(i.h, i.status ?? 'full', i, RATIO), boosted: false }));
  return { coins: dayCoins(coins), xp: dayXp({ entries, streak, perfect }) };
}

describe('reglas de monedas y XP (ejemplos del documento, en enteros)', () => {
  it('fórmula de monedas de tiempo (redondeada al entero)', () => {
    expect(timeHabitCoins(10)).toBe(10);
    expect(timeHabitCoins(60)).toBe(35);
    expect(timeHabitCoins(45)).toBe(28); // 27,5 → 28
    expect(timeHabitCoins(200)).toBe(50);
    expect(timeHabitCoins(2)).toBe(10);
  });

  it('Ejemplo 1: usuario casual, racha de 3 → 40 monedas y 117 XP', () => {
    const r = day([{ h: action(10) }, { h: time(10), minutes: 10 }, { h: qty(20, 8), quantity: 8 }], 3, true);
    expect(r.coins).toBe(40);
    expect(r.xp).toBe(117); // 84 × 1,03 + 30 = 116,52
  });

  it('Ejemplo 2: usuario constante, racha de 15 → 113 monedas y 319 XP', () => {
    const r = day(
      [{ h: time(60), minutes: 60 }, { h: time(45), minutes: 45 }, { h: qty(30, 10), quantity: 10 }, { h: action(10) }, { h: { ...action(10), id: 'a10b' } }],
      15,
      true,
    );
    expect(r.coins).toBe(113); // 35 + 28 + 30 + 10 + 10
    expect(r.xp).toBe(319); // (90 + 68 + 45 + 24 + 24) × 1,15 + 30 = 318,65
  });

  it('Ejemplo 3: día flojo, racha de 15 → 53 monedas y 133 XP', () => {
    const r = day(
      [{ h: time(60), status: 'minimum', minutes: 30 }, { h: qty(30, 10), status: 'minimum', quantity: 5 }, { h: action(10) }, { h: { ...action(10), id: 'x' } }],
      15,
      false,
    );
    expect(r.coins).toBe(53); // 18 (17,5) + 15 + 10 + 10
    expect(r.xp).toBe(133); // (45 + 23 + 24 + 24) × 1,15 = 133,4
  });

  it('Ejemplo 4: abuso con 25 acciones a +30 → 200 monedas (tope) y 192 XP de base (solo 8 cuentan)', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ h: { ...action(30), id: `abuse${i}` } }));
    const r = day(items, 0, false);
    expect(r.coins).toBe(200);
    expect(r.xp).toBe(192);
  });

  it('los chips no pasan del máximo por tipo', () => {
    expect(logCoins(action(50), 'full', undefined, RATIO)).toBe(30);
    expect(logCoins(qty(50, 10), 'full', { quantity: 10 }, RATIO)).toBe(40);
  });

  it('tiempo: menos de 5 minutos no da XP y la sesión se topa en 3 h', () => {
    expect(logBaseXp(time(4), 'full', { minutes: 4 }, RATIO)).toBe(0);
    expect(logBaseXp(time(300), 'full', { minutes: 400 }, RATIO)).toBe(90);
  });

  it('el protector de racha da 0 XP ese día', () => {
    expect(dayXp({ entries: [{ xp: 24, boosted: false }], streak: 10, perfect: false, frozen: true })).toBe(0);
  });

  it('el multiplicador 1.5× multiplica la XP de lo marcado con él y sube el tope a 1200 de base', () => {
    expect(dayXp({ entries: [{ xp: 90, boosted: true }], streak: 0, perfect: false })).toBe(135);
    const big = Array.from({ length: 8 }, () => ({ xp: 150, boosted: true }));
    expect(dayXp({ entries: big, streak: 0, perfect: false })).toBe(1200);
    expect(dayXp({ entries: big, streak: 30, perfect: true })).toBe(1590);
    // Cada hábito con multiplicador se redondea al aplicarlo: 45 × 1,5 = 67,5 → 68
    expect(dayXp({ entries: [{ xp: 45, boosted: true }], streak: 0, perfect: false })).toBe(68);
  });

  it('ni las monedas ni la XP tienen decimales', () => {
    // Versión mínima de una acción: 24 × 0,4 = 9,6 → 10 XP; 15 × 0,4 = 6 monedas
    expect(logBaseXp(action(10), 'minimum', undefined, RATIO)).toBe(10);
    expect(logCoins(action(15), 'minimum', undefined, RATIO)).toBe(6);
    // Tiempo: 1,5 × 45 = 67,5 → 68 XP; mitad de un hábito de 28 monedas = 14
    expect(logBaseXp(time(45), 'full', { minutes: 45 }, RATIO)).toBe(68);
    expect(logCoins(time(45), 'minimum', { minutes: 22.5 }, RATIO)).toBe(14);
    // Cantidad: 45 × 3/8 = 16,875 → 17
    expect(logBaseXp(qty(20, 8), 'minimum', { quantity: 3 }, RATIO)).toBe(17);
    // Un chip guardado con decimales (versión antigua) cuenta entero
    expect(habitCoinValue({ kind: 'action', points: 12.5 })).toBe(13);
    // Topes y precios
    expect(dayCoins(37.5)).toBe(38);
    expect(Number.isInteger(dayXpCap(false))).toBe(true);
    expect(Number.isInteger(dayXpCap(true))).toBe(true);
    expect(freezePrice(62.3)).toBe(125);
    expect(boostPrice(62.3)).toBe(125);
    for (let streak = 0; streak <= 30; streak += 7) {
      const xp = dayXp({ entries: [{ xp: 17, boosted: true }, { xp: 9, boosted: false }], streak, perfect: streak > 10 });
      expect(Number.isInteger(xp)).toBe(true);
    }
  });

  it('Ejemplo 6: precio del protector según el ritmo (casual 100, constante 200)', () => {
    expect(freezePrice(40)).toBe(100);
    expect(freezePrice(100)).toBe(200);
    expect(freezePrice(1000)).toBe(600);
  });

  it('equivalencia de premios propios', () => {
    expect(rewardEquivalence(300, 100, 10)).toEqual({ kind: 'ok', days: 3 });
    expect(rewardEquivalence(50, 100, 10)).toEqual({ kind: 'too-easy', days: 0.5 });
    expect(rewardEquivalence(7000, 100, 10)).toEqual({ kind: 'too-far', days: 70 });
    expect(rewardEquivalence(300, 100, 2)).toEqual({ kind: 'no-history' });
  });
});

describe('economía sobre el historial', () => {
  const T = '2026-10-20';
  const data = () => {
    const d = createEmptyData();
    d.settings.economyStartDate = '2026-10-15';
    d.habits = [{ ...action(30), id: 'h1', name: 'A', days: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01' } as Habit];
    return d;
  };
  const log = (date: string, points: number, loggedAt = `${date}T10:00:00.000Z`): HabitLog => ({ habitId: 'h1', date, status: 'full', points, loggedAt });

  it('el historial anterior conserva su saldo; desde la fecha de inicio rige el tope diario', () => {
    const d = data();
    d.logs = { a: log('2026-10-10', 500), b: log('2026-10-16', 500) };
    const s = economySummary(d, T);
    expect(s.fromLogs).toBe(700);
  });

  it('saldo, días y XP total en enteros aunque haya registros antiguos con decimales', () => {
    const d = data();
    d.logs = { a: log('2026-10-10', 27.5), b: log('2026-10-16', 12.5), c: log('2026-10-17', 30) };
    d.pointEvents = [{ id: 'p1', amount: 2.5, reason: 'x', source: 'other', at: '2026-10-17T10:00:00.000Z' }];
    d.redemptions = [{ id: 'r1', rewardId: 'rw', name: 'p', icon: 'x', cost: 10.4, date: '2026-10-18T10:00:00.000Z' }];
    const s = economySummary(d, T);
    expect(s.fromLogs).toBe(28 + 13 + 30);
    expect(s.bonus).toBe(3);
    expect(s.spent).toBe(10);
    expect(s.balance).toBe(71 + 3 - 10);
    expect(Number.isInteger(s.xpTotal)).toBe(true);
    for (const day of s.days.values()) {
      expect(Number.isInteger(day.coins)).toBe(true);
      expect(Number.isInteger(day.xp)).toBe(true);
    }
  });

  it('un registro marcado más de 1 día tarde no da XP', () => {
    expect(isBackdated('2026-10-18', '2026-10-20T10:00:00')).toBe(true);
    expect(isBackdated('2026-10-19', '2026-10-20T10:00:00')).toBe(false);
    const d = data();
    d.logs = { a: log('2026-10-16', 30, '2026-10-19T10:00:00.000Z') };
    expect(economySummary(d, T).xpTotal).toBe(0);
  });

  it('un hábito no da XP el día que se crea', () => {
    const d = data();
    d.habits[0].createdAt = '2026-10-16';
    d.logs = { a: log('2026-10-16', 30), b: log('2026-10-17', 30) };
    const s = economySummary(d, T);
    expect(s.days.get('2026-10-16')?.xp).toBe(0);
    expect(s.days.get('2026-10-17')?.xp).toBeGreaterThan(0);
  });

  it('desmarcar resta: sin el registro desaparecen sus monedas y su XP', () => {
    const d = data();
    d.logs = { a: log('2026-10-17', 30) };
    const before = economySummary(d, T);
    const after = economySummary({ ...d, logs: {} }, T);
    expect(before.balance).toBe(30);
    expect(after.balance).toBe(0);
    expect(after.xpTotal).toBe(0);
  });

  it('protector: máximo 7 compras al mes y 1 guardado', () => {
    const d = data();
    d.redemptions = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, rewardId: 'rw-streak-freeze', name: 'p', icon: '❄️', cost: 100, date: `2026-10-0${i + 1}T10:00:00.000Z` }));
    expect(freezeOffer({ ...d, hasStreakFreeze: false }, new Date('2026-10-20T12:00:00')).blocked).toBe('month-limit');
    expect(freezeOffer({ ...d, redemptions: [], hasStreakFreeze: true }, new Date('2026-10-20T12:00:00')).blocked).toBe('owned');
  });

  it('multiplicador: activo 12 h, espera de 24 h y máximo 4 al mes', () => {
    const d = data();
    const now = Date.parse('2026-10-20T12:00:00.000Z');
    d.xpBoosts = [{ id: 'b1', startedAt: '2026-10-20T06:00:00.000Z', endsAt: '2026-10-20T18:00:00.000Z', cost: 100 }];
    expect(boostOffer(d, now).blocked).toBe('active');
    expect(boostOffer(d, Date.parse('2026-10-20T20:00:00.000Z')).blocked).toBe('cooldown');
    expect(boostOffer(d, Date.parse('2026-10-21T07:00:00.000Z')).blocked).toBe(null);
    d.xpBoosts = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, startedAt: `2026-10-0${i * 2 + 1}T06:00:00.000Z`, endsAt: `2026-10-0${i * 2 + 1}T18:00:00.000Z`, cost: 100 }));
    expect(boostOffer(d, now).blocked).toBe('month-limit');
  });
});
