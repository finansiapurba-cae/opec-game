// Replaces ./client in normal (Supabase) builds so the in-browser database is not bundled.
import type { SupabaseClient } from '@supabase/supabase-js';

export function createLocalClient(): SupabaseClient {
  throw new Error('The in-browser backend is only available in the standalone build.');
}
