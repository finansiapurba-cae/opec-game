# OPEC Game — The Oil Cartel Simulation

A real-time, multiplayer classroom game for **NTU Energy Systems Engineering and Economics**.
21 student groups each run one OPEC country (Saudi Arabia, Iran, Iraq, Kuwait, UAE, Venezuela, Nigeria)
in one of three independent worlds (A, B, C) for 10 periods. They choose production, negotiate,
manage finite reserves and try to maximise their country's final wealth. At the end the same country
is compared across the three worlds.

Built with **React + TypeScript + Tailwind CSS + shadcn/ui + Recharts** on **Supabase**
(PostgreSQL, Auth, Realtime). English and Traditional Chinese.

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Set up with Supabase (recommended)](#set-up-with-supabase-recommended)
4. [Run on your own computer (no accounts needed)](#run-on-your-own-computer-no-accounts-needed)
5. [Running a class](#running-a-class)
6. [Deploying](#deploying)
7. [Testing](#testing)
8. [Game rules and documented assumptions](#game-rules-and-documented-assumptions)
9. [Replacing the price formula](#replacing-the-price-formula)
10. [Security model](#security-model)
11. [Database](#database)
12. [Project layout](#project-layout)

---

## Features

**Students** (`/play`)
- Join with **group number + access code**, choose English / 繁體中文, review the country briefing, press **Start Game**.
- One controlling device per group; refresh-safe (the Supabase session persists); a second device must explicitly **take over**; **Switch user** with confirmation.
- Five tabs:
  - **Country** – flag, world, period, initial/remaining reserves, capacity, marginal cost, cumulative profit, estimated wealth, reserves bar (extracted vs remaining), strategy & action cards, world roster.
  - **Production** – quantity input + % slider, gauge, maximum allowed = min(capacity, reserves), what-if price/profit estimate, public pledge, submit/revise until the period closes, countdown, submission status.
  - **Results** – price, own and total production, revenue, cost, profit, hedge, compounded profit, reserves, wealth; charts for price, production (actual vs pledged), profit, reserves and wealth; period table and a transparent **wealth breakdown**.
  - **Talk** – world chat and instructor-run OPEC meetings with countdown; locked in Periods 1–2; world-isolated.
  - **Notices** – teacher announcements, game events, market intelligence, the public pledge log, private audit results and Joint Production Review results; filters *Teacher / Game / My World*.
- Cards: **Audit** (private), **Joint Production Review** (anonymous vote, ≥ 4 of 7), one strategy card per game: **Enhanced Oil Recovery**, **Capacity Expansion**, **Price Hedge** — each shows cost, effect, activation period and duration, with purchase confirmation.
- Glossary tooltips for barrel, marginal cost, capacity, reserves, cartel, profit, final wealth, price hedge, pledge, audit.

**Instructor** (`/instructor`, e-mail login + instructor role)
- Create / delete / reset sessions; configurable assumptions; demo mode.
- Country assignment editor (exactly one group per country per world), randomise, printable access-code sheet, release a device, regenerate a code, toggle bots.
- Start the game; open periods with a duration; extend / remove the timer; **close early**; end the game.
- Live table of all 21 groups: device status, ready, submission status and value, pledge, cards, estimated wealth.
- Enable chat, run OPEC meetings (all worlds or one world), post announcements, trigger **Recession / Boom**.
- Markets view across all three worlds; chat monitor (and posting); card, audit and review logs.
- CSV exports (period results, final results, pledges & cards) and the final rankings page.

**Final rankings** (`/results/:sessionId`)
- Country × world matrix with the winning world highlighted; final wealth, price history, production share,
  production history per world, remaining reserves, strategy-card effects, a cooperation-vs-competition table,
  a full wealth breakdown, CSV download and print/PDF.

---

## Architecture

```
 Browser (React SPA)                                   Supabase
 ┌─────────────────────────┐   anonymous / e-mail   ┌──────────────────────────────────────────┐
 │ student / instructor UI │ ─────── Auth ────────▶ │ GoTrue (JWT)                             │
 │                         │                        │                                          │
 │ supabase.rpc(...)       │ ─── PostgREST RPC ───▶ │ PostgreSQL                               │
 │  - reads: get_*_state   │                        │  ├─ tables + row-level security          │
 │  - writes: submit_*,    │                        │  ├─ SECURITY DEFINER game functions      │
 │    buy_*, open_period…  │                        │  │   (validation, period closing,        │
 │                         │ ◀── Realtime (RLS) ─── │  │    cards, votes, accounting)          │
 │ refetch on change;      │   postgres_changes     │  └─ price engine module (SQL)            │
 │ polling fallback        │                        └──────────────────────────────────────────┘
 └─────────────────────────┘
```

- **All game rules run inside PostgreSQL** (`supabase/migrations/…_game_logic.sql`). The browser never sends prices,
  limits, reserves, profits, card eligibility or wealth — only intents (“produce 9,000 kb”, “buy EOR”).
- Each period is closed for **all three worlds in one transaction**: the session row is locked, the period's status is
  re-checked (so concurrent closes are no-ops) and unique constraints guard against duplicate result rows.
- Reads go through `SECURITY INVOKER` functions, so **row-level security decides what each user can see**.
- Realtime `postgres_changes` (which also respects RLS) tell clients to refetch; if the socket drops they poll.
- A period closes automatically when its timer expires: any connected client calls the idempotent `tick()` RPC
  (optionally also pg_cron — see [Deploying](#deploying)).

---

## Set up with Supabase (recommended)

Requirements: Node 20+, a Supabase project (free tier is fine).

### 1. Create the database objects

Either with the Supabase CLI:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```

```bash
npx supabase db push
```

…or paste the four files in `supabase/migrations/` into the dashboard **SQL Editor**, in filename order.

### 2. Configure Auth (Dashboard → Authentication)

- **Sign In / Providers → Allow anonymous sign-ins: ON** (students sign in anonymously and then claim a group).
- **Email provider: ON** (instructors). Turn off *Confirm email* if you don't want a confirmation step.
- **Rate limits → anonymous sign-ins**: raise it (e.g. 200/hour) — a class usually shares one public IP.
- **URL configuration → Site URL**: your deployed app URL.

### 3. Create an instructor

Sign up on the app's **Instructor** page, then make the account an instructor — either run, in the SQL editor:

```sql
select public.grant_instructor('teacher@your-university.edu');
```

or create a one-time invite code and redeem it on the instructor page:

```sql
insert into public.instructor_invites (code) values ('a-long-random-code');
```

### 4. Run the app

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API; a publishable key also works), then:

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173.

### Local Supabase stack (optional)

With Docker you can run the whole Supabase stack locally; `supabase/config.toml` already enables anonymous
sign-ins and `supabase/seed.sql` creates the invite code `LOCAL-DEV-INVITE`:

```bash
npx supabase start
```

Use the printed API URL and anon key in `.env.local`.

---

## Run on your own computer (no accounts needed)

You can run the whole game from one computer — handy for rehearsing in demo mode, or for a class where everyone is
on the same Wi-Fi. You need **Node.js 20+** and **PostgreSQL 15+** installed (e.g. Postgres.app on macOS, the
EnterpriseDB installer on Windows, `apt install postgresql` on Linux).

```bash
npm install
```

```bash
npm run build
```

```bash
DATABASE_URL=postgres://postgres:YOUR-DB-PASSWORD@127.0.0.1:5432/opec npm run local -- --instructor you@school.edu:CHOOSE-A-PASSWORD
```

Open http://localhost:54321 (instructor console: `/instructor`). To let students join from their own devices on the
same network, add `--host 0.0.0.0` and have them open `http://<your computer's IP address>:54321/play`.
The database `opec` is created on first run; add `--reset` to wipe it. (On Windows PowerShell set the variable with
`$env:DATABASE_URL="postgres://..."` first.)

How it works: `scripts/local-stack/server.mjs` emulates the parts of the Supabase API the app uses (anonymous and
e-mail sign-in with JWTs signed by a random secret stored in `.local-stack-secret`, and `POST /rest/v1/rpc/*`
executed as the caller's role so row-level security applies) and serves the built app from the same address.
Limitations: no realtime (screens refresh every ~3 seconds) and a minimal auth server — fine for a classroom
network, **not meant to be exposed to the internet**. For that, use Supabase.

**Solo practice against bots.** With the server running, start an automatic instructor that creates a demo game
for one human player (prints the group number and access code to use on `/play`):

```bash
node scripts/local-stack/autohost.mjs --instructor you@school.edu:YOUR-PASSWORD --world A --country SAU
```

Periods open automatically once you press Start Game and close when the timer ends or ~25 s after you submit; chat
opens in Period 3, and a recession and a boom are triggered along the way.

Developers can also run the backend alone (`npm run local:backend`, which prints the values for `.env.local`) and
use `npm run dev`.

---

## Play in the browser only (solo practice)

`npm run build:standalone` produces `dist-standalone/`: the whole game in static files, with the database running
inside the page (PGlite — the same SQL migrations compiled to WebAssembly). It needs no server or accounts and can be
hosted on any static host. The landing page offers **Play solo against 20 bots**: pick a country and the page acts as
the instructor (periods open automatically, close on the timer or ~25 s after you submit, chat opens in Period 3,
a recession and a boom happen along the way). Progress is kept in the browser (IndexedDB). It is single-device:
for a class, use Supabase or the local server above. The host must allow WebAssembly.

---

## Running a class

1. **Instructor → New game session.** Pick the period length, whether to randomise assignments and (optionally) the
   assumptions below. *Demo mode* makes all 21 groups bots so you can rehearse alone.
2. **Groups tab → Print codes** and hand each group its card (group number, world, country, access code, URL).
3. Students open `/play`, enter group number + code, choose a language, read the briefing and press **Start Game**.
   The *Groups* table shows who is online and ready.
4. **Start game**, then **Open Period 1**. The countdown appears for everyone; groups can revise until it ends.
   **Close period now** ends it early. Missing groups repeat their previous output.
5. After Period 2 closes you can **enable world chat** and **start OPEC meetings**; pledges open in Period 3.
6. Trigger **Recession** or **Boom** whenever you like — it affects the next period in all worlds (once each).
7. After Period 10 (or **End game**) the final rankings open for everyone. Export CSVs from the *Results* tab.

To try a student seat during a demo, open `/play` in another tab and use any code from the *Control → Demo tools*
list (the instructor and student logins are stored separately, so one browser can hold both). Claiming a bot group
switches its bot off.

---

## Deploying

The frontend is a static site.

```bash
npm run build
```

Deploy `dist/` to Vercel, Netlify, Cloudflare Pages, etc. with the two `VITE_SUPABASE_*` environment variables set at
build time. SPA rewrites are included (`vercel.json`, `public/_redirects`).

**Unattended period closing (optional).** Periods close when any connected client notices the deadline. To close them
even when nobody is connected, schedule the server-side tick with pg_cron (Dashboard → Database → Extensions → pg_cron):

```sql
select cron.schedule('opec-tick', '* * * * *', $$select public.tick_all()$$);
```

---

## Testing

```bash
npm test
```

| Suite | What it covers |
|---|---|
| `tests/unit/engine.test.ts` (30 tests) | price table reproduction, interpolation & extrapolation options, monotonicity, odd/even demand, demand factors, production limits, reserve depletion, profit, 5 % compounding to Period 11, terminal value, final wealth (both card-cost modes), card costs, activation delays, hedge payouts |
| `tests/db/game.test.ts` (36 tests) | runs the **real migrations on PostgreSQL** and calls the RPCs as different users with RLS: session setup & assignment bijection, access codes / takeover / rate limiting / refresh recovery / switch user, server-side limits, repeated and missing submissions, stale-screen protection, timer expiry & tick, identical prices across worlds, separate markets, **single calculation under concurrent closes**, events, compounding, reserve depletion, a full 10-period game with final rankings checked against the TypeScript model, Capacity Expansion / EOR / Price Hedge timing and payouts, card-too-late, **audit privacy**, hidden production, unreadable codes & ballots, no direct writes, **anonymous voting**, JPR reveal scope and once-per-world rule, chat isolation and lock, meetings, pledges, demo bots, reset |
| `tests/db/engine-parity.test.ts` (6 tests) | the SQL price engine and its TypeScript mirror agree on a grid of inputs for every configuration option |

The database tests need a PostgreSQL 15+ server where they may create throw-away databases
(default `postgres://postgres:postgres@127.0.0.1:5432/postgres`, override with `TEST_DATABASE_URL`; they are skipped if
no server is reachable). They also work against `supabase start` (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

**End-to-end browser test** (Playwright/Chromium) — an instructor runs a demo session while a student plays all ten
periods (takeover prompt, production, cards, pledge, meeting + chat, audit, review, event, final rankings, mobile
Chinese view), failing on any browser error:

```bash
npm run build
```

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/opec_local node scripts/local-stack/server.mjs --reset --static dist --instructor teacher@example.edu:secret123
```

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/opec_local npm run e2e
```

Screenshots go to `e2e/screenshots/`.

---

## Game rules and documented assumptions

**Implemented as stated in the course introduction**

| Rule | Implementation |
|---|---|
| 3 worlds × 7 countries, 21 groups, one group per country per world | `groups` + deferrable unique `(world_id, country_code)` |
| Country data (capacity, reserves = 9 × capacity, marginal cost) | `countries` table (snapshotted into `country_states` per session) |
| 10 periods; odd = low demand, even = high demand; ±1.5 % random variation | `open_period`, `_close_period` |
| Production ≤ min(current capacity, remaining reserves) | `_submit_production` and re-checked at close |
| Missing submission repeats previous output within current limits | `_close_period` step 2 |
| Profit = (P − MC) × Q; FV(t) = Profit(t) × 1.05^(11 − t) | `opec_fv_factor`, `_close_period` |
| Remaining oil value = (70 − MC) × reserves | `opec_terminal_value` |
| Pledges from Period 3, once per period, editable until close, public in the world, non-binding | `submit_pledge`, `public_pledges` |
| Talk locked in Periods 1–2 | `_talk_period` checks in `send_chat`, `set_chat_enabled`, `start_meeting` |
| Audit: $5M per 1,000 kb capacity, once, private | `use_audit`, `audit_records` (RLS: auditor only) |
| JPR: free, once per world, ≥ 4 of 7, anonymous, reveals last two closed periods to the world | `request_jpr`, `vote_jpr`, `_jpr_resolve`, `jpr_votes` (no SELECT policy) |
| EOR: $75M/1,000 kb, +10 % of original reserves once, from the 3rd period after purchase | `_buy_strategy_card`, `open_period` |
| Capacity Expansion: $12M/1,000 kb, +20 % capacity permanently, from the 2nd period after purchase | same |
| Price Hedge: $10M/1,000 kb, 3 periods from the next, pays (95 − P) on 50 % of capacity if P < 95 | `_close_period` |
| One strategy card per game | partial unique index + row lock |
| Recession / Boom: once per game, ±5 % demand next period, all worlds | `trigger_event`, `open_period` |

**Assumptions** (the introduction does not specify these; each is a key in the session's `config`, editable when
creating a session; defaults in `opec_default_config()`):

| # | Assumption (default) | Config key / alternative |
|---|---|---|
| 1 | **Price model:** price depends on total world production ÷ sum of the seven *original* capacities (33,700 kb), piecewise-linear interpolation of the reference table. *Inferred — not the instructor's official formula.* | `price.model`, `price.shares`, `price.low`, `price.high` |
| 2 | Outside 60–100 % the slope of the nearest segment is extended; price bounded to $1–$300 | `price.extrapolation`: `linear` / `clamp`; `price.floor`, `price.ceiling` |
| 3 | A demand change of x % shifts the curve horizontally (market absorbs x % more oil at the same price) | `price.demand_shift`: `quantity` / `price` (scale price) |
| 4 | Random variation drawn once per period and applied to all three worlds (fair comparison) | `demand.noise_pct`, `demand.noise_scope`: `session` / `world`; `rng_seed` for reproducible tests (don't set in class: config is visible to students) |
| 5 | A group with no submission in Period 1 produces 0 % of capacity | `production.missing_first_period_pct` |
| 6 | Card costs are subtracted once from final wealth, not compounded (literal formula) | `accounting.card_cost_mode`: `nominal` / `compounded` |
| 7 | Hedge payouts are added to that period's profit and compound | — |
| 8 | Card cost uses capacity at purchase; hedged volume = 50 % of capacity at purchase | `cards.*` |
| 9 | Cards can be used only while a period is open; a card whose effect would start after the last period cannot be bought | — |
| 10 | A rejected or expired JPR vote does not use up the review; an unresolved vote expires when the period closes | `cards.jpr.required_yes`, `cards.jpr.periods_revealed` |
| 11 | "Talk from Period 3" includes the break after Period 2 closes | `talk.start_period`, `pledge.start_period` |
| 12 | Final wealth uses Period-11 values even if the game is ended early; ties share a rank | `accounting.compound_to_period` |
| 13 | After the game, every country's history is revealed to the players of that session | `reveal_all_after_game` |
| 14 | Event cards: both can't target the same period | — |

The *Rules & assumptions* page (`/rules`) shows these to students in both languages.

---

## Replacing the price formula

The price model lives in **one server-side file**: `supabase/migrations/20261112000200_price_engine.sql`
(`opec_effective_share` and `opec_price`). If the official formula becomes available:

1. Write a new migration that `create or replace`s `public.opec_price(total, reference_capacity, demand_type, demand_factor, config)`
   (keep the signature — `_close_period` calls it).
2. Update the client-side preview mirror `src/lib/engine/price.ts` (used only for the "what-if" estimate).
3. Run `npm test` — `tests/db/engine-parity.test.ts` checks both agree.

---

## Security model

- Students authenticate anonymously; **control of a group** is granted only by `claim_group(group_number, access_code)`,
  rate-limited to 10 failures per 10 minutes per user. Each group has exactly one controlling auth user
  (`group_controls.controller_uid` is unique); taking over requires the code and an explicit confirmation, and the
  previous device is notified and loses access immediately.
- Instructors are e-mail users listed in `public.instructors`; every instructor RPC checks `is_instructor()`.
- API roles have **SELECT only** (no INSERT/UPDATE/DELETE on any table); all writes go through validated
  `SECURITY DEFINER` functions with a fixed `search_path`; internal helpers are not executable by API roles.
- Row-level security on every table. Students can read: their own group's submissions, results, cards, audits and
  private notices; their world's prices/totals, pledges, chat, review requests and reveals; the session's periods,
  events and meetings. They can never read other countries' production (until the game ends, if enabled), access codes,
  device bindings, individual ballots (no policy at all on `jpr_votes`), other worlds' chat or other groups' audits.
- Concurrency: period close/open/reset lock the session row; student writes take a shared lock, so a submission either
  lands before the close or is rejected; submissions carry the period the student was viewing (stale screens are rejected).

---

## Database

| Table | Purpose |
|---|---|
| `countries` | reference country data |
| `instructors`, `instructor_invites` | instructor role |
| `game_sessions` | session status, current period, merged config, chat switch |
| `worlds` | A/B/C per session |
| `groups` | group number + **country assignment** (`world_id`, `country_code`), bot flag, presence |
| `group_controls` | access code + controlling device (instructor-only) |
| `claim_attempts` | login rate limiting |
| `country_states` | live state per group (capacity, reserves, cumulative values, wealth) |
| `periods` | period status, demand, event multiplier, timer, random draw |
| `production_submissions` | one row per group & period (revisions counted) |
| `world_period_results` / `country_period_results` | market results |
| `final_results` | final wealth and ranks |
| `public_pledges` | pledge log |
| `chat_messages`, `opec_meetings` | communication |
| `card_purchases`, `audit_records` | cards |
| `jpr_requests`, `jpr_votes`, `jpr_reveals` | Joint Production Review |
| `game_events` | event history |
| `notices` | announcements, game/world/private notifications |

Money is stored in **USD millions**, quantities in **thousand barrels**, prices in **USD/bbl**.

---

## Project layout

```
supabase/
  migrations/   100_schema · 200_price_engine · 300_game_logic · 400_security (RLS, grants, realtime)
  tests/bootstrap.sql   Supabase-compatible roles/auth for plain PostgreSQL (tests, local backend)
  config.toml, seed.sql
src/
  lib/engine/   TypeScript mirror of the economics (previews + unit tests)
  lib/i18n/     en / zh-Hant dictionaries
  lib/          supabase clients, RPC wrapper, realtime hook, types, formatting, flags
  components/   shadcn/ui primitives, charts, gauge, countdown, glossary tooltips, notices
  pages/        Landing, Rules, student/ (entry, briefing, dashboard + 5 tabs, cards),
                instructor/ (login, sessions, dashboard + panels), results/FinalResults
scripts/local-stack/   migrate.mjs (apply migrations to plain Postgres), server.mjs (dev backend)
tests/          unit/, db/
e2e/smoke.mjs   browser end-to-end test
```
