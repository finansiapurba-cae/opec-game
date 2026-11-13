-- =============================================================================
-- OPEC Game — Migration 4/4: security (row-level security, grants, realtime)
--
-- Principles
--   * API roles (anon, authenticated) can only SELECT; every write goes through
--     the SECURITY DEFINER functions in migration 3.
--   * Row-level security decides what each student can read:
--       - own group's submissions, results, cards, audits, private notices
--       - own world's prices, pledges, chat, review votes/reveals
--       - never: other countries' production (unless revealed by a Joint
--         Production Review or, after the game, by config.reveal_all_after_game),
--         access codes, device bindings, individual review ballots,
--         another world's chat, or other groups' audits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere
-- -----------------------------------------------------------------------------
alter table public.countries              enable row level security;
alter table public.instructors            enable row level security;
alter table public.instructor_invites     enable row level security;
alter table public.game_sessions          enable row level security;
alter table public.worlds                 enable row level security;
alter table public.groups                 enable row level security;
alter table public.group_controls         enable row level security;
alter table public.claim_attempts         enable row level security;
alter table public.country_states         enable row level security;
alter table public.periods                enable row level security;
alter table public.production_submissions enable row level security;
alter table public.world_period_results   enable row level security;
alter table public.country_period_results enable row level security;
alter table public.final_results          enable row level security;
alter table public.public_pledges         enable row level security;
alter table public.opec_meetings          enable row level security;
alter table public.chat_messages          enable row level security;
alter table public.card_purchases         enable row level security;
alter table public.audit_records          enable row level security;
alter table public.jpr_requests           enable row level security;
alter table public.jpr_votes              enable row level security;
alter table public.jpr_reveals            enable row level security;
alter table public.game_events            enable row level security;
alter table public.notices                enable row level security;

-- -----------------------------------------------------------------------------
-- Read policies ((select fn()) lets Postgres evaluate the helper once per query)
-- -----------------------------------------------------------------------------
create policy countries_read on public.countries
  for select to anon, authenticated using (true);

create policy instructors_read_self on public.instructors
  for select to authenticated using (user_id = (select auth.uid()));

-- instructor_invites, group_controls (read via instructor RPC), claim_attempts, jpr_votes:
-- intentionally NO student policies.
create policy group_controls_instructor on public.group_controls
  for select to authenticated using ((select public.is_instructor()));

create policy sessions_read on public.game_sessions
  for select to authenticated
  using ((select public.is_instructor()) or id = (select public.my_session_id()));

create policy worlds_read on public.worlds
  for select to authenticated
  using ((select public.is_instructor()) or session_id = (select public.my_session_id()));

create policy groups_read on public.groups
  for select to authenticated
  using ((select public.is_instructor()) or session_id = (select public.my_session_id()));

create policy country_states_read on public.country_states
  for select to authenticated
  using ((select public.is_instructor())
         or group_id = (select public.my_group_id())
         or public.revealed_after_game(session_id));

create policy periods_read on public.periods
  for select to authenticated
  using ((select public.is_instructor()) or session_id = (select public.my_session_id()));

create policy submissions_read on public.production_submissions
  for select to authenticated
  using ((select public.is_instructor())
         or group_id = (select public.my_group_id())
         or public.revealed_after_game(session_id));

create policy world_results_read on public.world_period_results
  for select to authenticated
  using ((select public.is_instructor())
         or world_id = (select public.my_world_id())
         or public.revealed_after_game(session_id));

create policy country_results_read on public.country_period_results
  for select to authenticated
  using ((select public.is_instructor())
         or group_id = (select public.my_group_id())
         or public.revealed_after_game(session_id));

create policy final_results_read on public.final_results
  for select to authenticated
  using ((select public.is_instructor()) or public.session_finished_for_me(session_id));

create policy pledges_read on public.public_pledges
  for select to authenticated
  using ((select public.is_instructor())
         or world_id = (select public.my_world_id())
         or public.revealed_after_game(session_id));

create policy meetings_read on public.opec_meetings
  for select to authenticated
  using ((select public.is_instructor())
         or (session_id = (select public.my_session_id())
             and (world_id is null or world_id = (select public.my_world_id()))));

create policy chat_read on public.chat_messages
  for select to authenticated
  using ((select public.is_instructor()) or world_id = (select public.my_world_id()));

create policy cards_read on public.card_purchases
  for select to authenticated
  using ((select public.is_instructor())
         or group_id = (select public.my_group_id())
         or public.revealed_after_game(session_id));

create policy audits_read on public.audit_records
  for select to authenticated
  using ((select public.is_instructor()) or auditor_group_id = (select public.my_group_id()));

create policy jpr_requests_read on public.jpr_requests
  for select to authenticated
  using ((select public.is_instructor()) or world_id = (select public.my_world_id()));

create policy jpr_reveals_read on public.jpr_reveals
  for select to authenticated
  using ((select public.is_instructor()) or world_id = (select public.my_world_id()));

create policy events_read on public.game_events
  for select to authenticated
  using ((select public.is_instructor()) or session_id = (select public.my_session_id()));

create policy notices_read on public.notices
  for select to authenticated
  using ((select public.is_instructor())
         or (session_id = (select public.my_session_id())
             and (group_id is null or group_id = (select public.my_group_id()))
             and (world_id is null or world_id = (select public.my_world_id()))));

-- -----------------------------------------------------------------------------
-- Table privileges: read-only for API roles
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant select on public.countries to anon;
revoke all on all sequences in schema public from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Function privileges: nothing is callable unless granted below
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- helpers used inside RLS policies and invoker functions
grant execute on function public.is_instructor()                to authenticated;
grant execute on function public.my_group_id()                  to authenticated;
grant execute on function public.my_world_id()                  to authenticated;
grant execute on function public.my_session_id()                to authenticated;
grant execute on function public.revealed_after_game(uuid)      to authenticated;
grant execute on function public.session_finished_for_me(uuid)  to authenticated;
grant execute on function public._raise(text, text)             to authenticated;
grant execute on function public._require_instructor()          to authenticated;

-- pure engine functions (no data access) — handy for previews
grant execute on function public.opec_default_config()                                   to anon, authenticated;
grant execute on function public.opec_config(jsonb)                                      to authenticated;
grant execute on function public.opec_jsonb_merge(jsonb, jsonb)                          to authenticated;
grant execute on function public.opec_price(numeric, numeric, text, numeric, jsonb)      to anon, authenticated;
grant execute on function public.opec_effective_share(numeric, numeric, numeric, jsonb)  to anon, authenticated;
grant execute on function public.opec_interp(numeric[], numeric[], numeric, text)        to anon, authenticated;
grant execute on function public.opec_demand_type(int, jsonb)                            to anon, authenticated;

-- student API
grant execute on function public.claim_group(int, text, boolean, text) to authenticated;
grant execute on function public.heartbeat()                          to authenticated;
grant execute on function public.release_my_group()                   to authenticated;
grant execute on function public.set_ready(boolean)                   to authenticated;
grant execute on function public.set_language(text)                   to authenticated;
grant execute on function public.submit_production(numeric, int)      to authenticated;
grant execute on function public.submit_pledge(numeric, int)          to authenticated;
grant execute on function public.buy_strategy_card(text)              to authenticated;
grant execute on function public.use_audit(uuid, int)                 to authenticated;
grant execute on function public.request_jpr()                        to authenticated;
grant execute on function public.vote_jpr(uuid, boolean)              to authenticated;
grant execute on function public.my_jpr_votes()                       to authenticated;
grant execute on function public.send_chat(text, uuid)                to authenticated;
grant execute on function public.tick(uuid)                           to authenticated;
grant execute on function public.whoami()                             to authenticated;
grant execute on function public.get_student_state()                  to authenticated;
grant execute on function public.get_chat(int)                        to authenticated;
grant execute on function public.get_notices(int)                     to authenticated;
grant execute on function public.get_final_results(uuid)              to authenticated;

-- instructor API (each function checks is_instructor() itself)
grant execute on function public.redeem_instructor_invite(text)                         to authenticated;
grant execute on function public.create_session(text, boolean, boolean, jsonb, int, int) to authenticated;
grant execute on function public.delete_session(uuid)                                   to authenticated;
grant execute on function public.update_session_settings(uuid, text, jsonb, int)        to authenticated;
grant execute on function public.set_assignments(uuid, jsonb)                           to authenticated;
grant execute on function public.randomize_assignments(uuid)                            to authenticated;
grant execute on function public.regenerate_access_code(uuid)                           to authenticated;
grant execute on function public.release_group(uuid)                                    to authenticated;
grant execute on function public.set_group_bot(uuid, boolean, text)                     to authenticated;
grant execute on function public.start_game(uuid)                                       to authenticated;
grant execute on function public.open_period(uuid, int)                                 to authenticated;
grant execute on function public.set_period_deadline(uuid, int)                         to authenticated;
grant execute on function public.close_period(uuid)                                     to authenticated;
grant execute on function public.end_game(uuid)                                         to authenticated;
grant execute on function public.reset_session(uuid)                                    to authenticated;
grant execute on function public.set_chat_enabled(uuid, boolean)                        to authenticated;
grant execute on function public.start_meeting(uuid, uuid, int, text)                   to authenticated;
grant execute on function public.end_meeting(uuid)                                      to authenticated;
grant execute on function public.post_announcement(uuid, text, uuid)                    to authenticated;
grant execute on function public.instructor_chat(uuid, text, uuid)                      to authenticated;
grant execute on function public.trigger_event(uuid, text)                              to authenticated;
grant execute on function public.demo_fill_submissions(uuid)                            to authenticated;
grant execute on function public.list_sessions()                                        to authenticated;
grant execute on function public.get_instructor_state(uuid)                             to authenticated;
grant execute on function public.get_instructor_chat(uuid, int)                         to authenticated;

-- Supabase creates new functions with EXECUTE for anon/authenticated by default;
-- make future functions private unless explicitly granted.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: clients subscribe to change notifications (RLS still applies)
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array[
    'game_sessions', 'groups', 'country_states', 'periods', 'production_submissions',
    'world_period_results', 'country_period_results', 'final_results', 'public_pledges',
    'opec_meetings', 'chat_messages', 'card_purchases', 'audit_records', 'jpr_requests',
    'jpr_reveals', 'game_events', 'notices'
  ] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
