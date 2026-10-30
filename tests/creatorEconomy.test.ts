import { describe, expect, it } from 'vitest';
import { ECONOMY_DEFAULTS, dayXpCap, freezePrice } from '@/lib/economyRules';
import { SIM_EXAMPLES, compareEconomies, simulateExample } from '@/components/creator/simulation';
import {
  SERVER_ECONOMY_DEFAULTS, currentVersion, extraKeys, fromFormText, mergeEconomyParams, toFormText,
} from '@/components/creator/economyModel';

const ex = (id: string) => SIM_EXAMPLES.find((e) => e.id === id)!;
const D = ECONOMY_DEFAULTS;

describe('simulación del panel del creador', () => {
  it('con los valores por defecto reproduce los ejemplos del documento', () => {
    expect(simulateExample(ex('casual'), D)).toEqual({ coins: 40, xp: 116.5 });
    expect(simulateExample(ex('steady'), D)).toEqual({ coins: 112.5, xp: 318.1 });
    expect(simulateExample(ex('weak'), D)).toEqual({ coins: 52.5, xp: 132.8 });
    expect(simulateExample(ex('abuse'), D)).toEqual({ coins: 200, xp: 192 });
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
});

describe('parámetros de la economía en el formulario', () => {
  it('une los parámetros del servidor con los de la app', () => {
    const p = mergeEconomyParams({ coinDailyCap: 150, leaguePromotePct: 25, leaguePrizes: { gold: [300, 'x'] } });
    expect(p.coinDailyCap).toBe(150);
    expect(p.leaguePromotePct).toBe(25);
    expect(p.leagueDemotePct).toBe(20);
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
    text.leaguePromotePct = '150';
    text.xpHabitsPerDay = '2.5';
    text.freezePriceMin = '700';
    const { errors } = fromFormText(text);
    expect(Object.keys(errors).sort()).toEqual(['coinDailyCap', 'freezePriceMin', 'leaguePromotePct', 'xpHabitsPerDay']);
  });

  it('compara mínimo y máximo con la coma decimal ya leída', () => {
    const text = toFormText(mergeEconomyParams({}));
    text.timeCoinsMin = '60,5';
    text.timeCoinsMax = '50';
    const { params, errors } = fromFormText(text);
    expect(params.timeCoinsMin).toBe(60.5);
    expect(errors.timeCoinsMin).toBe('No puede ser mayor que el máximo');
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
