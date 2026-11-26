import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  APP_SETTING_KEYS,
  ITEM_KINDS,
  ITEM_STATUSES,
  isWorkerOnline,
  startOfDay,
  type AppSettingRow,
  type BotRow,
  type Database,
  type ItemKind,
  type ItemRow,
  type ItemStatus,
  type ProfileRow,
  type RunEventRow,
  type RunRow,
  type WorkerRow,
} from '@fgv/shared';

export type Db = SupabaseClient<Database>;

export interface GlobalSettings {
  killSwitch: boolean;
  dailySpendCapUsd: number;
  linkedinDailyCap: number;
  defaultModel: 'opus' | 'fast';
}

export function readGlobalSettings(rows: AppSettingRow[]): GlobalSettings {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const number = (key: string, fallback: number) => {
    const value = Number(map.get(key));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    killSwitch: map.get(APP_SETTING_KEYS.killSwitch) === true,
    dailySpendCapUsd: number(APP_SETTING_KEYS.dailySpendCapUsd, 30),
    linkedinDailyCap: number(APP_SETTING_KEYS.linkedinDailyCap, 20),
    defaultModel: map.get(APP_SETTING_KEYS.defaultModel) === 'fast' ? 'fast' : 'opus',
  };
}

export async function getGlobalSettings(db: Db): Promise<GlobalSettings> {
  const { data } = await db.from('app_settings').select('*');
  return readGlobalSettings(data ?? []);
}

/** Runs that are waiting or working. */
export const ACTIVE_RUN_STATUSES = ['queued', 'claimed', 'running', 'stop_requested'] as const;

export interface BotCardData {
  bot: BotRow;
  /** queued / running run, if any */
  activeRun: RunRow | null;
  activeWorkerName: string | null;
  lastRun: RunRow | null;
  /** sent + applied today by this bot */
  usedToday: number;
  /** items this bot found today */
  foundToday: number;
}

export interface DashboardData {
  settings: GlobalSettings;
  metrics: { foundToday: number; actedToday: number; waitingApproval: number; spendToday: number };
  bots: BotCardData[];
  workersOnline: number;
}

/** Does job-apply wait for approval before it applies? Then ready jobs belong in the inbox. */
function jobsNeedApproval(bots: BotRow[]): boolean {
  return bots.find((bot) => bot.slug === 'job-apply')?.approval_mode === 'approve_each';
}

export async function countWaitingApproval(db: Db, bots?: BotRow[]): Promise<number> {
  const list = bots ?? (await db.from('bots').select('*')).data ?? [];
  const waiting = await db
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'needs_approval');
  let total = waiting.count ?? 0;
  if (jobsNeedApproval(list)) {
    const jobs = await db
      .from('items')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'ready')
      .eq('kind', 'job');
    total += jobs.count ?? 0;
  }
  return total;
}

export async function getDashboard(db: Db): Promise<DashboardData> {
  const dayStart = startOfDay().toISOString();
  const [botsResult, settingsResult, workersResult, runsResult, actedResult, foundResult, spend] =
    await Promise.all([
      db.from('bots').select('*').order('name'),
      db.from('app_settings').select('*'),
      db.from('workers').select('*'),
      db.from('runs').select('*').order('queued_at', { ascending: false }).limit(300),
      db
        .from('items')
        .select('bot_id, acted_by, status')
        .in('status', ['sent', 'applied'])
        .gte('acted_at', dayStart),
      db.from('items').select('bot_id').gte('created_at', dayStart).limit(5000),
      db.rpc('spend_today'),
    ]);

  const bots = botsResult.data ?? [];
  const workers = workersResult.data ?? [];
  const workerNames = new Map(workers.map((worker) => [worker.id, worker.name]));
  const runs = runsResult.data ?? [];
  const acted = actedResult.data ?? [];
  const found = foundResult.data ?? [];

  const cards: BotCardData[] = bots.map((bot) => {
    const botRuns = runs.filter((run) => run.bot_id === bot.id);
    const activeRun =
      botRuns.find((run) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status)) ??
      null;
    const lastRun = botRuns.find((run) => run.finished_at !== null) ?? null;
    return {
      bot,
      activeRun,
      activeWorkerName: activeRun?.worker_id
        ? (workerNames.get(activeRun.worker_id) ?? null)
        : null,
      lastRun,
      usedToday: acted.filter((item) => (item.acted_by ?? item.bot_id) === bot.id).length,
      foundToday: found.filter((item) => item.bot_id === bot.id).length,
    };
  });

  return {
    settings: readGlobalSettings(settingsResult.data ?? []),
    metrics: {
      foundToday: found.length,
      actedToday: acted.length,
      waitingApproval: await countWaitingApproval(db, bots),
      spendToday: Number(spend.data ?? 0),
    },
    bots: cards,
    workersOnline: workers.filter((worker) => isWorkerOnline(worker.last_heartbeat)).length,
  };
}

export async function getBotBySlug(db: Db, slug: string): Promise<BotRow | null> {
  const { data } = await db.from('bots').select('*').eq('slug', slug).maybeSingle();
  return data;
}

export interface RunHistoryEntry {
  run: RunRow;
  itemCount: number;
}

export async function getRunHistory(db: Db, botId: string, limit = 20): Promise<RunHistoryEntry[]> {
  const { data: runs } = await db
    .from('runs')
    .select('*')
    .eq('bot_id', botId)
    .order('queued_at', { ascending: false })
    .limit(limit);
  const list = runs ?? [];
  if (list.length === 0) return [];
  const { data: items } = await db
    .from('items')
    .select('run_id')
    .in(
      'run_id',
      list.map((run) => run.id),
    );
  const counts = new Map<string, number>();
  for (const item of items ?? []) {
    if (item.run_id) counts.set(item.run_id, (counts.get(item.run_id) ?? 0) + 1);
  }
  return list.map((run) => ({ run, itemCount: counts.get(run.id) ?? 0 }));
}

export interface RunPageData {
  run: RunRow;
  bot: BotRow;
  worker: WorkerRow | null;
  events: RunEventRow[];
  items: ItemRow[];
}

export const MAX_EVENTS_ON_PAGE = 500;

export async function getRunPage(db: Db, id: string): Promise<RunPageData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: run } = await db.from('runs').select('*').eq('id', id).maybeSingle();
  if (!run) return null;
  const [bot, worker, events, items] = await Promise.all([
    db.from('bots').select('*').eq('id', run.bot_id).maybeSingle(),
    run.worker_id
      ? db.from('workers').select('*').eq('id', run.worker_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('run_events')
      .select('*')
      .eq('run_id', id)
      .order('id', { ascending: false })
      .limit(MAX_EVENTS_ON_PAGE),
    db
      .from('items')
      .select('*')
      .eq('run_id', id)
      .order('created_at', { ascending: true })
      .limit(500),
  ]);
  if (!bot.data) return null;
  return {
    run,
    bot: bot.data,
    worker: worker.data,
    events: (events.data ?? []).slice().reverse(),
    items: items.data ?? [],
  };
}

export interface ItemFilters {
  kind?: ItemKind;
  status?: ItemStatus;
  botId?: string;
  from?: string;
  to?: string;
  search?: string;
  sort?: 'newest' | 'oldest' | 'score' | 'company';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads filters from the URL, ignoring anything that is not a known value. */
export function parseItemFilters(
  params: Record<string, string | string[] | undefined>,
): ItemFilters {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const kind = one('kind');
  const status = one('status');
  const sort = one('sort');
  const bot = one('bot');
  const from = one('from');
  const to = one('to');
  return {
    kind: (ITEM_KINDS as readonly string[]).includes(kind ?? '') ? (kind as ItemKind) : undefined,
    status: (ITEM_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as ItemStatus)
      : undefined,
    botId: bot && /^[0-9a-f-]{36}$/i.test(bot) ? bot : undefined,
    from: from && DATE_ONLY.test(from) ? from : undefined,
    to: to && DATE_ONLY.test(to) ? to : undefined,
    search: one('q')?.slice(0, 100),
    sort: sort === 'oldest' || sort === 'score' || sort === 'company' ? sort : ('newest' as const),
  };
}

/** Strips the characters that have a meaning inside a PostgREST or() filter. */
function safeSearchTerm(term: string): string {
  return term
    .replace(/[%,()*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getItems(db: Db, filters: ItemFilters, limit = 200): Promise<ItemRow[]> {
  let query = db.from('items').select('*');
  if (filters.kind) query = query.eq('kind', filters.kind);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.botId) query = query.eq('bot_id', filters.botId);
  // dates are days in the app time zone (UTC-3, no daylight saving)
  if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00-03:00`);
  if (filters.to) query = query.lte('created_at', `${filters.to}T23:59:59-03:00`);
  const term = filters.search ? safeSearchTerm(filters.search) : '';
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      ['title', 'company', 'person', 'location', 'notes']
        .map((column) => `${column}.ilike.${like}`)
        .join(','),
    );
  }
  switch (filters.sort) {
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    case 'score':
      query = query.order('score', { ascending: false, nullsFirst: false });
      break;
    case 'company':
      query = query.order('company', { ascending: true, nullsFirst: false });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }
  const { data } = await query.limit(limit);
  return data ?? [];
}

export interface ApprovalData {
  items: ItemRow[];
  bots: BotRow[];
  includesReadyJobs: boolean;
}

export async function getApprovals(db: Db): Promise<ApprovalData> {
  const { data: bots } = await db.from('bots').select('*').order('name');
  const list = bots ?? [];
  const includeJobs = jobsNeedApproval(list);
  const [waiting, jobs] = await Promise.all([
    db
      .from('items')
      .select('*')
      .eq('status', 'needs_approval')
      .order('created_at', { ascending: false })
      .limit(300),
    includeJobs
      ? db
          .from('items')
          .select('*')
          .eq('status', 'ready')
          .eq('kind', 'job')
          .order('created_at', { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] as ItemRow[] }),
  ]);
  const items = [...(waiting.data ?? []), ...(jobs.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  return { items, bots: list, includesReadyJobs: includeJobs };
}

export interface WorkerCardData {
  worker: WorkerRow;
  online: boolean;
  runs: { run: RunRow; botName: string }[];
}

export async function getWorkers(db: Db): Promise<WorkerCardData[]> {
  const [workers, runs, bots] = await Promise.all([
    db.from('workers').select('*').order('name'),
    db.from('runs').select('*').in('status', ['claimed', 'running', 'stop_requested']),
    db.from('bots').select('id, name'),
  ]);
  const botNames = new Map((bots.data ?? []).map((bot) => [bot.id, bot.name]));
  return (workers.data ?? []).map((worker) => ({
    worker,
    online: isWorkerOnline(worker.last_heartbeat),
    runs: (runs.data ?? [])
      .filter((run) => run.worker_id === worker.id)
      .map((run) => ({ run, botName: botNames.get(run.bot_id) ?? 'Bot' })),
  }));
}

export async function getProfiles(db: Db): Promise<ProfileRow[]> {
  const { data } = await db.from('profiles').select('*').order('created_at');
  return data ?? [];
}
