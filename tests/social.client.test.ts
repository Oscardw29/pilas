import { afterEach, describe, expect, it } from 'vitest';
import type { Habit, HabitLog } from '@/types';
import { DEMO_HABIT_IDS, createDemoData, createEmptyData, isDemoActive, isDemoData } from '@/data/seed';
import { economySummary } from '@/lib/economy';
import { ECONOMY, applyEconomyVersions, dayXpCap, paramsFor } from '@/lib/economyRules';
import { DEFAULT_AVATARS, effectivePreset } from '@/lib/defaultAvatars';
import { PUBLIC_HABIT_DAYS, baselineFrom, dayRow, hasDeviceData, publicHabitRows, walletMoves } from '@/social/publish';
import { isAnimatedWebp, isWebp, muxAnimatedWebp, readBytes } from '@/social/images';
import { avatarSignature, economyVersionDay, resetPending } from '@/social/runtime';
import { addDaysKey } from '@/lib/dates';
import { migrateData, useStore } from '@/store/useStore';

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
    expect(Number.isInteger(b.xp) && Number.isInteger(b.coins)).toBe(true);
  });

  it('no cuenta lo que nació en el servidor (ya está en su historial: se sumaría dos veces)', () => {
    const d = data();
    d.logs = { '2026-10-15|a': log('a', '2026-10-15'), '2026-10-16|a': log('a', '2026-10-16'), '2026-10-17|a': log('a', '2026-10-17') };
    const before = baselineFrom(d, T).coins;
    d.pointEvents = [
      { id: 'srv-7', at: '2026-10-18T05:00:00Z', amount: 150, reason: 'Liga', source: 'other' },
      { id: 'p1', at: '2026-10-18T06:00:00Z', amount: 10, reason: 'Reto', source: 'challenge' },
    ];
    d.redemptions = [
      { id: 'srv-8', rewardId: 'item:x', name: 'Marco', icon: '🎨', cost: 200, date: '2026-10-18T07:00:00Z' },
      { id: 'r1', rewardId: 'x', name: 'Cine', icon: '🎬', cost: 25, date: '2026-10-18T08:00:00Z' },
    ];
    // Solo cuentan el reto (+10) y el premio propio (−25)
    expect(baselineFrom(d, T).coins).toBe(before + 10 - 25);
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

  it('publica las últimas 8 semanas (56 días) para poder recorrerlas en el perfil', () => {
    expect(PUBLIC_HABIT_DAYS).toBe(56);
    const d = data();
    d.habits = [habit('b', { publicVisible: true, createdAt: '2026-07-01' })];
    const in8 = addDaysKey(T, -55);
    const out = addDaysKey(T, -56);
    d.logs = { [`${T}|b`]: log('b', T), [`${in8}|b`]: log('b', in8), [`${out}|b`]: log('b', out) };
    const days = publicHabitRows(d, T, 'u1')[0].days;
    expect(days[in8]).toEqual({ s: 'full' });
    expect(days[out]).toBeUndefined();
    expect(Object.keys(days)).toHaveLength(56);
  });
});

describe('datos que cambian por completo', () => {
  it('cargar la demostración no reinicia lo público; empezar de cero e importar sí marcan la hora del cambio', () => {
    useStore.setState({ ...createEmptyData() });
    useStore.getState().updateSettings({ userName: 'Ana', avatarPreset: 3, theme: 'dark', pendingAlias: 'ana_99', dataResetAt: '2026-10-01T00:00:00.000Z' });
    useStore.getState().resetDemo();
    const demo = useStore.getState().settings;
    expect(demo.demoMode).toBe(true);
    // Se conserva el último cambio (para los dispositivos que aún no lo atendieron), sin marcar uno nuevo
    expect(demo.dataResetAt).toBe('2026-10-01T00:00:00.000Z');
    // Quién eres no cambia por reiniciar los datos
    expect(demo).toMatchObject({ userName: 'Ana', avatarPreset: 3, theme: 'dark', pendingAlias: 'ana_99' });

    // Quitar la demostración = empezar de cero: sí reinicia lo público
    useStore.getState().resetEmpty();
    const empty = useStore.getState().settings;
    expect(empty.demoMode).toBe(false);
    expect(Date.parse(empty.dataResetAt!)).toBeGreaterThan(Date.parse('2026-10-01T00:00:00.000Z'));

    // Una copia importada con la demostración cargada: el ajuste se quita, pero sus datos se reconocen como demostración
    const backup = createDemoData();
    backup.settings = { ...backup.settings, demoMode: true };
    useStore.getState().importData(backup);
    const s = useStore.getState();
    expect(s.settings.demoMode).toBe(false);
    expect(s.settings.dataResetAt).toBeTruthy();
    expect(isDemoActive(s)).toBe(true);
  });

  it('cada dispositivo atiende un cambio una vez; el servidor decide si de verdad reinicia', () => {
    const at = '2026-10-21T12:00:00.000Z';
    const now = Date.parse('2026-10-21T13:00:00.000Z');
    // Nunca atendido aquí y reciente: se pide al servidor (si otro dispositivo ya lo atendió, no hace nada)
    expect(resetPending(at, undefined, now)).toBe(true);
    // Ya atendido, o atendido uno posterior
    expect(resetPending(at, at, now)).toBe(false);
    expect(resetPending(at, '2026-10-22T00:00:00.000Z', now)).toBe(false);
    // Uno nuevo después del atendido, aunque llegue con otro huso
    expect(resetPending('2026-10-21T08:00:00-05:00', '2026-10-21T12:59:00.000Z', now)).toBe(true);
    // Dispositivo recién instalado con un cambio viejo: ya lo atendió el dispositivo donde ocurrió
    expect(resetPending(at, undefined, now + 3 * 86_400_000)).toBe(false);
    // Sin cambio o con una fecha no válida
    expect(resetPending(undefined, undefined, now)).toBe(false);
    expect(resetPending('ayer', undefined, now)).toBe(false);
  });

  it('el punto de partida no se reclama con un dispositivo sin hábitos ni registros', () => {
    expect(hasDeviceData(createEmptyData())).toBe(false);
    const d = createEmptyData();
    d.logs = { [`${T}|x`]: log('x', T) };
    expect(hasDeviceData(d)).toBe(true);
    expect(hasDeviceData(data())).toBe(true);
  });
});

describe('datos de demostración', () => {
  it('se reconocen por los ids de la demo, aunque el ajuste diga lo contrario', () => {
    const demo = createDemoData();
    expect(demo.habits.map((h) => h.id).sort()).toEqual([...DEMO_HABIT_IDS].sort());
    expect(isDemoData(demo)).toBe(true);
    expect(isDemoActive({ ...demo, settings: { ...demo.settings, demoMode: false } })).toBe(true);
    // Un hábito de la demo ya eliminado sigue dando XP con sus registros
    expect(isDemoData({ habits: [], logs: demo.logs })).toBe(true);
    // Datos reales
    expect(isDemoData(data())).toBe(false);
    expect(isDemoActive(createEmptyData())).toBe(false);
    expect(isDemoActive({ ...createEmptyData(), settings: { ...createEmptyData().settings, demoMode: true } })).toBe(true);
  });
});

describe('fotos por defecto y enteros', () => {
  it('cargar o importar no asigna una foto al azar: la que se ve sale de la cuenta, igual en todos los dispositivos', () => {
    // Escribir los ajustes al cargar hacía que un dispositivo desfasado pisara los ajustes de otro
    expect(migrateData({ settings: { userName: 'Leo' } }, 6, false).settings.avatarPreset).toBeUndefined();
    expect(migrateData({ settings: { avatarPreset: 4 } }, 6, false).settings.avatarPreset).toBe(4);
    useStore.setState({ ...createEmptyData() });
    useStore.getState().updateSettings({ avatarPreset: 2 });
    useStore.getState().importData(createEmptyData());
    expect(useStore.getState().settings.avatarPreset).toBe(2);

    // La elegida manda; sin elegir (o no válida), una fija para cada cuenta
    expect(effectivePreset(4, 'cuenta-a')).toBe(4);
    const uid = '00000000-0000-4000-8000-000000000001';
    const a = effectivePreset(undefined, uid);
    expect(effectivePreset(9, uid)).toBe(a);
    expect(effectivePreset(undefined, uid)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(DEFAULT_AVATARS.length);
    // Se reparten entre las cinco
    const seen = new Set(Array.from({ length: 40 }, (_, i) => effectivePreset(undefined, `cuenta-${i}`)));
    expect(seen.size).toBe(DEFAULT_AVATARS.length);
  });

  it('la firma de la foto publicada cambia si cambia la foto', () => {
    const a = 'data:image/webp;base64,AAAA';
    expect(avatarSignature(a)).toBe(avatarSignature(`data:image/webp;base64,${'AAAA'}`));
    expect(avatarSignature(a)).not.toBe(avatarSignature('data:image/webp;base64,AAAB'));
  });

  it('la XP total es la suma de cada día en entero (igual que el servidor)', () => {
    const d = data();
    d.logs = {};
    for (let i = 1; i <= 12; i++) {
      const day = addDaysKey(T, -i);
      d.logs[`${day}|a`] = log('a', day, i % 3 ? 'full' : 'minimum');
      d.logs[`${day}|b`] = log('b', day, i % 2 ? 'full' : 'minimum');
    }
    const econ = economySummary(d, T);
    const days = [...econ.days.values()].map((x) => x.xp);
    expect(days.every(Number.isInteger)).toBe(true);
    expect(econ.xpTotal).toBe(days.reduce((sum, x) => sum + x, 0));
  });

  it('las monedas que se guardan son enteras', () => {
    useStore.setState({ ...createEmptyData() });
    useStore.getState().addPointEvent({ amount: 12.6, reason: 'Reto', source: 'challenge' });
    useStore.getState().mergeServerLedger([{ id: 3, amount: 150.4, kind: 'league', ref: 'league:x', note: null, created_at: '2026-10-19T05:00:00Z' }]);
    expect(useStore.getState().pointEvents.map((p) => p.amount)).toEqual([13, 150]);
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
