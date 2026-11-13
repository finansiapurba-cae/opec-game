/**
 * Profit, compounding and wealth — mirror of the accounting in `_close_period()`
 * and `_finalize_game()`.
 *
 * Units: production/reserves in thousand barrels (kb); prices in USD/bbl;
 * money in USD millions ($M). ($/bbl × kb ÷ 1000 = $M)
 */
import type { DemandType, GameConfig } from './config';

export function demandTypeForPeriod(period: number, config: GameConfig): DemandType {
  return period % 2 === 1 ? config.demand.odd_periods : config.demand.even_periods;
}

/** (1 + noise) × Π(1 + event change) */
export function demandFactor(noise: number, eventChanges: number[] = []): number {
  return eventChanges.reduce((acc, c) => acc * (1 + c), 1 + noise);
}

/** Production limit: min(current capacity, remaining reserves). */
export function maxProduction(capacity: number, remainingReserves: number): number {
  return Math.max(0, Math.min(capacity, remainingReserves));
}

export const revenueM = (price: number, production: number) => (price * production) / 1000;
export const productionCostM = (marginalCost: number, production: number) => (marginalCost * production) / 1000;

/** Period profit = (P − MC) × Q, in $M. */
export function periodProfit(price: number, marginalCost: number, production: number): number {
  return ((price - marginalCost) * production) / 1000;
}

/** FV factor for period t: (1 + r)^(Tc − t), Tc = total periods + 1 (= 11). */
export function fvFactor(period: number, totalPeriods: number, config: GameConfig): number {
  const target = config.accounting.compound_to_period ?? totalPeriods + 1;
  return Math.pow(1 + config.accounting.interest_rate, target - period);
}

/** Remaining oil value = (70 − MC) × remaining reserves, in $M. */
export function terminalValue(marginalCost: number, remainingReserves: number, config: GameConfig): number {
  return ((config.accounting.terminal_price - marginalCost) * remainingReserves) / 1000;
}

/** Price hedge payout: max(0, strike − price) × hedged volume, in $M. */
export function hedgePayout(price: number, volume: number, strike: number): number {
  return (Math.max(0, strike - price) * volume) / 1000;
}

export interface PeriodInput {
  period: number;
  price: number;
  production: number;
  hedge?: number;
  cardCost?: number;
}

export interface PeriodOutcome extends Required<PeriodInput> {
  revenue: number;
  cost: number;
  profit: number;
  factor: number;
  fv: number;
}

export interface WealthBreakdown {
  periods: PeriodOutcome[];
  totalFv: number;
  terminalValue: number;
  cardCosts: number;
  cardDeduction: number;
  finalWealth: number;
  remainingReserves: number;
}

/**
 * Final wealth = Σ compounded period cash flows + remaining oil value − card costs.
 * card_cost_mode 'nominal': card costs are subtracted once at the end (literal rule).
 * card_cost_mode 'compounded': card costs reduce the purchase period's cash flow and compound.
 */
export function computeWealth(
  args: {
    marginalCost: number;
    initialReserves: number;
    reservesBonus?: number;
    totalPeriods: number;
    periods: PeriodInput[];
  },
  config: GameConfig,
): WealthBreakdown {
  const compounded = config.accounting.card_cost_mode === 'compounded';
  let remaining = args.initialReserves + (args.reservesBonus ?? 0);
  let totalFv = 0;
  let cardCosts = 0;
  const periods: PeriodOutcome[] = args.periods.map((p) => {
    const hedge = p.hedge ?? 0;
    const cardCost = p.cardCost ?? 0;
    const revenue = revenueM(p.price, p.production);
    const cost = productionCostM(args.marginalCost, p.production);
    const profit = revenue - cost;
    const factor = fvFactor(p.period, args.totalPeriods, config);
    const fv = (profit + hedge - (compounded ? cardCost : 0)) * factor;
    totalFv += fv;
    cardCosts += cardCost;
    remaining -= p.production;
    return { ...p, hedge, cardCost, revenue, cost, profit, factor, fv };
  });
  const tv = terminalValue(args.marginalCost, remaining, config);
  const cardDeduction = compounded ? 0 : cardCosts;
  return {
    periods,
    totalFv,
    terminalValue: tv,
    cardCosts,
    cardDeduction,
    finalWealth: totalFv + tv - cardDeduction,
    remainingReserves: remaining,
  };
}
