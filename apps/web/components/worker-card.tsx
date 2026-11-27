'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Globe, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { RunRow, WorkerRow } from '@fgv/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { TimeAgo } from '@/components/time-ago';
import { updateWorkerAction } from '@/lib/actions';

export function WorkerCard({
  worker,
  online,
  runs,
  isOwner,
}: {
  worker: WorkerRow;
  online: boolean;
  runs: { run: RunRow; botName: string }[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const state = !online ? 'offline' : runs.length > 0 ? 'busy' : 'online';

  const update = (patch: { max_concurrency?: number; paused?: boolean }) =>
    startTransition(async () => {
      const result = await updateWorkerAction(worker.id, patch);
      if (result.ok) router.refresh();
      else toast.error(result.error);
    });

  const stepper =
    'inline-flex size-11 items-center justify-center rounded-lg border border-input bg-card hover:bg-muted disabled:opacity-50';

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="worker-card" data-state={state}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{worker.name}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Last heartbeat <TimeAgo iso={worker.last_heartbeat} />
            {worker.version ? ` - v${worker.version}` : ''}
          </p>
        </div>
        <Badge variant={state === 'offline' ? 'neutral' : state === 'busy' ? 'accent' : 'success'}>
          {state === 'offline' ? 'Offline' : state === 'busy' ? 'Busy' : 'Online'}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline">
          <Globe className="size-3" />
          {worker.has_browser ? 'Has browser' : 'No browser'}
        </Badge>
        {worker.is_scheduler ? <Badge variant="outline">Runs the schedule</Badge> : null}
        {worker.paused ? <Badge variant="warning">Paused</Badge> : null}
      </div>

      <p className="text-sm">
        <span className="font-medium tabular-nums">
          {runs.length} / {worker.max_concurrency}
        </span>{' '}
        <span className="text-muted-foreground">runs active</span>
      </p>
      {runs.length > 0 ? (
        <ul className="flex flex-col">
          {runs.map(({ run, botName }) => (
            <li key={run.id}>
              <Link
                href={`/runs/${run.id}`}
                className="flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {botName}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {isOwner ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">Runs at the same time</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={stepper}
                aria-label="Fewer runs at the same time"
                disabled={pending || worker.max_concurrency <= 1}
                onClick={() => update({ max_concurrency: worker.max_concurrency - 1 })}
              >
                <Minus className="size-4" />
              </button>
              <output className="w-8 text-center font-semibold tabular-nums">
                {worker.max_concurrency}
              </output>
              <button
                type="button"
                className={stepper}
                aria-label="More runs at the same time"
                disabled={pending || worker.max_concurrency >= 20}
                onClick={() => update({ max_concurrency: worker.max_concurrency + 1 })}
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Pause this worker
              <span className="block text-xs text-muted-foreground">
                It finishes what it is doing and takes no new runs.
              </span>
            </span>
            <Switch
              checked={worker.paused}
              disabled={pending}
              onCheckedChange={(paused) => update({ paused })}
              aria-label={`Pause ${worker.name}`}
            />
          </label>
        </div>
      ) : null}
    </Card>
  );
}
