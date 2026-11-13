/**
 * Market price model — TypeScript mirror of `opec_price()` in
 * supabase/migrations/20261112000200_price_engine.sql.
 *
 * ASSUMPTION (not the instructor's official formula): the course material only
 * lists prices for the case in which every country produces the same share of
 * capacity. We interpolate that table piecewise-linearly on the world's
 * aggregate production share and apply a configurable rule outside 60–100 %.
 * The server is authoritative; this copy is used for previews and is kept in
 * sync by the parity test in tests/db/engine-parity.test.ts.
 */
import type { DemandType, GameConfig } from './config';

/** Sum of the seven countries' original capacities (kb per period). */
export const REFERENCE_CAPACITY = 12000 + 4600 + 3700 + 3300 + 3000 + 4400 + 2700; // 33,700

/** Round half away from zero to 2 decimals (matches PostgreSQL numeric round). */
export function roundCents(x: number): number {
  const sign = x < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(x) * 100 + 1e-9)) / 100;
}

export function interpolate(
  xs: number[],
  ys: number[],
  x: number,
  extrapolation: 'linear' | 'clamp' = 'linear',
): number {
  const n = xs.length;
  if (n < 2 || ys.length !== n) throw new Error('price table must have at least two points');
  if (x <= xs[0]) {
    if (extrapolation === 'clamp') return ys[0];
    return ys[0] + ((x - xs[0]) * (ys[1] - ys[0])) / (xs[1] - xs[0]);
  }
  if (x >= xs[n - 1]) {
    if (extrapolation === 'clamp') return ys[n - 1];
    return ys[n - 1] + ((x - xs[n - 1]) * (ys[n - 1] - ys[n - 2])) / (xs[n - 1] - xs[n - 2]);
  }
  for (let i = 0; i < n - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      return ys[i] + ((x - xs[i]) * (ys[i + 1] - ys[i])) / (xs[i + 1] - xs[i]);
    }
  }
  return ys[n - 1];
}

export function effectiveShare(
  totalProduction: number,
  referenceCapacity: number,
  demandFactor: number,
  config: GameConfig,
): number {
  const share = totalProduction / referenceCapacity;
  return config.price.demand_shift === 'quantity' ? share / demandFactor : share;
}

export interface PriceInput {
  totalProduction: number;
  referenceCapacity?: number;
  demandType: DemandType;
  /** (1 + noise) × event multiplier; 1 = reference demand */
  demandFactor?: number;
}

/** World oil price in USD per barrel. */
export function computePrice(input: PriceInput, config: GameConfig): number {
  const ref = input.referenceCapacity ?? REFERENCE_CAPACITY;
  const df = input.demandFactor ?? 1;
  const s = effectiveShare(input.totalProduction, ref, df, config);
  let p = interpolate(config.price.shares, config.price[input.demandType], s, config.price.extrapolation);
  if (config.price.demand_shift === 'price') p *= df;
  return roundCents(Math.min(Math.max(p, config.price.floor), config.price.ceiling));
}

/** Price when every country produces `pct`% of its capacity (the reference table case). */
export function uniformSharePrice(pct: number, demandType: DemandType, config: GameConfig, demandFactor = 1): number {
  return computePrice(
    { totalProduction: (pct / 100) * REFERENCE_CAPACITY, demandType, demandFactor },
    config,
  );
}
