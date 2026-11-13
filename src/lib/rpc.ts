import type { SupabaseClient } from '@supabase/supabase-js';

/** Error raised by a game RPC; `code` is the machine-readable message set by the database. */
export class GameError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

export async function rpc<T = unknown>(client: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const msg = error.message || 'unknown_error';
    // PostgREST/JWT problems → normalise
    if (/JWT|jwt/.test(msg)) throw new GameError('session_expired', msg);
    if (/permission denied/i.test(msg)) throw new GameError('not_allowed', msg);
    if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) throw new GameError('network', msg);
    throw new GameError(msg, error.details ?? undefined);
  }
  return data as T;
}
