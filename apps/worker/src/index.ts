// FGV worker: registers this computer, sends a heartbeat, claims queued runs
// and runs them with the Claude Agent SDK (spec section 10).
import type { RunRow, WorkerRow } from '@fgv/shared';
import { claimNextRun } from './claim';
import { loadConfig, type WorkerConfig } from './config';
import { createDb, type Db } from './db';
import { KeepAwake } from './keepawake';
import { errorMessage, logger } from './log';
import { executeRun } from './runner';
import { schedulerTick } from './scheduler';
import { startSheetsMirror } from './sheets';
import { LOCK_PREFIX } from './tools';

const HEARTBEAT_MS = 30_000;
const LOOP_MS = 5_000;
const SCHEDULER_MS = 60_000;

interface ActiveRun {
  run: RunRow;
  browser: boolean;
  done: Promise<void>;
}

/** The user id behind WORKER_OWNER_EMAIL, or null when it is not set or nobody has that login yet. */
async function findOwnerId(db: Db, email: string | null): Promise<string | null> {
  if (!email) return null;
  try {
    const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const user = data?.users.find((entry) => entry.email?.toLowerCase() === email);
    if (!user) logger.warn('WORKER_OWNER_EMAIL has not logged in to the app yet; no owner set.');
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Insert the workers row on first boot; afterwards the limits set in the app win over the .env. */
async function registerWorker(db: Db, config: WorkerConfig): Promise<WorkerRow> {
  const { data: existing, error } = await db
    .from('workers')
    .select('*')
    .eq('name', config.workerName)
    .maybeSingle();
  if (error) throw new Error(`Could not reach the database: ${error.message}`);

  const facts = {
    status: 'online' as const,
    has_browser: config.hasBrowser,
    has_desktop: config.hasDesktop,
    is_scheduler: config.isScheduler,
    active_runs: 0,
    last_heartbeat: new Date().toISOString(),
    version: config.version,
  };
  if (existing) {
    // the owner set in the app wins; the .env only fills it in when nobody is set
    const owner = existing.owner_id ?? (await findOwnerId(db, config.ownerEmail));
    const { data, error: failure } = await db
      .from('workers')
      .update({ ...facts, owner_id: owner })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (failure || !data) throw new Error(`Could not update this worker: ${failure?.message}`);
    return data;
  }
  const { data, error: failure } = await db
    .from('workers')
    .insert({
      name: config.workerName,
      max_concurrency: config.maxConcurrency,
      owner_id: await findOwnerId(db, config.ownerEmail),
      ...facts,
    })
    .select('*')
    .single();
  if (failure || !data) throw new Error(`Could not register this worker: ${failure?.message}`);
  return data;
}

/**
 * Crash safety: runs this worker was in the middle of are marked failed with
 * "worker restarted", and scheduled ones are queued again once.
 */
async function recoverFromCrash(db: Db, worker: WorkerRow): Promise<void> {
  const { data: orphans } = await db
    .from('runs')
    .select('*')
    .eq('worker_id', worker.id)
    .in('status', ['claimed', 'running', 'stop_requested']);

  for (const run of orphans ?? []) {
    const stopped = run.status === 'stop_requested';
    await db
      .from('runs')
      .update({
        status: stopped ? 'stopped' : 'failed',
        error: 'worker restarted',
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
    await db.from('run_events').insert({
      run_id: run.id,
      type: 'error',
      message: 'The worker computer restarted during this run.',
    });

    const alreadyRetried = run.settings_snapshot?.__requeued === true;
    if (!stopped && run.source === 'schedule' && !alreadyRetried) {
      const { error } = await db.from('runs').insert({
        bot_id: run.bot_id,
        settings_snapshot: { ...run.settings_snapshot, __requeued: true },
        source: 'schedule',
        requested_by: null,
      });
      if (!error) logger.info(`Re-queued scheduled run of bot ${run.bot_id} after a restart`);
    }
    logger.warn(`Run ${run.id} was interrupted by a restart`);
  }

  // release items this worker had claimed
  const { data: locked } = await db
    .from('items')
    .select('id, notes')
    .like('notes', `${LOCK_PREFIX}${worker.name}%`);
  for (const item of locked ?? []) {
    const rest = (item.notes ?? '').split(' || ').slice(1).join(' || ');
    await db
      .from('items')
      .update({ notes: rest || null })
      .eq('id', item.id);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config);
  const worker = await registerWorker(db, config);
  await recoverFromCrash(db, worker);

  logger.info(
    `Worker "${config.workerName}" v${config.version} is online ` +
      `(browser: ${config.hasBrowser ? 'yes' : 'no'}, scheduler: ${config.isScheduler ? 'yes' : 'no'})`,
  );

  const active = new Map<string, ActiveRun>();
  const keepAwake = new KeepAwake();
  let maxConcurrency = worker.max_concurrency;
  let paused = worker.paused;
  let shuttingDown = false;
  let claiming = false;

  const heartbeat = async () => {
    const { data, error } = await db
      .from('workers')
      .update({
        last_heartbeat: new Date().toISOString(),
        status: active.size > 0 ? 'busy' : 'online',
        active_runs: active.size,
        version: config.version,
      })
      .eq('id', worker.id)
      .select('max_concurrency, paused')
      .maybeSingle();
    if (error) {
      logger.warn(`Heartbeat failed: ${error.message}`);
      return;
    }
    if (data) {
      maxConcurrency = data.max_concurrency;
      paused = data.paused;
    }
  };

  const start = (run: RunRow, browser: boolean) => {
    logger.info(`Run ${run.id} started`);
    keepAwake.set(true);
    // run without blocking the loop
    const done = executeRun({ db, config, workerId: worker.id }, run)
      .then((outcome) => logger.info(`Run ${run.id} ${outcome}`))
      .catch((error: unknown) => logger.error(`Run ${run.id} crashed`, error))
      .finally(() => {
        active.delete(run.id);
        keepAwake.set(active.size > 0);
        void heartbeat();
      });
    active.set(run.id, { run, browser, done });
    void heartbeat();
  };

  const loop = async () => {
    if (claiming || shuttingDown || paused) return;
    claiming = true;
    try {
      // claim_next_run itself returns nothing while the kill switch is on
      while (!shuttingDown && !paused && active.size < maxConcurrency) {
        // one Chrome profile per worker: only ONE browser run at a time
        const browserBusy = [...active.values()].some((entry) => entry.browser);
        const run = await claimNextRun(db, worker.id, config.hasBrowser && !browserBusy);
        if (!run) break;
        const { data: bot } = await db
          .from('bots')
          .select('requires_browser')
          .eq('id', run.bot_id)
          .maybeSingle();
        start(run, bot?.requires_browser ?? false);
      }
    } catch (error) {
      logger.warn(`Could not check for queued runs: ${errorMessage(error)}`);
    } finally {
      claiming = false;
    }
  };

  const timers = [
    setInterval(() => void heartbeat(), HEARTBEAT_MS),
    setInterval(() => void loop(), LOOP_MS),
  ];
  if (config.isScheduler) {
    const tick = () =>
      schedulerTick(db).catch((error: unknown) => logger.warn(`Scheduler: ${errorMessage(error)}`));
    timers.push(setInterval(() => void tick(), SCHEDULER_MS));
    void tick();
  }
  const stopMirror = config.isScheduler ? startSheetsMirror(db, config) : null;
  void loop();

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received: stopping`);
    timers.forEach((timer) => clearInterval(timer));
    stopMirror?.();
    // ask running bots to stop, then give them a moment to write their result
    if (active.size > 0) {
      await db
        .from('runs')
        .update({ status: 'stop_requested' })
        .in('id', [...active.keys()])
        .in('status', ['claimed', 'running']);
      await Promise.race([
        Promise.all([...active.values()].map((entry) => entry.done)),
        new Promise((resolve) => setTimeout(resolve, 15_000)),
      ]);
    }
    keepAwake.release();
    await db.from('workers').update({ status: 'offline', active_runs: 0 }).eq('id', worker.id);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.error('The worker could not start', error);
  process.exit(1);
});
