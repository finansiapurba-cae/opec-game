import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  REFERENCE_CAPACITY,
  cardCost,
  cardTimeline,
  capacityInPeriod,
  computePrice,
  computeWealth,
  demandFactor,
  demandTypeForPeriod,
  eorBonus,
  fvFactor,
  hedgePayout,
  hedgeVolume,
  interpolate,
  maxProduction,
  periodProfit,
  resolveConfig,
  terminalValue,
  uniformSharePrice,
} from '@/lib/engine';

const cfg = DEFAULT_CONFIG;

describe('price calculation', () => {
  const table: Array<[number, number, number]> = [
    [100, 65, 91],
    [90, 78, 103],
    [80, 92, 115],
    [70, 105, 128],
    [60, 119, 140],
  ];

  it.each(table)('reproduces the reference table at %i%% of capacity', (pct, low, high) => {
    expect(uniformSharePrice(pct, 'low', cfg)).toBe(low);
    expect(uniformSharePrice(pct, 'high', cfg)).toBe(high);
  });

  it('uses the sum of the seven original capacities as reference', () => {
    expect(REFERENCE_CAPACITY).toBe(33700);
  });

  it('interpolates linearly between table points', () => {
    expect(uniformSharePrice(95, 'low', cfg)).toBe(71.5);
    expect(uniformSharePrice(85, 'high', cfg)).toBe(109);
    expect(uniformSharePrice(75, 'low', cfg)).toBe(98.5);
  });

  it('price falls as total production rises (monotonic)', () => {
    let prev = Infinity;
    for (let q = 15000; q <= 42000; q += 500) {
      const p = computePrice({ totalProduction: q, demandType: 'low' }, cfg);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });

  it('depends only on TOTAL production, not on who produces it', () => {
    // Saudi at 100% + others at 0 vs. a different mix with the same total
    const a = computePrice({ totalProduction: 12000 + 4600, demandType: 'high' }, cfg);
    const b = computePrice({ totalProduction: 3000 + 3300 + 2700 + 4400 + 3200, demandType: 'high' }, cfg);
    expect(a).toBe(b);
  });

  it('extrapolates linearly outside the table by default (labelled assumption)', () => {
    expect(uniformSharePrice(110, 'low', cfg)).toBe(52); // slope of the 90–100 % segment
    expect(uniformSharePrice(50, 'low', cfg)).toBe(133); // slope of the 60–70 % segment
  });

  it('supports the "clamp" extrapolation assumption', () => {
    const clamp = resolveConfig({ price: { extrapolation: 'clamp' } });
    expect(uniformSharePrice(110, 'low', clamp)).toBe(65);
    expect(uniformSharePrice(40, 'high', clamp)).toBe(140);
  });

  it('applies the configurable floor and ceiling', () => {
    expect(computePrice({ totalProduction: 33700 * 3, demandType: 'low' }, cfg)).toBe(cfg.price.floor);
    expect(computePrice({ totalProduction: 0, demandType: 'high' }, cfg)).toBeLessThanOrEqual(cfg.price.ceiling);
  });

  it('a demand increase shifts the curve outward (quantity mode)', () => {
    const base = uniformSharePrice(100, 'low', cfg);
    const boom = uniformSharePrice(100, 'low', cfg, 1.05);
    const recession = uniformSharePrice(100, 'low', cfg, 0.95);
    expect(boom).toBeGreaterThan(base);
    expect(recession).toBeLessThan(base);
    expect(boom).toBe(71.19); // effective share 1/1.05 = 95.24 %
  });

  it('supports the "price" demand-shift assumption', () => {
    const priceMode = resolveConfig({ price: { demand_shift: 'price' } });
    expect(uniformSharePrice(100, 'low', priceMode, 1.05)).toBe(68.25);
  });

  it('interpolate() validates its table', () => {
    expect(() => interpolate([1], [1], 1)).toThrow();
  });
});

describe('odd/even demand', () => {
  it('odd periods are low demand, even periods are high demand', () => {
    for (let t = 1; t <= 10; t++) {
      expect(demandTypeForPeriod(t, cfg)).toBe(t % 2 === 1 ? 'low' : 'high');
    }
  });

  it('combines random variation and events multiplicatively', () => {
    expect(demandFactor(0)).toBe(1);
    expect(demandFactor(0.015, [0.05])).toBeCloseTo(1.015 * 1.05, 12);
    expect(demandFactor(-0.015, [-0.05])).toBeCloseTo(0.985 * 0.95, 12);
  });

  it('random variation of ±1.5% moves the price by a bounded amount', () => {
    const hi = uniformSharePrice(80, 'low', cfg, 1.015);
    const lo = uniformSharePrice(80, 'low', cfg, 0.985);
    expect(hi - lo).toBeGreaterThan(0);
    expect(hi - lo).toBeLessThan(5);
  });
});

describe('production limits and reserve depletion', () => {
  it('limit is min(capacity, remaining reserves)', () => {
    expect(maxProduction(12000, 108000)).toBe(12000);
    expect(maxProduction(12000, 5000)).toBe(5000);
    expect(maxProduction(12000, 0)).toBe(0);
    expect(maxProduction(12000, -5)).toBe(0);
  });

  it('producing at full capacity depletes reserves after 9 periods (reserves = 9 × capacity)', () => {
    let remaining = 108000;
    const produced: number[] = [];
    for (let t = 1; t <= 10; t++) {
      const q = maxProduction(12000, remaining);
      produced.push(q);
      remaining -= q;
    }
    expect(produced.slice(0, 9).every((q) => q === 12000)).toBe(true);
    expect(produced[9]).toBe(0);
    expect(remaining).toBe(0);
  });
});

describe('profit, compounding and terminal value', () => {
  it('period profit = (price − MC) × production (in $M)', () => {
    expect(periodProfit(65, 9, 12000)).toBe(672); // $672 million
    expect(periodProfit(91, 20, 4400)).toBeCloseTo(312.4, 10);
  });

  it('profits compound at 5% per period until Period 11', () => {
    expect(fvFactor(10, 10, cfg)).toBeCloseTo(1.05, 12);
    expect(fvFactor(1, 10, cfg)).toBeCloseTo(Math.pow(1.05, 10), 12);
    expect(fvFactor(11, 10, cfg)).toBe(1);
  });

  it('terminal value = (70 − MC) × remaining reserves', () => {
    expect(terminalValue(9, 108000, cfg)).toBe(6588);
    expect(terminalValue(20, 0, cfg)).toBe(0);
  });

  it('final wealth = Σ compounded profits + remaining oil value − card costs', () => {
    const w = computeWealth(
      {
        marginalCost: 5,
        initialReserves: 27000,
        totalPeriods: 10,
        periods: [
          { period: 1, price: 92, production: 2400, cardCost: 36 },
          { period: 2, price: 115, production: 2400 },
        ],
      },
      cfg,
    );
    const p1 = ((92 - 5) * 2400) / 1000;
    const p2 = ((115 - 5) * 2400) / 1000;
    const expected = p1 * Math.pow(1.05, 10) + p2 * Math.pow(1.05, 9) + ((70 - 5) * (27000 - 4800)) / 1000 - 36;
    expect(w.finalWealth).toBeCloseTo(expected, 9);
    expect(w.remainingReserves).toBe(22200);
  });

  it('card costs can be compounded instead (configurable assumption)', () => {
    const compounded = resolveConfig({ accounting: { card_cost_mode: 'compounded' } });
    const w = computeWealth(
      { marginalCost: 5, initialReserves: 27000, totalPeriods: 10, periods: [{ period: 1, price: 92, production: 0, cardCost: 36 }] },
      compounded,
    );
    expect(w.cardDeduction).toBe(0);
    expect(w.totalFv).toBeCloseTo(-36 * Math.pow(1.05, 10), 9);
  });
});

describe('cards', () => {
  it('costs are per 1,000 units of capacity', () => {
    expect(cardCost('audit', 12000, cfg)).toBe(60);
    expect(cardCost('eor', 12000, cfg)).toBe(900);
    expect(cardCost('capacity_expansion', 3000, cfg)).toBe(36);
    expect(cardCost('price_hedge', 4600, cfg)).toBeCloseTo(46, 10);
  });

  it('Enhanced Oil Recovery activates in the third period after purchase (+10 % of original reserves, once)', () => {
    const t = cardTimeline('eor', 2, 10, cfg);
    expect(t.activationPeriod).toBe(5);
    expect(eorBonus(41400, cfg)).toBe(4140);
    expect(cardTimeline('eor', 8, 10, cfg).tooLate).toBe(true);
  });

  it('Capacity Expansion activates in the second period after purchase (+20 %, permanent)', () => {
    const t = cardTimeline('capacity_expansion', 3, 10, cfg);
    expect(t.activationPeriod).toBe(5);
    expect(capacityInPeriod(3700, 4, { activationPeriod: 5 }, cfg)).toBe(3700);
    expect(capacityInPeriod(3700, 5, { activationPeriod: 5 }, cfg)).toBe(4440);
    expect(capacityInPeriod(3700, 10, { activationPeriod: 5 }, cfg)).toBe(4440);
  });

  it('Price Hedge is active for three periods starting the next period', () => {
    const t = cardTimeline('price_hedge', 4, 10, cfg);
    expect([t.activationPeriod, t.endPeriod, t.activePeriods]).toEqual([5, 7, 3]);
    const late = cardTimeline('price_hedge', 9, 10, cfg);
    expect([late.activationPeriod, late.endPeriod, late.activePeriods]).toEqual([10, 10, 1]);
    expect(cardTimeline('price_hedge', 10, 10, cfg).tooLate).toBe(true);
  });

  it('Price Hedge pays (95 − price) on 50 % of capacity, independent of production; nothing at ≥ $95', () => {
    const volume = hedgeVolume(4400, cfg);
    expect(volume).toBe(2200);
    expect(hedgePayout(78, volume, 95)).toBeCloseTo(37.4, 10);
    expect(hedgePayout(95, volume, 95)).toBe(0);
    expect(hedgePayout(120, volume, 95)).toBe(0);
  });
});
