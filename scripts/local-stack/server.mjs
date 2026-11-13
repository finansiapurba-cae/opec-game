#!/usr/bin/env node
/**
 * Lightweight LOCAL backend for development and end-to-end tests — NOT for production.
 *
 * Emulates the small part of the Supabase API the app uses, on top of a plain
 * PostgreSQL database that has the migrations applied:
 *   - Auth (GoTrue-compatible subset): anonymous sign-in, e-mail/password
 *     sign-up/sign-in, refresh, user, logout — HS256 JWTs
 *   - PostgREST-compatible RPC: POST /rest/v1/rpc/<function>, executed inside a
 *     transaction as the caller's role with request.jwt.claims set, so
 *     row-level security and grants behave exactly as on Supabase
 *   - No realtime: the app falls back to polling automatically
 *
 * Usage
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/opec \
 *     node scripts/local-stack/server.mjs [--reset] [--port 54321] [--host 0.0.0.0] \
 *       [--instructor you@school.edu:YOUR-PASSWORD] [--static dist]
 *
 * --static dist  also serves the built app from the same address, so the whole
 *                game runs from one URL (e.g. http://<laptop-ip>:54321 on a
 *                classroom Wi-Fi with --host 0.0.0.0). The page is told where the
 *                API is and which public key to use, so no .env file is needed.
 * Without --static it prints VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for .env.local.
 *
 * The JWT signing secret is random and kept in .local-stack-secret (git-ignored),
 * so nobody can forge tokens from the published source code.
 */
import http from 'node:http';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/opec';
const PORT = Number(opt('port', process.env.PORT ?? 54321));
const HOST = opt('host', process.env.HOST ?? '127.0.0.1');
const STATIC_DIR = opt('static');
const POLL_MS = Number(opt('poll-ms', 3000));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadSecret() {
  if (process.env.LOCAL_JWT_SECRET) return process.env.LOCAL_JWT_SECRET;
  const file = join(ROOT, '.local-stack-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const JWT_SECRET = loadSecret();

// ---------------------------------------------------------------- JWT
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token ?? '').split('.');
  if (!h || !b || !s) return null;
  const expected = b64url(createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest());
  if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  const payload = JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
export const ANON_KEY = signJwt({ role: 'anon', iss: 'opec-local', iat: 1700000000, exp: 4102444800 });

// ---------------------------------------------------------------- DB
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });

async function ensureAuthTables() {
  await pool.query(`create table if not exists auth.local_refresh_tokens (
    token text primary key, user_id uuid not null, created_at timestamptz default now())`);
}

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const h = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(h, Buffer.from(hash, 'hex'));
}

function userJson(u) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email ?? '',
    is_anonymous: u.is_anonymous,
    app_metadata: { provider: u.is_anonymous ? 'anonymous' : 'email', providers: [] },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.created_at,
    email_confirmed_at: u.is_anonymous ? null : u.created_at,
  };
}

async function sessionFor(u) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const access = signJwt({
    sub: u.id,
    role: 'authenticated',
    aud: 'authenticated',
    email: u.email ?? '',
    is_anonymous: u.is_anonymous,
    iat: now,
    exp: now + expiresIn,
    session_id: randomUUID(),
  });
  const refresh = randomBytes(24).toString('hex');
  await pool.query('insert into auth.local_refresh_tokens (token, user_id) values ($1, $2)', [refresh, u.id]);
  return { access_token: access, token_type: 'bearer', expires_in: expiresIn, expires_at: now + expiresIn, refresh_token: refresh, user: userJson(u) };
}

async function createUser({ email = null, password = null, anonymous = false }) {
  const { rows } = await pool.query(
    `insert into auth.users (id, email, encrypted_password, is_anonymous) values ($1, $2, $3, $4) returning *`,
    [randomUUID(), email, password ? hashPassword(password) : null, anonymous],
  );
  return rows[0];
}

// ---------------------------------------------------------------- HTTP helpers
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, x-supabase-api-version, range',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
};
function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolveBody(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
function bearer(req) {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : req.headers.apikey;
}
const authError = (res, msg, status = 400) => send(res, status, { error: 'invalid_grant', error_description: msg, msg, code: status });

// ---------------------------------------------------------------- routes
async function handleAuth(req, res, url) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  if (req.method === 'GET' && path === '/settings') return send(res, 200, { external: { anonymous_users: true, email: true } });
  if (req.method === 'POST' && path === '/signup') {
    const body = await readBody(req);
    if (body.email) {
      const exists = await pool.query('select 1 from auth.users where lower(email) = lower($1)', [body.email]);
      if (exists.rows.length) return authError(res, 'User already registered', 422);
      const u = await createUser({ email: body.email, password: body.password });
      return send(res, 200, await sessionFor(u));
    }
    const u = await createUser({ anonymous: true });
    return send(res, 200, await sessionFor(u));
  }
  if (req.method === 'POST' && path === '/token') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const { rows } = await pool.query('select * from auth.users where lower(email) = lower($1)', [body.email ?? '']);
      if (!rows[0] || !checkPassword(body.password ?? '', rows[0].encrypted_password)) return authError(res, 'Invalid login credentials');
      return send(res, 200, await sessionFor(rows[0]));
    }
    if (grant === 'refresh_token') {
      const { rows } = await pool.query(
        'delete from auth.local_refresh_tokens t using auth.users u where t.token = $1 and u.id = t.user_id returning u.*',
        [body.refresh_token ?? ''],
      );
      if (!rows[0]) return authError(res, 'Invalid Refresh Token');
      return send(res, 200, await sessionFor(rows[0]));
    }
    return authError(res, 'unsupported grant_type');
  }
  if (req.method === 'GET' && path === '/user') {
    const claims = verifyJwt(bearer(req));
    if (!claims?.sub) return authError(res, 'invalid JWT', 401);
    const { rows } = await pool.query('select * from auth.users where id = $1', [claims.sub]);
    if (!rows[0]) return authError(res, 'User not found', 404);
    return send(res, 200, userJson(rows[0]));
  }
  if (req.method === 'POST' && path === '/logout') {
    res.writeHead(204, CORS);
    return res.end();
  }
  return send(res, 404, { msg: 'not found' });
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

async function handleRpc(req, res, fn) {
  if (!IDENT.test(fn)) return send(res, 404, { message: 'not found' });
  const claims = verifyJwt(bearer(req));
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT expired or invalid' });
  // this server never issues service_role tokens; only the two API roles are honoured
  const role = claims.role === 'authenticated' ? 'authenticated' : 'anon';
  const body = await readBody(req);
  const keys = Object.keys(body);
  if (!keys.every((k) => IDENT.test(k))) return send(res, 400, { message: 'bad argument name' });
  const values = keys.map((k) => (body[k] !== null && typeof body[k] === 'object' ? JSON.stringify(body[k]) : body[k]));
  const sql = `select public."${fn}"(${keys.map((k, i) => `"${k}" => $${i + 1}`).join(', ')}) as r`;

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claims', $1, true), set_config('statement_timeout', '8000', true)`, [JSON.stringify(claims)]);
    await client.query(`set local role ${role}`);
    const { rows } = await client.query(sql, values);
    await client.query('commit');
    const r = rows[0]?.r;
    return send(res, 200, r === '' || r === undefined ? null : r);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    const status = err.code === '42501' ? 403 : err.code === '42883' ? 404 : 400;
    return send(res, status, { code: err.code, message: err.message, details: err.detail ?? null, hint: err.hint ?? null });
  } finally {
    client.release();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (url.pathname.startsWith('/auth/v1')) return await handleAuth(req, res, url);
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (m && req.method === 'POST') return await handleRpc(req, res, m[1]);
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (STATIC_DIR && req.method === 'GET' && !url.pathname.startsWith('/rest/') && !url.pathname.startsWith('/realtime/')) {
      return serveStatic(req, res, url);
    }
    return send(res, 404, { message: `not supported by the local backend: ${req.method} ${url.pathname}` });
  } catch (err) {
    console.error(err);
    return send(res, 500, { message: String(err?.message ?? err) });
  }
});
// realtime websocket upgrades are refused → the app polls instead
server.on('upgrade', (_req, socket) => socket.destroy());

// ---------------------------------------------------------------- optional: serve the built app (same origin)
const STATIC_ROOT = STATIC_DIR ? resolve(STATIC_DIR) : null;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
function serveStatic(_req, res, url) {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]*\.\.)+/, '');
  let file = join(STATIC_ROOT, rel);
  if (!file.startsWith(STATIC_ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_ROOT, 'index.html');
  if (!existsSync(file)) return send(res, 404, { message: `build the app first (npm run build): ${STATIC_ROOT} not found` });
  let body = readFileSync(file);
  if (file.endsWith('index.html')) {
    // tell the page to use this same address as its backend
    const cfg = JSON.stringify({ anonKey: ANON_KEY, pollMs: POLL_MS });
    body = Buffer.from(body.toString('utf8').replace('</head>', `<script>window.__OPEC_LOCAL__=${cfg}</script></head>`));
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(body);
}

async function main() {
  if (args.includes('--reset')) await migrate(DATABASE_URL, { reset: true });
  else await migrate(DATABASE_URL, { log: () => {} });
  await ensureAuthTables();

  const instr = opt('instructor');
  if (instr) {
    const [email, password] = instr.split(':');
    const { rows } = await pool.query('select * from auth.users where lower(email) = lower($1)', [email]);
    const u = rows[0] ?? (await createUser({ email, password }));
    await pool.query('insert into public.instructors (user_id, display_name) values ($1, $2) on conflict do nothing', [u.id, email]);
    console.log(`instructor   ${email} (password: ${password})`);
  }

  const { rows: inst } = await pool.query('select count(*)::int as n from public.instructors');
  if (inst[0].n === 0) console.log('NOTE: no instructor account yet — restart with --instructor you@school.edu:YOUR-PASSWORD');

  server.listen(PORT, HOST, () => {
    if (STATIC_DIR) {
      console.log(`OPEC Game running at http://localhost:${PORT}`);
      if (HOST === '0.0.0.0') console.log(`students on the same network: http://<this computer's IP address>:${PORT}/play`);
    } else {
      console.log(`local backend http://localhost:${PORT}`);
      console.log(`VITE_SUPABASE_URL=http://localhost:${PORT}`);
      console.log(`VITE_SUPABASE_ANON_KEY=${ANON_KEY}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
