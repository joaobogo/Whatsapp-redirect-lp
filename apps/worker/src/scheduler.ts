import { CronExpressionParser } from 'cron-parser';
import { APP_TIME_ZONE, splitCron, type BotRow } from '@fgv/shared';
import type { Db } from './db';
import { logger } from './log';

/** A schedule that was due up to this long ago still fires (covers a slow tick or a short outage). */
export const CATCH_UP_MS = 5 * 60_000;

/** The most recent time the schedule should have fired, at or before `now`. */
export function lastDueTime(cron: string | null, now: Date, timeZone = APP_TIME_ZONE): Date | null {
  let latest: Date | null = null;
  for (const expression of splitCron(cron)) {
    try {
      // +1 ms so a run due exactly now counts as due
      const previous = CronExpressionParser.parse(expression, {
        tz: timeZone,
        currentDate: new Date(now.getTime() + 1),
      })
        .prev()
        .toDate();
      if (!latest || previous > latest) latest = previous;
    } catch {
      // an expression that cannot be read never fires
    }
  }
  return latest;
}

/**
 * Is a scheduled run due? Yes when the schedule fired within the catch-up
 * window and no scheduled run was queued since that moment.
 */
export function isDue(
  cron: string | null,
  now: Date,
  lastScheduledAt: Date | null,
  timeZone = APP_TIME_ZONE,
): boolean {
  const due = lastDueTime(cron, now, timeZone);
  if (!due) return false;
  if (now.getTime() - due.getTime() > CATCH_UP_MS) return false;
  return !lastScheduledAt || lastScheduledAt.getTime() < due.getTime();
}

/**
 * Runs once a minute on the one worker with WORKER_IS_SCHEDULER=true.
 * For each enabled bot with a schedule: queue a run when it is due, unless one
 * is already queued or running for that bot.
 */
export async function schedulerTick(db: Db, now: Date = new Date()): Promise<string[]> {
  const queued: string[] = [];
  const { data: bots, error } = await db
    .from('bots')
    .select('*')
    .eq('enabled', true)
    .not('schedule_cron', 'is', null);
  if (error) throw new Error(error.message);

  for (const bot of (bots ?? []) as BotRow[]) {
    const { data: recent } = await db
      .from('runs')
      .select('status, source, queued_at')
      .eq('bot_id', bot.id)
      .order('queued_at', { ascending: false })
      .limit(20);
    const runs = recent ?? [];
    if (
      runs.some((run) => ['queued', 'claimed', 'running', 'stop_requested'].includes(run.status))
    ) {
      continue;
    }
    const lastScheduled = runs.find((run) => run.source === 'schedule');
    if (!isDue(bot.schedule_cron, now, lastScheduled ? new Date(lastScheduled.queued_at) : null)) {
      continue;
    }
    const { error: failure } = await db.from('runs').insert({
      bot_id: bot.id,
      settings_snapshot: bot.settings,
      source: 'schedule',
      requested_by: null,
    });
    if (failure) {
      // the database refuses while everything is stopped or past the spend cap
      logger.info(`Schedule: ${bot.slug} was due but not queued (${failure.message})`);
    } else {
      queued.push(bot.slug);
      logger.info(`Schedule: queued ${bot.slug}`);
    }
  }
  return queued;
}
