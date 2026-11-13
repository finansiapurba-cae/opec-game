import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChangeSubscription {
  table: string;
  /** PostgREST-style filter, e.g. `world_id=eq.<uuid>` */
  filter?: string;
  /** opaque key handed back to the callback (e.g. which query to refresh) */
  key: string;
}

/**
 * Subscribes to Postgres changes (row-level security still applies on the
 * server) and calls `onChange` with the keys of the tables that changed,
 * debounced. Returns whether the realtime channel is connected so callers can
 * fall back to polling.
 */
export function useRealtime(
  client: SupabaseClient,
  channelName: string | null,
  subscriptions: ChangeSubscription[],
  onChange: (keys: Set<string>) => void,
) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;
  const subsKey = JSON.stringify(subscriptions);

  useEffect(() => {
    if (!channelName) return;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const keys = new Set(pending);
      pending.clear();
      cb.current(keys);
    };
    let channel = client.channel(channelName);
    for (const s of JSON.parse(subsKey) as ChangeSubscription[]) {
      channel = channel.on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) },
        () => {
          pending.add(s.key);
          if (!timer) timer = setTimeout(flush, 250);
        },
      );
    }
    channel.subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    return () => {
      if (timer) clearTimeout(timer);
      setConnected(false);
      client.removeChannel(channel);
    };
  }, [client, channelName, subsKey]);

  return connected;
}
