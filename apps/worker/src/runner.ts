import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  query,
  type HookCallback,
  type McpServerConfig,
  type Options,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  APP_SETTING_KEYS,
  HARD_LIMITS,
  addUsage,
  buildSystemPrompt,
  capabilitiesFor,
  costUsd,
  profileForPrompt,
  todayLabel,
  type BotRow,
  type BotSettings,
  type RunRow,
  type RunStatus,
  type TokenUsage,
} from '@fgv/shared';
import { ALLOWED_BROWSER_TOOLS, PLAYWRIGHT_SERVER, playwrightServerConfig } from './browser';
import { WORKER_ROOT, loadApplicantProfile, type WorkerConfig } from './config';
import type { Db } from './db';
import { ToolGuard } from './guard';
import { errorMessage, logger, redact, summarizeToolInput, toolLabel, trimTo } from './log';
import { createItemStore } from './store';
import {
  DASHBOARD_SERVER,
  DASHBOARD_TOOLS,
  createDashboardServer,
  createToolHandlers,
} from './tools';

const STOP_POLL_MS = 10_000;
const COST_FLUSH_MS = 20_000;

/** Built-in tools that must never be available to a bot, whatever else changes. */
const NEVER_TOOLS = [
  'Bash',
  'PowerShell',
  'Write',
  'Edit',
  'NotebookEdit',
  'Read',
  'Glob',
  'Grep',
  'Agent',
  'Skill',
  'Workflow',
  'TodoWrite',
  'CronCreate',
  'RemoteTrigger',
];

export type RunOutcome = Extract<RunStatus, 'succeeded' | 'failed' | 'stopped'>;

/** Which tools a bot may call: its web tools, the dashboard tools and, for browser bots, the browser. */
export function allowedToolsFor(bot: Pick<BotRow, 'slug' | 'requires_browser'>): {
  builtIn: string[];
  all: string[];
} {
  const capabilities = capabilitiesFor(bot.slug);
  const builtIn = [
    ...(capabilities.webSearch ? ['WebSearch'] : []),
    ...(capabilities.webFetch ? ['WebFetch'] : []),
  ];
  return {
    builtIn,
    all: [...builtIn, ...DASHBOARD_TOOLS, ...(bot.requires_browser ? ALLOWED_BROWSER_TOOLS : [])],
  };
}

function numberSetting(settings: BotSettings, key: string): number | undefined {
  const value = settings[key];
  return typeof value === 'number' ? value : undefined;
}

interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

function toTokenUsage(usage: UsageLike | null | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

/** Sums usage per API message (the SDK repeats a message's usage on each of its blocks). */
export class UsageMeter {
  private readonly byMessage = new Map<string, TokenUsage>();

  record(messageId: string, usage: UsageLike | null | undefined): void {
    this.byMessage.set(messageId, toTokenUsage(usage));
  }

  total(): TokenUsage {
    let total: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    for (const usage of this.byMessage.values()) total = addUsage(total, usage);
    return total;
  }
}

export interface RunDeps {
  db: Db;
  config: WorkerConfig;
  workerId: string;
}

/**
 * Runs one claimed run to the end: builds the prompt, starts the Agent SDK
 * query, streams every message to run_events, enforces the safety rules on
 * every tool call, tracks cost, and honours Stop, the kill switch and the
 * time limit. Never throws: the outcome is always written to the run row.
 */
export async function executeRun(deps: RunDeps, run: RunRow): Promise<RunOutcome> {
  const { db, config } = deps;
  const store = createItemStore(db, run.id);
  let outcome: RunOutcome = 'failed';
  let summary: string | null = null;
  let failure: string | null = null;
  const meter = new UsageMeter();
  let model = config.claudeModel;
  let finalCost: number | null = null;
  const scratch = path.join(WORKER_ROOT, '.runs', run.id);
  const abort = new AbortController();
  let abortReason: 'stop' | 'kill' | 'timeout' | null = null;
  const timers: NodeJS.Timeout[] = [];
  let channel: ReturnType<Db['channel']> | null = null;

  const stopWith = (reason: NonNullable<typeof abortReason>) => {
    if (abortReason) return;
    abortReason = reason;
    abort.abort();
  };

  const flushCost = async () => {
    const usage = meter.total();
    await db
      .from('runs')
      .update({
        input_tokens:
          usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
        output_tokens: usage.outputTokens,
        cost_usd: finalCost ?? costUsd(model, usage),
      })
      .eq('id', run.id);
  };

  try {
    const { data: bot } = await db.from('bots').select('*').eq('id', run.bot_id).maybeSingle();
    if (!bot) throw new Error('The bot for this run no longer exists.');
    model = bot.model === 'fast' ? config.claudeModelFast : config.claudeModel;
    const settings = (run.settings_snapshot ?? {}) as BotSettings;
    const capabilities = capabilitiesFor(bot.slug);

    // --- before starting: spend cap (spec 8.1) ---
    const [{ data: spent }, { data: capRow }, { data: linkedinRow }] = await Promise.all([
      db.rpc('spend_today'),
      db
        .from('app_settings')
        .select('value')
        .eq('key', APP_SETTING_KEYS.dailySpendCapUsd)
        .maybeSingle(),
      db
        .from('app_settings')
        .select('value')
        .eq('key', APP_SETTING_KEYS.linkedinDailyCap)
        .maybeSingle(),
    ]);
    const spendCap = Number(capRow?.value ?? 30);
    const spentToday = Number(spent ?? 0);
    if (Number.isFinite(spendCap) && spentToday >= spendCap) {
      throw new Error('Daily spend cap reached');
    }

    // --- applicant profile, only for the bots that fill in applications ---
    let profileText: string | undefined;
    if (capabilities.usesProfile) {
      const loaded = loadApplicantProfile(config);
      if (!loaded.ok) throw new Error(loaded.reason);
      profileText = profileForPrompt(loaded.value.profile, {
        cv: loaded.value.cvPath,
        photo: loaded.value.photoPath,
      });
    }
    if (bot.requires_browser && !config.hasBrowser) {
      throw new Error('This computer has no browser for bots (WORKER_HAS_BROWSER is not true).');
    }

    const linkedinCap = Math.min(
      Number(linkedinRow?.value ?? HARD_LIMITS.linkedinMessagesPerDay) || 0,
      HARD_LIMITS.linkedinMessagesPerDay,
    );
    const systemPrompt = buildSystemPrompt(bot.prompt_template, {
      settings,
      profile: profileText,
      worker: config.workerName,
      today: todayLabel(),
      caps: { linkedin_daily_cap: linkedinCap },
    });

    // --- tools ---
    const handlers = createToolHandlers({
      bot: {
        id: bot.id,
        slug: bot.slug,
        approvalMode: bot.approval_mode,
        dailyCap: bot.daily_cap,
        spacingMinutes: numberSetting(settings, 'spacing_minutes'),
        priority: typeof settings.priority === 'string' ? settings.priority : undefined,
      },
      runId: run.id,
      workerName: config.workerName,
      store,
    });
    mkdirSync(scratch, { recursive: true });
    const mcpServers: Record<string, McpServerConfig> = {
      [DASHBOARD_SERVER]: createDashboardServer(handlers),
    };
    if (bot.requires_browser) {
      mcpServers[PLAYWRIGHT_SERVER] = playwrightServerConfig(config.browserProfileDir, scratch);
    }
    const tools = allowedToolsFor(bot);
    const guard = new ToolGuard({
      allowedTools: tools.all,
      uploadDir: capabilities.usesProfile ? config.assetsDir : null,
    });

    // Section 9 at tool level. A PreToolUse hook runs for every call, including
    // pre-approved ones (the permission callback would be skipped for those).
    const preToolUse: HookCallback = async (input) => {
      if (input.hook_event_name !== 'PreToolUse') return {};
      const decision = guard.check(input.tool_name, input.tool_input);
      if (decision.allow) return {};
      await store.addEvent('error', `Blocked by the safety rules: ${decision.reason}`, {
        tool: toolLabel(input.tool_name),
      });
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      };
    };
    const postToolUse: HookCallback = async (input) => {
      if (input.hook_event_name === 'PostToolUse') {
        guard.noteToolResult(input.tool_name, input.tool_response);
      }
      return {};
    };

    const options: Options = {
      model,
      systemPrompt,
      maxTurns: bot.max_turns,
      // stop spending once the day's cap would be passed
      maxBudgetUsd: Number.isFinite(spendCap) ? Math.max(0.05, spendCap - spentToday) : undefined,
      abortController: abort,
      cwd: scratch,
      mcpServers,
      strictMcpConfig: true,
      // only these built-in tools exist for the bot; everything else is removed
      tools: tools.builtIn,
      allowedTools: tools.all,
      disallowedTools: NEVER_TOOLS,
      // anything not pre-approved is denied without a prompt
      permissionMode: 'dontAsk',
      // ignore any Claude settings files on this computer
      settingSources: [],
      persistSession: false,
      hooks: {
        PreToolUse: [{ hooks: [preToolUse], onFailure: 'block' }],
        PostToolUse: [{ matcher: `mcp__${PLAYWRIGHT_SERVER}__.*`, hooks: [postToolUse] }],
      },
      stderr: () => undefined,
    };

    await db.from('runs').update({ status: 'running' }).eq('id', run.id).eq('status', 'claimed');
    await store.addEvent('log', `Started on ${config.workerName}`);

    // --- stop signals: Realtime, plus a 10 s poll as the fallback ---
    channel = db
      .channel(`run-stop:${run.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'runs', filter: `id=eq.${run.id}` },
        (payload) => {
          if ((payload.new as { status?: string }).status === 'stop_requested') stopWith('stop');
        },
      )
      .subscribe();
    timers.push(
      setInterval(() => {
        void (async () => {
          const [{ data: current }, { data: kill }] = await Promise.all([
            db.from('runs').select('status').eq('id', run.id).maybeSingle(),
            db
              .from('app_settings')
              .select('value')
              .eq('key', APP_SETTING_KEYS.killSwitch)
              .maybeSingle(),
          ]);
          if (kill?.value === true) stopWith('kill');
          else if (
            !current ||
            current.status === 'stop_requested' ||
            current.status === 'stopped'
          ) {
            stopWith('stop');
          }
        })().catch(() => undefined);
      }, STOP_POLL_MS),
      setTimeout(() => stopWith('timeout'), bot.max_minutes * 60_000),
      setInterval(() => void flushCost().catch(() => undefined), COST_FLUSH_MS),
    );

    // --- the run itself ---
    const conversation = query({
      prompt:
        'Start this run now. Save every result with save_item as you go, and end with the short summary.',
      options,
    });
    for await (const message of conversation) {
      const result = await handleMessage(message, meter, store.addEvent);
      if (result) {
        finalCost = result.cost;
        if (result.ok) {
          outcome = 'succeeded';
          summary = result.text;
        } else {
          failure = result.text;
        }
      }
    }
    if (outcome !== 'succeeded' && !failure) failure = 'The run ended without a result.';
  } catch (error) {
    failure = errorMessage(error);
  } finally {
    for (const timer of timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    if (channel) await db.removeChannel(channel).catch(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
  }

  // an abort always wins over whatever the SDK reported while stopping
  if (abortReason === 'timeout') {
    outcome = 'stopped';
    failure = 'Stopped: the time limit for this bot was reached.';
  } else if (abortReason) {
    outcome = 'stopped';
    failure = null;
  }

  try {
    if (outcome === 'failed') await store.addEvent('error', failure ?? 'The run failed.');
    else if (outcome === 'stopped') await store.addEvent('log', failure ?? 'Stopped.');
    else await store.addEvent('result', 'Finished.');
    await flushCost();
    await db
      .from('runs')
      .update({
        status: outcome,
        summary: summary ? trimTo(redact(summary), 1500) : null,
        error: outcome === 'succeeded' ? null : failure ? trimTo(failure, 500) : null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
  } catch (error) {
    logger.error(`Could not record the end of run ${run.id}`, error);
  }
  return outcome;
}

const FAILURE_TEXT: Record<string, string> = {
  error_max_turns: 'The bot reached its step limit before finishing.',
  error_max_budget_usd: 'Daily spend cap reached',
  error_during_execution: 'The bot stopped because of an error.',
  error_max_structured_output_retries: 'The bot could not produce a valid result.',
};

/**
 * Streams one SDK message to run_events (spec 8.1): assistant text as 'log'
 * (trimmed to 2,000 characters), tool use as 'tool' (name + short input
 * summary, never secrets). Returns the final result when the run ends.
 */
export async function handleMessage(
  message: SDKMessage,
  meter: UsageMeter,
  addEvent: (
    type: 'log' | 'tool' | 'error',
    text: string,
    data?: Record<string, unknown>,
  ) => Promise<void>,
): Promise<{ ok: boolean; text: string; cost: number | null } | null> {
  if (message.type === 'assistant') {
    meter.record(message.message.id, message.message.usage);
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        await addEvent('log', trimTo(redact(block.text), 2000));
      } else if (block.type === 'tool_use') {
        // the bot's own progress lines and saved items already write their own events
        if (block.name === `mcp__${DASHBOARD_SERVER}__log`) continue;
        await addEvent('tool', toolLabel(block.name), summarizeToolInput(block.input));
      }
    }
    return null;
  }
  if (message.type === 'result') {
    const cost = Number.isFinite(message.total_cost_usd) ? message.total_cost_usd : null;
    if (message.subtype === 'success') {
      return { ok: !message.is_error, text: message.result ?? '', cost };
    }
    const detail = message.errors?.[0];
    return {
      ok: false,
      text: FAILURE_TEXT[message.subtype] ?? (detail ? redact(detail) : 'The run failed.'),
      cost,
    };
  }
  return null;
}
