/**
 * Solo practice: one human plays one country; the other 20 are bots and this
 * page acts as the instructor (same logic as scripts/local-stack/autohost.mjs).
 */
import { instructorClient, studentClient } from '@/lib/supabase';
import { rpc } from '@/lib/rpc';
import type { CountryCode, InstructorState, WorldCode } from '@/lib/types';

const KEY = 'opec-solo-game';
const GRACE_MS = 25_000;
const BREAK_MS = 6_000;

export interface SoloGame {
  sessionId: string;
  groupId: string;
  country: CountryCode;
  world: WorldCode;
}

export function savedSoloGame(): SoloGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SoloGame) : null;
  } catch {
    return null;
  }
}

function save(g: SoloGame | null) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the game still runs until the page closes */
  }
}

let current: SoloGame | null = null;

export async function startSoloGame(opts: { world: WorldCode; country: CountryCode; minutes: number; lang: 'en' | 'zh' }) {
  stopHost();
  const session = await rpc<{ id: string }>(instructorClient, 'create_session', {
    p_name: `Solo practice ${new Date().toLocaleString()}`,
    p_is_demo: true,
    p_randomize: false,
    p_config: {},
    p_period_seconds: Math.round(opts.minutes * 60),
  });
  await rpc(instructorClient, 'start_game', { p_session: session.id });
  await rpc(instructorClient, 'post_announcement', {
    p_session: session.id,
    p_body:
      opts.lang === 'zh'
        ? '個人練習：其他 20 國為電腦。每期自動開始，計時結束或你提交約 25 秒後結束。第 3 期起開放聊天，途中會發生經濟衰退與繁榮。'
        : 'Solo practice: the other 20 countries are bots. Each period opens automatically and closes when the timer ends or about 25 seconds after you submit. Chat opens in Period 3; a recession and a boom will hit along the way.',
  });
  const st = await rpc<InstructorState>(instructorClient, 'get_instructor_state', { p_session: session.id });
  const world = st.worlds.find((w) => w.code === opts.world)!;
  const group = st.groups.find((g) => g.world_id === world.id && g.country_code === opts.country)!;

  await studentClient.auth.signOut();
  const { error } = await studentClient.auth.signInAnonymously();
  if (error) throw new Error(error.message);
  const claim = await rpc<{ status: string }>(studentClient, 'claim_group', {
    p_group_number: group.group_number,
    p_access_code: group.access_code,
    p_takeover: true,
    p_language: opts.lang,
  });
  if (claim.status !== 'ok') throw new Error(`claim_group: ${claim.status}`);

  const game: SoloGame = { sessionId: session.id, groupId: group.id, country: opts.country, world: opts.world };
  save(game);
  ensureSoloHost();
  return game;
}

// ---------------------------------------------------------------- automatic instructor
let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let breakSince: number | null = null;

export function stopHost() {
  if (timer) clearInterval(timer);
  timer = null;
  current = null;
}

export function ensureSoloHost() {
  const game = savedSoloGame();
  if (!game || timer) return;
  current = game;
  timer = setInterval(() => void step(), 1500);
}

async function step() {
  if (busy || !current) return;
  busy = true;
  try {
    const st = await rpc<InstructorState>(instructorClient, 'get_instructor_state', { p_session: current.sessionId });
    const s = st.session;
    if (!s) {
      save(null);
      stopHost();
      return;
    }
    if (s.status === 'finished') {
      stopHost();
      return;
    }
    const me = st.groups.find((g) => g.id === current!.groupId);
    const open = st.periods.find((p) => p.status === 'open');
    const now = Date.parse(st.server_time);
    if (open) {
      breakSince = null;
      const sub = st.submissions.find((x) => x.group_id === current!.groupId && x.period_number === open.number && x.source === 'student');
      if (open.closes_at && now >= Date.parse(open.closes_at)) {
        await rpc(instructorClient, 'tick', { p_session: s.id });
      } else if (sub && now - Date.parse(sub.updated_at) >= GRACE_MS) {
        await rpc(instructorClient, 'close_period', { p_session: s.id });
      }
    } else if (me?.ready && s.current_period < s.total_periods) {
      breakSince ??= Date.now();
      if (Date.now() - breakSince >= (s.current_period === 0 ? 0 : BREAK_MS)) {
        const next = s.current_period + 1;
        if (next === 3 && !s.chat_enabled) await rpc(instructorClient, 'set_chat_enabled', { p_session: s.id, p_enabled: true });
        await rpc(instructorClient, 'open_period', { p_session: s.id, p_duration_seconds: s.default_period_seconds });
        if (next === 5) await rpc(instructorClient, 'trigger_event', { p_session: s.id, p_event: 'recession' }).catch(() => {});
        if (next === 8) await rpc(instructorClient, 'trigger_event', { p_session: s.id, p_event: 'boom' }).catch(() => {});
        breakSince = null;
      }
    }
  } catch {
    /* try again on the next step */
  } finally {
    busy = false;
  }
}
