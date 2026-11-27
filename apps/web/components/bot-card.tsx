'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  capabilitiesFor,
  fieldsFromJsonSchema,
  scheduleLabel,
  type BotRow,
  type RunRow,
} from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { RunSheet } from '@/components/run-sheet';
import { BotStatusPill } from '@/components/status-pill';
import { TimeAgo } from '@/components/time-ago';
import { updateBotAction } from '@/lib/actions';

export interface BotCardProps {
  bot: BotRow;
  activeRun: RunRow | null;
  activeWorkerName: string | null;
  lastRun: RunRow | null;
  usedToday: number;
  foundToday: number;
  canOperate: boolean;
  stopped: boolean;
}

export function BotCard({
  bot,
  activeRun,
  activeWorkerName,
  lastRun,
  usedToday,
  foundToday,
  canOperate,
  stopped,
}: BotCardProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  // shows the tapped value straight away; the saved value takes over once it arrives
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const enabled = optimistic ?? bot.enabled;
  const [pending, startTransition] = useTransition();
  const fields = fieldsFromJsonSchema(bot.settings_schema);
  const hasSchedule = Boolean(bot.schedule_cron);
  const contacts = capabilitiesFor(bot.slug).contactStatus !== null;

  const toggleSchedule = (next: boolean) => {
    setOptimistic(next);
    startTransition(async () => {
      const result = await updateBotAction(bot.slug, { enabled: next });
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(next ? `Schedule on: ${scheduleLabel(bot.schedule_cron)}` : 'Schedule off');
        router.refresh();
      }
      setOptimistic(null);
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="bot-card" data-slug={bot.slug}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base leading-tight font-semibold">{bot.name}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{bot.description}</p>
        </div>
        <BotStatusPill
          active={activeRun?.status ?? null}
          lastStatus={lastRun?.status ?? null}
          worker={activeWorkerName}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span data-testid="today-count">
          {contacts ? `${usedToday} / ${bot.daily_cap} today` : `${foundToday} found today`}
        </span>
        {lastRun ? (
          <Link
            href={`/runs/${lastRun.id}`}
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Last run&nbsp;
            <TimeAgo iso={lastRun.finished_at} />
          </Link>
        ) : (
          <span>Never run</span>
        )}
      </div>
      {lastRun?.summary || lastRun?.error ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {lastRun.summary ?? lastRun.error}
        </p>
      ) : null}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <label
          className="flex min-w-0 flex-1 items-center gap-1 text-sm"
          title={
            hasSchedule ? scheduleLabel(bot.schedule_cron) : 'Pick a schedule in settings first'
          }
        >
          <Switch
            checked={enabled && hasSchedule}
            disabled={!canOperate || !hasSchedule || pending}
            onCheckedChange={toggleSchedule}
            aria-label={`Schedule for ${bot.name}`}
            data-testid="schedule-switch"
          />
          <span className="min-w-0 truncate text-muted-foreground">
            {hasSchedule ? scheduleLabel(bot.schedule_cron) : 'No schedule'}
          </span>
        </label>
        <Button variant="outline" size="icon" asChild>
          <Link href={`/bots/${bot.slug}`} aria-label={`Settings for ${bot.name}`}>
            <Settings />
          </Link>
        </Button>
        {activeRun ? (
          <Button asChild variant="secondary">
            <Link href={`/runs/${activeRun.id}`}>Open run</Link>
          </Button>
        ) : (
          <Button
            onClick={() => setSheetOpen(true)}
            disabled={!canOperate || stopped}
            data-testid="run-now"
            title={stopped ? 'All bots are stopped' : undefined}
          >
            <Play />
            Run now
          </Button>
        )}
      </div>

      <RunSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        slug={bot.slug}
        name={bot.name}
        fields={fields}
        settings={bot.settings}
      />
    </Card>
  );
}
