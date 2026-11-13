/**
 * Game configuration — TypeScript mirror of `opec_default_config()` in
 * supabase/migrations/20261112000200_price_engine.sql.
 *
 * The server stores a fully merged copy of this object on every game session
 * (game_sessions.config) and all authoritative calculations use that copy.
 * The client only uses it for previews/estimates and to explain the rules.
 */
export type DemandType = 'low' | 'high';
export type StrategyCard = 'eor' | 'capacity_expansion' | 'price_hedge';
export type CardType = StrategyCard | 'audit';

export interface PriceConfig {
  model: string;
  /** production shares of capacity, ascending (0.6 … 1.0) */
  shares: number[];
  low: number[];
  high: number[];
  /** ASSUMPTION: behaviour outside the table range */
  extrapolation: 'linear' | 'clamp';
  /** ASSUMPTION: how a demand change moves the price curve */
  demand_shift: 'quantity' | 'price';
  floor: number;
  ceiling: number;
}

export interface GameConfig {
  price: PriceConfig;
  demand: {
    odd_periods: DemandType;
    even_periods: DemandType;
    noise_pct: number;
    noise_scope: 'session' | 'world';
  };
  events: { recession_pct: number; boom_pct: number };
  accounting: {
    interest_rate: number;
    compound_to_period: number | null;
    terminal_price: number;
    card_cost_mode: 'nominal' | 'compounded';
    hedge_in_profit: boolean;
  };
  production: { missing_first_period_pct: number };
  cards: {
    audit: { cost_per_1000_capacity: number };
    eor: { cost_per_1000_capacity: number; delay: number; reserve_increase: number };
    capacity_expansion: { cost_per_1000_capacity: number; delay: number; capacity_increase: number };
    price_hedge: {
      cost_per_1000_capacity: number;
      delay: number;
      duration: number;
      strike: number;
      volume_share: number;
    };
    jpr: { required_yes: number; periods_revealed: number };
  };
  talk: { start_period: number };
  pledge: { start_period: number };
  reveal_all_after_game: boolean;
  rng_seed: string | null;
}

export const DEFAULT_CONFIG: GameConfig = {
  price: {
    model: 'piecewise_linear_reference_table',
    shares: [0.6, 0.7, 0.8, 0.9, 1.0],
    low: [119, 105, 92, 78, 65],
    high: [140, 128, 115, 103, 91],
    extrapolation: 'linear',
    demand_shift: 'quantity',
    floor: 1,
    ceiling: 300,
  },
  demand: { odd_periods: 'low', even_periods: 'high', noise_pct: 1.5, noise_scope: 'session' },
  events: { recession_pct: -5, boom_pct: 5 },
  accounting: {
    interest_rate: 0.05,
    compound_to_period: null,
    terminal_price: 70,
    card_cost_mode: 'nominal',
    hedge_in_profit: true,
  },
  production: { missing_first_period_pct: 0 },
  cards: {
    audit: { cost_per_1000_capacity: 5 },
    eor: { cost_per_1000_capacity: 75, delay: 3, reserve_increase: 0.1 },
    capacity_expansion: { cost_per_1000_capacity: 12, delay: 2, capacity_increase: 0.2 },
    price_hedge: { cost_per_1000_capacity: 10, delay: 1, duration: 3, strike: 95, volume_share: 0.5 },
    jpr: { required_yes: 4, periods_revealed: 2 },
  },
  talk: { start_period: 3 },
  pledge: { start_period: 3 },
  reveal_all_after_game: true,
  rng_seed: null,
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Recursive merge with the same semantics as `opec_jsonb_merge` (arrays are replaced). */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** Merge a (possibly partial) server config over the defaults. */
export function resolveConfig(config?: unknown): GameConfig {
  return deepMerge(DEFAULT_CONFIG, (config ?? {}) as Json);
}
