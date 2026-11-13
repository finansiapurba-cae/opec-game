/**
 * Integration tests for the server-side game logic and its security.
 * They run the real SQL migrations on PostgreSQL (see helpers.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, computePrice, computeWealth, resolveConfig } from '@/lib/engine';
import { TestDb, createGame, databaseAvailable, groupOf, sleep, type GameFixture, type User } from './helpers';

const available = await databaseAvailable();

describe.skipIf(!available)('OPEC game database', () => {
  const db = new TestDb();
  let instructor: User;

  beforeAll(async () => {
    await db.setup();
    instructor = await db.createUser('teacher', { instructor: true });
  });
  afterAll(async () => {
    await db.teardown();
  });

  // ---------------------------------------------------------------- helpers
  const NO_NOISE = { demand: { noise_pct: 0 } };

  async function states(sessionId: string) {
    const rows = await db.sql(
      `select cs.*, g.group_number from country_states cs join groups g on g.id = cs.group_id where cs.session_id = $1`,
      [sessionId],
    );
    return new Map<number, any>(rows.map((r) => [r.group_number, r]));
  }

  async function start(f: GameFixture) {
    await db.rpc(instructor, 'start_game', { p_session: f.sessionId });
  }

  /** open → every claimed group submits pct% of its current capacity (null = skip) → close */
  async function playPeriod(f: GameFixture, pct: (g: GameFixture['groups'][number]) => number | null) {
    await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
    const st = await states(f.sessionId);
    for (const g of f.groups) {
      const user = f.students.get(g.group_number);
      const p = pct(g);
      if (!user || p === null) continue;
      const s = st.get(g.group_number);
      const limit = Math.min(Number(s.capacity), Number(s.remaining_reserves));
      await db.rpc(user, 'submit_production', { p_production: Math.min(Math.round((p / 100) * Number(s.capacity)), limit) });
    }
    return db.rpc(instructor, 'close_period', { p_session: f.sessionId });
  }

  async function worldPrices(sessionId: string, period: number) {
    const rows = await db.sql(
      `select w.code, r.price::float8 as price from world_period_results r join worlds w on w.id = r.world_id
        where r.session_id = $1 and r.period_number = $2 order by w.code`,
      [sessionId, period],
    );
    return Object.fromEntries(rows.map((r) => [r.code, r.price]));
  }

  // ---------------------------------------------------------------- setup & assignments
  describe('sessions and country assignment', () => {
    it('creates 3 worlds × 7 countries with exactly one group per country per world', async () => {
      const f = await createGame(db, instructor, { claim: [] });
      expect(f.groups).toHaveLength(21);
      for (const w of ['A', 'B', 'C']) {
        const countries = f.groups.filter((g) => g.world === w).map((g) => g.country_code).sort();
        expect(countries).toEqual(['ARE', 'IRN', 'IRQ', 'KWT', 'NGA', 'SAU', 'VEN']);
      }
      const st = await states(f.sessionId);
      expect(Number(st.get(1).capacity)).toBe(12000);
      expect(Number(st.get(1).remaining_reserves)).toBe(108000);
    });

    it('country data lives in the database and reserves equal 9 × capacity', async () => {
      const rows = await db.as(null, `select code, capacity::float8, reserves::float8, marginal_cost::float8 from countries order by sort_order`);
      expect(rows.map((r) => r.code)).toEqual(['SAU', 'IRN', 'IRQ', 'KWT', 'ARE', 'VEN', 'NGA']);
      for (const r of rows) expect(r.reserves).toBe(9 * r.capacity);
    });

    it('validates manual assignments and keeps the bijection when randomizing', async () => {
      const f = await createGame(db, instructor, { claim: [] });
      const bad = f.groups.map((g) => ({ group_number: g.group_number, world: 'A', country: 'SAU' }));
      expect(await db.rpcError(instructor, 'set_assignments', { p_session: f.sessionId, p_assignments: bad })).toBe('invalid_assignments');

      // swap groups 1 and 2
      const swapped = f.groups.map((g) => ({
        group_number: g.group_number,
        world: g.world,
        country: g.group_number === 1 ? 'IRN' : g.group_number === 2 ? 'SAU' : g.country_code,
      }));
      await db.rpc(instructor, 'set_assignments', { p_session: f.sessionId, p_assignments: swapped });
      const st = await states(f.sessionId);
      expect(st.get(1).country_code).toBe('IRN');
      expect(Number(st.get(1).capacity)).toBe(4600);

      await db.rpc(instructor, 'randomize_assignments', { p_session: f.sessionId });
      const rows = await db.sql(`select world_id, country_code from groups where session_id = $1`, [f.sessionId]);
      expect(new Set(rows.map((r) => `${r.world_id}:${r.country_code}`)).size).toBe(21);
    });

    it('only instructors can manage sessions', async () => {
      const student = await db.createUser('nobody');
      expect(await db.rpcError(student, 'create_session', { p_name: 'x' })).toBe('not_instructor');
      expect(await db.rpcError(student, 'list_sessions')).toBe('not_instructor');
    });
  });

  // ---------------------------------------------------------------- login
  describe('group login and single controlling device', () => {
    it('rejects wrong codes, blocks a second device and allows an explicit takeover', async () => {
      const f = await createGame(db, instructor, { claim: [1] });
      const g1 = f.groups[0];
      const dev2 = await db.createUser('device2');

      expect((await db.rpc(dev2, 'claim_group', { p_group_number: 1, p_access_code: 'WRONG1' })).status).toBe('invalid');
      expect((await db.rpc(dev2, 'claim_group', { p_group_number: 2, p_access_code: g1.access_code })).status).toBe('invalid');

      const inUse = await db.rpc(dev2, 'claim_group', { p_group_number: 1, p_access_code: g1.access_code.toLowerCase() });
      expect(inUse.status).toBe('in_use');

      const taken = await db.rpc(dev2, 'claim_group', { p_group_number: 1, p_access_code: g1.access_code, p_takeover: true });
      expect(taken.status).toBe('ok');

      const dev1 = f.students.get(1)!;
      expect((await db.rpc(dev1, 'heartbeat')).controller).toBe(false);
      expect((await db.rpc(dev2, 'heartbeat')).controller).toBe(true);
      await start(f);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      expect(await db.rpcError(dev1, 'submit_production', { p_production: 100 })).toBe('not_controller');
    });

    it('recovers the same group after a page refresh (same auth user) and supports switching user', async () => {
      const f = await createGame(db, instructor, { claim: [3] });
      const u = f.students.get(3)!;
      const again = await db.rpc(u, 'claim_group', { p_group_number: 3, p_access_code: f.groups[2].access_code });
      expect(again.status).toBe('ok');
      const state = await db.rpc(u, 'get_student_state');
      expect(state.group.group_number).toBe(3);
      await db.rpc(u, 'release_my_group');
      expect((await db.rpc(u, 'get_student_state')).status).toBe('no_group');
    });

    it('rate-limits repeated wrong codes', async () => {
      const f = await createGame(db, instructor, { claim: [] });
      const attacker = await db.createUser('attacker');
      for (let i = 0; i < 10; i++) {
        await db.rpc(attacker, 'claim_group', { p_group_number: 1, p_access_code: `BAD${i}` });
      }
      const res = await db.rpc(attacker, 'claim_group', { p_group_number: 1, p_access_code: f.groups[0].access_code });
      expect(res.status).toBe('too_many_attempts');
    });
  });

  // ---------------------------------------------------------------- production
  describe('production submissions', () => {
    let f: GameFixture;
    beforeAll(async () => {
      f = await createGame(db, instructor, { config: NO_NOISE });
    });

    it('refuses submissions before the game/period is open', async () => {
      const u = f.students.get(1)!;
      expect(await db.rpcError(u, 'submit_production', { p_production: 100 })).toBe('game_not_running');
      await start(f);
      expect(await db.rpcError(u, 'submit_production', { p_production: 100 })).toBe('period_not_open');
    });

    it('enforces production ≤ min(capacity, remaining reserves) on the server', async () => {
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const sau = f.students.get(1)!;
      const err = await db.rpcError(sau, 'submit_production', { p_production: 12001 });
      expect(err).toBe('exceeds_limit');
      expect(await db.rpcError(sau, 'submit_production', { p_production: -1 })).toBe('invalid_production');
      const ok = await db.rpc(sau, 'submit_production', { p_production: 12000 });
      expect(Number(ok.production)).toBe(12000);
    });

    it('lets a group revise its submission while the period is open (latest wins)', async () => {
      const sau = f.students.get(1)!;
      await db.rpc(sau, 'submit_production', { p_production: 9000 });
      const last = await db.rpc(sau, 'submit_production', { p_production: 9600 });
      expect(last.revision).toBe(3);
      expect(Number(last.production)).toBe(9600);
      expect(Number(last.production_pct)).toBe(80);
    });

    it('fills missing submissions: Period 1 uses the configured default (0), later periods repeat the previous output', async () => {
      // only group 1 submitted in period 1
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      const p1 = await db.sql(
        `select g.group_number, r.production::float8, r.auto_submitted from country_period_results r join groups g on g.id = r.group_id
          where r.session_id = $1 and r.period_number = 1 order by g.group_number`,
        [f.sessionId],
      );
      expect(p1).toHaveLength(21);
      expect(p1[0]).toMatchObject({ group_number: 1, production: 9600, auto_submitted: false });
      expect(p1[1]).toMatchObject({ group_number: 2, production: 0, auto_submitted: true });

      // period 2: group 2 submits, nobody else → group 1 repeats 9,600
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      await db.rpc(f.students.get(2)!, 'submit_production', { p_production: 4000 });
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      const p2 = await db.sql(
        `select g.group_number, r.production::float8, r.auto_submitted from country_period_results r join groups g on g.id = r.group_id
          where r.session_id = $1 and r.period_number = 2 and g.group_number in (1, 2) order by g.group_number`,
        [f.sessionId],
      );
      expect(p2).toEqual([
        { group_number: 1, production: 9600, auto_submitted: true },
        { group_number: 2, production: 4000, auto_submitted: false },
      ]);
    });

    it('rejects a submission made from a stale screen showing another period', async () => {
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const u = f.students.get(1)!;
      expect(await db.rpcError(u, 'submit_production', { p_production: 100, p_period: 1 })).toBe('period_changed');
      const ok = await db.rpc(u, 'submit_production', { p_production: 100, p_period: 3 });
      expect(ok.period_number).toBe(3);
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
    });

    it('locks submissions once the period is closed', async () => {
      expect(await db.rpcError(f.students.get(1)!, 'submit_production', { p_production: 1 })).toBe('period_not_open');
    });

    it('locks submissions when the countdown expires and closes the period on the next tick', async () => {
      const g = await createGame(db, instructor, { config: NO_NOISE, claim: [1] });
      await start(g);
      await db.rpc(instructor, 'open_period', { p_session: g.sessionId, p_duration_seconds: 1 });
      const u = g.students.get(1)!;
      expect((await db.rpc(u, 'tick')).closed).toBe(false);
      await sleep(1200);
      expect(await db.rpcError(u, 'submit_production', { p_production: 100 })).toBe('period_closed');
      const t = await db.rpc(u, 'tick');
      expect(t.closed).toBe(true);
      expect((await db.rpc(u, 'tick')).closed).toBe(false);
    });
  });

  // ---------------------------------------------------------------- market
  describe('period closing and market price', () => {
    it('reproduces the reference table and alternates low/high demand', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await playPeriod(f, () => 80);
      expect(await worldPrices(f.sessionId, 1)).toEqual({ A: 92, B: 92, C: 92 });
      await playPeriod(f, () => 100);
      expect(await worldPrices(f.sessionId, 2)).toEqual({ A: 91, B: 91, C: 91 });
      const periods = await db.sql(`select number, demand_type from periods where session_id = $1 order by number`, [f.sessionId]);
      expect(periods.map((p) => p.demand_type)).toEqual(['low', 'high']);
    });

    it('gives identical prices for identical inputs across worlds even with random demand', async () => {
      const f = await createGame(db, instructor, { config: { rng_seed: 'same-everywhere' } });
      await start(f);
      const res = await playPeriod(f, () => 75);
      const prices = await worldPrices(f.sessionId, 1);
      expect(prices.A).toBe(prices.B);
      expect(prices.B).toBe(prices.C);
      expect(Math.abs(Number(res.noise))).toBeLessThanOrEqual(0.015);
      // server price equals the TypeScript mirror for the recorded demand factor
      const ts = computePrice(
        { totalProduction: 0.75 * 33700, demandType: 'low', demandFactor: Number(res.demand_factor) },
        resolveConfig({}),
      );
      expect(Math.abs(prices.A - ts)).toBeLessThanOrEqual(0.011);
    });

    it('separates markets: different production gives different prices per world', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await playPeriod(f, (g) => (g.world === 'A' ? 60 : g.world === 'B' ? 80 : 100));
      expect(await worldPrices(f.sessionId, 1)).toEqual({ A: 119, B: 92, C: 65 });
    });

    it('computes each period exactly once, even with concurrent close requests', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE, claim: [] });
      await start(f);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const results = await Promise.all([1, 2, 3, 4].map(() => db.rpc(instructor, 'close_period', { p_session: f.sessionId })));
      expect(results.filter((r) => r.closed)).toHaveLength(1);
      const counts = await db.sql(
        `select (select count(*) from world_period_results where session_id = $1)::int as w,
                (select count(*) from country_period_results where session_id = $1)::int as c`,
        [f.sessionId],
      );
      expect(counts[0]).toEqual({ w: 3, c: 21 });
    });

    it('applies event cards to the next period in all three worlds', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const ev = await db.rpc(instructor, 'trigger_event', { p_session: f.sessionId, p_event: 'recession' });
      expect(ev.effective_period).toBe(2);
      expect(await db.rpcError(instructor, 'trigger_event', { p_session: f.sessionId, p_event: 'recession' })).toBe('event_already_used');
      expect(await db.rpcError(instructor, 'trigger_event', { p_session: f.sessionId, p_event: 'boom' })).toBe('event_conflict');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      await playPeriod(f, () => 100);
      const p2 = await db.sql(`select event_multiplier::float8 from periods where session_id = $1 and number = 2`, [f.sessionId]);
      expect(p2[0].event_multiplier).toBeCloseTo(0.95, 10);
      const expected = computePrice({ totalProduction: 33700, demandType: 'high', demandFactor: 0.95 }, resolveConfig(NO_NOISE));
      expect(await worldPrices(f.sessionId, 2)).toEqual({ A: expected, B: expected, C: expected });
      expect(expected).toBeLessThan(91);
    });
  });

  // ---------------------------------------------------------------- accounting & reserves
  describe('profit, compounding, reserves and final wealth', () => {
    it('compounds each period profit at 5 % to Period 11 and depletes reserves', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await playPeriod(f, () => 100); // low, all 100% → $65
      const r = (
        await db.sql(
          `select r.* from country_period_results r join groups g on g.id = r.group_id where g.session_id = $1 and g.group_number = 1 and r.period_number = 1`,
          [f.sessionId],
        )
      )[0];
      expect(Number(r.price)).toBe(65);
      expect(Number(r.profit)).toBeCloseTo(672, 9);
      expect(Number(r.fv_amount)).toBeCloseTo(672 * 1.05 ** 10, 6);
      expect(Number(r.remaining_reserves)).toBe(96000);
      expect(Number(r.terminal_value)).toBeCloseTo(61 * 96, 9);
      expect(Number(r.estimated_wealth)).toBeCloseTo(672 * 1.05 ** 10 + 61 * 96, 6);
    });

    it('caps production at remaining reserves and runs a full 10-period game to final rankings', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      // A cooperates at 70 %, B competes at 100 %, C at 85 %
      for (let t = 1; t <= 10; t++) {
        await playPeriod(f, (g) => (g.world === 'A' ? 70 : g.world === 'B' ? 100 : 85));
      }
      const session = (await db.sql(`select status from game_sessions where id = $1`, [f.sessionId]))[0];
      expect(session.status).toBe('finished');

      // World B produced flat out: reserves were exhausted in period 10
      const bSau = groupOf(f, 'B', 'SAU');
      const hist = await db.sql(
        `select period_number, production::float8, remaining_reserves::float8 from country_period_results where group_id = $1 order by period_number`,
        [bSau.id],
      );
      expect(hist.slice(0, 9).every((h) => h.production === 12000)).toBe(true);
      expect(hist[9]).toEqual({ period_number: 10, production: 0, remaining_reserves: 0 });

      // final wealth equals the TypeScript accounting model on the recorded prices
      const finals = await db.sql(`select * from final_results where session_id = $1`, [f.sessionId]);
      expect(finals).toHaveLength(21);
      const aIrn = groupOf(f, 'A', 'IRN');
      const rows = await db.sql(
        `select period_number, price::float8, production::float8 from country_period_results where group_id = $1 order by period_number`,
        [aIrn.id],
      );
      const model = computeWealth(
        {
          marginalCost: 10,
          initialReserves: 41400,
          totalPeriods: 10,
          periods: rows.map((x) => ({ period: x.period_number, price: x.price, production: x.production })),
        },
        DEFAULT_CONFIG,
      );
      const serverIrn = finals.find((x) => x.group_id === aIrn.id);
      expect(Number(serverIrn.final_wealth)).toBeCloseTo(model.finalWealth, 6);
      expect(Number(serverIrn.terminal_value)).toBeCloseTo(model.terminalValue, 6);

      // ranks within each country across worlds
      for (const code of ['SAU', 'IRN', 'IRQ', 'KWT', 'ARE', 'VEN', 'NGA']) {
        const rs = finals.filter((x) => x.country_code === code).sort((a, b) => Number(b.final_wealth) - Number(a.final_wealth));
        expect(rs.map((x) => x.rank_in_country)).toEqual([1, 2, 3]);
      }

      // students can read every world's results after the game
      const student = f.students.get(1)!;
      const fr = await db.rpc(student, 'get_final_results', { p_session: f.sessionId });
      expect(fr.final_results).toHaveLength(21);
      expect(fr.results).toHaveLength(210);
      expect(await db.rpcError(instructor, 'open_period', { p_session: f.sessionId })).toBe('game_not_running');
    });

    it('rejects production above remaining reserves once reserves are nearly exhausted', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE, claim: [7] });
      await start(f);
      await db.sql(`update country_states set remaining_reserves = 500 where group_id = $1`, [f.groups[6].id]);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const u = f.students.get(7)!;
      expect(await db.rpcError(u, 'submit_production', { p_production: 501 })).toBe('exceeds_limit');
      await db.rpc(u, 'submit_production', { p_production: 500 });
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      const st = await states(f.sessionId);
      expect(Number(st.get(7).remaining_reserves)).toBe(0);
    });
  });

  // ---------------------------------------------------------------- cards
  describe('strategy cards', () => {
    it('Capacity Expansion: +20 % from the second period after purchase; one strategy card per game', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const irq = groupOf(f, 'A', 'IRQ');
      const card = await db.rpc(irq.user, 'buy_strategy_card', { p_card: 'capacity_expansion' });
      expect(card.activation_period).toBe(3);
      expect(Number(card.cost)).toBeCloseTo(12 * 3.7, 9);
      expect(await db.rpcError(irq.user, 'buy_strategy_card', { p_card: 'eor' })).toBe('strategy_card_already_used');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });

      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      expect(Number((await states(f.sessionId)).get(irq.group_number).capacity)).toBe(3700);
      expect(await db.rpcError(irq.user, 'submit_production', { p_production: 3701 })).toBe('exceeds_limit');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });

      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const st = (await states(f.sessionId)).get(irq.group_number);
      expect(Number(st.capacity)).toBe(4440);
      expect(Number(st.original_reserves)).toBe(33300);
      await db.rpc(irq.user, 'submit_production', { p_production: 4440 });
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
    });

    it('Enhanced Oil Recovery: +10 % of original reserves once, from the third period after purchase', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const irn = groupOf(f, 'B', 'IRN');
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const card = await db.rpc(irn.user, 'buy_strategy_card', { p_card: 'eor' });
      expect(card.activation_period).toBe(4);
      await db.rpc(irn.user, 'submit_production', { p_production: 4600 });
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      for (let t = 2; t <= 3; t++) {
        await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
        await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      }
      // before activation: 41,400 − 3 × 4,600 (missing periods repeat 4,600)
      expect(Number((await states(f.sessionId)).get(irn.group_number).remaining_reserves)).toBe(41400 - 3 * 4600);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const st = (await states(f.sessionId)).get(irn.group_number);
      expect(Number(st.remaining_reserves)).toBe(41400 - 3 * 4600 + 4140);
      expect(Number(st.capacity)).toBe(4600);
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      expect(Number((await states(f.sessionId)).get(irn.group_number).reserves_bonus)).toBe(4140); // applied once
    });

    it('Price Hedge: pays (95 − P) on 50 % of capacity for three periods, regardless of production', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const ven = groupOf(f, 'C', 'VEN');
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const card = await db.rpc(ven.user, 'buy_strategy_card', { p_card: 'price_hedge' });
      expect([card.activation_period, card.end_period, Number(card.details.volume)]).toEqual([2, 4, 2200]);
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });

      // P2 high: everyone 100% → $91 → (95 − 91) × 2,200
      await playPeriod(f, () => 100);
      // P3 low: VEN produces NOTHING, others 100% → price < $95 → still paid
      await playPeriod(f, (g) => (g.world === 'C' && g.country_code === 'VEN' ? 0 : 100));
      // P4 high: 60% → $140 ≥ $95 → nothing; P5 low 100% → $65 but the hedge has expired
      await playPeriod(f, () => 60);
      await playPeriod(f, () => 100);
      const rows = await db.sql(
        `select period_number, production::float8, price::float8, hedge_payout::float8 from country_period_results where group_id = $1 order by period_number`,
        [ven.id],
      );
      const by = Object.fromEntries(rows.map((r) => [r.period_number, r]));
      expect(by[1].hedge_payout).toBe(0);
      expect(by[2].price).toBe(91);
      expect(by[2].hedge_payout).toBeCloseTo(((95 - 91) * 2200) / 1000, 9);
      expect(by[3].production).toBe(0);
      expect(by[3].price).toBeLessThan(95);
      expect(by[3].hedge_payout).toBeCloseTo(((95 - by[3].price) * 2200) / 1000, 9);
      expect(by[4].price).toBe(140);
      expect(by[4].hedge_payout).toBe(0);
      expect(by[5].price).toBe(65);
      expect(by[5].hedge_payout).toBe(0);
    });

    it('refuses cards whose effect would start after the last period, and outside open periods', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE, claim: [1] });
      await start(f);
      const u = f.students.get(1)!;
      expect(await db.rpcError(u, 'buy_strategy_card', { p_card: 'eor' })).toBe('period_not_open');
      for (let t = 1; t <= 7; t++) {
        await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
        await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      }
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 }); // period 8
      expect(await db.rpcError(u, 'buy_strategy_card', { p_card: 'eor' })).toBe('card_too_late');
      const ok = await db.rpc(u, 'buy_strategy_card', { p_card: 'capacity_expansion' });
      expect(ok.activation_period).toBe(10);
    });
  });

  // ---------------------------------------------------------------- privacy
  describe('privacy: audits, hidden production and row-level security', () => {
    let f: GameFixture;
    beforeAll(async () => {
      f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      await playPeriod(f, (g) => (g.country_code === 'IRN' ? 90 : 80));
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
    });

    it('an audit privately reveals one country’s production share for a closed period', async () => {
      const sau = groupOf(f, 'A', 'SAU');
      const irn = groupOf(f, 'A', 'IRN');
      const iraq = groupOf(f, 'A', 'IRQ');
      const bIrn = groupOf(f, 'B', 'IRN');

      expect(await db.rpcError(sau.user, 'use_audit', { p_target_group: bIrn.id, p_period: 1 })).toBe('invalid_target');
      expect(await db.rpcError(sau.user, 'use_audit', { p_target_group: irn.id, p_period: 2 })).toBe('period_not_closed');

      const audit = await db.rpc(sau.user, 'use_audit', { p_target_group: irn.id, p_period: 1 });
      expect(Number(audit.production_pct)).toBe(90);
      expect(Number(audit.cost)).toBe(60); // $5M × 12
      expect(await db.rpcError(sau.user, 'use_audit', { p_target_group: iraq.id, p_period: 1 })).toBe('audit_already_used');

      // visible to the auditor only
      expect(await db.as(sau.user, `select * from audit_records`)).toHaveLength(1);
      expect(await db.as(iraq.user, `select * from audit_records`)).toHaveLength(0);
      expect(await db.as(irn.user, `select * from audit_records`)).toHaveLength(0);
      const iraqNotices = await db.rpc(iraq.user, 'get_notices');
      expect(iraqNotices.some((n: any) => n.kind === 'audit_result')).toBe(false);
      const sauNotices = await db.rpc(sau.user, 'get_notices');
      expect(sauNotices.some((n: any) => n.kind === 'audit_result')).toBe(true);
    });

    it('students only see their own production, never other countries’', async () => {
      const sau = groupOf(f, 'A', 'SAU');
      const subs = await db.as(sau.user, `select group_id from production_submissions`);
      expect(new Set(subs.map((s) => s.group_id))).toEqual(new Set([sau.id]));
      const res = await db.as(sau.user, `select group_id from country_period_results`);
      expect(new Set(res.map((s) => s.group_id))).toEqual(new Set([sau.id]));
      const st = await db.as(sau.user, `select group_id from country_states`);
      expect(st).toHaveLength(1);
      // but the world price and total are visible for their world only
      const wr = await db.as(sau.user, `select world_id from world_period_results`);
      expect(wr).toHaveLength(1);
    });

    it('access codes, device bindings and ballots are not readable by students', async () => {
      const sau = groupOf(f, 'A', 'SAU');
      expect(await db.as(sau.user, `select * from group_controls`)).toHaveLength(0);
      expect(await db.as(sau.user, `select * from jpr_votes`)).toHaveLength(0);
      expect(await db.as(sau.user, `select * from claim_attempts`)).toHaveLength(0);
      const st = await db.rpc(sau.user, 'get_student_state');
      expect(JSON.stringify(st)).not.toContain(sau.access_code);
    });

    it('students cannot write tables directly or call instructor/internal functions', async () => {
      const sau = groupOf(f, 'A', 'SAU');
      await expect(
        db.as(sau.user, `insert into production_submissions (session_id, world_id, group_id, period_number, production, production_pct, source)
                         select session_id, world_id, group_id, 2, 0, 0, 'student' from country_states limit 1`),
      ).rejects.toThrow(/permission denied/);
      await expect(db.as(sau.user, `update country_states set remaining_reserves = 1e9`)).rejects.toThrow(/permission denied/);
      await expect(db.as(sau.user, `select public._close_period($1, 'x')`, [f.sessionId])).rejects.toThrow(/permission denied/);
      expect(await db.rpcError(sau.user, 'close_period', { p_session: f.sessionId })).toBe('not_instructor');
      expect(await db.rpcError(sau.user, 'get_instructor_state', { p_session: f.sessionId })).toBe('not_instructor');
      await expect(db.as(null, `select public.get_student_state()`)).rejects.toThrow(/permission denied/);
    });
  });

  // ---------------------------------------------------------------- JPR
  describe('Joint Production Review (anonymous voting)', () => {
    it('needs 4 of 7 votes, reveals the last two closed periods to that world only, once per world', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const a = ['SAU', 'IRN', 'IRQ', 'KWT', 'ARE', 'VEN', 'NGA'].map((c) => groupOf(f, 'A', c));
      expect(await db.rpcError(a[0].user, 'request_jpr')).toBe('no_closed_period');
      await playPeriod(f, () => 80);
      await playPeriod(f, (g) => (g.country_code === 'VEN' ? 100 : 80));
      await playPeriod(f, (g) => (g.country_code === 'NGA' ? 95 : 70));

      const req = await db.rpc(a[0].user, 'request_jpr');
      expect([req.status, req.yes_count]).toEqual(['voting', 1]);
      expect(await db.rpcError(a[1].user, 'request_jpr')).toBe('jpr_vote_in_progress');
      expect(await db.rpcError(a[0].user, 'vote_jpr', { p_request: req.id, p_vote: true })).toBe('already_voted');

      await db.rpc(a[1].user, 'vote_jpr', { p_request: req.id, p_vote: false });
      await db.rpc(a[2].user, 'vote_jpr', { p_request: req.id, p_vote: true });
      // other worlds cannot vote on world A's request
      expect(await db.rpcError(groupOf(f, 'B', 'SAU').user, 'vote_jpr', { p_request: req.id, p_vote: true })).toBe('invalid_request');
      await db.rpc(a[3].user, 'vote_jpr', { p_request: req.id, p_vote: true });
      const done = await db.rpc(a[4].user, 'vote_jpr', { p_request: req.id, p_vote: true });
      expect([done.status, done.yes_count, done.no_count]).toEqual(['approved', 4, 1]);
      expect(done.revealed_periods).toEqual([2, 3]);

      const reveals = await db.as(a[6].user, `select country_code, period_number, production_pct::float8 from jpr_reveals order by period_number, country_code`);
      expect(reveals).toHaveLength(14);
      expect(reveals.find((r) => r.country_code === 'VEN' && r.period_number === 2)!.production_pct).toBe(100);
      expect(reveals.find((r) => r.country_code === 'NGA' && r.period_number === 3)!.production_pct).toBe(95);
      expect(await db.as(groupOf(f, 'B', 'SAU').user, `select * from jpr_reveals`)).toHaveLength(0);

      // anonymous: nobody (not even the instructor through the API) can read ballots
      expect(await db.as(instructor, `select * from jpr_votes`)).toHaveLength(0);
      const visible = await db.as(a[5].user, `select * from jpr_requests`);
      expect(Object.keys(visible[0])).not.toContain('initiated_by');

      expect(await db.rpcError(a[5].user, 'request_jpr')).toBe('jpr_already_used');
    });

    it('a rejected vote does not consume the review; unresolved votes expire with the period', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const a = ['SAU', 'IRN', 'IRQ', 'KWT', 'ARE', 'VEN', 'NGA'].map((c) => groupOf(f, 'A', c));
      await playPeriod(f, () => 80);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      const req = await db.rpc(a[0].user, 'request_jpr');
      for (const g of a.slice(1, 4)) await db.rpc(g.user, 'vote_jpr', { p_request: req.id, p_vote: false });
      const r = await db.rpc(a[4].user, 'vote_jpr', { p_request: req.id, p_vote: false });
      expect(r.status).toBe('rejected'); // 4 "no": 4 yes can no longer be reached
      const again = await db.rpc(a[1].user, 'request_jpr');
      expect(again.status).toBe('voting');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      const after = await db.sql(`select status from jpr_requests where id = $1`, [again.id]);
      expect(after[0].status).toBe('rejected');
    });
  });

  // ---------------------------------------------------------------- talk & pledges
  describe('talk, meetings and public pledges', () => {
    it('chat is locked in Periods 1–2 and isolated per world afterwards', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const aSau = groupOf(f, 'A', 'SAU');
      const bSau = groupOf(f, 'B', 'SAU');
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      expect(await db.rpcError(instructor, 'set_chat_enabled', { p_session: f.sessionId, p_enabled: true })).toBe('talk_locked');
      expect(await db.rpcError(aSau.user, 'send_chat', { p_body: 'hi' })).toBe('talk_locked');
      expect(await db.rpcError(instructor, 'start_meeting', { p_session: f.sessionId })).toBe('talk_locked');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      await playPeriod(f, () => 80);

      // between Period 2 and 3 → negotiations may begin
      await db.rpc(instructor, 'set_chat_enabled', { p_session: f.sessionId, p_enabled: true });
      await db.rpc(aSau.user, 'send_chat', { p_body: 'World A: let us cut to 70%' });
      await db.rpc(bSau.user, 'send_chat', { p_body: 'World B secret' });
      const aChat = await db.rpc(aSau.user, 'get_chat');
      const bChat = await db.rpc(bSau.user, 'get_chat');
      expect(aChat.map((m: any) => m.body)).toEqual(['World A: let us cut to 70%']);
      expect(bChat.map((m: any) => m.body)).toEqual(['World B secret']);
      expect(await db.as(bSau.user, `select * from chat_messages where body like 'World A%'`)).toHaveLength(0);
      expect((await db.rpc(instructor, 'get_instructor_chat', { p_session: f.sessionId })).length).toBe(2);

      // OPEC meeting for world A only
      const worldA = (await db.sql(`select id from worlds where session_id = $1 and code = 'A'`, [f.sessionId]))[0].id;
      await db.rpc(instructor, 'set_chat_enabled', { p_session: f.sessionId, p_enabled: false });
      expect(await db.rpcError(aSau.user, 'send_chat', { p_body: 'x' })).toBe('chat_disabled');
      const m = await db.rpc(instructor, 'start_meeting', { p_session: f.sessionId, p_world: worldA, p_minutes: 5 });
      await db.rpc(aSau.user, 'send_chat', { p_body: 'in the meeting', p_meeting: m.id });
      expect(await db.rpcError(bSau.user, 'send_chat', { p_body: 'sneak', p_meeting: m.id })).toBe('meeting_not_active');
      await db.rpc(instructor, 'end_meeting', { p_meeting: m.id });
      expect(await db.rpcError(aSau.user, 'send_chat', { p_body: 'late', p_meeting: m.id })).toBe('meeting_not_active');
    });

    it('pledges start in Period 3, are editable while open, visible to the world, and do not constrain output', async () => {
      const f = await createGame(db, instructor, { config: NO_NOISE });
      await start(f);
      const aKwt = groupOf(f, 'A', 'KWT');
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      expect(await db.rpcError(aKwt.user, 'submit_pledge', { p_pct: 70 })).toBe('pledge_locked');
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      await playPeriod(f, () => 80);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      await db.rpc(aKwt.user, 'submit_pledge', { p_pct: 75 });
      const p = await db.rpc(aKwt.user, 'submit_pledge', { p_pct: 70 });
      expect([Number(p.pledge_pct), p.revision]).toEqual([70, 2]);
      expect(await db.rpcError(aKwt.user, 'submit_pledge', { p_pct: 101 })).toBe('invalid_pledge');
      await db.rpc(aKwt.user, 'submit_production', { p_production: 3300 }); // 100% despite pledging 70%
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });

      const seenByA = await db.as(groupOf(f, 'A', 'NGA').user, `select country_code, pledge_pct::float8 from public_pledges`);
      expect(seenByA).toEqual([{ country_code: 'KWT', pledge_pct: 70 }]);
      expect(await db.as(groupOf(f, 'B', 'NGA').user, `select * from public_pledges`)).toHaveLength(0);
      const res = await db.sql(`select production_pct::float8 from country_period_results where group_id = $1 and period_number = 3`, [aKwt.id]);
      expect(res[0].production_pct).toBe(100);
    });
  });

  // ---------------------------------------------------------------- demo mode
  describe('demo mode', () => {
    it('simulated groups submit, pledge and buy cards automatically', async () => {
      const f = await createGame(db, instructor, { demo: true, claim: [], config: { rng_seed: 'demo' } });
      await start(f);
      for (let t = 1; t <= 10; t++) {
        await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
        const subs = await db.sql(`select count(*)::int as n from production_submissions where session_id = $1 and period_number = $2 and source = 'bot'`, [f.sessionId, t]);
        expect(subs[0].n).toBe(21);
        await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      }
      const pledges = await db.sql(`select count(*)::int as n from public_pledges where session_id = $1`, [f.sessionId]);
      expect(pledges[0].n).toBe(21 * 8);
      const cards = await db.sql(`select card_type, count(*)::int as n from card_purchases where session_id = $1 group by 1`, [f.sessionId]);
      expect(cards.length).toBeGreaterThan(0);
      const fin = await db.sql(`select count(*)::int as n from final_results where session_id = $1`, [f.sessionId]);
      expect(fin[0].n).toBe(21);
    });

    it('reset returns a session to the lobby with pristine country states', async () => {
      const f = await createGame(db, instructor, { demo: true, claim: [] });
      await start(f);
      await db.rpc(instructor, 'open_period', { p_session: f.sessionId, p_duration_seconds: 0 });
      await db.rpc(instructor, 'close_period', { p_session: f.sessionId });
      await db.rpc(instructor, 'reset_session', { p_session: f.sessionId });
      const s = (await db.sql(`select status, current_period from game_sessions where id = $1`, [f.sessionId]))[0];
      expect(s).toEqual({ status: 'lobby', current_period: 0 });
      const st = await states(f.sessionId);
      expect(Number(st.get(1).remaining_reserves)).toBe(108000);
      const n = await db.sql(`select count(*)::int as n from country_period_results where session_id = $1`, [f.sessionId]);
      expect(n[0].n).toBe(0);
    });
  });
});
