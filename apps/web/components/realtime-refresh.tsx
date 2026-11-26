'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type LiveTable = 'runs' | 'items' | 'workers' | 'bots' | 'app_settings';

/**
 * Keeps server-rendered pages live: when a watched table changes, the current
 * page re-fetches its data (no manual refresh). If the Realtime connection is
 * not available it falls back to a slow poll, so the page is never stale for long.
 */
export function RealtimeRefresh({
  tables,
  pollSeconds = 20,
}: {
  tables: LiveTable[];
  pollSeconds?: number;
}) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(',');

  useEffect(() => {
    const supabase = createClient();
    let connected = false;

    const refresh = () => {
      // at most one refresh every 1.5 seconds, however many rows change
      const wait = Math.max(0, 1500 - (Date.now() - lastRefresh.current));
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        lastRefresh.current = Date.now();
        router.refresh();
      }, wait);
    };

    let channel = supabase.channel(`live:${key}`);
    for (const table of key.split(',')) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    }
    channel.subscribe((status) => {
      connected = status === 'SUBSCRIBED';
    });

    const poll = setInterval(() => {
      if (!connected && document.visibilityState === 'visible') refresh();
    }, pollSeconds * 1000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [key, pollSeconds, router]);

  return null;
}
