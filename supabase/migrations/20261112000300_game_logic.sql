-- =============================================================================
-- OPEC Game — Migration 3/4: game logic (server-authoritative RPCs)
--
-- Every write in the game goes through these functions. Clients never send
-- prices, profits, limits, reserves, card eligibility or wealth — those are
-- always computed here. Functions that mutate state are SECURITY DEFINER with a
-- fixed search_path and perform their own authorization checks.
--
-- Concurrency model
--   * close / open / reset / end lock the game_sessions row FOR UPDATE.
--   * student writes (submit, pledge, cards) lock the session row FOR SHARE, so
--     they either finish before a period closes or see the period as closed.
--   * a period is closed exactly once: the close function re-checks
--     periods.status = 'open' under the session lock, and the results tables
--     carry unique (…, period_number) constraints as a final guard.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers (also used by row-level security policies)
-- -----------------------------------------------------------------------------
create or replace function public.is_instructor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
      or exists (select 1 from public.instructors i where i.user_id = auth.uid())
$$;

create or replace function public.my_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.group_id from public.group_controls c where c.controller_uid = auth.uid()
$$;

create or replace function public.my_world_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select g.world_id
    from public.group_controls c
    join public.groups g on g.id = c.group_id
   where c.controller_uid = auth.uid()
$$;

create or replace function public.my_session_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.session_id from public.group_controls c where c.controller_uid = auth.uid()
$$;

-- After the game is over every country's history is revealed to the players of
-- that session (configurable: config.reveal_all_after_game).
create or replace function public.revealed_after_game(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions s
     where s.id = p_session
       and s.status = 'finished'
       and coalesce((s.config ->> 'reveal_all_after_game')::boolean, true)
       and s.id = (select c.session_id from public.group_controls c where c.controller_uid = auth.uid())
  )
$$;

create or replace function public.session_finished_for_me(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions s
     where s.id = p_session
       and s.status = 'finished'
       and s.id = (select c.session_id from public.group_controls c where c.controller_uid = auth.uid())
  )
$$;

-- -----------------------------------------------------------------------------
-- Internal helpers (not executable by API roles — see migration 4)
-- -----------------------------------------------------------------------------
create or replace function public._raise(p_code text, p_detail text default null)
returns void
language plpgsql
as $$
begin
  raise exception using message = p_code, errcode = 'P0001', detail = coalesce(p_detail, '');
end
$$;

create or replace function public._require_instructor()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_instructor() then
    perform public._raise('not_instructor');
  end if;
end
$$;

create or replace function public._notice(
  p_session uuid, p_world uuid, p_group uuid, p_category text, p_kind text,
  p_payload jsonb default '{}'::jsonb, p_body text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notices (session_id, world_id, group_id, category, kind, payload, body)
  values (p_session, p_world, p_group, p_category, p_kind, coalesce(p_payload, '{}'::jsonb), p_body)
$$;

create or replace function public._gen_access_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code  text;
  i       int;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0 .. 5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.group_controls where access_code = v_code);
  end loop;
  return v_code;
end
$$;

-- (Re)build a group's country state from the reference data.
create or replace function public._init_country_state(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.country_states where group_id = p_group;
  insert into public.country_states (
    group_id, session_id, world_id, country_code, marginal_cost,
    base_capacity, capacity, original_reserves, remaining_reserves, estimated_wealth)
  select g.id, g.session_id, g.world_id, c.code, c.marginal_cost,
         c.capacity, c.capacity, c.reserves, c.reserves,
         public.opec_terminal_value(c.marginal_cost, c.reserves, s.config)
    from public.groups g
    join public.countries c on c.code = g.country_code
    join public.game_sessions s on s.id = g.session_id
   where g.id = p_group;
end
$$;

-- Wealth "if the game ended now": compounded cash flows + value of remaining oil
-- - card costs (nominal mode) or - not-yet-closed card costs compounded (compounded mode).
create or replace function public._estimated_wealth(p_group uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select cs.cumulative_fv
       + public.opec_terminal_value(cs.marginal_cost, cs.remaining_reserves, s.config)
       - case when s.config #>> '{accounting,card_cost_mode}' = 'compounded'
              then coalesce((
                     select sum(cp.cost * public.opec_fv_factor(cp.purchased_period, s.total_periods, s.config))
                       from public.card_purchases cp
                      where cp.group_id = cs.group_id
                        and not exists (select 1 from public.periods p
                                         where p.session_id = s.id
                                           and p.number = cp.purchased_period
                                           and p.status = 'closed')), 0)
              else cs.card_costs end
    from public.country_states cs
    join public.game_sessions s on s.id = cs.session_id
   where cs.group_id = p_group
$$;

create or replace function public._refresh_wealth(p_group uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.country_states
     set estimated_wealth = public._estimated_wealth(p_group), updated_at = now()
   where group_id = p_group
$$;

-- The period that communication rules refer to: the open period, or the next
-- period to be played when the game is between periods.
create or replace function public._talk_period(p_session uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when exists (select 1 from public.periods p
                         where p.session_id = s.id and p.number = s.current_period and p.status = 'open')
             then s.current_period
           else s.current_period + 1
         end
    from public.game_sessions s
   where s.id = p_session
$$;

-- Returns the open period of a session (locked FOR SHARE on the session) or raises.
create or replace function public._open_period_number(p_session uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_period  public.periods%rowtype;
begin
  select * into v_session from public.game_sessions where id = p_session for share;
  if not found then perform public._raise('session_not_found'); end if;
  if v_session.status <> 'running' then perform public._raise('game_not_running'); end if;

  select * into v_period from public.periods
   where session_id = p_session and number = v_session.current_period;
  if not found or v_period.status <> 'open' then
    perform public._raise('period_not_open');
  end if;
  if v_period.closes_at is not null and now() >= v_period.closes_at then
    perform public._raise('period_closed');
  end if;
  return v_period.number;
end
$$;

-- -----------------------------------------------------------------------------
-- Internal game actions shared by students, bots and the instructor
-- -----------------------------------------------------------------------------
create or replace function public._submit_production(p_group uuid, p_period int, p_production numeric, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.country_states%rowtype;
  v_limit numeric;
  v_prod  numeric;
  v_row   public.production_submissions%rowtype;
begin
  if p_production is null or p_production < 0 then
    perform public._raise('invalid_production');
  end if;
  v_prod := round(p_production);

  select * into v_state from public.country_states where group_id = p_group for update;
  v_limit := greatest(0, least(v_state.capacity, v_state.remaining_reserves));
  if v_prod > v_limit then
    perform public._raise('exceeds_limit', v_limit::text);
  end if;

  insert into public.production_submissions as ps
    (session_id, world_id, group_id, period_number, production, production_pct, source)
  values
    (v_state.session_id, v_state.world_id, p_group, p_period, v_prod,
     round(v_prod / v_state.capacity * 100, 4), p_source)
  on conflict (group_id, period_number) do update
     set production     = excluded.production,
         production_pct = excluded.production_pct,
         source         = excluded.source,
         revision       = ps.revision + 1,
         updated_at     = now()
  returning * into v_row;

  return to_jsonb(v_row) || jsonb_build_object('limit', v_limit);
end
$$;

create or replace function public._buy_strategy_card(p_group uuid, p_card text, p_period int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state   public.country_states%rowtype;
  v_session public.game_sessions%rowtype;
  v_cfg     jsonb;
  v_act     int;
  v_end     int;
  v_cost    numeric;
  v_details jsonb;
  v_row     public.card_purchases%rowtype;
begin
  if p_card not in ('eor', 'capacity_expansion', 'price_hedge') then
    perform public._raise('invalid_card');
  end if;

  select * into v_state from public.country_states where group_id = p_group for update;
  if v_state.strategy_card is not null then
    perform public._raise('strategy_card_already_used');
  end if;

  select * into v_session from public.game_sessions where id = v_state.session_id;
  v_cfg  := v_session.config -> 'cards' -> p_card;
  v_act  := p_period + (v_cfg ->> 'delay')::int;
  if v_act > v_session.total_periods then
    perform public._raise('card_too_late', v_act::text);
  end if;
  v_cost := (v_cfg ->> 'cost_per_1000_capacity')::numeric * v_state.capacity / 1000;

  if p_card = 'price_hedge' then
    v_end := least(v_act + (v_cfg ->> 'duration')::int - 1, v_session.total_periods);
    v_details := jsonb_build_object(
      'strike', (v_cfg ->> 'strike')::numeric,
      'volume_share', (v_cfg ->> 'volume_share')::numeric,
      'volume', round((v_cfg ->> 'volume_share')::numeric * v_state.capacity));
  elsif p_card = 'eor' then
    v_end := null;
    v_details := jsonb_build_object(
      'reserve_increase', (v_cfg ->> 'reserve_increase')::numeric,
      'bonus', round((v_cfg ->> 'reserve_increase')::numeric * v_state.original_reserves));
  else
    v_end := null;
    v_details := jsonb_build_object(
      'capacity_increase', (v_cfg ->> 'capacity_increase')::numeric,
      'new_capacity', round(v_state.base_capacity * (1 + (v_cfg ->> 'capacity_increase')::numeric)));
  end if;

  insert into public.card_purchases
    (session_id, world_id, group_id, card_type, purchased_period, capacity_basis, cost,
     activation_period, end_period, details)
  values
    (v_state.session_id, v_state.world_id, p_group, p_card, p_period, v_state.capacity, v_cost,
     v_act, v_end, v_details)
  returning * into v_row;

  update public.country_states
     set strategy_card = p_card,
         card_costs    = card_costs + v_cost,
         updated_at    = now()
   where group_id = p_group;
  perform public._refresh_wealth(p_group);

  perform public._notice(v_state.session_id, null, p_group, 'card', 'card_purchased',
    jsonb_build_object('card', p_card, 'cost', v_cost, 'period', p_period,
                       'activation_period', v_act, 'end_period', v_end));
  return to_jsonb(v_row);
end
$$;

-- Resolve a Joint Production Review vote if the outcome is decided.
create or replace function public._jpr_resolve(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req     public.jpr_requests%rowtype;
  v_session public.game_sessions%rowtype;
  v_members int;
  v_periods int[];
  v_n       int;
begin
  select * into v_req from public.jpr_requests where id = p_request for update;
  if v_req.status <> 'voting' then return; end if;
  select * into v_session from public.game_sessions where id = v_req.session_id;
  select count(*) into v_members from public.groups where world_id = v_req.world_id;

  if v_req.yes_count >= v_req.required_yes then
    v_n := coalesce((v_session.config #>> '{cards,jpr,periods_revealed}')::int, 2);
    select array_agg(number order by number) into v_periods
      from (select number from public.periods
             where session_id = v_req.session_id and status = 'closed'
             order by number desc limit v_n) last_closed;

    insert into public.jpr_reveals (request_id, session_id, world_id, group_id, country_code, period_number, production_pct)
    select v_req.id, r.session_id, r.world_id, r.group_id, r.country_code, r.period_number, r.production_pct
      from public.country_period_results r
     where r.world_id = v_req.world_id
       and r.period_number = any (coalesce(v_periods, '{}'::int[]));

    update public.jpr_requests
       set status = 'approved', resolved_at = now(), revealed_periods = coalesce(v_periods, '{}'::int[])
     where id = v_req.id;
    perform public._notice(v_req.session_id, v_req.world_id, null, 'world', 'jpr_result',
      jsonb_build_object('approved', true, 'yes', v_req.yes_count, 'no', v_req.no_count,
                         'periods', to_jsonb(coalesce(v_periods, '{}'::int[]))));
  elsif v_members - v_req.no_count < v_req.required_yes then
    update public.jpr_requests set status = 'rejected', resolved_at = now() where id = v_req.id;
    perform public._notice(v_req.session_id, v_req.world_id, null, 'world', 'jpr_result',
      jsonb_build_object('approved', false, 'yes', v_req.yes_count, 'no', v_req.no_count));
  end if;
end
$$;

create or replace function public._cast_jpr_vote(p_request uuid, p_group uuid, p_vote boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.jpr_votes (request_id, group_id, vote) values (p_request, p_group, p_vote);
  update public.jpr_requests
     set yes_count = yes_count + case when p_vote then 1 else 0 end,
         no_count  = no_count  + case when p_vote then 0 else 1 end
   where id = p_request;
end
$$;

-- -----------------------------------------------------------------------------
-- Demo mode: simulated groups ("bots")
-- -----------------------------------------------------------------------------
create or replace function public._bot_pct(p_strategy text, p_group uuid, p_label text)
returns numeric
language sql
immutable
as $$
  select case coalesce(p_strategy, 'random')
           when 'cooperative' then 72 + 6  * public.opec_seeded_uniform(p_group::text, p_label)
           when 'moderate'    then 82 + 6  * public.opec_seeded_uniform(p_group::text, p_label)
           when 'competitive' then 95 + 5  * public.opec_seeded_uniform(p_group::text, p_label)
           else                    60 + 40 * public.opec_seeded_uniform(p_group::text, p_label)
         end
$$;

create or replace function public._bot_play(p_session uuid, p_period int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_bot     record;
  v_prod    numeric;
  v_count   int := 0;
  v_card    text;
begin
  select * into v_session from public.game_sessions where id = p_session;

  for v_bot in
    select g.id, g.bot_strategy, cs.capacity, cs.remaining_reserves, cs.strategy_card,
           cs.session_id, cs.world_id, cs.country_code
      from public.groups g
      join public.country_states cs on cs.group_id = g.id
     where g.session_id = p_session and g.is_bot
  loop
    -- strategy cards (once): competitive -> capacity expansion, cooperative -> EOR,
    -- random -> sometimes a price hedge
    if v_bot.strategy_card is null then
      v_card := case
        when p_period = 2 and v_bot.bot_strategy = 'competitive' then 'capacity_expansion'
        when p_period = 2 and v_bot.bot_strategy = 'cooperative' then 'eor'
        when p_period = 3 and coalesce(v_bot.bot_strategy, 'random') = 'random'
             and public.opec_seeded_uniform(v_bot.id::text, 'hedge') < 0.5 then 'price_hedge'
        else null end;
      if v_card is not null then
        begin
          perform public._buy_strategy_card(v_bot.id, v_card, p_period);
        exception when others then
          null; -- a bot never blocks the game
        end;
      end if;
    end if;

    v_prod := least(
      round(public._bot_pct(v_bot.bot_strategy, v_bot.id, 'p' || p_period) / 100 * v_bot.capacity),
      greatest(0, least(v_bot.capacity, v_bot.remaining_reserves)));

    insert into public.production_submissions
      (session_id, world_id, group_id, period_number, production, production_pct, source)
    values
      (v_bot.session_id, v_bot.world_id, v_bot.id, p_period, v_prod,
       round(v_prod / v_bot.capacity * 100, 4), 'bot')
    on conflict (group_id, period_number) do nothing;

    if p_period >= coalesce((v_session.config #>> '{pledge,start_period}')::int, 3) then
      insert into public.public_pledges (session_id, world_id, group_id, country_code, period_number, pledge_pct)
      values (v_bot.session_id, v_bot.world_id, v_bot.id, v_bot.country_code, p_period,
              case coalesce(v_bot.bot_strategy, 'random')
                when 'cooperative' then 75
                when 'moderate'    then 85
                when 'competitive' then 80   -- pledges restraint, produces flat out
                else round(70 + 20 * public.opec_seeded_uniform(v_bot.id::text, 'pl' || p_period)) end)
      on conflict (group_id, period_number) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

create or replace function public._bot_vote_jpr(p_request uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.jpr_requests%rowtype;
  v_bot record;
begin
  select * into v_req from public.jpr_requests where id = p_request;
  for v_bot in
    select g.id, g.bot_strategy from public.groups g
     where g.world_id = v_req.world_id and g.is_bot
       and not exists (select 1 from public.jpr_votes v where v.request_id = p_request and v.group_id = g.id)
  loop
    perform public._cast_jpr_vote(p_request, v_bot.id,
      case coalesce(v_bot.bot_strategy, 'random')
        when 'cooperative' then true
        when 'moderate'    then true
        when 'competitive' then false
        else public.opec_seeded_uniform(v_bot.id::text, p_request::text) < 0.5 end);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Period closing: the market-clearing calculation for ALL worlds in one
-- transaction. Idempotent: returns {closed:false} if the period is not open.
-- -----------------------------------------------------------------------------
create or replace function public._close_period(p_session uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.game_sessions%rowtype;
  v_period    public.periods%rowtype;
  v_cfg       jsonb;
  v_n         int;
  v_noise_pct numeric;
  v_noise     numeric;
  v_df        numeric;
  v_world     record;
  v_world_noise numeric;
  v_world_df  numeric;
  v_total     numeric;
  v_ref       numeric;
  v_price     numeric;
  v_g         record;
  v_prod      numeric;
  v_limit     numeric;
  v_revenue   numeric;
  v_cost      numeric;
  v_profit    numeric;
  v_hedge     numeric;
  v_card_cost numeric;
  v_factor    numeric;
  v_cash      numeric;
  v_fv        numeric;
  v_remaining numeric;
  v_cum_fv    numeric;
  v_terminal  numeric;
  v_wealth    numeric;
  v_compounded boolean;
  v_prices    jsonb := '{}'::jsonb;
begin
  select * into v_session from public.game_sessions where id = p_session for update;
  if not found then perform public._raise('session_not_found'); end if;

  select * into v_period from public.periods
   where session_id = p_session and number = v_session.current_period
   for update;
  if not found or v_period.status <> 'open' then
    return jsonb_build_object('closed', false, 'reason', 'not_open', 'period', v_session.current_period);
  end if;

  v_cfg        := v_session.config;
  v_n          := v_period.number;
  v_compounded := (v_cfg #>> '{accounting,card_cost_mode}') = 'compounded';
  v_noise_pct  := coalesce((v_cfg #>> '{demand,noise_pct}')::numeric, 1.5) / 100;

  -- 1. Random demand variation (one draw shared by all worlds unless noise_scope = 'world')
  v_noise := case
    when v_cfg ->> 'rng_seed' is not null
      then (public.opec_seeded_uniform(v_cfg ->> 'rng_seed', 'period:' || v_n) * 2 - 1) * v_noise_pct
    else (random() * 2 - 1) * v_noise_pct end;
  v_noise := round(v_noise, 6);
  v_df    := (1 + v_noise) * v_period.event_multiplier;

  -- 2. Missing submissions repeat the previous period's output, within current limits
  for v_g in
    select cs.* from public.country_states cs
     where cs.session_id = p_session
       and not exists (select 1 from public.production_submissions ps
                        where ps.group_id = cs.group_id and ps.period_number = v_n)
  loop
    v_limit := greatest(0, least(v_g.capacity, v_g.remaining_reserves));
    v_prod  := coalesce(v_g.last_production,
                        round(coalesce((v_cfg #>> '{production,missing_first_period_pct}')::numeric, 0) / 100 * v_g.capacity));
    v_prod  := least(v_prod, v_limit);
    insert into public.production_submissions
      (session_id, world_id, group_id, period_number, production, production_pct, source)
    values
      (v_g.session_id, v_g.world_id, v_g.group_id, v_n, v_prod, round(v_prod / v_g.capacity * 100, 4), 'auto_repeat');
    perform public._notice(p_session, null, v_g.group_id, 'game', 'auto_submitted',
      jsonb_build_object('period', v_n, 'production', v_prod));
  end loop;

  -- 3. Clear each world's market
  for v_world in select * from public.worlds where session_id = p_session order by code loop
    if (v_cfg #>> '{demand,noise_scope}') = 'world' then
      v_world_noise := case
        when v_cfg ->> 'rng_seed' is not null
          then (public.opec_seeded_uniform(v_cfg ->> 'rng_seed', 'period:' || v_n || ':' || v_world.code) * 2 - 1) * v_noise_pct
        else (random() * 2 - 1) * v_noise_pct end;
      v_world_df := (1 + round(v_world_noise, 6)) * v_period.event_multiplier;
    else
      v_world_df := v_df;
    end if;

    select coalesce(sum(least(ps.production, greatest(0, least(cs.capacity, cs.remaining_reserves)))), 0),
           sum(cs.base_capacity)
      into v_total, v_ref
      from public.country_states cs
      left join public.production_submissions ps
        on ps.group_id = cs.group_id and ps.period_number = v_n
     where cs.world_id = v_world.id;

    v_price := public.opec_price(v_total, v_ref, v_period.demand_type, v_world_df, v_cfg);
    v_prices := v_prices || jsonb_build_object(v_world.code, v_price);

    insert into public.world_period_results
      (session_id, world_id, period_number, demand_type, demand_factor, total_production,
       reference_capacity, production_share, effective_share, price)
    values
      (p_session, v_world.id, v_n, v_period.demand_type, v_world_df, v_total,
       v_ref, v_total / v_ref, public.opec_effective_share(v_total, v_ref, v_world_df, v_cfg), v_price);

    for v_g in
      select cs.*, ps.production as submitted, ps.source
        from public.country_states cs
        join public.production_submissions ps on ps.group_id = cs.group_id and ps.period_number = v_n
       where cs.world_id = v_world.id
       for update of cs
    loop
      v_prod    := least(v_g.submitted, greatest(0, least(v_g.capacity, v_g.remaining_reserves)));
      v_revenue := v_price * v_prod / 1000;
      v_cost    := v_g.marginal_cost * v_prod / 1000;
      v_profit  := v_revenue - v_cost;

      select coalesce(sum(public.opec_hedge_payout(v_price, (cp.details ->> 'volume')::numeric,
                                                   (cp.details ->> 'strike')::numeric)), 0)
        into v_hedge
        from public.card_purchases cp
       where cp.group_id = v_g.group_id and cp.card_type = 'price_hedge'
         and v_n between cp.activation_period and cp.end_period;

      select coalesce(sum(cp.cost), 0) into v_card_cost
        from public.card_purchases cp
       where cp.group_id = v_g.group_id and cp.purchased_period = v_n;

      v_factor    := public.opec_fv_factor(v_n, v_session.total_periods, v_cfg);
      v_cash      := v_profit + v_hedge - case when v_compounded then v_card_cost else 0 end;
      v_fv        := v_cash * v_factor;
      v_remaining := v_g.remaining_reserves - v_prod;
      v_cum_fv    := v_g.cumulative_fv + v_fv;
      v_terminal  := public.opec_terminal_value(v_g.marginal_cost, v_remaining, v_cfg);
      v_wealth    := v_cum_fv + v_terminal - case when v_compounded then 0 else v_g.card_costs end;

      insert into public.country_period_results
        (session_id, world_id, group_id, country_code, period_number, production, capacity,
         production_pct, auto_submitted, price, revenue, production_cost, profit, hedge_payout,
         card_cost, fv_factor, fv_amount, cumulative_fv, remaining_reserves, terminal_value, estimated_wealth)
      values
        (p_session, v_world.id, v_g.group_id, v_g.country_code, v_n, v_prod, v_g.capacity,
         round(v_prod / v_g.capacity * 100, 4), v_g.source = 'auto_repeat', v_price, v_revenue, v_cost,
         v_profit, v_hedge, v_card_cost, v_factor, v_fv, v_cum_fv, v_remaining, v_terminal, v_wealth);

      update public.country_states
         set remaining_reserves    = v_remaining,
             cumulative_production = cumulative_production + v_prod,
             cumulative_profit     = cumulative_profit + v_profit + v_hedge,
             cumulative_fv         = v_cum_fv,
             last_production       = v_prod,
             estimated_wealth      = v_wealth,
             updated_at            = now()
       where group_id = v_g.group_id;

      if v_hedge > 0 then
        perform public._notice(p_session, null, v_g.group_id, 'card', 'hedge_payout',
          jsonb_build_object('period', v_n, 'payout', v_hedge, 'price', v_price));
      end if;
    end loop;

    perform public._notice(p_session, v_world.id, null, 'world', 'period_results',
      jsonb_build_object('period', v_n, 'price', v_price, 'total_production', v_total));
  end loop;

  -- 4. Mark closed; unresolved review votes expire with the period
  update public.periods
     set status = 'closed', closed_at = now(), closed_by = p_reason,
         demand_noise = v_noise, demand_factor = v_df
   where id = v_period.id;

  with expired as (
    update public.jpr_requests set status = 'rejected', resolved_at = now()
     where session_id = p_session and status = 'voting'
    returning world_id, yes_count, no_count
  )
  insert into public.notices (session_id, world_id, category, kind, payload)
  select p_session, world_id, 'world', 'jpr_result',
         jsonb_build_object('approved', false, 'expired', true, 'yes', yes_count, 'no', no_count)
    from expired;

  perform public._notice(p_session, null, null, 'game', 'period_closed',
    jsonb_build_object('period', v_n, 'reason', p_reason));

  -- 5. Last period -> final wealth
  if v_n >= v_session.total_periods then
    perform public._finalize_game(p_session);
  end if;

  return jsonb_build_object('closed', true, 'period', v_n, 'prices', v_prices,
                            'demand_factor', v_df, 'noise', v_noise);
end
$$;

create or replace function public._finalize_game(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_compounded boolean;
begin
  select * into v_session from public.game_sessions where id = p_session for update;
  if v_session.status = 'finished' then return; end if;
  v_compounded := (v_session.config #>> '{accounting,card_cost_mode}') = 'compounded';

  delete from public.final_results where session_id = p_session;

  insert into public.final_results
    (session_id, world_id, group_id, country_code, total_fv, terminal_value, card_costs,
     card_costs_nominal, final_wealth, remaining_reserves, rank_in_country, rank_in_world)
  select session_id, world_id, group_id, country_code, total_fv, terminal_value, card_costs,
         card_costs_nominal, final_wealth, remaining_reserves,
         rank() over (partition by country_code order by final_wealth desc),
         rank() over (partition by world_id order by final_wealth desc)
    from (
      select cs.session_id, cs.world_id, cs.group_id, cs.country_code,
             cs.cumulative_fv as total_fv,
             public.opec_terminal_value(cs.marginal_cost, cs.remaining_reserves, v_session.config) as terminal_value,
             case when v_compounded then 0 else cs.card_costs end as card_costs,
             cs.card_costs as card_costs_nominal,
             cs.cumulative_fv
               + public.opec_terminal_value(cs.marginal_cost, cs.remaining_reserves, v_session.config)
               - case when v_compounded then 0 else cs.card_costs end as final_wealth,
             cs.remaining_reserves
        from public.country_states cs
       where cs.session_id = p_session
    ) f;

  update public.country_states cs
     set estimated_wealth = fr.final_wealth, updated_at = now()
    from public.final_results fr
   where fr.group_id = cs.group_id and cs.session_id = p_session;

  update public.game_sessions
     set status = 'finished', finished_at = now(), chat_enabled = false
   where id = p_session;

  perform public._notice(p_session, null, null, 'game', 'game_finished', '{}'::jsonb);
end
$$;

-- =============================================================================
-- STUDENT API
-- =============================================================================

-- Claim control of a group with its access code. Returns a status instead of
-- raising so that failed attempts are recorded (rate limiting).
create or replace function public.claim_group(
  p_group_number int,
  p_access_code  text,
  p_takeover     boolean default false,
  p_language     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_ctrl   public.group_controls%rowtype;
  v_group  public.groups%rowtype;
  v_fails  int;
begin
  if v_uid is null then perform public._raise('not_authenticated'); end if;

  select count(*) into v_fails from public.claim_attempts
   where uid = v_uid and not success and created_at > now() - interval '10 minutes';
  if v_fails >= 10 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;

  select c.* into v_ctrl
    from public.group_controls c
    join public.groups g on g.id = c.group_id
   where c.access_code = upper(btrim(coalesce(p_access_code, '')))
     and g.group_number = p_group_number
   for update of c;

  if not found then
    insert into public.claim_attempts (uid, success) values (v_uid, false);
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into v_group from public.groups where id = v_ctrl.group_id for update;

  if v_ctrl.controller_uid is not null and v_ctrl.controller_uid <> v_uid
     and v_group.last_seen_at is not null and v_group.last_seen_at > now() - interval '60 seconds'
     and not coalesce(p_takeover, false) then
    return jsonb_build_object('status', 'in_use', 'last_seen_at', v_group.last_seen_at);
  end if;

  -- one device controls at most one group
  update public.group_controls set controller_uid = null, controller_since = null
   where controller_uid = v_uid and group_id <> v_ctrl.group_id;

  if v_ctrl.controller_uid is not null and v_ctrl.controller_uid <> v_uid then
    perform public._notice(v_group.session_id, null, v_group.id, 'game', 'control_transferred',
                           jsonb_build_object('at', now()));
  end if;

  update public.group_controls
     set controller_uid = v_uid,
         controller_since = case when controller_uid = v_uid then controller_since else now() end
   where group_id = v_ctrl.group_id;

  update public.groups
     set claimed_at   = coalesce(claimed_at, now()),
         last_seen_at = now(),
         is_bot       = false,
         language     = case when p_language in ('en', 'zh') then p_language else language end
   where id = v_group.id;

  insert into public.claim_attempts (uid, success) values (v_uid, true);
  return jsonb_build_object('status', 'ok', 'group_id', v_group.id, 'session_id', v_group.session_id);
end
$$;

create or replace function public.heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
begin
  if v_group is null then
    return jsonb_build_object('controller', false, 'server_time', now());
  end if;
  update public.groups set last_seen_at = now() where id = v_group;
  return jsonb_build_object('controller', true, 'group_id', v_group, 'server_time', now());
end
$$;

create or replace function public.release_my_group()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
begin
  if v_group is null then return; end if;
  update public.group_controls set controller_uid = null, controller_since = null where group_id = v_group;
  update public.groups set last_seen_at = null where id = v_group;
end
$$;

create or replace function public.set_ready(p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  update public.groups set ready = coalesce(p_ready, true), last_seen_at = now() where id = v_group;
end
$$;

create or replace function public.set_language(p_language text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
begin
  if v_group is null or p_language not in ('en', 'zh') then return; end if;
  update public.groups set language = p_language where id = v_group;
end
$$;

-- p_period (optional): the period the student was looking at; a mismatch means
-- their screen is stale, so nothing is recorded for a period they have not seen.
create or replace function public.submit_production(p_production numeric, p_period int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_session uuid;
  v_n       int;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select session_id into v_session from public.groups where id = v_group;
  v_n := public._open_period_number(v_session);
  if p_period is not null and p_period <> v_n then
    perform public._raise('period_changed', v_n::text);
  end if;
  return public._submit_production(v_group, v_n, p_production, 'student');
end
$$;

create or replace function public.submit_pledge(p_pct numeric, p_period int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_g       public.groups%rowtype;
  v_cfg     jsonb;
  v_n       int;
  v_row     public.public_pledges%rowtype;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select * into v_g from public.groups where id = v_group;
  v_n := public._open_period_number(v_g.session_id);
  if p_period is not null and p_period <> v_n then
    perform public._raise('period_changed', v_n::text);
  end if;
  select config into v_cfg from public.game_sessions where id = v_g.session_id;

  if v_n < coalesce((v_cfg #>> '{pledge,start_period}')::int, 3) then
    perform public._raise('pledge_locked');
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    perform public._raise('invalid_pledge');
  end if;

  insert into public.public_pledges as pp
    (session_id, world_id, group_id, country_code, period_number, pledge_pct)
  values
    (v_g.session_id, v_g.world_id, v_group, v_g.country_code, v_n, round(p_pct, 1))
  on conflict (group_id, period_number) do update
     set pledge_pct = excluded.pledge_pct, revision = pp.revision + 1, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end
$$;

create or replace function public.buy_strategy_card(p_card text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_session uuid;
  v_n       int;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select session_id into v_session from public.groups where id = v_group;
  v_n := public._open_period_number(v_session);
  return public._buy_strategy_card(v_group, p_card, v_n);
end
$$;

create or replace function public.use_audit(p_target_group uuid, p_period int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_me      public.groups%rowtype;
  v_target  public.groups%rowtype;
  v_state   public.country_states%rowtype;
  v_cfg     jsonb;
  v_n       int;
  v_pct     numeric;
  v_cost    numeric;
  v_card    public.card_purchases%rowtype;
  v_audit   public.audit_records%rowtype;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select * into v_me from public.groups where id = v_group;
  v_n := public._open_period_number(v_me.session_id);

  select * into v_state from public.country_states where group_id = v_group for update;
  if v_state.audit_used then perform public._raise('audit_already_used'); end if;

  select * into v_target from public.groups where id = p_target_group;
  if not found or v_target.world_id <> v_me.world_id or v_target.id = v_group then
    perform public._raise('invalid_target');
  end if;

  if not exists (select 1 from public.periods
                  where session_id = v_me.session_id and number = p_period and status = 'closed') then
    perform public._raise('period_not_closed');
  end if;

  select production_pct into v_pct from public.country_period_results
   where group_id = p_target_group and period_number = p_period;
  if v_pct is null then perform public._raise('period_not_closed'); end if;

  select config into v_cfg from public.game_sessions where id = v_me.session_id;
  v_cost := coalesce((v_cfg #>> '{cards,audit,cost_per_1000_capacity}')::numeric, 5) * v_state.capacity / 1000;

  insert into public.card_purchases
    (session_id, world_id, group_id, card_type, purchased_period, capacity_basis, cost, details, applied_at)
  values
    (v_me.session_id, v_me.world_id, v_group, 'audit', v_n, v_state.capacity, v_cost,
     jsonb_build_object('target_country', v_target.country_code, 'target_period', p_period), now())
  returning * into v_card;

  insert into public.audit_records
    (session_id, world_id, auditor_group_id, target_group_id, target_country, target_period, production_pct, card_purchase_id)
  values
    (v_me.session_id, v_me.world_id, v_group, p_target_group, v_target.country_code, p_period, v_pct, v_card.id)
  returning * into v_audit;

  update public.country_states
     set audit_used = true, card_costs = card_costs + v_cost, updated_at = now()
   where group_id = v_group;
  perform public._refresh_wealth(v_group);

  perform public._notice(v_me.session_id, null, v_group, 'audit', 'audit_result',
    jsonb_build_object('target_country', v_target.country_code, 'period', p_period,
                       'production_pct', v_pct, 'cost', v_cost));
  return to_jsonb(v_audit) || jsonb_build_object('cost', v_cost);
end
$$;

create or replace function public.request_jpr()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_me      public.groups%rowtype;
  v_session public.game_sessions%rowtype;
  v_req     public.jpr_requests%rowtype;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select * into v_me from public.groups where id = v_group;
  select * into v_session from public.game_sessions where id = v_me.session_id for share;
  if v_session.status <> 'running' then perform public._raise('game_not_running'); end if;

  if not exists (select 1 from public.periods where session_id = v_me.session_id and status = 'closed') then
    perform public._raise('no_closed_period');
  end if;

  -- serialize per world
  perform 1 from public.worlds where id = v_me.world_id for update;
  if exists (select 1 from public.jpr_requests where world_id = v_me.world_id and status = 'approved') then
    perform public._raise('jpr_already_used');
  end if;
  if exists (select 1 from public.jpr_requests where world_id = v_me.world_id and status = 'voting') then
    perform public._raise('jpr_vote_in_progress');
  end if;

  insert into public.jpr_requests (session_id, world_id, required_yes, opened_period)
  values (v_me.session_id, v_me.world_id,
          coalesce((v_session.config #>> '{cards,jpr,required_yes}')::int, 4),
          v_session.current_period)
  returning * into v_req;

  perform public._notice(v_me.session_id, v_me.world_id, null, 'world', 'jpr_requested',
    jsonb_build_object('required_yes', v_req.required_yes));

  perform public._cast_jpr_vote(v_req.id, v_group, true);   -- the requester supports the review
  perform public._bot_vote_jpr(v_req.id);
  perform public._jpr_resolve(v_req.id);

  select * into v_req from public.jpr_requests where id = v_req.id;
  return to_jsonb(v_req);
end
$$;

create or replace function public.vote_jpr(p_request uuid, p_vote boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
  v_me    public.groups%rowtype;
  v_req   public.jpr_requests%rowtype;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  if p_vote is null then perform public._raise('invalid_vote'); end if;
  select * into v_me from public.groups where id = v_group;

  select * into v_req from public.jpr_requests where id = p_request for update;
  if not found or v_req.world_id <> v_me.world_id then perform public._raise('invalid_request'); end if;
  if v_req.status <> 'voting' then perform public._raise('jpr_not_voting'); end if;
  if exists (select 1 from public.jpr_votes where request_id = p_request and group_id = v_group) then
    perform public._raise('already_voted');
  end if;

  perform public._cast_jpr_vote(p_request, v_group, p_vote);
  perform public._jpr_resolve(p_request);
  select * into v_req from public.jpr_requests where id = p_request;
  return to_jsonb(v_req);
end
$$;

-- Which review requests has my group voted on (my own ballots only).
create or replace function public.my_jpr_votes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('request_id', v.request_id, 'vote', v.vote)), '[]'::jsonb)
    from public.jpr_votes v
   where v.group_id = public.my_group_id()
$$;

create or replace function public.send_chat(p_body text, p_meeting uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group   uuid := public.my_group_id();
  v_me      public.groups%rowtype;
  v_session public.game_sessions%rowtype;
  v_meeting public.opec_meetings%rowtype;
  v_body    text := btrim(coalesce(p_body, ''));
  v_row     public.chat_messages%rowtype;
begin
  if v_group is null then perform public._raise('not_controller'); end if;
  select * into v_me from public.groups where id = v_group;
  select * into v_session from public.game_sessions where id = v_me.session_id;

  if v_session.status <> 'running' then perform public._raise('game_not_running'); end if;
  if public._talk_period(v_session.id) < coalesce((v_session.config #>> '{talk,start_period}')::int, 3) then
    perform public._raise('talk_locked');
  end if;
  if length(v_body) = 0 or length(v_body) > 1000 then perform public._raise('invalid_message'); end if;

  if p_meeting is not null then
    select * into v_meeting from public.opec_meetings where id = p_meeting;
    if not found or v_meeting.session_id <> v_session.id
       or (v_meeting.world_id is not null and v_meeting.world_id <> v_me.world_id)
       or now() < v_meeting.starts_at or now() >= coalesce(v_meeting.ended_at, v_meeting.ends_at) then
      perform public._raise('meeting_not_active');
    end if;
  elsif not v_session.chat_enabled then
    perform public._raise('chat_disabled');
  end if;

  if (select count(*) from public.chat_messages
       where group_id = v_group and created_at > now() - interval '10 seconds') >= 8 then
    perform public._raise('slow_down');
  end if;

  insert into public.chat_messages (session_id, world_id, group_id, country_code, meeting_id, body)
  values (v_session.id, v_me.world_id, v_group, v_me.country_code, p_meeting, v_body)
  returning * into v_row;
  return to_jsonb(v_row);
end
$$;

-- Anyone in the session may poke the clock; the period only closes once its
-- deadline has passed, and only once.
create or replace function public.tick(p_session uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid := coalesce(p_session, public.my_session_id());
begin
  if v_session is null then return jsonb_build_object('closed', false); end if;
  if not (public.is_instructor() or v_session = public.my_session_id()) then
    perform public._raise('not_allowed');
  end if;

  if exists (select 1 from public.game_sessions s
               join public.periods p on p.session_id = s.id and p.number = s.current_period
              where s.id = v_session and p.status = 'open'
                and p.closes_at is not null and p.closes_at <= now()) then
    return public._close_period(v_session, 'timer');
  end if;
  return jsonb_build_object('closed', false);
end
$$;

-- Ticks every running session (for pg_cron).
create or replace function public.tick_all()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s record;
  v_n int := 0;
begin
  for v_s in
    select s.id from public.game_sessions s
      join public.periods p on p.session_id = s.id and p.number = s.current_period
     where s.status = 'running' and p.status = 'open' and p.closes_at <= now()
  loop
    perform public._close_period(v_s.id, 'timer');
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

create or replace function public.whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'uid', auth.uid(),
    'is_instructor', public.is_instructor(),
    'is_anonymous', coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false),
    'group_id', public.my_group_id(),
    'session_id', public.my_session_id(),
    'server_time', now())
$$;

-- -----------------------------------------------------------------------------
-- Student read API (SECURITY INVOKER: row-level security decides what is visible)
-- -----------------------------------------------------------------------------
create or replace function public.get_student_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_group uuid := public.my_group_id();
  v_sid   uuid;
  v_wid   uuid;
begin
  if v_group is null then
    return jsonb_build_object('status', 'no_group', 'server_time', now());
  end if;
  select session_id, world_id into v_sid, v_wid from public.groups where id = v_group;

  return jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'group', (select to_jsonb(g) from public.groups g where g.id = v_group),
    'world', (select to_jsonb(w) from public.worlds w where w.id = v_wid),
    'session', (select to_jsonb(s) from public.game_sessions s where s.id = v_sid),
    'country', (select to_jsonb(c) from public.countries c join public.groups g on g.country_code = c.code where g.id = v_group),
    'state', (select to_jsonb(cs) from public.country_states cs where cs.group_id = v_group),
    'periods', coalesce((select jsonb_agg(to_jsonb(p) order by p.number) from public.periods p where p.session_id = v_sid), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.production_submissions x where x.group_id = v_group), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.country_period_results x where x.group_id = v_group), '[]'::jsonb),
    'world_results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.world_period_results x where x.world_id = v_wid), '[]'::jsonb),
    'pledges', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number, x.country_code) from public.public_pledges x where x.world_id = v_wid), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.card_purchases x where x.group_id = v_group), '[]'::jsonb),
    'audits', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.audit_records x where x.auditor_group_id = v_group), '[]'::jsonb),
    'jpr_requests', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.jpr_requests x where x.world_id = v_wid), '[]'::jsonb),
    'jpr_my_votes', public.my_jpr_votes(),
    'jpr_reveals', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number, x.country_code) from public.jpr_reveals x where x.world_id = v_wid), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.game_events x where x.session_id = v_sid), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.opec_meetings x where x.session_id = v_sid), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object(
                 'group_id', g.id, 'group_number', g.group_number, 'country_code', g.country_code,
                 'online', g.last_seen_at is not null and g.last_seen_at > now() - interval '60 seconds')
               order by c.sort_order)
               from public.groups g join public.countries c on c.code = g.country_code
              where g.world_id = v_wid), '[]'::jsonb),
    'final_results', coalesce((select jsonb_agg(to_jsonb(x)) from public.final_results x where x.session_id = v_sid), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_chat(p_limit int default 300)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb)
    from (select * from public.chat_messages
           where world_id = public.my_world_id()
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 300), 1), 1000)) m
$$;

create or replace function public.get_notices(p_limit int default 300)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb)
    from (select * from public.notices
           where session_id = public.my_session_id()
           order by created_at desc
           limit least(greatest(coalesce(p_limit, 300), 1), 1000)) n
$$;

-- Final results / debrief data (RLS: everything for instructors; for students
-- only once the game is finished).
create or replace function public.get_final_results(p_session uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'session', (select to_jsonb(s) from public.game_sessions s where s.id = p_session),
    'worlds', coalesce((select jsonb_agg(to_jsonb(w) order by w.code) from public.worlds w where w.session_id = p_session), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'group_number', g.group_number,
                          'world_id', g.world_id, 'country_code', g.country_code, 'is_bot', g.is_bot))
                        from public.groups g where g.session_id = p_session), '[]'::jsonb),
    'final_results', coalesce((select jsonb_agg(to_jsonb(x)) from public.final_results x where x.session_id = p_session), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.country_period_results x where x.session_id = p_session), '[]'::jsonb),
    'world_results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.world_period_results x where x.session_id = p_session), '[]'::jsonb),
    'pledges', coalesce((select jsonb_agg(to_jsonb(x)) from public.public_pledges x where x.session_id = p_session), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(to_jsonb(x)) from public.card_purchases x where x.session_id = p_session), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(x)) from public.country_states x where x.session_id = p_session), '[]'::jsonb),
    'periods', coalesce((select jsonb_agg(to_jsonb(p) order by p.number) from public.periods p where p.session_id = p_session), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.game_events x where x.session_id = p_session), '[]'::jsonb)
  )
$$;

-- =============================================================================
-- INSTRUCTOR API
-- =============================================================================

-- Run as the database owner / service role to make someone an instructor:
--   select public.grant_instructor('teacher@example.edu');
create or replace function public.grant_instructor(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then perform public._raise('user_not_found'); end if;
  insert into public.instructors (user_id, display_name) values (v_uid, p_email)
  on conflict (user_id) do nothing;
  return v_uid;
end
$$;

create or replace function public.redeem_instructor_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    perform public._raise('not_authenticated');
  end if;
  update public.instructor_invites set used_by = v_uid, used_at = now()
   where code = btrim(p_code) and used_by is null;
  if not found then perform public._raise('invalid_invite'); end if;
  insert into public.instructors (user_id, display_name)
  values (v_uid, auth.jwt() ->> 'email') on conflict (user_id) do nothing;
  return jsonb_build_object('is_instructor', true);
end
$$;

create or replace function public.create_session(
  p_name            text,
  p_is_demo         boolean default false,
  p_randomize       boolean default false,
  p_config          jsonb   default '{}'::jsonb,
  p_period_seconds  int     default 600,
  p_total_periods   int     default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid       uuid;
  v_slots     record;
  v_i         int := 0;
  v_group     uuid;
  v_strats    text[] := array['cooperative', 'moderate', 'competitive', 'random'];
begin
  perform public._require_instructor();

  insert into public.game_sessions (name, config, is_demo, default_period_seconds, total_periods, created_by)
  values (coalesce(nullif(btrim(p_name), ''), 'OPEC Game'), public.opec_config(p_config),
          coalesce(p_is_demo, false), coalesce(p_period_seconds, 600), coalesce(p_total_periods, 10), auth.uid())
  returning id into v_sid;

  insert into public.worlds (session_id, code) values (v_sid, 'A'), (v_sid, 'B'), (v_sid, 'C');

  for v_slots in
    select w.id as world_id, c.code as country_code
      from public.worlds w cross join public.countries c
     where w.session_id = v_sid
     order by case when coalesce(p_randomize, false) then random() else 0 end, w.code, c.sort_order
  loop
    v_i := v_i + 1;
    insert into public.groups (session_id, group_number, world_id, country_code, is_bot, bot_strategy)
    values (v_sid, v_i, v_slots.world_id, v_slots.country_code, coalesce(p_is_demo, false),
            v_strats[1 + ((v_i - 1) % 4)])
    returning id into v_group;
    insert into public.group_controls (group_id, session_id, access_code)
    values (v_group, v_sid, public._gen_access_code());
    perform public._init_country_state(v_group);
  end loop;

  return (select to_jsonb(s) from public.game_sessions s where s.id = v_sid);
end
$$;

create or replace function public.delete_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_instructor();
  delete from public.game_sessions where id = p_session;
end
$$;

create or replace function public.update_session_settings(
  p_session uuid, p_name text default null, p_config jsonb default null, p_period_seconds int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if not found then perform public._raise('session_not_found'); end if;
  if p_config is not null and v_session.status <> 'lobby' then
    perform public._raise('config_locked');
  end if;
  update public.game_sessions
     set name = coalesce(nullif(btrim(p_name), ''), name),
         config = case when p_config is null then config else public.opec_jsonb_merge(config, p_config) end,
         default_period_seconds = coalesce(p_period_seconds, default_period_seconds)
   where id = p_session;
  if p_config is not null then
    perform public._refresh_wealth(g.id) from public.groups g where g.session_id = p_session;
  end if;
  return (select to_jsonb(s) from public.game_sessions s where s.id = p_session);
end
$$;

-- p_assignments: [{"group_number": 1, "world": "A", "country": "SAU"}, ...] (all groups)
create or replace function public.set_assignments(p_session uuid, p_assignments jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_groups  int;
  v_rows    int;
  v_pairs   int;
  v_a       record;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if v_session.status <> 'lobby' then perform public._raise('assignments_locked'); end if;

  select count(*) into v_groups from public.groups where session_id = p_session;
  select count(*), count(distinct (a ->> 'world') || ':' || (a ->> 'country'))
    into v_rows, v_pairs
    from jsonb_array_elements(p_assignments) a;
  if v_rows <> v_groups or v_pairs <> v_groups then
    perform public._raise('invalid_assignments', 'each world/country pair must be used exactly once');
  end if;

  for v_a in
    select (a ->> 'group_number')::int as group_number, a ->> 'world' as world, a ->> 'country' as country
      from jsonb_array_elements(p_assignments) a
  loop
    update public.groups g
       set world_id = w.id, country_code = v_a.country
      from public.worlds w
     where g.session_id = p_session and g.group_number = v_a.group_number
       and w.session_id = p_session and w.code = v_a.world
       and exists (select 1 from public.countries c where c.code = v_a.country);
    if not found then perform public._raise('invalid_assignments', v_a.group_number::text); end if;
  end loop;

  perform public._init_country_state(g.id) from public.groups g where g.session_id = p_session;
end
$$;

create or replace function public.randomize_assignments(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assign jsonb;
begin
  perform public._require_instructor();
  with slots as (
    select w.code as world, c.code as country, row_number() over (order by random()) as rn
      from public.worlds w cross join public.countries c where w.session_id = p_session
  ), grps as (
    select group_number, row_number() over (order by group_number) as rn
      from public.groups where session_id = p_session
  )
  select jsonb_agg(jsonb_build_object('group_number', g.group_number, 'world', s.world, 'country', s.country))
    into v_assign
    from grps g join slots s using (rn);
  perform public.set_assignments(p_session, v_assign);
end
$$;

create or replace function public.regenerate_access_code(p_group uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  perform public._require_instructor();
  v_code := public._gen_access_code();
  update public.group_controls set access_code = v_code, controller_uid = null, controller_since = null
   where group_id = p_group;
  return v_code;
end
$$;

create or replace function public.release_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_instructor();
  update public.group_controls set controller_uid = null, controller_since = null where group_id = p_group;
  update public.groups set last_seen_at = null where id = p_group;
end
$$;

create or replace function public.set_group_bot(p_group uuid, p_is_bot boolean, p_strategy text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_g public.groups%rowtype;
begin
  perform public._require_instructor();
  update public.groups
     set is_bot = coalesce(p_is_bot, false),
         bot_strategy = coalesce(p_strategy, bot_strategy, 'random')
   where id = p_group
  returning * into v_g;
  -- a newly simulated group immediately plays the open period
  if v_g.is_bot and exists (select 1 from public.game_sessions s
                              join public.periods p on p.session_id = s.id and p.number = s.current_period
                             where s.id = v_g.session_id and p.status = 'open') then
    perform public._bot_play(v_g.session_id, (select current_period from public.game_sessions where id = v_g.session_id));
  end if;
end
$$;

create or replace function public.start_game(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if v_session.status <> 'lobby' then perform public._raise('game_already_started'); end if;
  update public.game_sessions set status = 'running', started_at = now() where id = p_session;
  perform public._notice(p_session, null, null, 'game', 'game_started', '{}'::jsonb);
  return (select to_jsonb(s) from public.game_sessions s where s.id = p_session);
end
$$;

create or replace function public.open_period(p_session uuid, p_duration_seconds int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_n       int;
  v_dur     int;
  v_mult    numeric := 1;
  v_event   record;
  v_card    record;
  v_type    text;
  v_period  public.periods%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if not found then perform public._raise('session_not_found'); end if;
  if v_session.status <> 'running' then perform public._raise('game_not_running'); end if;
  if exists (select 1 from public.periods where session_id = p_session and status = 'open') then
    perform public._raise('period_already_open');
  end if;

  v_n := v_session.current_period + 1;
  if v_n > v_session.total_periods then perform public._raise('no_more_periods'); end if;

  v_dur  := coalesce(p_duration_seconds, v_session.default_period_seconds);
  v_type := public.opec_demand_type(v_n, v_session.config);

  for v_event in select * from public.game_events where session_id = p_session and effective_period = v_n loop
    v_mult := v_mult * (1 + v_event.demand_change);
  end loop;

  insert into public.periods (session_id, number, status, demand_type, event_multiplier, duration_seconds, opened_at, closes_at)
  values (p_session, v_n, 'open', v_type, v_mult, v_dur, now(),
          case when v_dur > 0 then now() + make_interval(secs => v_dur) else null end)
  returning * into v_period;

  update public.game_sessions set current_period = v_n where id = p_session;

  -- Strategy card activations scheduled for this period
  for v_card in
    select * from public.card_purchases
     where session_id = p_session and activation_period = v_n and applied_at is null
       and card_type in ('eor', 'capacity_expansion', 'price_hedge')
  loop
    if v_card.card_type = 'eor' then
      update public.country_states
         set reserves_bonus     = reserves_bonus + (v_card.details ->> 'bonus')::numeric,
             remaining_reserves = remaining_reserves + (v_card.details ->> 'bonus')::numeric,
             updated_at = now()
       where group_id = v_card.group_id;
    elsif v_card.card_type = 'capacity_expansion' then
      update public.country_states
         set capacity = (v_card.details ->> 'new_capacity')::numeric, updated_at = now()
       where group_id = v_card.group_id;
    end if;
    update public.card_purchases set applied_at = now() where id = v_card.id;
    perform public._refresh_wealth(v_card.group_id);
    perform public._notice(p_session, null, v_card.group_id, 'card', 'card_activated',
      jsonb_build_object('card', v_card.card_type, 'period', v_n, 'end_period', v_card.end_period,
                         'details', v_card.details));
  end loop;

  perform public._notice(p_session, null, null, 'game', 'period_opened',
    jsonb_build_object('period', v_n, 'demand_type', v_type, 'closes_at', v_period.closes_at,
                       'duration', v_dur));
  perform public._notice(p_session, null, null, 'intel', 'market_intel',
    jsonb_build_object('period', v_n, 'demand_type', v_type, 'event_multiplier', v_mult,
                       'shares', v_session.config #> '{price,shares}',
                       'prices', v_session.config #> array['price', v_type],
                       'noise_pct', v_session.config #> '{demand,noise_pct}'));
  for v_event in select * from public.game_events where session_id = p_session and effective_period = v_n loop
    perform public._notice(p_session, null, null, 'event', 'event_active',
      jsonb_build_object('event', v_event.event_type, 'period', v_n, 'change', v_event.demand_change));
  end loop;

  perform public._bot_play(p_session, v_n);
  return to_jsonb(v_period);
end
$$;

-- Sets the remaining time of the open period (0 or null = no timer).
create or replace function public.set_period_deadline(p_session uuid, p_seconds_from_now int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.periods%rowtype;
begin
  perform public._require_instructor();
  perform 1 from public.game_sessions where id = p_session for update;
  update public.periods p
     set closes_at = case when coalesce(p_seconds_from_now, 0) > 0
                          then now() + make_interval(secs => p_seconds_from_now) else null end
    from public.game_sessions s
   where s.id = p_session and p.session_id = s.id and p.number = s.current_period and p.status = 'open'
  returning p.* into v_period;
  if v_period.id is null then perform public._raise('period_not_open'); end if;
  perform public._notice(p_session, null, null, 'game', 'timer_changed',
    jsonb_build_object('period', v_period.number, 'closes_at', v_period.closes_at));
  return to_jsonb(v_period);
end
$$;

create or replace function public.close_period(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_instructor();
  return public._close_period(p_session, 'instructor');
end
$$;

create or replace function public.end_game(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if v_session.status = 'finished' then return jsonb_build_object('finished', true); end if;
  if v_session.status = 'lobby' then perform public._raise('game_not_running'); end if;
  perform public._close_period(p_session, 'end_game');
  perform public._finalize_game(p_session);
  return jsonb_build_object('finished', true);
end
$$;

create or replace function public.reset_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_instructor();
  perform 1 from public.game_sessions where id = p_session for update;
  delete from public.audit_records          where session_id = p_session;
  delete from public.card_purchases         where session_id = p_session;
  delete from public.jpr_requests           where session_id = p_session;
  delete from public.chat_messages          where session_id = p_session;
  delete from public.opec_meetings          where session_id = p_session;
  delete from public.public_pledges         where session_id = p_session;
  delete from public.final_results          where session_id = p_session;
  delete from public.country_period_results where session_id = p_session;
  delete from public.world_period_results   where session_id = p_session;
  delete from public.production_submissions where session_id = p_session;
  delete from public.game_events            where session_id = p_session;
  delete from public.notices                where session_id = p_session;
  delete from public.periods                where session_id = p_session;
  update public.game_sessions
     set status = 'lobby', current_period = 0, chat_enabled = false, started_at = null, finished_at = null
   where id = p_session;
  update public.groups set ready = false where session_id = p_session;
  perform public._init_country_state(g.id) from public.groups g where g.session_id = p_session;
end
$$;

create or replace function public.set_chat_enabled(p_session uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if coalesce(p_enabled, false)
     and public._talk_period(p_session) < coalesce((v_session.config #>> '{talk,start_period}')::int, 3) then
    perform public._raise('talk_locked');
  end if;
  update public.game_sessions set chat_enabled = coalesce(p_enabled, false) where id = p_session;
  perform public._notice(p_session, null, null, 'game',
    case when coalesce(p_enabled, false) then 'chat_enabled' else 'chat_disabled' end, '{}'::jsonb);
end
$$;

create or replace function public.start_meeting(p_session uuid, p_world uuid default null, p_minutes int default 5, p_title text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_talk    int;
  v_row     public.opec_meetings%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session;
  if v_session.status <> 'running' then perform public._raise('game_not_running'); end if;
  v_talk := public._talk_period(p_session);
  if v_talk < coalesce((v_session.config #>> '{talk,start_period}')::int, 3) then
    perform public._raise('talk_locked');
  end if;
  if p_world is not null and not exists (select 1 from public.worlds where id = p_world and session_id = p_session) then
    perform public._raise('invalid_world');
  end if;

  insert into public.opec_meetings (session_id, world_id, title, period_number, starts_at, ends_at)
  values (p_session, p_world, nullif(btrim(coalesce(p_title, '')), ''), v_talk, now(),
          now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 5), 120))))
  returning * into v_row;

  perform public._notice(p_session, p_world, null, 'game', 'meeting_started',
    jsonb_build_object('meeting_id', v_row.id, 'ends_at', v_row.ends_at, 'title', v_row.title,
                       'minutes', greatest(1, least(coalesce(p_minutes, 5), 120))));
  return to_jsonb(v_row);
end
$$;

create or replace function public.end_meeting(p_meeting uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.opec_meetings%rowtype;
begin
  perform public._require_instructor();
  update public.opec_meetings set ended_at = now()
   where id = p_meeting and ended_at is null
  returning * into v_row;
  if v_row.id is not null then
    perform public._notice(v_row.session_id, v_row.world_id, null, 'game', 'meeting_ended',
      jsonb_build_object('meeting_id', v_row.id));
  end if;
end
$$;

create or replace function public.post_announcement(p_session uuid, p_body text, p_world uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_instructor();
  if length(btrim(coalesce(p_body, ''))) = 0 then perform public._raise('invalid_message'); end if;
  perform public._notice(p_session, p_world, null, 'teacher', 'announcement', '{}'::jsonb, btrim(p_body));
end
$$;

create or replace function public.instructor_chat(p_world uuid, p_body text, p_meeting uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world public.worlds%rowtype;
  v_row   public.chat_messages%rowtype;
begin
  perform public._require_instructor();
  select * into v_world from public.worlds where id = p_world;
  if not found then perform public._raise('invalid_world'); end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then perform public._raise('invalid_message'); end if;
  insert into public.chat_messages (session_id, world_id, group_id, country_code, meeting_id, body)
  values (v_world.session_id, p_world, null, null, p_meeting, btrim(p_body))
  returning * into v_row;
  return to_jsonb(v_row);
end
$$;

create or replace function public.trigger_event(p_session uuid, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.game_sessions%rowtype;
  v_change  numeric;
  v_eff     int;
  v_row     public.game_events%rowtype;
begin
  perform public._require_instructor();
  select * into v_session from public.game_sessions where id = p_session for update;
  if v_session.status = 'finished' then perform public._raise('game_finished'); end if;
  if p_event not in ('recession', 'boom') then perform public._raise('invalid_event'); end if;
  if exists (select 1 from public.game_events where session_id = p_session and event_type = p_event) then
    perform public._raise('event_already_used');
  end if;

  v_eff := v_session.current_period + 1;
  if v_eff > v_session.total_periods then perform public._raise('event_too_late'); end if;
  if exists (select 1 from public.game_events where session_id = p_session and effective_period = v_eff) then
    perform public._raise('event_conflict');
  end if;

  v_change := case p_event
    when 'recession' then coalesce((v_session.config #>> '{events,recession_pct}')::numeric, -5) / 100
    else coalesce((v_session.config #>> '{events,boom_pct}')::numeric, 5) / 100 end;

  insert into public.game_events (session_id, event_type, demand_change, triggered_in_period, effective_period)
  values (p_session, p_event, v_change, v_session.current_period, v_eff)
  returning * into v_row;

  perform public._notice(p_session, null, null, 'event', 'event_triggered',
    jsonb_build_object('event', p_event, 'effective_period', v_eff, 'change', v_change));
  return to_jsonb(v_row);
end
$$;

create or replace function public.demo_fill_submissions(p_session uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform public._require_instructor();
  select s.current_period into v_n
    from public.game_sessions s
    join public.periods p on p.session_id = s.id and p.number = s.current_period and p.status = 'open'
   where s.id = p_session;
  if v_n is null then perform public._raise('period_not_open'); end if;
  return public._bot_play(p_session, v_n);
end
$$;

create or replace function public.list_sessions()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public._require_instructor();
  return coalesce((
    select jsonb_agg(to_jsonb(s) || jsonb_build_object(
             'groups_claimed', (select count(*) from public.group_controls c where c.session_id = s.id and c.controller_uid is not null),
             'bots', (select count(*) from public.groups g where g.session_id = s.id and g.is_bot))
           order by s.created_at desc)
      from public.game_sessions s), '[]'::jsonb);
end
$$;

create or replace function public.get_instructor_state(p_session uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public._require_instructor();
  return jsonb_build_object(
    'server_time', now(),
    'session', (select to_jsonb(s) from public.game_sessions s where s.id = p_session),
    'worlds', coalesce((select jsonb_agg(to_jsonb(w) order by w.code) from public.worlds w where w.session_id = p_session), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) || jsonb_build_object(
                  'access_code', c.access_code,
                  'controlled', c.controller_uid is not null,
                  'controller_since', c.controller_since,
                  'online', g.last_seen_at is not null and g.last_seen_at > now() - interval '60 seconds')
                order by g.group_number)
              from public.groups g join public.group_controls c on c.group_id = g.id
             where g.session_id = p_session), '[]'::jsonb),
    'states', coalesce((select jsonb_agg(to_jsonb(x)) from public.country_states x where x.session_id = p_session), '[]'::jsonb),
    'periods', coalesce((select jsonb_agg(to_jsonb(x) order by x.number) from public.periods x where x.session_id = p_session), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(to_jsonb(x)) from public.production_submissions x where x.session_id = p_session), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.country_period_results x where x.session_id = p_session), '[]'::jsonb),
    'world_results', coalesce((select jsonb_agg(to_jsonb(x) order by x.period_number) from public.world_period_results x where x.session_id = p_session), '[]'::jsonb),
    'pledges', coalesce((select jsonb_agg(to_jsonb(x)) from public.public_pledges x where x.session_id = p_session), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.card_purchases x where x.session_id = p_session), '[]'::jsonb),
    'audits', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.audit_records x where x.session_id = p_session), '[]'::jsonb),
    'jpr_requests', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.jpr_requests x where x.session_id = p_session), '[]'::jsonb),
    'jpr_reveals', coalesce((select jsonb_agg(to_jsonb(x)) from public.jpr_reveals x where x.session_id = p_session), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.game_events x where x.session_id = p_session), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at) from public.opec_meetings x where x.session_id = p_session), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
                          from (select * from public.notices where session_id = p_session and group_id is null
                                 order by created_at desc limit 200) x), '[]'::jsonb),
    'final_results', coalesce((select jsonb_agg(to_jsonb(x)) from public.final_results x where x.session_id = p_session), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_instructor_chat(p_session uuid, p_limit int default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  perform public._require_instructor();
  return coalesce((
    select jsonb_agg(to_jsonb(m) order by m.created_at)
      from (select * from public.chat_messages where session_id = p_session
             order by created_at desc limit least(greatest(coalesce(p_limit, 500), 1), 2000)) m), '[]'::jsonb);
end
$$;
