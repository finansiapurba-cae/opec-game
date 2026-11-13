/**
 * Database test harness.
 *
 * Runs the real migrations against a throw-away PostgreSQL database and calls
 * the RPCs exactly like PostgREST does: inside a transaction, as the
 * `authenticated` role, with the caller's JWT claims in `request.jwt.claims`,
 * so row-level security and privilege checks are exercised for real.
 *
 * Set TEST_DATABASE_URL to a superuser connection on any PostgreSQL 15+ server
 * (default: postgres://postgres:postgres@127.0.0.1:5432/postgres). Tests are
 * skipped when the server is unreachable.
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
// @ts-expect-error — plain ESM script without type declarations
import { migrate } from '../../scripts/local-stack/migrate.mjs';

export const BASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export async function databaseAvailable(): Promise<boolean> {
  const c = new pg.Client({ connectionString: BASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

export interface User {
  id: string;
  label: string;
  anonymous: boolean;
}

export class TestDb {
  pool!: pg.Pool;
  url!: string;
  private dbName = `opec_test_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

  async setup() {
    const u = new URL(BASE_URL);
    u.pathname = `/${this.dbName}`;
    this.url = u.toString();
    await migrate(this.url, { reset: true, log: () => {} });
    this.pool = new pg.Pool({ connectionString: this.url, max: 8 });
  }

  async teardown() {
    await this.pool?.end();
    const admin = new pg.Client({ connectionString: BASE_URL });
    await admin.connect();
    await admin.query(`drop database if exists "${this.dbName}" with (force)`);
    await admin.end();
  }

  /** Superuser query (bypasses RLS) — for assertions and setup only. */
  async sql<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query<T>(text, params);
    return r.rows;
  }

  async createUser(label: string, opts: { anonymous?: boolean; instructor?: boolean } = {}): Promise<User> {
    const id = randomUUID();
    const anonymous = opts.anonymous ?? !opts.instructor;
    await this.sql(`insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)`, [
      id,
      anonymous ? null : `${label}@example.edu`,
      anonymous,
    ]);
    if (opts.instructor) await this.sql(`insert into public.instructors (user_id) values ($1)`, [id]);
    return { id, label, anonymous };
  }

  /** Run SQL as an API user (role authenticated + JWT claims), like PostgREST. */
  async as<T = any>(user: User | null, text: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (user) {
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: user.id, role: 'authenticated', is_anonymous: user.anonymous }),
        ]);
        await client.query('set local role authenticated');
      } else {
        await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
        await client.query('set local role anon');
      }
      const r = await client.query(text, params);
      await client.query('commit');
      return r.rows as T[];
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /** Call an RPC by name with named arguments; returns its (jsonb) result. */
  async rpc<T = any>(user: User | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const keys = Object.keys(args);
    const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const values = keys.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const rows = await this.as<{ r: T }>(user, call, values);
    return rows[0]?.r as T;
  }

  /** Expect an RPC to fail with the given error code (exception message). */
  async rpcError(user: User | null, fn: string, args: Record<string, unknown> = {}): Promise<string> {
    try {
      await this.rpc(user, fn, args);
    } catch (err: any) {
      return err.message as string;
    }
    throw new Error(`expected ${fn} to fail`);
  }
}

export interface GameFixture {
  sessionId: string;
  groups: Array<{ id: string; group_number: number; world: string; country_code: string; access_code: string }>;
  students: Map<number, User>;
}

/** Create a session and have a student device claim every group. */
export async function createGame(
  db: TestDb,
  instructor: User,
  opts: { config?: Record<string, unknown>; demo?: boolean; claim?: number[] | 'all' } = {},
): Promise<GameFixture> {
  const session = await db.rpc(instructor, 'create_session', {
    p_name: 'Test game',
    p_is_demo: opts.demo ?? false,
    p_randomize: false,
    p_config: opts.config ?? { rng_seed: 'unit-test' },
    p_period_seconds: 0,
  });
  const groups = await db.sql(
    `select g.id, g.group_number, w.code as world, g.country_code, c.access_code
       from groups g join worlds w on w.id = g.world_id join group_controls c on c.group_id = g.id
      where g.session_id = $1 order by g.group_number`,
    [session.id],
  );
  const students = new Map<number, User>();
  const toClaim = opts.claim === 'all' || opts.claim === undefined ? groups.map((g) => g.group_number) : opts.claim;
  for (const n of toClaim) {
    const g = groups.find((x) => x.group_number === n)!;
    const u = await db.createUser(`group${n}`);
    const res = await db.rpc(u, 'claim_group', { p_group_number: n, p_access_code: g.access_code });
    if (res.status !== 'ok') throw new Error(`claim failed for group ${n}: ${JSON.stringify(res)}`);
    students.set(n, u);
  }
  return { sessionId: session.id, groups, students };
}

export function groupOf(f: GameFixture, world: string, country: string) {
  const g = f.groups.find((x) => x.world === world && x.country_code === country);
  if (!g) throw new Error(`no group for ${world}/${country}`);
  return { ...g, user: f.students.get(g.group_number)! };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
