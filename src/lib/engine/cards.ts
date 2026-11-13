/**
 * Card economics and timing — mirror of `_buy_strategy_card()`, `use_audit()`
 * and the activation step of `open_period()`.
 */
import type { CardType, GameConfig, StrategyCard } from './config';

/** Card cost in $M: rate ($M per 1,000 kb of capacity) × capacity / 1000. */
export function cardCost(card: CardType, capacity: number, config: GameConfig): number {
  return (config.cards[card].cost_per_1000_capacity * capacity) / 1000;
}

export interface CardTimeline {
  purchasePeriod: number;
  activationPeriod: number;
  /** last active period (price hedge only) */
  endPeriod: number | null;
  activePeriods: number;
  /** activation would fall after the last period: purchase is refused */
  tooLate: boolean;
}

export function cardTimeline(
  card: StrategyCard,
  purchasePeriod: number,
  totalPeriods: number,
  config: GameConfig,
): CardTimeline {
  const activationPeriod = purchasePeriod + config.cards[card].delay;
  const tooLate = activationPeriod > totalPeriods;
  if (card === 'price_hedge') {
    const endPeriod = Math.min(activationPeriod + config.cards.price_hedge.duration - 1, totalPeriods);
    return {
      purchasePeriod,
      activationPeriod,
      endPeriod,
      activePeriods: tooLate ? 0 : endPeriod - activationPeriod + 1,
      tooLate,
    };
  }
  return {
    purchasePeriod,
    activationPeriod,
    endPeriod: null,
    activePeriods: tooLate ? 0 : totalPeriods - activationPeriod + 1,
    tooLate,
  };
}

export function isHedgeActive(period: number, activation: number, end: number | null): boolean {
  return end !== null && period >= activation && period <= end;
}

/** Capacity in a given period, accounting for a capacity expansion purchase. */
export function capacityInPeriod(
  baseCapacity: number,
  period: number,
  expansion: { activationPeriod: number } | null,
  config: GameConfig,
): number {
  if (expansion && period >= expansion.activationPeriod) {
    return Math.round(baseCapacity * (1 + config.cards.capacity_expansion.capacity_increase));
  }
  return baseCapacity;
}

/** One-time reserve addition from Enhanced Oil Recovery (10 % of ORIGINAL reserves). */
export function eorBonus(originalReserves: number, config: GameConfig): number {
  return Math.round(originalReserves * config.cards.eor.reserve_increase);
}

/** Fixed hedged volume (kb): 50 % of capacity at purchase. */
export function hedgeVolume(capacity: number, config: GameConfig): number {
  return Math.round(capacity * config.cards.price_hedge.volume_share);
}
