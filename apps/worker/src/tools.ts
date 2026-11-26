import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  HARD_LIMITS,
  ITEM_KINDS,
  ITEM_STATUSES,
  SETTLED_STATUSES,
  capStatus,
  capabilitiesFor,
  checkContactAllowed,
  dedupeKey,
  isLinkedinUrl,
  limitSaveStatus,
  workableStatuses,
  type ApprovalMode,
  type ItemKind,
  type ItemRow,
  type ItemStatus,
  type RunEventType,
} from '@fgv/shared';
import { clip, redact } from './log';

/**
 * The five in-process dashboard tools every bot gets (spec 8.2):
 * save_item, update_item, get_items, check_cap, log.
 *
 * The rules live in `createToolHandlers`, which only talks to an `ItemStore`.
 * That keeps them testable without a database (tools.test.ts) and means a bot
 * can never reach the database except through these checks.
 */

export interface ToolBot {
  id: string;
  slug: string;
  approvalMode: ApprovalMode;
  dailyCap: number;
  /** minutes between LinkedIn messages, from the bot's settings */
  spacingMinutes?: number;
  /** 'Candidates first' | 'Oldest first' */
  priority?: string;
}

export interface NewItem {
  bot_id: string;
  run_id: string;
  kind: ItemKind;
  status: ItemStatus;
  title: string | null;
  company: string | null;
  person: string | null;
  url: string | null;
  location: string | null;
  pay: string | null;
  score: number | null;
  fit_reason: string | null;
  draft: string | null;
  notes: string | null;
  dedupe_key: string;
}

export type ItemPatch = Partial<
  Pick<
    ItemRow,
    | 'status'
    | 'notes'
    | 'draft'
    | 'title'
    | 'company'
    | 'person'
    | 'location'
    | 'pay'
    | 'score'
    | 'fit_reason'
    | 'acted_by'
    | 'run_id'
  >
>;

export interface ItemStore {
  findByDedupeKey(key: string): Promise<ItemRow | null>;
  findById(id: string): Promise<ItemRow | null>;
  /** Returns null when another run saved the same dedupe key first. */
  insert(item: NewItem): Promise<ItemRow | null>;
  /**
   * Updates only while the item still has `ifStatus` (and, with `ifUnlocked`,
   * is not locked by a worker). Returns null when the condition did not hold.
   * Throws with the database's message when a rule in the database refuses.
   */
  update(
    id: string,
    patch: ItemPatch,
    condition: { ifStatus: ItemStatus; ifUnlocked?: boolean },
  ): Promise<ItemRow | null>;
  list(filter: {
    botId?: string;
    kinds?: ItemKind[];
    statuses?: ItemStatus[];
    limit: number;
    oldestFirst: boolean;
  }): Promise<ItemRow[]>;
  botActionsToday(botId: string): Promise<number>;
  linkedinSentToday(): Promise<number>;
  linkedinAppliedToday(): Promise<number>;
  lastLinkedinSendAt(): Promise<Date | null>;
  linkedinDailyCap(): Promise<number>;
  addEvent(type: RunEventType, message: string, data?: Record<string, unknown>): Promise<void>;
}

export interface ToolContext {
  bot: ToolBot;
  runId: string;
  workerName: string;
  store: ItemStore;
  now?: () => Date;
}

export const LOCK_PREFIX = 'in progress by ';

export function isLocked(notes: string | null): boolean {
  return (notes ?? '').startsWith(LOCK_PREFIX);
}

/** "in progress by pichau-desktop || original notes" -> "original notes" */
export function notesWithoutLock(notes: string | null): string | null {
  if (!isLocked(notes)) return notes;
  const rest = (notes ?? '').split(' || ').slice(1).join(' || ');
  return rest.length > 0 ? rest : null;
}

function lockNote(worker: string, previous: string | null): string {
  return previous ? `${LOCK_PREFIX}${worker} || ${previous}` : `${LOCK_PREFIX}${worker}`;
}

const cleanText = (value: string | undefined, max: number): string | null => {
  const text = (value ?? '').trim();
  return text.length === 0 ? null : text.slice(0, max);
};

/** Only real web links are stored; a "javascript:" link from a page never reaches the app. */
function cleanUrl(value: string | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

function itemName(item: Pick<ItemRow, 'title' | 'person' | 'company'>): string {
  const main = item.person ?? item.title ?? 'item';
  return item.company && item.company !== main ? `${main} - ${item.company}` : main;
}

export const saveItemShape = {
  kind: z.enum(ITEM_KINDS).describe('What this result is'),
  title: z.string().optional().describe('Job title, role, or project title'),
  company: z.string().optional(),
  person: z.string().optional().describe('Full name of the person, for candidates and leads'),
  url: z.string().optional().describe('Link to the posting, profile or project'),
  location: z.string().optional(),
  pay: z.string().optional().describe('Pay or budget exactly as stated on the page'),
  score: z.number().min(0).max(100).optional().describe('Fit score 0-100'),
  fit_reason: z.string().optional().describe('One or two sentences on why it fits'),
  draft: z.string().optional().describe('The message or proposal you wrote, if any'),
  notes: z.string().optional(),
  status: z
    .enum(ITEM_STATUSES)
    .optional()
    .describe('found, ready, needs_approval, needs_human, skipped or closed'),
};
const saveItemSchema = z.object(saveItemShape);
export type SaveItemArgs = z.infer<typeof saveItemSchema>;

export const updateItemShape = {
  id: z.string().describe('Item id from save_item or get_items'),
  status: z.enum(ITEM_STATUSES).optional(),
  notes: z.string().optional(),
  draft: z.string().optional(),
  lock: z
    .boolean()
    .optional()
    .describe(
      'true = claim this item before working on it. Returns locked=false if another computer has it.',
    ),
};
const updateItemSchema = z.object(updateItemShape);
export type UpdateItemArgs = z.infer<typeof updateItemSchema>;

export const getItemsShape = {
  kind: z.enum(ITEM_KINDS).optional(),
  status: z.enum(ITEM_STATUSES).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};
const getItemsSchema = z.object(getItemsShape);
export type GetItemsArgs = z.infer<typeof getItemsSchema>;

export type ToolReply = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const refuse = (error: string): ToolReply => ({ ok: false, error });

export function createToolHandlers(context: ToolContext) {
  const { bot, runId, workerName, store } = context;
  const now = context.now ?? (() => new Date());
  const capabilities = capabilitiesFor(bot.slug);

  /** May this bot touch this item at all? Its own, or one it is allowed to work on. */
  function inScope(item: ItemRow): boolean {
    if (item.bot_id === bot.id) return true;
    if (!capabilities.worksOn || !capabilities.worksOn.kinds.includes(item.kind)) return false;
    return workableStatuses(bot.slug, bot.approvalMode).includes(item.status);
  }

  async function saveItem(raw: SaveItemArgs): Promise<ToolReply> {
    const parsed = saveItemSchema.safeParse(raw);
    if (!parsed.success)
      return refuse('That item is not valid. Give at least a kind and a title, person or company.');
    const args = parsed.data;
    const title = cleanText(args.title, 300);
    const company = cleanText(args.company, 200);
    const person = cleanText(args.person, 200);
    const url = cleanUrl(args.url);
    if (!title && !company && !person && !url) {
      return refuse('Give the item a title, a person, a company or a link.');
    }

    const status = limitSaveStatus(args.status, bot.approvalMode);
    const key = dedupeKey({ kind: args.kind, url, company, title, person });
    const fields = {
      title,
      company,
      person,
      location: cleanText(args.location, 200),
      pay: cleanText(args.pay, 200),
      score: args.score === undefined ? null : Math.round(args.score),
      fit_reason: cleanText(args.fit_reason, 1000),
      draft: cleanText(args.draft, 8000),
      notes: cleanText(args.notes, 2000),
    };

    const existing = await store.findByDedupeKey(key);
    if (existing) return refreshDuplicate(existing, fields);

    const created = await store.insert({
      bot_id: bot.id,
      run_id: runId,
      kind: args.kind,
      status,
      url,
      dedupe_key: key,
      ...fields,
    });
    if (!created) {
      // another run saved the same thing a moment ago
      const again = await store.findByDedupeKey(key);
      if (again) return refreshDuplicate(again, fields);
      return refuse('The item could not be saved. Try once more.');
    }
    await store.addEvent('item', `Saved: ${clip(itemName(created), 160)}`, {
      item_id: created.id,
      kind: created.kind,
      status: created.status,
    });
    return { ok: true, data: { id: created.id, duplicate: false, status: created.status } };
  }

  /** Same item found again: fill in what is new, never touch a status a person or a sender set. */
  async function refreshDuplicate(
    existing: ItemRow,
    fields: Omit<ItemPatch, 'status' | 'acted_by' | 'run_id'>,
  ): Promise<ToolReply> {
    const untouched = { id: existing.id, duplicate: true, status: existing.status };
    if (existing.bot_id !== bot.id || SETTLED_STATUSES.includes(existing.status)) {
      return { ok: true, data: untouched };
    }
    const patch: ItemPatch = {};
    for (const [name, value] of Object.entries(fields) as [keyof typeof fields, unknown][]) {
      if (value !== null && value !== undefined && existing[name] !== value) {
        (patch as Record<string, unknown>)[name] = value;
      }
    }
    if (Object.keys(patch).length > 0) {
      await store.update(existing.id, patch, { ifStatus: existing.status });
    }
    return { ok: true, data: untouched };
  }

  async function updateItem(raw: UpdateItemArgs): Promise<ToolReply> {
    const parsed = updateItemSchema.safeParse(raw);
    if (!parsed.success) return refuse('Give the item id and what to change.');
    const args = parsed.data;
    const item = await store.findById(args.id);
    if (!item) return refuse('There is no item with that id.');
    if (!inScope(item)) {
      return refuse(
        `This bot may not change that item (it is '${item.status}' and belongs to another bot).`,
      );
    }

    // --- claim an item before working on it (spec 7.3) ---
    if (args.lock) {
      if (isLocked(item.notes)) {
        const mine = (item.notes ?? '').startsWith(`${LOCK_PREFIX}${workerName}`);
        return {
          ok: true,
          data: {
            id: item.id,
            locked: mine,
            note: mine ? 'already yours' : 'another computer has it',
          },
        };
      }
      const locked = await store.update(
        item.id,
        { notes: lockNote(workerName, item.notes) },
        { ifStatus: item.status, ifUnlocked: true },
      );
      return { ok: true, data: { id: item.id, locked: locked !== null } };
    }

    const patch: ItemPatch = {};
    const next = args.status;

    if (args.draft !== undefined) {
      if (item.status === 'approved') {
        return refuse('This draft was approved as written. It cannot be changed; send it exactly.');
      }
      patch.draft = cleanText(args.draft, 8000);
    }
    if (args.notes !== undefined) patch.notes = cleanText(args.notes, 2000);

    if (next !== undefined && next !== item.status) {
      if (next === 'approved') return refuse('Only a person can approve an item.');

      if (next === 'sent' || next === 'applied') {
        const lastSend = next === 'sent' ? await store.lastLinkedinSendAt() : null;
        const decision = checkContactAllowed({
          botSlug: bot.slug,
          approvalMode: bot.approvalMode,
          currentStatus: item.status,
          nextStatus: next,
          itemUrl: item.url,
          usedToday: await store.botActionsToday(bot.id),
          dailyCap: bot.dailyCap,
          linkedinSentToday: next === 'sent' ? await store.linkedinSentToday() : 0,
          linkedinDailyCap: await store.linkedinDailyCap(),
          linkedinAppliedToday:
            next === 'applied' && isLinkedinUrl(item.url) ? await store.linkedinAppliedToday() : 0,
          secondsSinceLastLinkedinSend: lastSend
            ? Math.max(0, (now().getTime() - lastSend.getTime()) / 1000)
            : null,
          spacingMinutes: bot.spacingMinutes,
        });
        if (!decision.allowed) return refuse(decision.reason);
        patch.acted_by = bot.id;
        patch.status = next;
      } else {
        patch.status = limitSaveStatus(next, bot.approvalMode);
      }
      // the item is done with: drop the "in progress" marker, keep the earlier notes
      if (patch.notes === undefined && isLocked(item.notes)) {
        patch.notes = notesWithoutLock(item.notes);
      }
    }

    if (Object.keys(patch).length === 0) {
      return { ok: true, data: { id: item.id, status: item.status, changed: false } };
    }

    let updated: ItemRow | null;
    try {
      updated = await store.update(item.id, patch, { ifStatus: item.status });
    } catch (failure) {
      // a database rule refused (approval, cap): pass its sentence on to the bot
      return refuse(
        failure instanceof Error ? failure.message : 'The database refused that change.',
      );
    }
    if (!updated)
      return refuse('The item changed while you were working on it. Call get_items again.');

    if (patch.status) {
      await store.addEvent('item', `${labelFor(patch.status)}: ${clip(itemName(updated), 160)}`, {
        item_id: updated.id,
        status: updated.status,
      });
    }
    return { ok: true, data: { id: updated.id, status: updated.status, changed: true } };
  }

  async function getItems(raw: GetItemsArgs): Promise<ToolReply> {
    const parsed = getItemsSchema.safeParse(raw ?? {});
    if (!parsed.success) return refuse('Those filters are not valid.');
    const args = parsed.data;
    const limit = args.limit ?? 20;
    let items: ItemRow[];

    if (capabilities.worksOn) {
      // a sender / applier: the items it is allowed to act on, oldest first
      const allowedStatuses = workableStatuses(bot.slug, bot.approvalMode);
      const statuses = args.status
        ? allowedStatuses.filter((status) => status === args.status)
        : allowedStatuses;
      const kinds = args.kind
        ? capabilities.worksOn.kinds.filter((kind) => kind === args.kind)
        : capabilities.worksOn.kinds;
      if (statuses.length === 0 || kinds.length === 0) {
        return { ok: true, data: { count: 0, items: [] } };
      }
      items = await store.list({ kinds, statuses, limit: 50, oldestFirst: true });
      // skip what another computer is working on
      items = items.filter(
        (item) =>
          !isLocked(item.notes) || (item.notes ?? '').startsWith(`${LOCK_PREFIX}${workerName}`),
      );
      if (bot.priority === 'Candidates first') {
        items = [
          ...items.filter((item) => item.kind === 'candidate'),
          ...items.filter((item) => item.kind !== 'candidate'),
        ];
      }
      items = items.slice(0, limit);
    } else {
      items = await store.list({
        botId: bot.id,
        kinds: args.kind ? [args.kind] : undefined,
        statuses: args.status ? [args.status] : undefined,
        limit,
        oldestFirst: false,
      });
    }

    return {
      ok: true,
      data: {
        count: items.length,
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          status: item.status,
          title: item.title,
          company: item.company,
          person: item.person,
          url: item.url,
          location: item.location,
          pay: item.pay,
          score: item.score,
          draft: item.draft,
          notes: item.notes,
        })),
      },
    };
  }

  async function checkCap(): Promise<ToolReply> {
    if (!capabilities.contactStatus || bot.approvalMode === 'draft_only') {
      return {
        ok: true,
        data: { ...capStatus(0, 0), note: 'This bot only drafts. It never contacts anyone.' },
      };
    }
    if (capabilities.contactStatus === 'sent') {
      const cap = Math.min(
        bot.dailyCap,
        await store.linkedinDailyCap(),
        HARD_LIMITS.linkedinMessagesPerDay,
      );
      return { ok: true, data: { ...capStatus(await store.linkedinSentToday(), cap) } };
    }
    return { ok: true, data: { ...capStatus(await store.botActionsToday(bot.id), bot.dailyCap) } };
  }

  async function log(raw: { message: string }): Promise<ToolReply> {
    const message = redact(clip(String(raw?.message ?? ''), 500));
    if (!message) return refuse('Give a message.');
    await store.addEvent('log', message);
    return { ok: true, data: { logged: true } };
  }

  return { saveItem, updateItem, getItems, checkCap, log };
}

function labelFor(status: ItemStatus): string {
  const labels: Record<ItemStatus, string> = {
    found: 'Found',
    ready: 'Ready',
    needs_approval: 'Waiting for approval',
    approved: 'Approved',
    sent: 'Sent',
    applied: 'Applied',
    skipped: 'Skipped',
    needs_human: 'Needs you',
    closed: 'Closed',
    error: 'Error',
  };
  return labels[status];
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;

function reply(result: ToolReply) {
  if (result.ok) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
  }
  return { content: [{ type: 'text' as const, text: `Refused: ${result.error}` }], isError: true };
}

export const DASHBOARD_SERVER = 'dashboard';
export const DASHBOARD_TOOLS = ['save_item', 'update_item', 'get_items', 'check_cap', 'log'].map(
  (name) => `mcp__${DASHBOARD_SERVER}__${name}`,
);

/** Wraps the handlers as the in-process MCP server the Agent SDK talks to. */
export function createDashboardServer(handlers: ToolHandlers) {
  const safely = async (work: () => Promise<ToolReply>) => {
    try {
      return reply(await work());
    } catch {
      return reply({
        ok: false,
        error: 'The dashboard could not be reached. Try again in a moment.',
      });
    }
  };
  return createSdkMcpServer({
    name: DASHBOARD_SERVER,
    version: '1.0.0',
    // keep the five tools in the prompt from the first turn (no tool search round-trip)
    alwaysLoad: true,
    tools: [
      tool(
        'save_item',
        'Save one result (job, lead, candidate, message draft, proposal). Removes duplicates. Returns { id, duplicate }.',
        saveItemShape,
        (args) => safely(() => handlers.saveItem(args)),
      ),
      tool(
        'update_item',
        "Change an item's status, notes or draft, or lock it before working on it. 'sent' and 'applied' are refused unless the item is approved and the daily cap allows it.",
        updateItemShape,
        (args) => safely(() => handlers.updateItem(args)),
      ),
      tool(
        'get_items',
        'List the items this bot may work on (for example approved drafts or ready jobs).',
        getItemsShape,
        (args) => safely(() => handlers.getItems(args)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'check_cap',
        'Returns { used, cap, remaining } for today. Call before anything that contacts a person or submits something.',
        {},
        () => safely(() => handlers.checkCap()),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'log',
        'Write one short progress line the user sees live, for example "Found 7 so far".',
        { message: z.string().describe('One short line') },
        (args) => safely(() => handlers.log(args)),
      ),
    ],
  });
}
