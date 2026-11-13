-- =============================================================================
-- OPEC Game — Migration 2/4: ECONOMIC ENGINE (price + accounting primitives)
--
-- >>> This file is the single server-side module for market pricing. <<<
--
-- IMPORTANT — ASSUMPTION NOTICE
-- The course's introductory material only gives reference prices for the case in
-- which ALL seven countries produce the SAME share of their capacity:
--
--     share of capacity   low demand   high demand
--          100%              $65          $91
--           90%              $78         $103
--           80%              $92         $115
--           70%             $105         $128
--           60%             $119         $140
--
-- It does not publish the full price function for arbitrary production mixes.
-- The model below is an INFERRED, CONFIGURABLE ASSUMPTION — it is NOT the
-- instructor's official formula. It reproduces the table exactly at the listed
-- points:
--
--   1. S      = total world production / reference capacity
--               (reference capacity = sum of the seven countries' ORIGINAL
--               capacities = 33,700 kb; fixed, so the price depends only on total
--               production). When every country produces x% of capacity, S = x.
--   2. D      = demand factor = (1 + random noise) * (1 + event effect)
--               (noise uniform in +/- demand.noise_pct %, events +/- 5 %)
--   3. S_eff  = S / D            when price.demand_shift = 'quantity' (default:
--               a +5 % demand shift means the market absorbs 5 % more oil at the
--               same price), or S_eff = S when demand_shift = 'price'.
--   4. P      = piecewise-linear interpolation of the table at S_eff for the
--               period's demand curve (odd periods = low, even periods = high).
--   5. Outside 60 %–100 % (price.extrapolation):
--         'linear' (default) — extend the slope of the nearest table segment
--         'clamp'            — hold the end-point price constant
--   6. If demand_shift = 'price', P = P * D.
--   7. P is bounded by [price.floor, price.ceiling] and rounded to cents.
--
-- To plug in an official formula, replace opec_effective_share()/opec_price()
-- below (and the TypeScript mirror in src/lib/engine/price.ts used for
-- client-side previews) — nothing else in the game needs to change.
-- =============================================================================

-- Recursive jsonb merge: values in b override values in a; nested objects merge.
create or replace function public.opec_jsonb_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when a is null then b
    when b is null then a
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(
               coalesce(ka, kb),
               case
                 when va is null then vb
                 when vb is null then va
                 else public.opec_jsonb_merge(va, vb)
               end), '{}'::jsonb)
      from jsonb_each(a) as ea(ka, va)
      full join jsonb_each(b) as eb(kb, vb) on ka = kb
    )
    else b
  end
$$;

-- Default game configuration. Every documented assumption lives here.
create or replace function public.opec_default_config()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'price', jsonb_build_object(
      'model',          'piecewise_linear_reference_table',
      'shares',         jsonb_build_array(0.6, 0.7, 0.8, 0.9, 1.0),
      'low',            jsonb_build_array(119, 105, 92, 78, 65),
      'high',           jsonb_build_array(140, 128, 115, 103, 91),
      'extrapolation',  'linear',      -- 'linear' | 'clamp'      (ASSUMPTION)
      'demand_shift',   'quantity',    -- 'quantity' | 'price'    (ASSUMPTION)
      'floor',          1,             -- USD/bbl                 (ASSUMPTION)
      'ceiling',        300            -- USD/bbl                 (ASSUMPTION)
    ),
    'demand', jsonb_build_object(
      'odd_periods',  'low',
      'even_periods', 'high',
      'noise_pct',    1.5,
      'noise_scope',  'session'        -- 'session' (same draw for A/B/C) | 'world'
    ),
    'events', jsonb_build_object(
      'recession_pct', -5,
      'boom_pct',       5
    ),
    'accounting', jsonb_build_object(
      'interest_rate',      0.05,
      'compound_to_period', null,      -- null => total_periods + 1 (= 11)
      'terminal_price',     70,
      'card_cost_mode',     'nominal', -- 'nominal' | 'compounded'  (ASSUMPTION)
      'hedge_in_profit',    true       -- hedge payouts compound with the period's profit
    ),
    'production', jsonb_build_object(
      'missing_first_period_pct', 0    -- used when Period 1 has no submission (ASSUMPTION)
    ),
    'cards', jsonb_build_object(
      'audit',              jsonb_build_object('cost_per_1000_capacity', 5),
      'eor',                jsonb_build_object('cost_per_1000_capacity', 75, 'delay', 3, 'reserve_increase', 0.10),
      'capacity_expansion', jsonb_build_object('cost_per_1000_capacity', 12, 'delay', 2, 'capacity_increase', 0.20),
      'price_hedge',        jsonb_build_object('cost_per_1000_capacity', 10, 'delay', 1, 'duration', 3,
                                               'strike', 95, 'volume_share', 0.5),
      'jpr',                jsonb_build_object('required_yes', 4, 'periods_revealed', 2)
    ),
    'talk',   jsonb_build_object('start_period', 3),
    'pledge', jsonb_build_object('start_period', 3),
    'reveal_all_after_game', true,
    'rng_seed', null
  )
$$;

create or replace function public.opec_config(p_overrides jsonb)
returns jsonb
language sql
immutable
as $$
  select public.opec_jsonb_merge(public.opec_default_config(), coalesce(p_overrides, '{}'::jsonb))
$$;

-- Demand curve for a period: odd = low, even = high (configurable).
create or replace function public.opec_demand_type(p_period int, p_config jsonb)
returns text
language sql
immutable
as $$
  select case when p_period % 2 = 1
              then coalesce(p_config #>> '{demand,odd_periods}', 'low')
              else coalesce(p_config #>> '{demand,even_periods}', 'high') end
$$;

-- Piecewise-linear interpolation through (xs[i], ys[i]); xs ascending.
create or replace function public.opec_interp(p_xs numeric[], p_ys numeric[], p_x numeric, p_extrapolation text)
returns numeric
language plpgsql
immutable
as $$
declare
  n int := array_length(p_xs, 1);
  i int;
begin
  if n is null or n < 2 or array_length(p_ys, 1) <> n then
    raise exception 'price table must have at least two points';
  end if;

  if p_x <= p_xs[1] then
    if p_extrapolation = 'clamp' then return p_ys[1]; end if;
    return p_ys[1] + (p_x - p_xs[1]) * (p_ys[2] - p_ys[1]) / (p_xs[2] - p_xs[1]);
  end if;

  if p_x >= p_xs[n] then
    if p_extrapolation = 'clamp' then return p_ys[n]; end if;
    return p_ys[n] + (p_x - p_xs[n]) * (p_ys[n] - p_ys[n - 1]) / (p_xs[n] - p_xs[n - 1]);
  end if;

  for i in 1 .. n - 1 loop
    if p_x >= p_xs[i] and p_x <= p_xs[i + 1] then
      return p_ys[i] + (p_x - p_xs[i]) * (p_ys[i + 1] - p_ys[i]) / (p_xs[i + 1] - p_xs[i]);
    end if;
  end loop;

  return p_ys[n];
end
$$;

create or replace function public.opec_effective_share(
  p_total_production   numeric,
  p_reference_capacity numeric,
  p_demand_factor      numeric,
  p_config             jsonb
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_config #>> '{price,demand_shift}', 'quantity') = 'quantity'
      then (p_total_production / p_reference_capacity) / nullif(p_demand_factor, 0)
    else p_total_production / p_reference_capacity
  end
$$;

-- THE PRICE FUNCTION (USD/bbl). Identical inputs always give identical outputs.
create or replace function public.opec_price(
  p_total_production   numeric,
  p_reference_capacity numeric,
  p_demand_type        text,
  p_demand_factor      numeric,
  p_config             jsonb
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_shares numeric[];
  v_prices numeric[];
  v_share  numeric;
  v_price  numeric;
  v_floor  numeric := coalesce((p_config #>> '{price,floor}')::numeric, 1);
  v_ceil   numeric := coalesce((p_config #>> '{price,ceiling}')::numeric, 300);
begin
  select array_agg(value::numeric order by ord)
    into v_shares
    from jsonb_array_elements_text(p_config #> '{price,shares}') with ordinality as t(value, ord);
  select array_agg(value::numeric order by ord)
    into v_prices
    from jsonb_array_elements_text(p_config #> array['price', p_demand_type]) with ordinality as t(value, ord);

  v_share := public.opec_effective_share(p_total_production, p_reference_capacity, p_demand_factor, p_config);
  v_price := public.opec_interp(v_shares, v_prices, v_share, coalesce(p_config #>> '{price,extrapolation}', 'linear'));

  if coalesce(p_config #>> '{price,demand_shift}', 'quantity') = 'price' then
    v_price := v_price * p_demand_factor;
  end if;

  return round(least(greatest(v_price, v_floor), v_ceil), 2);
end
$$;

-- Deterministic uniform draw in [0, 1] from a seed + label (used when rng_seed is set).
create or replace function public.opec_seeded_uniform(p_seed text, p_label text)
returns numeric
language sql
immutable
as $$
  select (abs(hashtextextended(p_seed || ':' || p_label, 0)) % 1000001)::numeric / 1000000
$$;

-- ---------------------------------------------------------------------------
-- Accounting primitives (all money in $M; production in kb; prices in USD/bbl)
-- ---------------------------------------------------------------------------

-- Compounding factor for a cash flow in period t: (1 + r)^(T_c - t), T_c = 11 by default.
create or replace function public.opec_fv_factor(p_period int, p_total_periods int, p_config jsonb)
returns numeric
language sql
immutable
as $$
  select power(
    1 + coalesce((p_config #>> '{accounting,interest_rate}')::numeric, 0.05),
    coalesce((p_config #>> '{accounting,compound_to_period}')::int, p_total_periods + 1) - p_period
  )::numeric
$$;

-- Value of oil left in the ground after the last period: (70 - MC) * reserves.
create or replace function public.opec_terminal_value(p_marginal_cost numeric, p_remaining numeric, p_config jsonb)
returns numeric
language sql
immutable
as $$
  select (coalesce((p_config #>> '{accounting,terminal_price}')::numeric, 70) - p_marginal_cost) * p_remaining / 1000
$$;

-- Price hedge payout: max(0, strike - price) * hedged volume (kb) -> $M
create or replace function public.opec_hedge_payout(p_price numeric, p_volume numeric, p_strike numeric)
returns numeric
language sql
immutable
as $$
  select greatest(0, p_strike - p_price) * p_volume / 1000
$$;
