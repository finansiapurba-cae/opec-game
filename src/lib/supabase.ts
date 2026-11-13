import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare global {
  interface Window {
    /** injected by scripts/local-stack/server.mjs when it serves the app itself */
    __OPEC_LOCAL__?: { anonKey: string; pollMs?: number };
  }
}

const local = typeof window !== 'undefined' ? window.__OPEC_LOCAL__ : undefined;
const url = local ? window.location.origin : (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = local
  ? local.anonKey
  : ((import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string | undefined);

export const isConfigured = Boolean(url && key);
export const POLL_MS = local?.pollMs ?? (Number(import.meta.env.VITE_POLL_MS ?? 5000) || 5000);

function make(storageKey: string): SupabaseClient {
  return createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
    auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
}

/**
 * Two independent auth sessions so a teacher can run the instructor console and
 * test a student seat (e.g. in demo mode) in the same browser.
 *  - students sign in anonymously and then claim a group with its access code
 *  - instructors sign in with e-mail + password
 */
export const studentClient = make('opec-student-auth');
export const instructorClient = make('opec-instructor-auth');
