#!/usr/bin/env node
/**
 * Applies the Supabase migrations to a PLAIN PostgreSQL database (15+).
 *
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/opec node scripts/local-stack/migrate.mjs [--reset]
 *
 * --reset drops and recreates the target database first.
 * The Supabase-compatibility bootstrap (supabase/tests/bootstrap.sql) is applied
 * when the database has no `auth` schema. On a real Supabase project use
 * `supabase db push` instead.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function migrate(databaseUrl, { reset = false, log = console.log } = {}) {
  const url = new URL(databaseUrl);
  const dbName = url.pathname.replace(/^\//, '') || 'postgres';

  if (reset) {
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    await admin.query(`drop database if exists "${dbName}" with (force)`);
    await admin.query(`create database "${dbName}"`);
    await admin.end();
    log(`recreated database ${dbName}`);
  }

  if (!reset) {
    // create the database on first run
    const adminUrl = new URL(databaseUrl);
    adminUrl.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const { rows } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (rows.length === 0) {
      await admin.query(`create database "${dbName}"`);
      log(`created database ${dbName}`);
    }
    await admin.end();
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(`select 1 from pg_namespace where nspname = 'auth'`);
    if (rows.length === 0) {
      await client.query(readFileSync(join(root, 'supabase/tests/bootstrap.sql'), 'utf8'));
      log('applied supabase/tests/bootstrap.sql');
    }
    await client.query(`create table if not exists public._local_migrations (name text primary key, applied_at timestamptz default now())`);
    const dir = join(root, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const done = await client.query('select 1 from public._local_migrations where name = $1', [file]);
      if (done.rows.length) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('insert into public._local_migrations(name) values ($1)', [file]);
        await client.query('commit');
        log(`applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`${file}: ${err.message}`);
      }
    }
    // keep the bookkeeping table private
    await client.query('revoke all on public._local_migrations from anon, authenticated');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/opec';
  migrate(url, { reset: process.argv.includes('--reset') }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
