/**
 * STANDALONE MODE — the game's real PostgreSQL code running inside the browser.
 *
 * PGlite (PostgreSQL compiled to WebAssembly) executes the very same migrations
 * as Supabase (supabase/migrations/*.sql), so every rule, calculation and
 * row-level-security policy behaves identically. Used for the single-file
 * "play in the browser" build: one device, no server, no accounts.
 */
import { PGlite } from '@electric-sql/pglite';

const sqlFiles = import.meta.glob('/supabase/**/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function migrationsInOrder(): Array<[string, string]> {
  return Object.entries(sqlFiles)
    .filter(([path]) => path.startsWith('/supabase/migrations/'))
    .sort(([a], [b]) => a.localeCompare(b));
}

export interface Claims {
  sub?: string;
  role: 'anon' | 'authenticated';
  is_anonymous?: boolean;
  email?: string;
}

export class RpcError extends Error {
  code: string;
  details: string | null;
  constructor(message: string, code: string, details: string | null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

let dbPromise: Promise<PGlite> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Runs operations one at a time (transactions never interleave). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function open(): Promise<PGlite> {
  let db: PGlite;
  try {
    // keep the game across page reloads when the browser allows IndexedDB
    db = await PGlite.create('idb://opec-game');
  } catch {
    db = await PGlite.create();
  }
  const { rows } = await db.query<{ ok: boolean }>(`select to_regclass('public._local_migrations') is not null as ok`);
  if (!rows[0]?.ok) {
    await db.exec(sqlFiles['/supabase/tests/bootstrap.sql']);
    await db.exec(`create table public._local_migrations (name text primary key, applied_at timestamptz default now())`);
  }
  for (const [path, sql] of migrationsInOrder()) {
    const name = path.split('/').pop()!;
    const done = await db.query(`select 1 from public._local_migrations where name = $1`, [name]);
    if (done.rows.length) continue;
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(`insert into public._local_migrations (name) values ($1)`, [name]);
    });
  }
  await db.exec(`revoke all on public._local_migrations from anon, authenticated`);
  return db;
}

export function database(): Promise<PGlite> {
  dbPromise ??= open().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Calls a game function exactly like PostgREST: as the caller's role, with JWT claims set. */
export function callFunction<T = unknown>(claims: Claims, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!IDENT.test(fn)) return Promise.reject(new RpcError('not found', '42883', null));
  const keys = Object.keys(args).filter((k) => args[k] !== undefined);
  if (!keys.every((k) => IDENT.test(k))) return Promise.reject(new RpcError('bad argument name', '22023', null));
  const values = keys.map((k) => {
    const v = args[k];
    if (v === null) return null;
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  });
  const sql = `select public."${fn}"(${keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ')}) as r`;
  return serial(async () => {
    const db = await database();
    try {
      return await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await tx.exec(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
        const { rows } = await tx.query<{ r: T }>(sql, values);
        return (rows[0]?.r ?? null) as T;
      });
    } catch (err) {
      const e = err as { message?: string; code?: string; detail?: string };
      throw new RpcError(e.message ?? String(err), e.code ?? 'XX000', e.detail ?? null);
    }
  });
}

/** Privileged helper for the local sign-in emulation (never exposed to the game UI). */
export function adminQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return serial(async () => {
    const db = await database();
    const { rows } = await db.query<T>(sql, params);
    return rows;
  });
}
