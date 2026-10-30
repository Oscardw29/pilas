import { afterEach, describe, expect, it } from 'vitest';
import type { Habit, HabitLog } from '@/types';
import { createEmptyData } from '@/data/seed';
import { economySummary } from '@/lib/economy';
import { ECONOMY, applyEconomyVersions, dayXpCap, paramsFor } from '@/lib/economyRules';
import { baselineFrom, dayRow, publicHabitRows, walletMoves } from '@/social/publish';
import { isAnimatedWebp, isWebp, muxAnimatedWebp, readBytes } from '@/social/images';
import { economyVersionDay } from '@/social/runtime';
import { useStore } from '@/store/useStore';

/**
 * Capa pública en el cliente: lo que se publica, el punto de partida, los movimientos del saldo y la economía por versiones.
 */

const T = '2026-10-21';
const habit = (id: string, extra: Partial<Habit> = {}): Habit =>
  ({ id, name: `Hábito ${id}`, icon: '📚', kind: 'action', points: 20, days: [0, 1, 2, 3, 4, 5, 6], status: 'active', createdAt: '2026-10-01', ...extra }) as Habit;
const log = (habitId: string, date: string, status: HabitLog['status'] = 'full', loggedAt = `${date}T15:00:00.000Z`): HabitLog => ({
  habitId, date, status, points: status === 'full' ? 20 : status === 'minimum' ? 8 : 0, loggedAt,
});
const data = () => {
  const d = createEmptyData();
  d.settings.economyStartDate = '2026-10-01';
  d.habits = [habit('a'), habit('b', { publicVisible: true })];
  return d;
};

afterEach(() => applyEconomyVersions([], T));

describe('lo que se publica de un día', () => {
  it('cumplimiento, día perfecto y racha viva (hoy sin marcar sigue la de ayer)', () => {
    const d = data();
    d.logs = {
      '2026-10-19|a': log('a', '2026-10-19'), '2026-10-19|b': log('b', '2026-10-19'),
      '2026-10-20|a': log('a', '2026-10-20'),
    };
    const y = dayRow(d, '2026-10-20', T);
    expect(y).toMatchObject({ day: '2026-10-20', completion: 0.5, done: 1, scheduled: 2, perfect: false, streak: 2, coins: 20 });
    const t = dayRow(d, T, T);
    expect(t).toMatchObject({ completion: 0, done: 0, streak: 2, xp: 0 });
    const perfect = dayRow({ ...d, logs: { ...d.logs, [`${T}|a`]: log('a', T), [`${T}|b`]: log('b', T) } }, T, T);
    expect(perfect).toMatchObject({ completion: 1, perfect: true, streak: 3 });
  });

  it('marca el día como «con multiplicador» solo si algo se marcó durante uno', () => {
    const d = data();
    d.xpBoosts = [{ id: 'x', startedAt: `${T}T14:00:00.000Z`, endsAt: `${T}T23:59:00.000Z`, cost: 100 }];
    d.logs = { [`${T}|a`]: log('a', T, 'full', `${T}T15:00:00.000Z`) };
    expect(dayRow(d, T, T).boosted).toBe(true);
    d.logs = { [`${T}|a`]: log('a', T, 'full', `${T}T10:00:00.000Z`) };
    expect(dayRow(d, T, T).boosted).toBe(false);
  });

  it('nunca supera el tope de XP que acepta el servidor', () => {
    expect(dayXpCap(false)).toBe(1070);
    expect(dayXpCap(true)).toBe(1590);
  });
});

describe('punto de partida', () => {
  it('saldo y XP sin ayer ni hoy (que se publican aparte), racha hasta anteayer', () => {
    const d = data();
    d.logs = {
      '2026-10-17|a': log('a', '2026-10-17'), '2026-10-18|a': log('a', '2026-10-18'), '2026-10-19|a': log('a', '2026-10-19'),
      '2026-10-20|a': log('a', '2026-10-20'), [`${T}|a`]: log('a', T),
    };
    d.redemptions = [{ id: 'r1', rewardId: 'x', name: 'Cine', icon: '🎬', cost: 30, date: '2026-10-19T10:00:00.000Z' }];
    const econ = economySummary(d, T);
    const b = baselineFrom(d, T);
    expect(b.coins).toBe(econ.balance - 40);
    expect(b.xp).toBeCloseTo(econ.xpTotal - (econ.days.get(T)!.xp + econ.days.get('2026-10-20')!.xp), 1);
    expect(b.streak).toBe(3);
    expect(b.best).toBe(3);
    expect(b.done).toBe(3);
  });
});

describe('hábitos visibles', () => {
  it('solo salen los marcados como visibles', () => {
    const d = data();
    d.logs = { [`${T}|a`]: log('a', T), [`${T}|b`]: log('b', T, 'minimum') };
    const rows = publicHabitRows(d, T, 'u1');
    expect(rows.map((r) => r.name)).toEqual(['Hábito b']);
    expect(rows[0].days[T]).toEqual({ s: 'minimum' });
    expect(rows[0].days['2026-10-20']).toEqual({ s: 'missed' });
    expect(JSON.stringify(rows)).not.toContain('Hábito a');
  });
});

describe('saldo entre el dispositivo y el servidor', () => {
  it('envía gastos y extras desde el perfil, sin lo que nació en el servidor ni lo ya enviado', () => {
    const d = data();
    d.redemptions = [
      { id: 'old', rewardId: 'x', name: 'Antes', icon: '🎁', cost: 10, date: '2026-10-01T10:00:00.000Z' },
      { id: 'r1', rewardId: 'x', name: 'Cine', icon: '🎬', cost: 30, date: '2026-10-21T10:00:00.000Z' },
      { id: 'srv-5', rewardId: 'item:1', name: 'Marco', icon: '🎨', cost: 200, date: '2026-10-21T10:00:00.000Z' },
      { id: 'sent', rewardId: 'x', name: 'Ya', icon: '🎁', cost: 5, date: '2026-10-21T10:00:00.000Z' },
    ];
    d.pointEvents = [
      { id: 'p1', at: '2026-10-21T11:00:00.000Z', amount: 50, reason: 'Reto', source: 'challenge' },
      { id: 'srv-6', at: '2026-10-21T11:00:00.000Z', amount: 150, reason: 'Liga', source: 'other' },
    ];
    const m = walletMoves(d, '2026-10-20T00:00:00.000Z', new Set(['sent']));
    expect(m.spends.map((s) => s.id)).toEqual(['r1']);
    expect(m.bonuses.map((s) => s.id)).toEqual(['p1']);
  });

  it('compara el inicio del perfil por instante, aunque el servidor lo mande con otro huso', () => {
    const d = data();
    d.redemptions = [
      { id: 'antes', rewardId: 'x', name: 'Antes', icon: '🎁', cost: 10, date: '2026-10-21T18:00:00.000Z' },
      { id: 'despues', rewardId: 'x', name: 'Después', icon: '🎁', cost: 10, date: '2026-10-21T22:00:00.000Z' },
    ];
    // 16:43 en Bogotá = 21:43 UTC: el gasto de las 18:00 UTC ya está en el saldo inicial
    const m = walletMoves(d, '2026-10-21T16:43:45.123456-05:00', new Set());
    expect(m.spends.map((s) => s.id)).toEqual(['despues']);
  });

  it('refleja los movimientos del servidor una sola vez', () => {
    useStore.setState({ ...createEmptyData(), redemptions: [], pointEvents: [] });
    const entries = [
      { id: 7, amount: 150, kind: 'league' as const, ref: 'league:2026-10-12', note: 'Liga Bronce: puesto 1', created_at: '2026-10-19T05:00:00Z' },
      { id: 8, amount: -200, kind: 'purchase' as const, ref: 'item:abc', note: 'Marco dorado', created_at: '2026-10-19T06:00:00Z' },
    ];
    expect(useStore.getState().mergeServerLedger(entries)).toBe(2);
    expect(useStore.getState().mergeServerLedger(entries)).toBe(0);
    const s = useStore.getState();
    expect(s.pointEvents.map((p) => p.id)).toEqual(['srv-7']);
    expect(s.redemptions.map((r) => [r.id, r.cost])).toEqual([['srv-8', 200]]);
    expect(economySummary(s).balance).toBe(0);
  });

  it('el multiplicador comprado en el servidor no se duplica al llegar por el historial', () => {
    useStore.setState({ ...createEmptyData(), redemptions: [], xpBoosts: [] });
    useStore.getState().buyXpBoost({ id: 'b1', startedAt: '2026-10-21T10:00:00Z', endsAt: '2026-10-21T22:00:00Z', price: 120, ledgerId: 9 });
    useStore.getState().mergeServerLedger([{ id: 9, amount: -120, kind: 'purchase', ref: 'boost:b1', note: 'x', created_at: '2026-10-21T10:00:00Z' }]);
    expect(useStore.getState().redemptions).toHaveLength(1);
    expect(useStore.getState().xpBoosts).toHaveLength(1);
  });
});

describe('economía por versiones', () => {
  it('cada día se calcula con la versión que regía: cambiar un valor no reescribe el pasado', () => {
    const d = data();
    d.logs = { '2026-10-15|a': log('a', '2026-10-15'), '2026-10-20|a': log('a', '2026-10-20') };
    const before = economySummary(d, T);
    applyEconomyVersions([{ from: '2026-10-18', params: { actionXp: 48, coinDailyCap: 10 } }], T);
    const after = economySummary(d, T);
    expect(after.days.get('2026-10-15')).toEqual(before.days.get('2026-10-15'));
    expect(after.days.get('2026-10-20')!.xp).toBeGreaterThan(before.days.get('2026-10-20')!.xp);
    expect(after.days.get('2026-10-20')!.coins).toBe(10);
    expect(ECONOMY.actionXp).toBe(48);
    expect(paramsFor('2026-10-01').actionXp).toBe(24);
  });

  it('cada versión rige desde el día de Colombia de su inicio (como en el servidor)', () => {
    // 00:00 de Colombia = 05:00 UTC: el mismo día aunque el dispositivo esté en otro huso
    expect(economyVersionDay('2026-10-22T05:00:00+00:00')).toBe('2026-10-22');
    expect(economyVersionDay('2026-10-22T04:59:59Z')).toBe('2026-10-21');
    expect(economyVersionDay('2000-01-01T05:00:00Z')).toBe('2000-01-01');
  });

  it('ignora valores no válidos de un borrador', () => {
    applyEconomyVersions([{ from: '2026-01-01', params: { actionXp: -5, coinDailyCap: 'mucho', chipMax: { action: 99 } } }], T);
    expect(ECONOMY.actionXp).toBe(24);
    expect(ECONOMY.coinDailyCap).toBe(200);
    expect(ECONOMY.chipMax.action).toBe(99);
  });
});

describe('WebP animado', () => {
  // WebP mínimo sin pérdida (VP8L) de 1×1: suficiente para comprobar el contenedor
  const tinyWebp = () => {
    const vp8l = new Uint8Array([0x2f, 0, 0, 0, 0, 0x07, 0x10, 0x11, 0x10, 0x88, 0x88, 0x08, 0x00]);
    const chunk = new Uint8Array(8 + vp8l.length + (vp8l.length & 1));
    chunk.set(new TextEncoder().encode('VP8L'));
    new DataView(chunk.buffer).setUint32(4, vp8l.length, true);
    chunk.set(vp8l, 8);
    const out = new Uint8Array(12 + chunk.length);
    out.set(new TextEncoder().encode('RIFF'));
    new DataView(out.buffer).setUint32(4, 4 + chunk.length, true);
    out.set(new TextEncoder().encode('WEBP'), 8);
    out.set(chunk, 12);
    return new Blob([out], { type: 'image/webp' });
  };

  it('une fotogramas en un WebP animado válido', async () => {
    const still = await readBytes(tinyWebp());
    expect(isWebp(still)).toBe(true);
    expect(isAnimatedWebp(still)).toBe(false);
    const anim = await readBytes(await muxAnimatedWebp([tinyWebp(), tinyWebp(), tinyWebp()], 1, 1, 80));
    expect(isWebp(anim)).toBe(true);
    expect(isAnimatedWebp(anim)).toBe(true);
    // Tamaño RIFF coherente con el archivo
    expect(new DataView(anim.buffer).getUint32(4, true)).toBe(anim.length - 8);
    expect(isWebp(new TextEncoder().encode('GIF89a......WEBP'))).toBe(false);
  });

  it('un bloque con tamaño enorme (archivo dañado) no cuelga la lectura', () => {
    const bad = new Uint8Array(40);
    bad.set(new TextEncoder().encode('RIFF'));
    bad.set(new TextEncoder().encode('WEBP'), 8);
    bad.set(new TextEncoder().encode('VP8 '), 12);
    bad.set([0, 0, 0, 0x80], 16);
    const t0 = Date.now();
    expect(isAnimatedWebp(bad)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});
