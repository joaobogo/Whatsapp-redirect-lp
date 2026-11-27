'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Pause } from 'lucide-react';
import type { RunEventRow } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

const MAX_EVENTS = 1000;

function clock(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function merge(current: RunEventRow[], incoming: RunEventRow[]): RunEventRow[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map((event) => event.id));
  const fresh = incoming.filter((event) => !seen.has(event.id));
  if (fresh.length === 0) return current;
  return [...current, ...fresh].sort((a, b) => a.id - b.id).slice(-MAX_EVENTS);
}

/**
 * The run's events, streamed in order with the newest at the bottom.
 * Auto-scrolls unless paused. Falls back to polling when Realtime is not connected.
 */
export function LiveLog({
  runId,
  initialEvents,
  active,
}: {
  runId: string;
  initialEvents: RunEventRow[];
  active: boolean;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const lastId = useRef(initialEvents.at(-1)?.id ?? 0);

  useEffect(() => {
    lastId.current = events.at(-1)?.id ?? lastId.current;
  }, [events]);

  useEffect(() => {
    const supabase = createClient();
    let connected = false;
    let cancelled = false;

    const fetchNew = async () => {
      const { data } = await supabase
        .from('run_events')
        .select('*')
        .eq('run_id', runId)
        .gt('id', lastId.current)
        .order('id', { ascending: true })
        .limit(200);
      if (!cancelled && data && data.length > 0) setEvents((current) => merge(current, data));
    };

    const channel = supabase
      .channel(`run-events:${runId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'run_events', filter: `run_id=eq.${runId}` },
        (payload) => setEvents((current) => merge(current, [payload.new as RunEventRow])),
      )
      .subscribe((status) => {
        connected = status === 'SUBSCRIBED';
        // catch anything written between the page render and the subscription
        if (connected) void fetchNew();
      });

    const poll = setInterval(() => {
      if (!connected && active && document.visibilityState === 'visible') void fetchNew();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [runId, active]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [events, follow]);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Live log</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFollow((value) => !value)}
          aria-pressed={!follow}
        >
          {follow ? <Pause /> : <ArrowDownToLine />}
          {follow ? 'Pause scroll' : 'Follow'}
        </Button>
      </div>
      <div
        ref={box}
        data-testid="live-log"
        className="max-h-[55dvh] min-h-40 overflow-y-auto p-3 text-sm"
        aria-live="polite"
      >
        {events.length === 0 ? (
          <p className="p-2 text-muted-foreground">
            {active
              ? 'Waiting for the first message. A worker computer has to pick up the run.'
              : 'This run did not write any messages.'}
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {events.map((event) => (
              <LogLine key={event.id} event={event} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function LogLine({ event }: { event: RunEventRow }) {
  const time = (
    <time className="shrink-0 text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
      {clock(event.ts)}
    </time>
  );

  if (event.type === 'tool') {
    const detail = event.data ? JSON.stringify(event.data, null, 2) : null;
    return (
      <li className="flex gap-2">
        {time}
        <details className="min-w-0 flex-1 text-muted-foreground">
          <summary className="cursor-pointer truncate py-0.5 font-mono text-xs">
            {event.message}
          </summary>
          {detail ? (
            <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs whitespace-pre-wrap">
              {detail}
            </pre>
          ) : null}
        </details>
      </li>
    );
  }

  return (
    <li className="flex gap-2">
      {time}
      <p
        className={cn(
          'min-w-0 flex-1 break-words whitespace-pre-wrap',
          event.type === 'error' && 'font-medium text-destructive',
          event.type === 'item' && 'font-medium text-primary',
          event.type === 'result' && 'font-medium text-success',
        )}
      >
        {event.type === 'item' ? '+ ' : ''}
        {event.message}
      </p>
    </li>
  );
}
