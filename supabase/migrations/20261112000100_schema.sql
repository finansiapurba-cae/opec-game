-- =============================================================================
-- OPEC Game — The Oil Cartel Simulation
-- Migration 1/4: schema (tables, constraints, indexes, reference data)
--
-- Units used throughout the database:
--   * production, capacity, reserves ............ thousand barrels (kb)
--   * prices, marginal costs ..................... USD per barrel
--   * all money amounts (revenue, profit, wealth,
--     card costs, hedge payouts) ................ USD millions ($M)
--     e.g. ($65 - $9) * 12,000 kb = $672,000,000 = 672 ($M)
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+, no extension required.

-- -----------------------------------------------------------------------------
-- Reference data: the seven OPEC countries (authoritative source of country data)
-- -----------------------------------------------------------------------------
create table public.countries (
  code          text primary key,
  iso2          text not null,
  name_en       text not null,
  name_zh       text not null,
  flag_emoji    text not null,
  capacity      numeric not null check (capacity > 0),       -- kb per period
  reserves      numeric not null check (reserves >= 0),       -- kb
  marginal_cost numeric not null check (marginal_cost >= 0),  -- USD/bbl
  sort_order    int not null unique
);

insert into public.countries (code, iso2, name_en, name_zh, flag_emoji, capacity, reserves, marginal_cost, sort_order) values
  ('SAU', 'sa', 'Saudi Arabia', '沙烏地阿拉伯',     '🇸🇦', 12000, 108000,  9, 1),
  ('IRN', 'ir', 'Iran',         '伊朗',             '🇮🇷',  4600,  41400, 10, 2),
  ('IRQ', 'iq', 'Iraq',         '伊拉克',           '🇮🇶',  3700,  33300, 16, 3),
  ('KWT', 'kw', 'Kuwait',       '科威特',           '🇰🇼',  3300,  29700, 13, 4),
  ('ARE', 'ae', 'UAE',          '阿拉伯聯合大公國', '🇦🇪',  3000,  27000,  5, 5),
  ('VEN', 've', 'Venezuela',    '委內瑞拉',         '🇻🇪',  4400,  39600, 20, 6),
  ('NGA', 'ng', 'Nigeria',      '奈及利亞',         '🇳🇬',  2700,  24300,  7, 7);

-- -----------------------------------------------------------------------------
-- Instructors (role-based access). Rows are created by grant_instructor() or by
-- redeeming an instructor invite code.
-- -----------------------------------------------------------------------------
create table public.instructors (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.instructor_invites (
  code       text primary key,
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Game sessions and worlds
-- -----------------------------------------------------------------------------
create table public.game_sessions (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(name) between 1 and 120),
  status                  text not null default 'lobby' check (status in ('lobby', 'running', 'finished')),
  current_period          int  not null default 0,      -- last period that was opened (0 = none yet)
  total_periods           int  not null default 10 check (total_periods between 1 and 30),
  config                  jsonb not null,
  is_demo                 boolean not null default false,
  chat_enabled            boolean not null default false,
  default_period_seconds  int  not null default 600 check (default_period_seconds >= 0),
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  started_at              timestamptz,
  finished_at             timestamptz
);

create table public.worlds (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  code       text not null check (code in ('A', 'B', 'C')),
  unique (session_id, code)
);

-- -----------------------------------------------------------------------------
-- Groups (student teams). A group's country assignment is (world_id, country_code);
-- the deferrable unique constraint guarantees exactly one group per country per
-- world while still allowing swaps inside one transaction.
-- -----------------------------------------------------------------------------
create table public.groups (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions (id) on delete cascade,
  group_number  int  not null check (group_number between 1 and 99),
  world_id      uuid not null references public.worlds (id) on delete cascade,
  country_code  text not null references public.countries (code),
  is_bot        boolean not null default false,
  bot_strategy  text check (bot_strategy in ('cooperative', 'moderate', 'competitive', 'random')),
  ready         boolean not null default false,
  language      text not null default 'en' check (language in ('en', 'zh')),
  claimed_at    timestamptz,
  last_seen_at  timestamptz,
  unique (session_id, group_number),
  constraint groups_one_country_per_world unique (world_id, country_code) deferrable initially deferred
);

-- Secrets and device binding — instructor-only (never readable by students).
create table public.group_controls (
  group_id         uuid primary key references public.groups (id) on delete cascade,
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  access_code      text not null unique,
  controller_uid   uuid unique,           -- the single device (auth user) controlling the group
  controller_since timestamptz
);

create table public.claim_attempts (
  id         bigint generated always as identity primary key,
  uid        uuid not null,
  success    boolean not null,
  created_at timestamptz not null default now()
);
create index claim_attempts_uid_time on public.claim_attempts (uid, created_at desc);

-- -----------------------------------------------------------------------------
-- Country state (current snapshot, rebuilt from data at session creation/reset)
-- -----------------------------------------------------------------------------
create table public.country_states (
  group_id             uuid primary key references public.groups (id) on delete cascade,
  session_id           uuid not null references public.game_sessions (id) on delete cascade,
  world_id             uuid not null references public.worlds (id) on delete cascade,
  country_code         text not null references public.countries (code),
  marginal_cost        numeric not null,
  base_capacity        numeric not null,
  capacity             numeric not null,
  original_reserves    numeric not null,
  reserves_bonus       numeric not null default 0,
  remaining_reserves   numeric not null,
  cumulative_production numeric not null default 0,
  cumulative_profit    numeric not null default 0,  -- nominal (profit + hedge), $M
  cumulative_fv        numeric not null default 0,  -- compounded to period T+1, $M
  card_costs           numeric not null default 0,  -- nominal, $M
  last_production      numeric,                     -- for the "repeat previous output" rule
  estimated_wealth     numeric not null default 0,  -- if the game ended now, $M
  strategy_card        text,
  audit_used           boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Periods
-- -----------------------------------------------------------------------------
create table public.periods (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  number           int  not null,
  status           text not null check (status in ('open', 'closed')),
  demand_type      text not null check (demand_type in ('low', 'high')),
  event_multiplier numeric not null default 1,   -- product of active event card effects
  demand_noise     numeric,                      -- set when the period closes (hidden before)
  demand_factor    numeric,                      -- (1 + noise) * event_multiplier, set at close
  duration_seconds int,
  opened_at        timestamptz not null default now(),
  closes_at        timestamptz,                  -- null = no timer (instructor closes manually)
  closed_at        timestamptz,
  closed_by        text check (closed_by in ('instructor', 'timer', 'end_game')),
  unique (session_id, number)
);

-- -----------------------------------------------------------------------------
-- Production submissions (hidden from other countries)
-- -----------------------------------------------------------------------------
create table public.production_submissions (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.game_sessions (id) on delete cascade,
  world_id       uuid not null references public.worlds (id) on delete cascade,
  group_id       uuid not null references public.groups (id) on delete cascade,
  period_number  int  not null,
  production     numeric not null check (production >= 0),
  production_pct numeric not null,
  source         text not null check (source in ('student', 'bot', 'auto_repeat', 'instructor')),
  revision       int  not null default 1,
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (group_id, period_number)
);
create index production_submissions_session on public.production_submissions (session_id, period_number);

-- -----------------------------------------------------------------------------
-- Results
-- -----------------------------------------------------------------------------
create table public.world_period_results (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.game_sessions (id) on delete cascade,
  world_id           uuid not null references public.worlds (id) on delete cascade,
  period_number      int  not null,
  demand_type        text not null,
  demand_factor      numeric not null,
  total_production   numeric not null,
  reference_capacity numeric not null,
  production_share   numeric not null,   -- total / reference capacity
  effective_share    numeric not null,   -- share adjusted for demand (input of the price curve)
  price              numeric not null,
  created_at         timestamptz not null default now(),
  unique (world_id, period_number)
);

create table public.country_period_results (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.game_sessions (id) on delete cascade,
  world_id           uuid not null references public.worlds (id) on delete cascade,
  group_id           uuid not null references public.groups (id) on delete cascade,
  country_code       text not null,
  period_number      int  not null,
  production         numeric not null,
  capacity           numeric not null,
  production_pct     numeric not null,
  auto_submitted     boolean not null default false,
  price              numeric not null,
  revenue            numeric not null,   -- $M
  production_cost    numeric not null,   -- $M
  profit             numeric not null,   -- (price - MC) * production, $M
  hedge_payout       numeric not null default 0,
  card_cost          numeric not null default 0,
  fv_factor          numeric not null,
  fv_amount          numeric not null,   -- compounded value of this period's cash flow
  cumulative_fv      numeric not null,
  remaining_reserves numeric not null,
  terminal_value     numeric not null,   -- value of remaining oil if the game ended now
  estimated_wealth   numeric not null,
  created_at         timestamptz not null default now(),
  unique (group_id, period_number)
);
create index country_period_results_session on public.country_period_results (session_id, period_number);

create table public.final_results (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.game_sessions (id) on delete cascade,
  world_id           uuid not null references public.worlds (id) on delete cascade,
  group_id           uuid not null references public.groups (id) on delete cascade,
  country_code       text not null,
  total_fv           numeric not null,
  terminal_value     numeric not null,
  card_costs         numeric not null,   -- deducted separately (0 when compounded into periods)
  card_costs_nominal numeric not null,
  final_wealth       numeric not null,
  remaining_reserves numeric not null,
  rank_in_country    int not null,       -- 1 = best world for this country
  rank_in_world      int not null,
  created_at         timestamptz not null default now(),
  unique (group_id)
);

-- -----------------------------------------------------------------------------
-- Public pledges
-- -----------------------------------------------------------------------------
create table public.public_pledges (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions (id) on delete cascade,
  world_id      uuid not null references public.worlds (id) on delete cascade,
  group_id      uuid not null references public.groups (id) on delete cascade,
  country_code  text not null,
  period_number int  not null,
  pledge_pct    numeric not null check (pledge_pct between 0 and 100),
  revision      int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (group_id, period_number)
);

-- -----------------------------------------------------------------------------
-- Communication
-- -----------------------------------------------------------------------------
create table public.opec_meetings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.game_sessions (id) on delete cascade,
  world_id      uuid references public.worlds (id) on delete cascade,  -- null = all worlds
  title         text,
  period_number int  not null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);

create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.game_sessions (id) on delete cascade,
  world_id     uuid not null references public.worlds (id) on delete cascade,
  group_id     uuid references public.groups (id) on delete cascade,    -- null = instructor
  country_code text,
  meeting_id   uuid references public.opec_meetings (id) on delete set null,
  body         text not null check (length(body) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index chat_messages_world_time on public.chat_messages (world_id, created_at);

-- -----------------------------------------------------------------------------
-- Cards
-- -----------------------------------------------------------------------------
create table public.card_purchases (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.game_sessions (id) on delete cascade,
  world_id           uuid not null references public.worlds (id) on delete cascade,
  group_id           uuid not null references public.groups (id) on delete cascade,
  card_type          text not null check (card_type in ('eor', 'capacity_expansion', 'price_hedge', 'audit')),
  purchased_period   int  not null,
  capacity_basis     numeric not null,  -- capacity used for the cost (kb)
  cost               numeric not null,  -- $M
  activation_period  int,
  end_period         int,
  details            jsonb not null default '{}'::jsonb,
  applied_at         timestamptz,
  created_at         timestamptz not null default now()
);
-- one strategy card per country for the whole game; one audit per country per game
create unique index card_purchases_one_strategy on public.card_purchases (group_id)
  where card_type in ('eor', 'capacity_expansion', 'price_hedge');
create unique index card_purchases_one_audit on public.card_purchases (group_id)
  where card_type = 'audit';

create table public.audit_records (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.game_sessions (id) on delete cascade,
  world_id          uuid not null references public.worlds (id) on delete cascade,
  auditor_group_id  uuid not null references public.groups (id) on delete cascade,
  target_group_id   uuid not null references public.groups (id) on delete cascade,
  target_country    text not null,
  target_period     int  not null,
  production_pct    numeric not null,
  card_purchase_id  uuid references public.card_purchases (id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Joint Production Review
create table public.jpr_requests (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.game_sessions (id) on delete cascade,
  world_id         uuid not null references public.worlds (id) on delete cascade,
  status           text not null default 'voting' check (status in ('voting', 'approved', 'rejected')),
  yes_count        int  not null default 0,
  no_count         int  not null default 0,
  required_yes     int  not null,
  opened_period    int  not null,
  revealed_periods int[],
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);
-- at most one open vote and at most one approved review per world
create unique index jpr_requests_one_active on public.jpr_requests (world_id)
  where status in ('voting', 'approved');

-- Individual ballots. No RLS policy grants SELECT on this table to anyone, so
-- votes can never be attributed through the API (anonymous voting).
create table public.jpr_votes (
  request_id uuid not null references public.jpr_requests (id) on delete cascade,
  group_id   uuid not null references public.groups (id) on delete cascade,
  vote       boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, group_id)
);

create table public.jpr_reveals (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.jpr_requests (id) on delete cascade,
  session_id     uuid not null references public.game_sessions (id) on delete cascade,
  world_id       uuid not null references public.worlds (id) on delete cascade,
  group_id       uuid not null references public.groups (id) on delete cascade,
  country_code   text not null,
  period_number  int  not null,
  production_pct numeric not null,
  unique (request_id, group_id, period_number)
);

-- -----------------------------------------------------------------------------
-- Event cards (instructor only)
-- -----------------------------------------------------------------------------
create table public.game_events (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references public.game_sessions (id) on delete cascade,
  event_type          text not null check (event_type in ('recession', 'boom')),
  demand_change       numeric not null,   -- e.g. -0.05 / +0.05
  triggered_in_period int  not null,
  effective_period    int  not null,
  created_at          timestamptz not null default now(),
  unique (session_id, event_type)
);

-- -----------------------------------------------------------------------------
-- Notices (announcements, game notifications, private notices)
--   world_id null  -> all worlds;   group_id not null -> private to that group
-- -----------------------------------------------------------------------------
create table public.notices (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  world_id   uuid references public.worlds (id) on delete cascade,
  group_id   uuid references public.groups (id) on delete cascade,
  category   text not null check (category in ('teacher', 'game', 'world', 'event', 'intel', 'audit', 'card')),
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  body       text,
  created_at timestamptz not null default now()
);
create index notices_session_time on public.notices (session_id, created_at);
