import { describe, expect, it } from 'vitest';
import { ECONOMY_DEFAULTS, dayXpCap, freezePrice, parseEconomyParams } from '@/lib/economyRules';
import { SIM_EXAMPLES, compareEconomies, leagueSplit, simulateExample } from '@/components/creator/simulation';
import {
  SERVER_ECONOMY_DEFAULTS, currentVersion, extraKeys, fromFormText, mergeEconomyParams, toFormText,
} from '@/components/creator/economyModel';

const ex = (id: string) => SIM_EXAMPLES.find((e) => e.id === id)!;
const D = ECONOMY_DEFAULTS;

describe('simulación del panel del creador', () => {
  it('con los valores por defecto reproduce los ejemplos del documento (en enteros)', () => {
    expect(simulateExample(ex('casual'), D)).toEqual({ coins: 40, xp: 117 });
    expect(simulateExample(ex('steady'), D)).toEqual({ coins: 113, xp: 319 });
    expect(simulateExample(ex('weak'), D)).toEqual({ coins: 53, xp: 133 });
    expect(simulateExample(ex('abuse'), D)).toEqual({ coins: 200, xp: 192 });
    // Con multiplicador: (135 + 102 + 68 + 36 + 36) × 1,15 + 30 = 463,55
    expect(simulateExample(ex('steady-boost'), D)).toEqual({ coins: 113, xp: 464 });
  });

  it('ningún resultado de la simulación tiene decimales', () => {
    const draft = { ...structuredClone(D), timeXpPerMinute: 1.3, freezePriceFactor: 1.7, streakBonusPerDay: 0.013 };
    for (const r of compareEconomies(D, draft)) {
      expect(Number.isInteger(r.before)).toBe(true);
      expect(Number.isInteger(r.after)).toBe(true);
    }
  });

  it('usa los parámetros del borrador, no los vigentes', () => {
    const draft = { ...structuredClone(D), coinDailyCap: 100, actionXp: 30 };
    const abuse = simulateExample(ex('abuse'), draft);
    expect(abuse.coins).toBe(100);
    expect(abuse.xp).toBe(240);
    const draft2 = { ...structuredClone(D), chipMax: { action: 20, quantity: 40 } };
    expect(simulateExample(ex('abuse'), draft2).coins).toBe(200);
    expect(simulateExample(ex('casual'), draft2).coins).toBe(40);
  });

  it('compara topes y precios antes y después', () => {
    const draft = { ...structuredClone(D), freezePriceFactor: 3, xpBaseDailyCap: 1000 };
    const rows = compareEconomies(D, draft);
    const cap = rows.find((r) => r.id === 'cap')!;
    expect(cap.before).toBe(dayXpCap(false, D));
    expect(cap.after).toBe(dayXpCap(false, draft));
    const f80 = rows.find((r) => r.id === 'freeze-80')!;
    expect(f80.before).toBe(freezePrice(80));
    expect(f80.after).toBe(240);
    expect(rows.find((r) => r.id === 'freeze-20')!.after).toBe(100);
    expect(rows.find((r) => r.id === 'boost-250')!.after).toBe(500);
  });

  it('reparto de la liga: suben los N primeros, los N siguientes se quedan y el resto baja', () => {
    expect(leagueSplit({ ...D, leagueGroupSize: 30 })).toEqual({ size: 30, up: 5, stay: 5, down: 20 });
    expect(leagueSplit({ ...D, leagueGroupSize: 8 })).toEqual({ size: 8, up: 5, stay: 3, down: 0 });
    const rows = compareEconomies({ ...D, leagueGroupSize: 30 }, { ...D, leagueGroupSize: 20, leaguePromoteCount: 3, leagueSoloPrize: 40 });
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect([row('league-up').before, row('league-up').after]).toEqual([5, 3]);
    expect([row('league-stay').before, row('league-stay').after]).toEqual([5, 5]);
    expect([row('league-down').before, row('league-down').after]).toEqual([20, 12]);
    expect([row('league-solo').before, row('league-solo').after]).toEqual([25, 40]);
    expect(row('league-up').detail).toBe('Grupo lleno de 30 → 20 personas');
  });
});

describe('parámetros de la economía en el formulario', () => {
  it('une los parámetros del servidor con los de la app', () => {
    const p = mergeEconomyParams({ coinDailyCap: 150, leaguePromoteCount: 3, leagueStayCount: 4.6, leaguePrizes: { gold: [300, 'x'] } });
    expect(p.coinDailyCap).toBe(150);
    expect(p.leaguePromoteCount).toBe(3);
    expect(p.leagueStayCount).toBe(5);
    expect(p.leagueSoloPrize).toBe(25);
    expect(p.leagueGroupSize).toBe(30);
    expect('leaguePromotePct' in p).toBe(false);
    expect(p.leaguePrizes.gold).toEqual([300, 175, 120, 45]);
    expect(p.leaguePrizes.bronze).toEqual(SERVER_ECONOMY_DEFAULTS.leaguePrizes.bronze);
  });

  it('ida y vuelta por el texto del formulario sin perder claves', () => {
    const p = mergeEconomyParams({ coinDailyCap: 180, futureKey: 'x' });
    const { params, errors } = fromFormText(toFormText(p), extraKeys({ coinDailyCap: 180, futureKey: 'x' }));
    expect(errors).toEqual({});
    expect(params.futureKey).toBe('x');
    expect(params.coinDailyCap).toBe(180);
    expect(params.chipMax).toEqual({ action: 30, quantity: 40 });
    expect((params.leaguePrizes as Record<string, number[]>).diamond).toEqual([400, 270, 190, 70]);
    expect(mergeEconomyParams(params)).toEqual(p);
  });

  it('marca los campos no válidos', () => {
    const text = toFormText(mergeEconomyParams({}));
    text.coinDailyCap = 'abc';
    text.leaguePromoteCount = '2.5';
    text.leagueSoloPrize = '-1';
    text.xpHabitsPerDay = '2.5';
    text.freezePriceMin = '700';
    const { errors } = fromFormText(text);
    expect(Object.keys(errors).sort()).toEqual(['coinDailyCap', 'freezePriceMin', 'leaguePromoteCount', 'leagueSoloPrize', 'xpHabitsPerDay']);
  });

  it('monedas y XP enteras en el formulario; la coma decimal se lee en los factores', () => {
    const text = toFormText(mergeEconomyParams({}));
    text.timeXpPerMinute = '1,5';
    text.actionXp = '24,5';
    text.coinDailyCap = '12,5';
    const r = fromFormText(text);
    expect(r.params.timeXpPerMinute).toBe(1.5);
    expect(r.errors.timeXpPerMinute).toBeUndefined();
    expect(r.errors.actionXp).toBe('Número entero');
    expect(r.errors.coinDailyCap).toBe('Número entero');
  });

  it('compara mínimo y máximo con los valores ya leídos', () => {
    const text = toFormText(mergeEconomyParams({}));
    text.timeCoinsMin = ' 60 ';
    text.timeCoinsMax = '50';
    const { params, errors } = fromFormText(text);
    expect(params.timeCoinsMin).toBe(60);
    expect(errors.timeCoinsMin).toBe('No puede ser mayor que el máximo');
  });

  it('los parámetros de liga que cuentan personas o monedas se guardan enteros', () => {
    const p = parseEconomyParams({ leaguePromoteCount: 5.4, leagueStayCount: 'x', leagueSoloPrize: 24.5 });
    expect(p.leaguePromoteCount).toBe(5);
    expect(p.leagueStayCount).toBe(5);
    expect(p.leagueSoloPrize).toBe(25);
  });

  it('la versión vigente es la última publicada cuya fecha ya llegó', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    const v = currentVersion(
      [
        { version: 1, params: {}, status: 'published', effective_from: '2000-01-01T00:00:00Z' },
        { version: 2, params: {}, status: 'published', effective_from: '2026-10-20T00:00:00Z' },
        { version: 3, params: {}, status: 'published', effective_from: '2026-11-01T00:00:00Z' },
        { version: 4, params: {}, status: 'draft', effective_from: null },
      ],
      now,
    );
    expect(v?.version).toBe(2);
  });
});
