#!/usr/bin/env node
/**
 * Solo practice: an automatic instructor for the local game server.
 *
 * Creates a demo session (20 bot countries) and runs it for ONE human group:
 *   - starts the game; opens each period once the human pressed "Start Game"
 *   - closes a period when its timer ends, or shortly after the human submits
 *   - opens chat from Period 3, triggers a recession and a boom along the way
 *
 *   node scripts/local-stack/autohost.mjs --instructor you@school.edu:PASSWORD \
 *     [--url http://localhost:54321] [--world A] [--country SAU] [--minutes 4] [--grace 25]
 *
 * Prints the group number and access code to enter on /play.
 */
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('url', 'http://localhost:54321');
const [EMAIL, PASSWORD] = (opt('instructor', '') || ':').split(':');
const WORLD = opt('world', 'A');
const COUNTRY = opt('country', 'SAU');
const PERIOD_SECONDS = Math.round(Number(opt('minutes', 4)) * 60);
const GRACE_MS = Number(opt('grace', 25)) * 1000;
const BREAK_MS = Number(opt('break', 8)) * 1000;

let token = null;
let tokenAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function login() {
  const indexHtml = await (await fetch(`${BASE}/`)).text();
  const anon = indexHtml.match(/"anonKey":"([^"]+)"/)?.[1] ?? '';
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anon },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login failed: ${JSON.stringify(j)}`);
  token = j.access_token;
  tokenAt = Date.now();
}

async function rpc(fn, body = {}) {
  if (!token || Date.now() - tokenAt > 40 * 60 * 1000) await login();
  const r = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: token },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${fn}: ${j?.message ?? r.status}`);
  return j;
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error('pass --instructor email:password');
  await login();
  const session = await rpc('create_session', {
    p_name: `Solo practice ${new Date().toLocaleString()}`,
    p_is_demo: true,
    p_randomize: false,
    p_config: {},
    p_period_seconds: PERIOD_SECONDS,
  });
  let st = await rpc('get_instructor_state', { p_session: session.id });
  const world = st.worlds.find((w) => w.code === WORLD);
  const me = st.groups.find((g) => g.world_id === world.id && g.country_code === COUNTRY);
  await rpc('start_game', { p_session: session.id });
  await rpc('post_announcement', {
    p_session: session.id,
    p_body:
      'Solo practice: the other 20 countries are bots. Each period opens automatically and closes when the timer ends or about 25 seconds after you submit. ' +
      '個人練習：其他 20 國為電腦。每期自動開始，計時結束或你提交約 25 秒後結束。',
  });

  console.log('\n================ SOLO PRACTICE READY ================');
  console.log(`  Open:          ${BASE}/play`);
  console.log(`  Group number:  ${me.group_number}`);
  console.log(`  Access code:   ${me.access_code}`);
  console.log(`  You play:      ${COUNTRY} in World ${WORLD}`);
  console.log('=====================================================\n');

  let breakSince = null;
  for (;;) {
    try {
      st = await rpc('get_instructor_state', { p_session: session.id });
      const s = st.session;
      if (s.status === 'finished') {
        log(`game finished — final rankings: ${BASE}/results/${s.id}`);
        return;
      }
      const human = st.groups.find((g) => g.id === me.id);
      const open = st.periods.find((p) => p.status === 'open');
      const now = Date.parse(st.server_time);

      if (open) {
        breakSince = null;
        const sub = st.submissions.find((x) => x.group_id === me.id && x.period_number === open.number && x.source === 'student');
        if (open.closes_at && now >= Date.parse(open.closes_at)) {
          await rpc('tick', { p_session: s.id });
          log(`period ${open.number} closed (timer)`);
        } else if (sub && now - Date.parse(sub.updated_at) >= GRACE_MS) {
          await rpc('close_period', { p_session: s.id });
          log(`period ${open.number} closed (you submitted)`);
        }
      } else if (human.ready && s.current_period < s.total_periods) {
        breakSince ??= Date.now();
        if (Date.now() - breakSince >= (s.current_period === 0 ? 0 : BREAK_MS)) {
          const next = s.current_period + 1;
          if (next === 3 && !s.chat_enabled) await rpc('set_chat_enabled', { p_session: s.id, p_enabled: true });
          await rpc('open_period', { p_session: s.id, p_duration_seconds: PERIOD_SECONDS });
          log(`period ${next} opened`);
          if (next === 5) await rpc('trigger_event', { p_session: s.id, p_event: 'recession' }).catch(() => {});
          if (next === 8) await rpc('trigger_event', { p_session: s.id, p_event: 'boom' }).catch(() => {});
          breakSince = null;
        }
      }
    } catch (err) {
      log('error:', err.message);
    }
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
