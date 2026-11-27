import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  ITEM_KINDS,
  ITEM_STATUSES,
  chatEntryFromRow,
  chatPrompt,
  chatSystemPrompt,
  fieldsFromJsonSchema,
  formatUsd,
  isWorkerOnline,
  parseSettings,
  scheduleLabel,
  startOfDay,
  type BotRow,
  type BotSettings,
  type ChatCard,
  type ChatEntry,
  type ChatMessageRow,
  type Json,
  type PendingAction,
  type StoredAction,
  type UserRole,
} from '@fgv/shared';
import { WORKER_ROOT, type WorkerConfig } from './config';
import type { Db } from './db';
import { errorMessage, logger, redact, trimTo } from './log';

/**
 * The chat runs here, on the worker, with this computer's own Claude access -
 * so the web app needs no API key.
 *
 * The web app saves the user's message with status "waiting". A worker claims
 * it, asks Claude with the tools below, and writes the answer back as rows the
 * web app shows. Tools that start, stop, change or approve NEVER act: they
 * only save a preview card. The action runs in the web app, with the user's
 * own permissions, when the user taps Confirm.
 */

const SERVER = 'panel';
const CHAT_TURNS = 8;
const CHAT_TIMEOUT_MS = 100_000;

const CONFIRM = z
  .boolean()
  .optional()
  .describe(
    'Always false. The app shows a preview with a Confirm button; the action only runs when the user taps it.',
  );

type Reply = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): Reply => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const no = (text: string): Reply => ({ content: [{ type: 'text', text }], isError: true });

function settingLines(settings: BotSettings, only?: string[]): string[] {
  return Object.entries(settings)
    .filter(([key]) => !key.startsWith('__') && (!only || only.includes(key)))
    .map(
      ([key, value]) =>
        `${key.replace(/_/g, ' ')}: ${Array.isArray(value) ? value.join(', ') : String(value)}`,
    );
}

export interface ChatSession {
  db: Db;
  userId: string;
  role: UserRole;
  /** called for each read-only tool, to show a small card in the chat */
  onCard: (card: ChatCard) => void;
}

async function findBot(db: Db, slug: string): Promise<BotRow | null> {
  const { data } = await db.from('bots').select('*').eq('slug', slug).maybeSingle();
  return data;
}

/** Saves a preview card for the user. Returns what Claude is told. */
async function preview(session: ChatSession, action: PendingAction): Promise<Reply> {
  const stored: StoredAction = { ...action, status: 'pending' };
  const { error } = await session.db
    .from('chat_messages')
    .insert({ user_id: session.userId, role: 'action', content: { ...stored } as Json });
  if (error) return no('The preview could not be saved. Tell the user to try again.');
  return ok({
    preview_shown: action.title,
    note: "A preview card with a Confirm button is now on the user's screen. Nothing has happened yet. Tell the user in one short sentence to tap Confirm, and do not call this tool again for the same action.",
  });
}

/** The tools Claude gets in the chat. Viewers get the read-only ones (spec 8.3). */
export function createChatTools(session: ChatSession) {
  const { db } = session;
  const canAct = session.role === 'owner' || session.role === 'operator';

  const read = [
    tool(
      'list_bots',
      'List every bot with its status, schedule, approval mode and daily cap.',
      {},
      async () => {
        const [{ data: bots }, { data: runs }, { data: workers }] = await Promise.all([
          db.from('bots').select('*').order('name'),
          db
            .from('runs')
            .select('*')
            .in('status', ['queued', 'claimed', 'running', 'stop_requested']),
          db.from('workers').select('id, name'),
        ]);
        const names = new Map((workers ?? []).map((worker) => [worker.id, worker.name]));
        const list = (bots ?? []).map((bot) => {
          const active = (runs ?? []).find((run) => run.bot_id === bot.id);
          return {
            slug: bot.slug,
            name: bot.name,
            channel: bot.channel,
            status: active?.status ?? 'idle',
            running_on: active?.worker_id ? (names.get(active.worker_id) ?? null) : null,
            schedule: bot.enabled ? scheduleLabel(bot.schedule_cron) : 'off',
            approval_mode: bot.approval_mode,
            daily_cap: bot.daily_cap,
            needs_browser: bot.requires_browser,
          };
        });
        session.onCard({ title: `Looked at ${list.length} bots` });
        return ok(list);
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'get_bot',
      'One bot in detail: current settings, the settings it accepts, and its last runs.',
      { slug: z.string().describe('Bot slug, for example market-positions') },
      async ({ slug }) => {
        const bot = await findBot(db, slug);
        if (!bot) return no(`There is no bot with the slug "${slug}". Call list_bots.`);
        const { data: runs } = await db
          .from('runs')
          .select('id, status, queued_at, summary, cost_usd')
          .eq('bot_id', bot.id)
          .order('queued_at', { ascending: false })
          .limit(3);
        session.onCard({
          title: `Looked at ${bot.name}`,
          link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
        });
        return ok({
          slug: bot.slug,
          name: bot.name,
          description: bot.description,
          settings: bot.settings,
          accepted_settings: fieldsFromJsonSchema(bot.settings_schema).map((field) => ({
            key: field.key,
            label: field.label,
            kind: field.kind,
            options: 'options' in field ? field.options : undefined,
            min: 'min' in field ? field.min : undefined,
            max: 'max' in field ? field.max : undefined,
            locked: 'locked' in field ? field.locked : undefined,
          })),
          schedule: bot.enabled ? scheduleLabel(bot.schedule_cron) : 'off',
          approval_mode: bot.approval_mode,
          daily_cap: bot.daily_cap,
          last_runs: runs ?? [],
        });
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'get_status',
      'Workers online, runs in progress, and the numbers for today.',
      {},
      async () => {
        const dayStart = startOfDay().toISOString();
        const [workers, runs, bots, settings, found, acted, waiting, spend] = await Promise.all([
          db.from('workers').select('*').order('name'),
          db
            .from('runs')
            .select('*')
            .in('status', ['queued', 'claimed', 'running', 'stop_requested']),
          db.from('bots').select('id, name'),
          db.from('app_settings').select('*'),
          db.from('items').select('id', { count: 'exact', head: true }).gte('created_at', dayStart),
          db
            .from('items')
            .select('id', { count: 'exact', head: true })
            .in('status', ['sent', 'applied'])
            .gte('acted_at', dayStart),
          db
            .from('items')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'needs_approval'),
          db.rpc('spend_today'),
        ]);
        const botNames = new Map((bots.data ?? []).map((bot) => [bot.id, bot.name]));
        const workerNames = new Map((workers.data ?? []).map((worker) => [worker.id, worker.name]));
        const setting = (key: string) =>
          (settings.data ?? []).find((row) => row.key === key)?.value;
        session.onCard({ title: 'Checked the status' });
        return ok({
          all_bots_stopped: setting('kill_switch') === true,
          workers: (workers.data ?? []).map((worker) => ({
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
          runs_in_progress: (runs.data ?? []).map((run) => ({
            bot: botNames.get(run.bot_id) ?? 'Bot',
            status: run.status,
            worker: run.worker_id ? (workerNames.get(run.worker_id) ?? null) : null,
            run_id: run.id,
          })),
          today: {
            found: found.count ?? 0,
            applied_or_sent: acted.count ?? 0,
            waiting_for_approval: waiting.count ?? 0,
            usage: formatUsd(Number(spend.data ?? 0)),
            usage_cap: formatUsd(Number(setting('daily_spend_cap_usd') ?? 30)),
          },
        });
      },
      { annotations: { readOnlyHint: true } },
    ),
    tool(
      'search_items',
      'Search saved results (jobs, candidates, leads, drafts, proposals). Use status needs_approval for "what is waiting for me".',
      {
        kind: z.enum(ITEM_KINDS).optional(),
        status: z.enum(ITEM_STATUSES).optional(),
        bot_slug: z.string().optional(),
        search: z.string().max(100).optional().describe('Text in title, company or person'),
        limit: z.number().int().min(1).max(50).optional(),
      },
      async (args) => {
        let request = db
          .from('items')
          .select('id, kind, status, title, company, person, location, score, url');
        if (args.kind) request = request.eq('kind', args.kind);
        if (args.status) request = request.eq('status', args.status);
        if (args.bot_slug) {
          const bot = await findBot(db, args.bot_slug);
          if (!bot) return no(`There is no bot with the slug "${args.bot_slug}".`);
          request = request.eq('bot_id', bot.id);
        }
        const term = (args.search ?? '')
          .replace(/[%,()*\\"']/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (term) {
          request = request.or(
            ['title', 'company', 'person'].map((column) => `${column}.ilike.%${term}%`).join(','),
          );
        }
        const { data } = await request
          .order('created_at', { ascending: false })
          .limit(args.limit ?? 20);
        const rows = data ?? [];
        session.onCard({
          title: `Found ${rows.length} ${rows.length === 1 ? 'item' : 'items'}`,
          link:
            args.status === 'needs_approval'
              ? { href: '/approvals', label: 'Open approvals' }
              : { href: '/results', label: 'Open results' },
        });
        return ok({ count: rows.length, items: rows });
      },
      { annotations: { readOnlyHint: true } },
    ),
  ];

  if (!canAct) return read;

  const act = [
    tool(
      'start_bot',
      'Start a bot now. settings_overrides changes settings for this run only; leave out what should stay as saved. Call get_bot first if you are not sure of the setting names.',
      {
        slug: z.string(),
        settings_overrides: z.record(z.string(), z.unknown()).optional(),
        confirm: CONFIRM,
      },
      async (args) => {
        const bot = await findBot(db, args.slug);
        if (!bot) return no(`There is no bot with the slug "${args.slug}". Call list_bots.`);
        const overrides = args.settings_overrides ?? {};
        const checked = parseSettings(fieldsFromJsonSchema(bot.settings_schema), {
          ...bot.settings,
          ...overrides,
        });
        if (!checked.ok) return no(`${checked.message} Fix the settings and call start_bot again.`);
        return preview(session, {
          tool: 'start_bot',
          input: { slug: bot.slug, settings_overrides: overrides },
          title: `Start ${bot.name}`,
          lines: settingLines(checked.settings),
        });
      },
    ),
    tool('stop_run', 'Stop one run.', { run_id: z.string(), confirm: CONFIRM }, async (args) => {
      if (!z.uuid().safeParse(args.run_id).success) return no('That is not a run id.');
      const { data: run } = await db
        .from('runs')
        .select('id, status, bot_id')
        .eq('id', args.run_id)
        .maybeSingle();
      if (!run) return no('That run does not exist.');
      if (!['queued', 'claimed', 'running'].includes(run.status)) {
        return no(`That run is already ${run.status}.`);
      }
      const { data: bot } = await db.from('bots').select('name').eq('id', run.bot_id).maybeSingle();
      return preview(session, {
        tool: 'stop_run',
        input: { run_id: run.id },
        title: `Stop ${bot?.name ?? 'this run'}`,
        lines: ['The run stops within about 15 seconds.'],
      });
    }),
    tool(
      'stop_all',
      'Stop every running bot and switch the kill switch on.',
      { confirm: CONFIRM },
      async () =>
        preview(session, {
          tool: 'stop_all',
          input: {},
          title: 'Stop every running bot',
          lines: ['Running bots stop, queued runs are cancelled, nothing starts until Resume.'],
        }),
    ),
    tool(
      'set_bot_enabled',
      "Switch a bot's schedule on or off.",
      { slug: z.string(), enabled: z.boolean(), confirm: CONFIRM },
      async (args) => {
        const bot = await findBot(db, args.slug);
        if (!bot) return no(`There is no bot with the slug "${args.slug}".`);
        if (args.enabled && !bot.schedule_cron) {
          return no(
            `${bot.name} has no schedule yet. The user picks one on the bot's settings page.`,
          );
        }
        return preview(session, {
          tool: 'set_bot_enabled',
          input: { slug: bot.slug, enabled: args.enabled },
          title: `Switch the schedule ${args.enabled ? 'on' : 'off'} for ${bot.name}`,
          lines: args.enabled ? [`Schedule: ${scheduleLabel(bot.schedule_cron)}`] : [],
        });
      },
    ),
    tool(
      'update_bot_settings',
      "Change a bot's saved settings. Send only the settings that change.",
      { slug: z.string(), settings: z.record(z.string(), z.unknown()), confirm: CONFIRM },
      async (args) => {
        const bot = await findBot(db, args.slug);
        if (!bot) return no(`There is no bot with the slug "${args.slug}".`);
        const fields = fieldsFromJsonSchema(bot.settings_schema);
        const known = new Set(fields.map((field) => field.key));
        const unknown = Object.keys(args.settings).filter((key) => !known.has(key));
        if (unknown.length > 0) {
          return no(`${bot.name} has no setting called ${unknown.join(', ')}. Call get_bot.`);
        }
        const checked = parseSettings(fields, { ...bot.settings, ...args.settings });
        if (!checked.ok) return no(`${checked.message} Fix it and call the tool again.`);
        return preview(session, {
          tool: 'update_bot_settings',
          input: { slug: bot.slug, settings: args.settings },
          title: `Change the settings of ${bot.name}`,
          lines: settingLines(checked.settings, Object.keys(args.settings)),
        });
      },
    ),
    tool(
      'approve_items',
      'Approve items that are waiting for approval, by id (from search_items).',
      { ids: z.array(z.string()).min(1).max(50), confirm: CONFIRM },
      async (args) => {
        const ids = args.ids.filter((id) => z.uuid().safeParse(id).success);
        if (ids.length === 0) return no('Give the ids of the items to approve.');
        const { data: items } = await db
          .from('items')
          .select('id, status, kind, person, title, company')
          .in('id', ids);
        const waiting = (items ?? []).filter(
          (item) =>
            item.status === 'needs_approval' || (item.kind === 'job' && item.status === 'ready'),
        );
        if (waiting.length === 0) return no('None of those items is waiting for approval.');
        return preview(session, {
          tool: 'approve_items',
          input: { ids: waiting.map((item) => item.id) },
          title: `Approve ${waiting.length} ${waiting.length === 1 ? 'item' : 'items'}`,
          lines: waiting
            .slice(0, 8)
            .map((item) => [item.person ?? item.title, item.company].filter(Boolean).join(' - ')),
        });
      },
    ),
  ];
  return [...read, ...act];
}

async function setRequestStatus(db: Db, row: ChatMessageRow, status: 'done' | 'failed') {
  const content = (row.content ?? {}) as Record<string, Json | undefined>;
  await db
    .from('chat_messages')
    .update({ content: { ...content, status } as Json })
    .eq('id', row.id);
}

/** Answers one claimed chat question. Never throws. */
export async function answerChat(db: Db, config: WorkerConfig, row: ChatMessageRow): Promise<void> {
  const request = chatEntryFromRow(row);
  if (!request || request.role !== 'user' || !row.user_id) {
    await setRequestStatus(db, row, 'failed');
    return;
  }
  const userId = row.user_id;
  const cards: ChatCard[] = [];
  let text = '';
  let answerId: string | null = null;

  /** Writes the answer so far; the web app shows it as it grows. */
  const save = async () => {
    const content = {
      text: trimTo(redact(text), 6000),
      cards,
      reply_to: row.id,
    } as unknown as Json;
    if (answerId) {
      await db.from('chat_messages').update({ content }).eq('id', answerId);
      return;
    }
    const { data } = await db
      .from('chat_messages')
      .insert({ user_id: userId, role: 'assistant', content })
      .select('id')
      .single();
    answerId = data?.id ?? null;
  };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHAT_TIMEOUT_MS);
  const scratch = path.join(WORKER_ROOT, '.runs', `chat-${row.id}`);
  try {
    const [{ data: profile }, { data: earlier }] = await Promise.all([
      db.from('profiles').select('role').eq('id', userId).maybeSingle(),
      db
        .from('chat_messages')
        .select('*')
        .eq('user_id', userId)
        .lt('created_at', row.created_at)
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    const role: UserRole = profile?.role ?? 'viewer';
    const history = (earlier ?? [])
      .reverse()
      .map(chatEntryFromRow)
      .filter((entry): entry is ChatEntry => entry !== null);

    const tools = createChatTools({ db, userId, role, onCard: (card) => cards.push(card) });
    mkdirSync(scratch, { recursive: true });
    const conversation = query({
      prompt: chatPrompt(history, request.text),
      options: {
        model: config.claudeModel,
        systemPrompt: chatSystemPrompt(role),
        maxTurns: CHAT_TURNS,
        abortController: abort,
        cwd: scratch,
        mcpServers: {
          [SERVER]: createSdkMcpServer({ name: SERVER, version: '1.0.0', alwaysLoad: true, tools }),
        },
        strictMcpConfig: true,
        // the chat has no built-in tools at all: only the panel tools above
        tools: [],
        allowedTools: tools.map((entry) => `mcp__${SERVER}__${entry.name}`),
        permissionMode: 'dontAsk',
        settingSources: [],
        persistSession: false,
        stderr: () => undefined,
      },
    });

    let failed: string | null = null;
    for await (const message of conversation) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            text += (text ? '\n\n' : '') + block.text.trim();
          }
        }
        if (text) await save();
      } else if (message.type === 'result' && (message.subtype !== 'success' || message.is_error)) {
        failed =
          message.subtype === 'success'
            ? (message.result ?? 'unknown')
            : (message.errors?.[0] ?? message.subtype);
      }
    }
    if (failed && !text) throw new Error(failed);
    if (!text) text = 'Done.';
    await save();
    await setRequestStatus(db, row, 'done');
  } catch (error) {
    const reason = abort.signal.aborted ? 'it took too long' : errorMessage(error);
    logger.warn(`Chat ${row.id} failed: ${reason}`);
    text = text
      ? `${text}\n\n(I had to stop early: ${reason}.)`
      : `I could not answer that: ${claudeAccessHint(reason)}`;
    await save().catch(() => undefined);
    await setRequestStatus(db, row, 'failed').catch(() => undefined);
  } finally {
    clearTimeout(timer);
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Turns the usual Claude access problems into one plain sentence. */
export function claudeAccessHint(reason: string): string {
  if (/hit your|reached your|out of usage|usage limit|rate limit|429/i.test(reason)) {
    return "this computer's Claude plan has reached its usage limit for now. It resets by itself; try again later.";
  }
  if (/log ?in|unauthor|401|invalid api key|oauth|credential|not logged/i.test(reason)) {
    return 'this computer is not signed in to Claude. Run "claude" on it once and log in, then try again.';
  }
  return `${reason}.`.replace(/\.\.$/, '.');
}

/** Claims and answers waiting chat questions, one at a time. */
export async function chatTick(db: Db, config: WorkerConfig, workerId: string): Promise<boolean> {
  const { data, error } = await db.rpc('claim_next_chat', { p_worker: workerId });
  if (error) throw new Error(error.message);
  if (!data || !data.id) return false;
  await answerChat(db, config, data);
  return true;
}
