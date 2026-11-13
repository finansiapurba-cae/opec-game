/** Row and payload types returned by the database RPCs (see supabase/migrations). */
import type { CardType, DemandType, GameConfig } from './engine';

export type UUID = string;
export type WorldCode = 'A' | 'B' | 'C';
export type CountryCode = 'SAU' | 'IRN' | 'IRQ' | 'KWT' | 'ARE' | 'VEN' | 'NGA';
export type BotStrategy = 'cooperative' | 'moderate' | 'competitive' | 'random';

export interface Country {
  code: CountryCode;
  iso2: string;
  name_en: string;
  name_zh: string;
  flag_emoji: string;
  capacity: number;
  reserves: number;
  marginal_cost: number;
  sort_order: number;
}

export interface GameSession {
  id: UUID;
  name: string;
  status: 'lobby' | 'running' | 'finished';
  current_period: number;
  total_periods: number;
  config: GameConfig;
  is_demo: boolean;
  chat_enabled: boolean;
  default_period_seconds: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  groups_claimed?: number;
  bots?: number;
}

export interface World {
  id: UUID;
  session_id: UUID;
  code: WorldCode;
}

export interface Group {
  id: UUID;
  session_id: UUID;
  group_number: number;
  world_id: UUID;
  country_code: CountryCode;
  is_bot: boolean;
  bot_strategy: BotStrategy | null;
  ready: boolean;
  language: 'en' | 'zh';
  claimed_at: string | null;
  last_seen_at: string | null;
  // instructor view only
  access_code?: string;
  controlled?: boolean;
  controller_since?: string | null;
  online?: boolean;
}

export interface CountryState {
  group_id: UUID;
  session_id: UUID;
  world_id: UUID;
  country_code: CountryCode;
  marginal_cost: number;
  base_capacity: number;
  capacity: number;
  original_reserves: number;
  reserves_bonus: number;
  remaining_reserves: number;
  cumulative_production: number;
  cumulative_profit: number;
  cumulative_fv: number;
  card_costs: number;
  last_production: number | null;
  estimated_wealth: number;
  strategy_card: CardType | null;
  audit_used: boolean;
}

export interface Period {
  id: UUID;
  session_id: UUID;
  number: number;
  status: 'open' | 'closed';
  demand_type: DemandType;
  event_multiplier: number;
  demand_noise: number | null;
  demand_factor: number | null;
  duration_seconds: number | null;
  opened_at: string;
  closes_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
}

export interface Submission {
  id: UUID;
  group_id: UUID;
  world_id: UUID;
  period_number: number;
  production: number;
  production_pct: number;
  source: 'student' | 'bot' | 'auto_repeat' | 'instructor';
  revision: number;
  submitted_at: string;
  updated_at: string;
}

export interface WorldResult {
  world_id: UUID;
  period_number: number;
  demand_type: DemandType;
  demand_factor: number;
  total_production: number;
  reference_capacity: number;
  production_share: number;
  effective_share: number;
  price: number;
}

export interface CountryResult {
  group_id: UUID;
  world_id: UUID;
  country_code: CountryCode;
  period_number: number;
  production: number;
  capacity: number;
  production_pct: number;
  auto_submitted: boolean;
  price: number;
  revenue: number;
  production_cost: number;
  profit: number;
  hedge_payout: number;
  card_cost: number;
  fv_factor: number;
  fv_amount: number;
  cumulative_fv: number;
  remaining_reserves: number;
  terminal_value: number;
  estimated_wealth: number;
}

export interface FinalResult {
  group_id: UUID;
  world_id: UUID;
  country_code: CountryCode;
  total_fv: number;
  terminal_value: number;
  card_costs: number;
  card_costs_nominal: number;
  final_wealth: number;
  remaining_reserves: number;
  rank_in_country: number;
  rank_in_world: number;
}

export interface Pledge {
  id: UUID;
  group_id: UUID;
  world_id: UUID;
  country_code: CountryCode;
  period_number: number;
  pledge_pct: number;
  revision: number;
  updated_at: string;
}

export interface CardPurchase {
  id: UUID;
  group_id: UUID;
  world_id: UUID;
  card_type: CardType;
  purchased_period: number;
  capacity_basis: number;
  cost: number;
  activation_period: number | null;
  end_period: number | null;
  details: Record<string, any>;
  applied_at: string | null;
  created_at: string;
}

export interface AuditRecord {
  id: UUID;
  auditor_group_id: UUID;
  target_group_id: UUID;
  target_country: CountryCode;
  target_period: number;
  production_pct: number;
  created_at: string;
}

export interface JprRequest {
  id: UUID;
  world_id: UUID;
  status: 'voting' | 'approved' | 'rejected';
  yes_count: number;
  no_count: number;
  required_yes: number;
  opened_period: number;
  revealed_periods: number[] | null;
  created_at: string;
  resolved_at: string | null;
}

export interface JprReveal {
  request_id: UUID;
  world_id: UUID;
  group_id: UUID;
  country_code: CountryCode;
  period_number: number;
  production_pct: number;
}

export interface GameEvent {
  id: UUID;
  event_type: 'recession' | 'boom';
  demand_change: number;
  triggered_in_period: number;
  effective_period: number;
  created_at: string;
}

export interface Meeting {
  id: UUID;
  session_id: UUID;
  world_id: UUID | null;
  title: string | null;
  period_number: number;
  starts_at: string;
  ends_at: string;
  ended_at: string | null;
}

export interface ChatMessage {
  id: UUID;
  world_id: UUID;
  group_id: UUID | null;
  country_code: CountryCode | null;
  meeting_id: UUID | null;
  body: string;
  created_at: string;
}

export type NoticeCategory = 'teacher' | 'game' | 'world' | 'event' | 'intel' | 'audit' | 'card';

export interface Notice {
  id: UUID;
  session_id: UUID;
  world_id: UUID | null;
  group_id: UUID | null;
  category: NoticeCategory;
  kind: string;
  payload: Record<string, any>;
  body: string | null;
  created_at: string;
}

export interface RosterEntry {
  group_id: UUID;
  group_number: number;
  country_code: CountryCode;
  online: boolean;
}

export interface StudentState {
  status: 'ok' | 'no_group';
  server_time: string;
  group: Group;
  world: World;
  session: GameSession;
  country: Country;
  state: CountryState;
  periods: Period[];
  submissions: Submission[];
  results: CountryResult[];
  world_results: WorldResult[];
  pledges: Pledge[];
  cards: CardPurchase[];
  audits: AuditRecord[];
  jpr_requests: JprRequest[];
  jpr_my_votes: { request_id: UUID; vote: boolean }[];
  jpr_reveals: JprReveal[];
  events: GameEvent[];
  meetings: Meeting[];
  roster: RosterEntry[];
  final_results: FinalResult[];
}

export interface InstructorState {
  server_time: string;
  session: GameSession;
  worlds: World[];
  groups: Group[];
  states: CountryState[];
  periods: Period[];
  submissions: Submission[];
  results: CountryResult[];
  world_results: WorldResult[];
  pledges: Pledge[];
  cards: CardPurchase[];
  audits: AuditRecord[];
  jpr_requests: JprRequest[];
  jpr_reveals: JprReveal[];
  events: GameEvent[];
  meetings: Meeting[];
  notices: Notice[];
  final_results: FinalResult[];
}

export interface FinalResultsPayload {
  session: GameSession | null;
  worlds: World[];
  groups: Pick<Group, 'id' | 'group_number' | 'world_id' | 'country_code' | 'is_bot'>[];
  final_results: FinalResult[];
  results: CountryResult[];
  world_results: WorldResult[];
  pledges: Pledge[];
  cards: CardPurchase[];
  states: CountryState[];
  periods: Period[];
  events: GameEvent[];
}
