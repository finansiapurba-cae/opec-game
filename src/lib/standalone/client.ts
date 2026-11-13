/**
 * STANDALONE MODE — a stand-in for the small part of supabase-js the app uses
 * (auth, rpc, realtime channels), backed by the in-browser database.
 *
 * - Students sign in "anonymously" (a local user row) and claim a group exactly
 *   as on Supabase; every RPC runs as that user with row-level security.
 * - The instructor console is signed in automatically as this device's instructor.
 * - Realtime: after every state-changing call, all open channels are told that
 *   data changed, so every screen in the page refreshes immediately.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminQuery, callFunction, RpcError, type Claims } from './database';

interface LocalUser {
  id: string;
  email: string | null;
  is_anonymous: boolean;
}
interface LocalSession {
  access_token: string;
  user: LocalUser & { aud: string; role: string; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown> };
}

const memoryStore = new Map<string, string>();
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStore.get(key) ?? null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      memoryStore.set(key, value);
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      memoryStore.delete(key);
    }
  },
};

// ---------------------------------------------------------------- change notifications
type Handler = () => void;
const channels = new Set<LocalChannel>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
function notifyAll() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    channels.forEach((c) => c.fire());
  }, 30);
}

class LocalChannel {
  private handlers: Handler[] = [];
  on(_type: string, _filter: unknown, handler: Handler) {
    this.handlers.push(handler);
    return this;
  }
  subscribe(status?: (s: string) => void) {
    channels.add(this);
    setTimeout(() => status?.('SUBSCRIBED'), 0);
    return this;
  }
  fire() {
    this.handlers.forEach((h) => h());
  }
  unsubscribe() {
    channels.delete(this);
  }
}

const READ_ONLY = new Set([
  'get_student_state',
  'get_chat',
  'get_notices',
  'get_final_results',
  'get_instructor_state',
  'get_instructor_chat',
  'list_sessions',
  'whoami',
  'my_jpr_votes',
  'heartbeat',
]);

// ---------------------------------------------------------------- auth
type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'INITIAL_SESSION';
type AuthListener = (event: AuthEvent, session: LocalSession | null) => void;

function toSession(u: LocalUser): LocalSession {
  return {
    access_token: `local-${u.id}`,
    user: { ...u, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} },
  };
}

class LocalAuth {
  private listeners = new Set<AuthListener>();
  private current: LocalSession | null;
  private prepared: Promise<unknown> | null = null;

  constructor(
    private storageKey: string,
    private autoInstructor: boolean,
  ) {
    const raw = store.get(storageKey);
    this.current = raw ? (JSON.parse(raw) as LocalSession) : null;
  }

  /** The built-in instructor must exist (user row + instructor role) before its first call. */
  ready(): Promise<unknown> {
    if (!this.autoInstructor) return Promise.resolve();
    this.prepared ??= this.getSession().catch((err) => {
      this.prepared = null;
      throw err;
    });
    return this.prepared;
  }

  claims(): Claims {
    const u = this.current?.user;
    return u ? { sub: u.id, role: 'authenticated', is_anonymous: u.is_anonymous, email: u.email ?? undefined } : { role: 'anon' };
  }

  private set(session: LocalSession | null, event: AuthEvent) {
    this.current = session;
    if (session) store.set(this.storageKey, JSON.stringify(session));
    else store.remove(this.storageKey);
    this.listeners.forEach((l) => l(event, session));
  }

  private async ensureRow(u: LocalUser) {
    await adminQuery(`insert into auth.users (id, email, is_anonymous) values ($1, $2, $3) on conflict (id) do nothing`, [
      u.id,
      u.email,
      u.is_anonymous,
    ]);
  }

  async getSession() {
    if (this.autoInstructor) {
      if (!this.current) {
        const u: LocalUser = { id: crypto.randomUUID(), email: 'instructor@this-device', is_anonymous: false };
        this.current = toSession(u);
        store.set(this.storageKey, JSON.stringify(this.current));
      }
      await this.ensureRow(this.current.user);
      await adminQuery(`insert into public.instructors (user_id, display_name) values ($1, 'This device') on conflict do nothing`, [
        this.current.user.id,
      ]);
    } else if (this.current) {
      // the stored login may belong to a database that no longer exists
      const rows = await adminQuery(`select 1 from auth.users where id = $1`, [this.current.user.id]);
      if (rows.length === 0) this.set(null, 'SIGNED_OUT');
    }
    return { data: { session: this.current }, error: null };
  }

  onAuthStateChange(listener: AuthListener) {
    this.listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => this.listeners.delete(listener) } } };
  }

  async signInAnonymously() {
    const u: LocalUser = { id: crypto.randomUUID(), email: null, is_anonymous: true };
    await this.ensureRow(u);
    const session = toSession(u);
    this.set(session, 'SIGNED_IN');
    return { data: { session, user: session.user }, error: null };
  }

  async signInWithPassword() {
    return { data: { session: null, user: null }, error: { message: 'Not available in the browser version.' } };
  }

  async signUp() {
    return this.signInWithPassword();
  }

  async signOut() {
    if (!this.autoInstructor) this.set(null, 'SIGNED_OUT');
    return { error: null };
  }
}

// ---------------------------------------------------------------- client
class LocalClient {
  auth: LocalAuth;
  constructor(storageKey: string, autoInstructor: boolean) {
    this.auth = new LocalAuth(storageKey, autoInstructor);
  }

  async rpc(fn: string, args: Record<string, unknown> = {}) {
    try {
      await this.auth.ready();
      const data = await callFunction(this.auth.claims(), fn, args);
      if (!READ_ONLY.has(fn)) notifyAll();
      return { data, error: null };
    } catch (err) {
      const e = err as RpcError;
      return { data: null, error: { message: e.message, code: e.code, details: e.details, hint: null } };
    }
  }

  channel(_name: string) {
    return new LocalChannel();
  }

  removeChannel(channel: LocalChannel) {
    channel.unsubscribe();
    return Promise.resolve('ok');
  }
}

export function createLocalClient(storageKey: string, opts: { autoInstructor?: boolean } = {}): SupabaseClient {
  return new LocalClient(storageKey, Boolean(opts.autoInstructor)) as unknown as SupabaseClient;
}
