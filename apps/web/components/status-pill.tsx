import { ITEM_STATUS_LABELS, type ItemStatus, type RunStatus } from '@fgv/shared';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

const RUN_STATUS: Record<RunStatus, { label: string; variant: BadgeVariant; live?: boolean }> = {
  queued: { label: 'Queued', variant: 'warning', live: true },
  claimed: { label: 'Starting', variant: 'accent', live: true },
  running: { label: 'Running', variant: 'accent', live: true },
  stop_requested: { label: 'Stopping', variant: 'warning', live: true },
  succeeded: { label: 'Finished', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  stopped: { label: 'Stopped', variant: 'neutral' },
};

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS[status].label;
}

/** Status of a run. "Running on <worker>" when the worker is known. */
export function RunStatusPill({ status, worker }: { status: RunStatus; worker?: string | null }) {
  const info = RUN_STATUS[status];
  const label = status === 'running' && worker ? `Running on ${worker}` : info.label;
  return (
    <Badge variant={info.variant} data-testid="status-pill" data-status={status}>
      {info.live ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {label}
    </Badge>
  );
}

/** Status of a bot card: Idle / Queued / Running on <worker> / Failed. */
export function BotStatusPill({
  active,
  lastStatus,
  worker,
}: {
  active: RunStatus | null;
  lastStatus: RunStatus | null;
  worker: string | null;
}) {
  if (active) return <RunStatusPill status={active} worker={worker} />;
  if (lastStatus === 'failed') return <RunStatusPill status="failed" />;
  return (
    <Badge variant="neutral" data-testid="status-pill" data-status="idle">
      Idle
    </Badge>
  );
}

const ITEM_VARIANT: Record<ItemStatus, BadgeVariant> = {
  found: 'neutral',
  ready: 'accent',
  needs_approval: 'warning',
  approved: 'accent',
  sent: 'success',
  applied: 'success',
  skipped: 'neutral',
  needs_human: 'warning',
  closed: 'neutral',
  error: 'danger',
};

export function ItemStatusPill({ status }: { status: ItemStatus }) {
  return <Badge variant={ITEM_VARIANT[status]}>{ITEM_STATUS_LABELS[status]}</Badge>;
}
