'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, RotateCcw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { formatDuration, formatUsd, type BotSettings, type RunRow } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { queueRun } from '@/components/run-sheet';
import { RunStatusPill } from '@/components/status-pill';

const ACTIVE = ['queued', 'claimed', 'running', 'stop_requested'];

function startedAt(iso: string | null): string {
  if (!iso) return 'Not started yet';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Bot name, status, worker, start time, a ticking duration, cost so far, and Stop. */
export function RunHeader({
  run,
  botName,
  botSlug,
  workerName,
  canOperate,
  stopped,
}: {
  run: RunRow;
  botName: string;
  botSlug: string;
  workerName: string | null;
  canOperate: boolean;
  stopped: boolean;
}) {
  const router = useRouter();
  const active = ACTIVE.includes(run.status);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState<'stop' | 'again' | null>(null);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  async function stop() {
    setBusy('stop');
    try {
      const response = await fetch(`/api/runs/${run.id}/stop`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.ok) {
        toast.success('Stopping. This can take up to 15 seconds.');
        router.refresh();
      } else {
        toast.error(body?.error ?? 'Could not stop the run. Try again.');
      }
    } catch {
      toast.error('Could not reach the server. Try again.');
    }
    setBusy(null);
  }

  async function runAgain() {
    setBusy('again');
    const result = await queueRun({
      slug: botSlug,
      settings: run.settings_snapshot as BotSettings,
    });
    if (result.ok) {
      router.push(`/runs/${result.runId}`);
      return;
    }
    toast.error(result.error);
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">
            <Link
              href={`/bots/${botSlug}`}
              className="inline-flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              {botName}
            </Link>
          </h1>
          <div className="mt-2">
            <RunStatusPill status={run.status} worker={workerName} />
          </div>
        </div>
        {active && canOperate ? (
          <Button
            variant="destructive"
            onClick={stop}
            disabled={busy !== null || run.status === 'stop_requested'}
            data-testid="stop-run"
          >
            <Square />
            {run.status === 'stop_requested' ? 'Stopping...' : 'Stop'}
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Fact label="Computer" value={workerName ?? 'Waiting for one'} />
        <Fact label="Started" value={startedAt(run.started_at)} />
        <Fact
          label="Duration"
          value={formatDuration(run.started_at, run.finished_at, now)}
          testId="run-duration"
        />
        <Fact label={active ? 'Cost so far' : 'Cost'} value={formatUsd(run.cost_usd)} />
      </dl>

      {run.error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {run.error}
        </p>
      ) : null}

      {!active ? (
        <div className="flex flex-wrap gap-2">
          {canOperate ? (
            <Button onClick={runAgain} disabled={busy !== null || stopped} data-testid="run-again">
              <RotateCcw />
              {busy === 'again' ? 'Starting...' : 'Run again with same settings'}
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <a href={`/api/export?run=${run.id}`} download>
              <Download />
              Export CSV
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums" data-testid={testId} suppressHydrationWarning>
        {value}
      </dd>
    </div>
  );
}
