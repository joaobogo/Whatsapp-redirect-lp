import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  fieldsFromJsonSchema,
  formatUsd,
  isWorkerOnline,
  parseSettings,
  scheduleLabel,
  type BotRow,
  type BotSettings,
} from '@fgv/shared';
import type { Viewer } from '@/lib/auth';
import { canOperate } from '@/lib/auth';
import { getDashboard, getItems, type Db } from '@/lib/data';
import { friendlyError } from '@/lib/errors';
import { createRun, prepareRun } from '@/lib/runs';

/** A small card shown in the chat for a tool call. */
export interface ChatCard {
  title: string;
  lines?: string[];
  link?: { href: string; label: string };
}

/** An action the model proposed. Nothing happens until the user taps Confirm. */
export interface PendingAction {
  tool: MutatingTool;
  input: Record<string, unknown>;
  title: string;
  lines: string[];
}

export type ActionStatus = 'pending' | 'confirmed' | 'cancelled' | 'failed';

export interface StoredAction extends PendingAction {
  status: ActionStatus;
  result?: string;
  link?: { href: string; label: string };
}

const MUTATING_TOOLS = [
  'start_bot',
  'stop_run',
  'stop_all',
  'set_bot_enabled',
  'update_bot_settings',
  'approve_items',
] as const;
type MutatingTool = (typeof MUTATING_TOOLS)[number];

export function isMutatingTool(name: string): name is MutatingTool {
  return (MUTATING_TOOLS as readonly string[]).includes(name);
}

const CONFIRM = {
  type: 'boolean' as const,
  description:
    'Always send false. The app shows the user a preview with a Confirm button; the action only runs when they tap it.',
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_bots',
    description: 'List every bot with its status, schedule, approval mode and today count.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_bot',
    description: 'One bot in detail: current settings, the settings it accepts, and its last runs.',
    input_schema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'Bot slug, e.g. market-positions' } },
      required: ['slug'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_status',
    description: 'Workers online, runs in progress, and the metrics for today.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_items',
    description:
      'Search saved results (jobs, candidates, leads, drafts, proposals). Use status needs_approval for "what is waiting for me".',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...ITEM_KINDS] },
        status: { type: 'string', enum: [...ITEM_STATUSES] },
        bot_slug: { type: 'string' },
        search: { type: 'string', description: 'Text to look for in title, company, person' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'start_bot',
    description:
      'Start a bot now. settings_overrides changes settings for this run only; leave out what should stay as saved. Call get_bot first if you are not sure of the setting names.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        settings_overrides: { type: 'object', additionalProperties: true },
        confirm: CONFIRM,
      },
      required: ['slug', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_run',
    description: 'Stop one run.',
    input_schema: {
      type: 'object',
      properties: { run_id: { type: 'string' }, confirm: CONFIRM },
      required: ['run_id', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'stop_all',
    description: 'Stop every running bot and switch the kill switch on.',
    input_schema: {
      type: 'object',
      properties: { confirm: CONFIRM },
      required: ['confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_bot_enabled',
    description: "Switch a bot's schedule on or off.",
    input_schema: {
      type: 'object',
      properties: { slug: { type: 'string' }, enabled: { type: 'boolean' }, confirm: CONFIRM },
      required: ['slug', 'enabled', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_bot_settings',
    description: "Change a bot's saved settings. Send only the settings that change.",
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        settings: { type: 'object', additionalProperties: true },
        confirm: CONFIRM,
      },
      required: ['slug', 'settings', 'confirm'],
      additionalProperties: false,
    },
  },
  {
    name: 'approve_items',
    description: 'Approve items that are waiting for approval, by id (from search_items).',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
        confirm: CONFIRM,
      },
      required: ['ids', 'confirm'],
      additionalProperties: false,
    },
  },
];

/** Viewers get read-only tools (spec 8.3). */
export function toolsFor(viewer: Viewer): Anthropic.Tool[] {
  return canOperate(viewer.role) ? TOOLS : TOOLS.filter((tool) => !isMutatingTool(tool.name));
}

const slugSchema = z.string().min(1).max(80);
const inputs = {
  get_bot: z.object({ slug: slugSchema }),
  search_items: z.object({
    kind: z.enum(ITEM_KINDS).optional(),
    status: z.enum(ITEM_STATUSES).optional(),
    bot_slug: slugSchema.optional(),
    search: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  start_bot: z.object({
    slug: slugSchema,
    settings_overrides: z.record(z.string(), z.unknown()).optional(),
  }),
  stop_run: z.object({ run_id: z.uuid() }),
  stop_all: z.object({}),
  set_bot_enabled: z.object({ slug: slugSchema, enabled: z.boolean() }),
  update_bot_settings: z.object({ slug: slugSchema, settings: z.record(z.string(), z.unknown()) }),
  approve_items: z.object({ ids: z.array(z.uuid()).min(1).max(50) }),
};

export type ToolOutcome =
  | { kind: 'result'; text: string; card?: ChatCard; isError?: boolean }
  | { kind: 'preview'; text: string; action: PendingAction };

function error(text: string): ToolOutcome {
  return { kind: 'result', text, isError: true };
}

function settingLines(settings: BotSettings, only?: string[]): string[] {
  return Object.entries(settings)
    .filter(([key]) => !only || only.includes(key))
    .map(
      ([key, value]) =>
        `${key.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
    );
}

async function findBot(db: Db, slug: string): Promise<BotRow | null> {
  const { data } = await db.from('bots').select('*').eq('slug', slug).maybeSingle();
  return data;
}

/**
 * Runs a tool the model called.
 *  - Read-only tools run immediately.
 *  - Tools that start, stop, change or approve NEVER run here, whatever the
 *    model sends for `confirm`: they return a preview. Only the user's tap on
 *    Confirm (confirmAction below, through a server action) executes them.
 */
export async function runChatTool(
  db: Db,
  viewer: Viewer,
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  if (isMutatingTool(name) && !canOperate(viewer.role)) {
    return error('This user is a viewer and cannot start, stop or change anything.');
  }

  switch (name) {
    case 'list_bots': {
      const data = await getDashboard(db);
      const bots = data.bots.map((card) => ({
        slug: card.bot.slug,
        name: card.bot.name,
        channel: card.bot.channel,
        status: card.activeRun?.status ?? 'idle',
        running_on: card.activeWorkerName,
        schedule: card.bot.enabled ? scheduleLabel(card.bot.schedule_cron) : 'off',
        approval_mode: card.bot.approval_mode,
        today: `${card.usedToday} / ${card.bot.daily_cap}`,
        needs_browser: card.bot.requires_browser,
      }));
      return {
        kind: 'result',
        text: JSON.stringify(bots),
        card: { title: `Looked at ${bots.length} bots` },
      };
    }

    case 'get_bot': {
      const parsed = inputs.get_bot.safeParse(rawInput);
      if (!parsed.success) return error('Give a bot slug.');
      const bot = await findBot(db, parsed.data.slug);
      if (!bot)
        return error(`There is no bot with the slug "${parsed.data.slug}". Call list_bots.`);
      const { data: runs } = await db
        .from('runs')
        .select('id, status, queued_at, summary, cost_usd')
        .eq('bot_id', bot.id)
        .order('queued_at', { ascending: false })
        .limit(3);
      const fields = fieldsFromJsonSchema(bot.settings_schema).map((field) => ({
        key: field.key,
        label: field.label,
        kind: field.kind,
        options: 'options' in field ? field.options : undefined,
        min: 'min' in field ? field.min : undefined,
        max: 'max' in field ? field.max : undefined,
        locked: 'locked' in field ? field.locked : undefined,
      }));
      return {
        kind: 'result',
        text: JSON.stringify({
          slug: bot.slug,
          name: bot.name,
          description: bot.description,
          settings: bot.settings,
          accepted_settings: fields,
          schedule: bot.enabled ? scheduleLabel(bot.schedule_cron) : 'off',
          approval_mode: bot.approval_mode,
          daily_cap: bot.daily_cap,
          last_runs: runs ?? [],
        }),
        card: {
          title: `Looked at ${bot.name}`,
          link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
        },
      };
    }

    case 'get_status': {
      const data = await getDashboard(db);
      const { data: workers } = await db.from('workers').select('*');
      const status = {
        all_bots_stopped: data.settings.killSwitch,
        workers: (workers ?? []).map((worker) => ({
          name: worker.name,
          state: !isWorkerOnline(worker.last_heartbeat)
            ? 'offline'
            : worker.paused
              ? 'paused'
              : worker.active_runs > 0
                ? 'busy'
                : 'online',
          active_runs: worker.active_runs,
        })),
        running: data.bots
          .filter((card) => card.activeRun)
          .map((card) => ({
            bot: card.bot.name,
            status: card.activeRun!.status,
            worker: card.activeWorkerName,
            run_id: card.activeRun!.id,
          })),
        today: {
          found: data.metrics.foundToday,
          applied_or_sent: data.metrics.actedToday,
          waiting_for_approval: data.metrics.waitingApproval,
          spend: formatUsd(data.metrics.spendToday),
          spend_cap: formatUsd(data.settings.dailySpendCapUsd),
        },
      };
      return {
        kind: 'result',
        text: JSON.stringify(status),
        card: { title: 'Checked the status' },
      };
    }

    case 'search_items': {
      const parsed = inputs.search_items.safeParse(rawInput ?? {});
      if (!parsed.success) return error('Those search filters are not valid.');
      let botId: string | undefined;
      if (parsed.data.bot_slug) {
        const bot = await findBot(db, parsed.data.bot_slug);
        if (!bot) return error(`There is no bot with the slug "${parsed.data.bot_slug}".`);
        botId = bot.id;
      }
      const items = await getItems(
        db,
        { kind: parsed.data.kind, status: parsed.data.status, botId, search: parsed.data.search },
        parsed.data.limit ?? 20,
      );
      const rows = items.map((item) => ({
        id: item.id,
        kind: item.kind,
        status: item.status,
        title: item.title,
        company: item.company,
        person: item.person,
        location: item.location,
        score: item.score,
        url: item.url,
      }));
      const waiting = parsed.data.status === 'needs_approval';
      return {
        kind: 'result',
        text: JSON.stringify({ count: rows.length, items: rows }),
        card: {
          title: `Found ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`,
          link: waiting
            ? { href: '/approvals', label: 'Open approvals' }
            : { href: '/results', label: 'Open results' },
        },
      };
    }

    case 'start_bot': {
      const parsed = inputs.start_bot.safeParse(rawInput);
      if (!parsed.success) return error('Give a bot slug.');
      const prepared = await prepareRun(db, {
        slug: parsed.data.slug,
        overrides: parsed.data.settings_overrides,
      });
      if (!prepared.ok)
        return error(`${prepared.error} Fix the settings and call start_bot again.`);
      return preview({
        tool: 'start_bot',
        input: {
          slug: prepared.bot.slug,
          settings_overrides: parsed.data.settings_overrides ?? {},
        },
        title: `Start ${prepared.bot.name}`,
        lines: settingLines(prepared.settings),
      });
    }

    case 'stop_run': {
      const parsed = inputs.stop_run.safeParse(rawInput);
      if (!parsed.success) return error('Give the run id.');
      const { data: run } = await db
        .from('runs')
        .select('id, status, bot_id')
        .eq('id', parsed.data.run_id)
        .maybeSingle();
      if (!run) return error('That run does not exist.');
      if (!['queued', 'claimed', 'running'].includes(run.status)) {
        return error(`That run is already ${run.status}.`);
      }
      const { data: bot } = await db.from('bots').select('name').eq('id', run.bot_id).maybeSingle();
      return preview({
        tool: 'stop_run',
        input: { run_id: run.id },
        title: `Stop ${bot?.name ?? 'this run'}`,
        lines: ['The run stops within about 15 seconds.'],
      });
    }

    case 'stop_all':
      return preview({
        tool: 'stop_all',
        input: {},
        title: 'Stop every running bot',
        lines: ['Running bots stop, queued runs are cancelled, nothing starts until Resume.'],
      });

    case 'set_bot_enabled': {
      const parsed = inputs.set_bot_enabled.safeParse(rawInput);
      if (!parsed.success) return error('Give a bot slug and enabled true or false.');
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return error(`There is no bot with the slug "${parsed.data.slug}".`);
      if (parsed.data.enabled && !bot.schedule_cron) {
        return error(
          `${bot.name} has no schedule yet. The user picks one on the bot's settings page.`,
        );
      }
      return preview({
        tool: 'set_bot_enabled',
        input: { slug: bot.slug, enabled: parsed.data.enabled },
        title: `Switch the schedule ${parsed.data.enabled ? 'on' : 'off'} for ${bot.name}`,
        lines: parsed.data.enabled ? [`Schedule: ${scheduleLabel(bot.schedule_cron)}`] : [],
      });
    }

    case 'update_bot_settings': {
      const parsed = inputs.update_bot_settings.safeParse(rawInput);
      if (!parsed.success) return error('Give a bot slug and the settings to change.');
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return error(`There is no bot with the slug "${parsed.data.slug}".`);
      const fields = fieldsFromJsonSchema(bot.settings_schema);
      const known = new Set(fields.map((field) => field.key));
      const unknown = Object.keys(parsed.data.settings).filter((key) => !known.has(key));
      if (unknown.length > 0) {
        return error(`${bot.name} has no setting called ${unknown.join(', ')}. Call get_bot.`);
      }
      const checked = parseSettings(fields, { ...bot.settings, ...parsed.data.settings });
      if (!checked.ok) return error(`${checked.message} Fix it and call the tool again.`);
      return preview({
        tool: 'update_bot_settings',
        input: { slug: bot.slug, settings: parsed.data.settings },
        title: `Change the settings of ${bot.name}`,
        lines: settingLines(checked.settings, Object.keys(parsed.data.settings)),
      });
    }

    case 'approve_items': {
      const parsed = inputs.approve_items.safeParse(rawInput);
      if (!parsed.success) return error('Give the ids of the items to approve.');
      const { data: items } = await db
        .from('items')
        .select('id, status, kind, person, title, company')
        .in('id', parsed.data.ids);
      const waiting = (items ?? []).filter(
        (item) =>
          item.status === 'needs_approval' || (item.kind === 'job' && item.status === 'ready'),
      );
      if (waiting.length === 0) return error('None of those items is waiting for approval.');
      return preview({
        tool: 'approve_items',
        input: { ids: waiting.map((item) => item.id) },
        title: `Approve ${waiting.length} ${waiting.length === 1 ? 'item' : 'items'}`,
        lines: waiting
          .slice(0, 8)
          .map((item) => [item.person ?? item.title, item.company].filter(Boolean).join(' - ')),
      });
    }

    default:
      return error(`Unknown tool: ${name}`);
  }
}

function preview(action: PendingAction): ToolOutcome {
  return {
    kind: 'preview',
    action,
    text: `A preview card for "${action.title}" is now on the user's screen with a Confirm button. Nothing has happened yet. Tell the user in one short sentence to tap Confirm, and do not call this tool again for the same action.`,
  };
}

export interface ConfirmResult {
  ok: boolean;
  message: string;
  link?: { href: string; label: string };
}

/**
 * Executes an action the user confirmed. The action is re-read from the
 * database row it was stored in and every input is validated again, so a
 * tampered request cannot run something the user did not see.
 */
export async function confirmAction(
  db: Db,
  viewer: Viewer,
  action: PendingAction,
): Promise<ConfirmResult> {
  if (!canOperate(viewer.role)) {
    return { ok: false, message: 'You do not have permission to do that.' };
  }

  switch (action.tool) {
    case 'start_bot': {
      const parsed = inputs.start_bot.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const result = await createRun(db, {
        slug: parsed.data.slug,
        overrides: parsed.data.settings_overrides,
        source: 'chat',
      });
      if (!result.ok) return { ok: false, message: result.error };
      return {
        ok: true,
        message: `Started ${result.bot.name}`,
        link: { href: `/runs/${result.runId}`, label: 'Open run' },
      };
    }
    case 'stop_run': {
      const parsed = inputs.stop_run.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const { error: failure } = await db.rpc('request_stop', { p_run: parsed.data.run_id });
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: 'Stopping the run',
        link: { href: `/runs/${parsed.data.run_id}`, label: 'Open run' },
      };
    }
    case 'stop_all': {
      const { error: failure } = await db.rpc('stop_all');
      if (failure) return { ok: false, message: friendlyError(failure) };
      return { ok: true, message: 'All bots are stopping' };
    }
    case 'set_bot_enabled': {
      const parsed = inputs.set_bot_enabled.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return { ok: false, message: 'That bot does not exist.' };
      if (parsed.data.enabled && !bot.schedule_cron) {
        return { ok: false, message: 'Pick a schedule for this bot first.' };
      }
      const { error: failure } = await db
        .from('bots')
        .update({ enabled: parsed.data.enabled })
        .eq('id', bot.id);
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: `Schedule ${parsed.data.enabled ? 'on' : 'off'} for ${bot.name}`,
        link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
      };
    }
    case 'update_bot_settings': {
      const parsed = inputs.update_bot_settings.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return { ok: false, message: 'That bot does not exist.' };
      const checked = parseSettings(fieldsFromJsonSchema(bot.settings_schema), {
        ...bot.settings,
        ...parsed.data.settings,
      });
      if (!checked.ok) return { ok: false, message: checked.message };
      const { error: failure } = await db
        .from('bots')
        .update({ settings: checked.settings })
        .eq('id', bot.id);
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: `Saved the settings of ${bot.name}`,
        link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
      };
    }
    case 'approve_items': {
      const parsed = inputs.approve_items.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const { data, error: failure } = await db
        .from('items')
        .update({ status: 'approved' })
        .in('id', parsed.data.ids)
        .in('status', ['needs_approval', 'ready'])
        .select('id');
      if (failure) return { ok: false, message: friendlyError(failure) };
      const count = data?.length ?? 0;
      return {
        ok: count > 0,
        message:
          count > 0
            ? `Approved ${count} ${count === 1 ? 'item' : 'items'}`
            : 'Those items were no longer waiting for approval.',
        link: { href: '/approvals', label: 'Open approvals' },
      };
    }
  }
}
