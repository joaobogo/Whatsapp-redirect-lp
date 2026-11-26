import { describe, expect, it } from 'vitest';
import type { ApprovalMode, ItemRow, ItemStatus, RunEventType } from '@fgv/shared';
import {
  createToolHandlers,
  isLocked,
  notesWithoutLock,
  type ItemStore,
  type NewItem,
  type ToolBot,
} from './tools';

/** An in-memory stand-in for the database, so the rules can be tested on their own. */
class MemoryStore implements ItemStore {
  items: ItemRow[] = [];
  events: { type: RunEventType; message: string }[] = [];
  linkedinCap = 20;
  lastSend: Date | null = null;
  private next = 1;

  add(partial: Partial<ItemRow> & Pick<ItemRow, 'kind' | 'status'>): ItemRow {
    const id = `00000000-0000-0000-0000-${String(this.next++).padStart(12, '0')}`;
    const item: ItemRow = {
      id,
      bot_id: null,
      run_id: null,
      title: null,
      company: null,
      person: null,
      url: null,
      location: null,
      pay: null,
      score: null,
      fit_reason: null,
      draft: null,
      notes: null,
      dedupe_key: id,
      acted_at: null,
      acted_by: null,
      created_at: new Date(Date.now() + this.next).toISOString(),
      updated_at: new Date().toISOString(),
      ...partial,
    };
    this.items.push(item);
    return item;
  }

  async findByDedupeKey(key: string) {
    return this.items.find((item) => item.dedupe_key === key) ?? null;
  }
  async findById(id: string) {
    return this.items.find((item) => item.id === id) ?? null;
  }
  async insert(item: NewItem) {
    if (this.items.some((existing) => existing.dedupe_key === item.dedupe_key)) return null;
    return this.add(item);
  }
  async update(
    id: string,
    patch: Partial<ItemRow>,
    condition: { ifStatus: ItemStatus; ifUnlocked?: boolean },
  ) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item || item.status !== condition.ifStatus) return null;
    if (condition.ifUnlocked && isLocked(item.notes)) return null;
    if (patch.status === 'sent' || patch.status === 'applied') {
      item.acted_at = new Date().toISOString();
    }
    Object.assign(item, patch);
    return item;
  }
  async list(filter: {
    botId?: string;
    kinds?: string[];
    statuses?: string[];
    limit: number;
    oldestFirst: boolean;
  }) {
    const rows = this.items
      .filter((item) => !filter.botId || item.bot_id === filter.botId)
      .filter((item) => !filter.kinds || filter.kinds.includes(item.kind))
      .filter((item) => !filter.statuses || filter.statuses.includes(item.status))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return (filter.oldestFirst ? rows : rows.reverse()).slice(0, filter.limit);
  }
  async botActionsToday(botId: string) {
    return this.items.filter(
      (item) =>
        (item.acted_by ?? item.bot_id) === botId && ['sent', 'applied'].includes(item.status),
    ).length;
  }
  async linkedinSentToday() {
    return this.items.filter((item) => item.status === 'sent').length;
  }
  async linkedinAppliedToday() {
    return this.items.filter(
      (item) => item.status === 'applied' && (item.url ?? '').includes('linkedin.com'),
    ).length;
  }
  async lastLinkedinSendAt() {
    return this.lastSend;
  }
  async linkedinDailyCap() {
    return this.linkedinCap;
  }
  async addEvent(type: RunEventType, message: string) {
    this.events.push({ type, message });
  }
}

const BOTS: Record<string, ToolBot> = {
  finder: {
    id: 'bot-finder',
    slug: 'candidate-finder',
    approvalMode: 'approve_each',
    dailyCap: 20,
  },
  outreach: {
    id: 'bot-outreach',
    slug: 'linkedin-outreach',
    approvalMode: 'approve_each',
    dailyCap: 20,
    spacingMinutes: 3,
    priority: 'Candidates first',
  },
  scout: { id: 'bot-scout', slug: 'job-scout', approvalMode: 'draft_only', dailyCap: 20 },
  apply: { id: 'bot-apply', slug: 'job-apply', approvalMode: 'approve_each', dailyCap: 60 },
};

function setup(bot: ToolBot, worker = 'pichau-desktop') {
  const store = new MemoryStore();
  const handlers = createToolHandlers({ bot, runId: 'run-1', workerName: worker, store });
  return { store, handlers };
}

function withMode(bot: ToolBot, approvalMode: ApprovalMode): ToolBot {
  return { ...bot, approvalMode };
}

describe('save_item', () => {
  it('saves a new item and reports it is not a duplicate', async () => {
    const { store, handlers } = setup(BOTS.finder!);
    const reply = await handlers.saveItem({
      kind: 'candidate',
      person: 'Ana Souza',
      title: 'Sales Director',
      url: 'https://www.linkedin.com/in/ana',
      status: 'needs_approval',
      draft: 'Hi Ana',
      score: 82,
    });
    expect(reply).toMatchObject({ ok: true, data: { duplicate: false, status: 'needs_approval' } });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ bot_id: 'bot-finder', run_id: 'run-1', score: 82 });
    expect(store.events[0]?.type).toBe('item');
  });

  it('removes duplicates by url, ignoring case and tracking parameters', async () => {
    const { store, handlers } = setup(BOTS.scout!);
    await handlers.saveItem({ kind: 'job', title: 'CMO', url: 'https://jobs.example.com/1' });
    const again = await handlers.saveItem({
      kind: 'job',
      title: 'CMO',
      url: 'https://Jobs.Example.com/1/?utm_source=feed',
    });
    expect(again).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(store.items).toHaveLength(1);
  });

  it('never lets a bot save something as approved, sent or applied', async () => {
    const { handlers } = setup(BOTS.finder!);
    for (const status of ['approved', 'sent', 'applied'] as const) {
      const reply = await handlers.saveItem({ kind: 'candidate', person: `P ${status}`, status });
      expect(reply).toMatchObject({ ok: true, data: { status: 'needs_approval' } });
    }
  });

  it('keeps draft-only bots out of the approval queue', async () => {
    const { handlers } = setup(BOTS.scout!);
    const reply = await handlers.saveItem({ kind: 'job', title: 'CMO', status: 'needs_approval' });
    expect(reply).toMatchObject({ ok: true, data: { status: 'found' } });
  });

  it('does not overwrite an item a person already approved', async () => {
    const { store, handlers } = setup(BOTS.finder!);
    await handlers.saveItem({
      kind: 'candidate',
      person: 'Ana',
      url: 'https://www.linkedin.com/in/ana',
      draft: 'Original draft',
      status: 'needs_approval',
    });
    store.items[0]!.status = 'approved';
    const reply = await handlers.saveItem({
      kind: 'candidate',
      person: 'Ana',
      url: 'https://www.linkedin.com/in/ana',
      draft: 'A different draft',
      status: 'needs_approval',
    });
    expect(reply).toMatchObject({ ok: true, data: { duplicate: true, status: 'approved' } });
    expect(store.items[0]!.draft).toBe('Original draft');
  });

  it('drops links that are not web addresses', async () => {
    const { store, handlers } = setup(BOTS.scout!);
    await handlers.saveItem({
      kind: 'job',
      title: 'CMO',
      company: 'Acme',
      url: 'javascript:alert(1)',
    });
    expect(store.items[0]!.url).toBeNull();
  });

  it('needs something to identify the item', async () => {
    const { handlers } = setup(BOTS.scout!);
    expect((await handlers.saveItem({ kind: 'job' })).ok).toBe(false);
  });
});

describe('linkedin-outreach (rules 5 and 6)', () => {
  function outreach() {
    const context = setup(BOTS.outreach!);
    const approved = context.store.add({
      kind: 'candidate',
      status: 'approved',
      bot_id: 'bot-finder',
      person: 'Ana',
      draft: 'Hi Ana',
      url: 'https://www.linkedin.com/in/ana',
    });
    const waiting = context.store.add({
      kind: 'candidate',
      status: 'needs_approval',
      bot_id: 'bot-finder',
      person: 'Bruno',
      draft: 'Hi Bruno',
    });
    return { ...context, approved, waiting };
  }

  it('sends an approved item and records who acted', async () => {
    const { store, handlers, approved } = outreach();
    const reply = await handlers.updateItem({ id: approved.id, status: 'sent' });
    expect(reply).toMatchObject({ ok: true, data: { status: 'sent' } });
    expect(store.items[0]).toMatchObject({ status: 'sent', acted_by: 'bot-outreach' });
  });

  it('refuses items that are not approved', async () => {
    const { store, handlers, waiting } = outreach();
    const reply = await handlers.updateItem({ id: waiting.id, status: 'sent' });
    expect(reply.ok).toBe(false);
    expect(store.items[1]!.status).toBe('needs_approval');
  });

  it('only lists approved items', async () => {
    const { handlers, approved } = outreach();
    const reply = await handlers.getItems({});
    expect(reply.ok && reply.data.count).toBe(1);
    expect(reply.ok && (reply.data.items as { id: string }[])[0]?.id).toBe(approved.id);
  });

  it('refuses to send past the cap', async () => {
    const { store, handlers, approved } = outreach();
    for (let index = 0; index < 20; index += 1) {
      store.add({
        kind: 'candidate',
        status: 'sent',
        acted_by: 'bot-outreach',
        bot_id: 'bot-finder',
      });
    }
    const reply = await handlers.updateItem({ id: approved.id, status: 'sent' });
    expect(reply).toMatchObject({ ok: false });
    expect(store.items[0]!.status).toBe('approved');
    expect(await handlers.checkCap()).toMatchObject({ ok: true, data: { remaining: 0, cap: 20 } });
  });

  it('counts messages sent by any bot against the LinkedIn cap', async () => {
    const { store, handlers, approved } = outreach();
    store.linkedinCap = 2;
    store.add({ kind: 'candidate', status: 'sent', acted_by: 'someone-else' });
    store.add({ kind: 'candidate', status: 'sent', acted_by: 'someone-else' });
    expect((await handlers.updateItem({ id: approved.id, status: 'sent' })).ok).toBe(false);
  });

  it('never lets the LinkedIn cap go above 20, whatever the settings say', async () => {
    const context = setup({ ...BOTS.outreach!, dailyCap: 500 });
    context.store.linkedinCap = 500;
    expect(await context.handlers.checkCap()).toMatchObject({ ok: true, data: { cap: 20 } });
  });

  it('refuses a second message too soon after the last one', async () => {
    const { store, handlers, approved } = outreach();
    store.lastSend = new Date(Date.now() - 30_000);
    const reply = await handlers.updateItem({ id: approved.id, status: 'sent' });
    expect(reply.ok).toBe(false);
    store.lastSend = new Date(Date.now() - 4 * 60_000);
    expect((await handlers.updateItem({ id: approved.id, status: 'sent' })).ok).toBe(true);
  });

  it('cannot change a draft that was approved as written', async () => {
    const { store, handlers, approved } = outreach();
    const reply = await handlers.updateItem({ id: approved.id, draft: 'Buy now!!!' });
    expect(reply.ok).toBe(false);
    expect(store.items[0]!.draft).toBe('Hi Ana');
  });

  it('cannot approve anything itself', async () => {
    const { handlers, waiting } = outreach();
    expect((await handlers.updateItem({ id: waiting.id, status: 'approved' })).ok).toBe(false);
  });

  it('marks an existing thread needs_human instead of sending', async () => {
    const { store, handlers, approved } = outreach();
    const reply = await handlers.updateItem({
      id: approved.id,
      status: 'needs_human',
      notes: 'thread exists',
    });
    expect(reply.ok).toBe(true);
    expect(store.items[0]).toMatchObject({ status: 'needs_human', notes: 'thread exists' });
  });

  it('puts candidates first when asked', async () => {
    const context = setup(BOTS.outreach!);
    context.store.add({ kind: 'lead', status: 'approved', bot_id: 'x', person: 'Lead first' });
    context.store.add({ kind: 'candidate', status: 'approved', bot_id: 'x', person: 'Candidate' });
    const reply = await context.handlers.getItems({});
    const people = reply.ok ? (reply.data.items as { person: string }[]).map((i) => i.person) : [];
    expect(people).toEqual(['Candidate', 'Lead first']);
  });
});

describe('drafting bots never contact anyone', () => {
  it('candidate-finder cannot mark its own approved item sent', async () => {
    const { store, handlers } = setup(BOTS.finder!);
    const item = store.add({ kind: 'candidate', status: 'approved', bot_id: 'bot-finder' });
    const reply = await handlers.updateItem({ id: item.id, status: 'sent' });
    expect(reply.ok).toBe(false);
    expect(store.items[0]!.status).toBe('approved');
  });

  it('a bot cannot touch items of another bot it has no business with', async () => {
    const { store, handlers } = setup(BOTS.finder!);
    const other = store.add({ kind: 'job', status: 'ready', bot_id: 'bot-scout' });
    expect((await handlers.updateItem({ id: other.id, status: 'skipped' })).ok).toBe(false);
  });

  it('check_cap says so', async () => {
    const { handlers } = setup(BOTS.scout!);
    expect(await handlers.checkCap()).toMatchObject({ ok: true, data: { remaining: 0 } });
  });
});

describe('job-apply', () => {
  function jobs(mode: ApprovalMode) {
    const context = setup(withMode(BOTS.apply!, mode));
    const ready = context.store.add({
      kind: 'job',
      status: 'ready',
      bot_id: 'bot-scout',
      title: 'Head of Growth',
      notes: 'Posted 20 Nov',
      url: 'https://apply.workable.com/acme/j/1',
    });
    const approved = context.store.add({
      kind: 'job',
      status: 'approved',
      bot_id: 'bot-scout',
      title: 'CMO',
      url: 'https://boards.greenhouse.io/acme/jobs/2',
    });
    return { ...context, ready, approved };
  }

  it('in approve_each mode only applies to items John approved', async () => {
    const { handlers, ready, approved } = jobs('approve_each');
    const list = await handlers.getItems({});
    expect(list.ok && (list.data.items as { id: string }[]).map((item) => item.id)).toEqual([
      approved.id,
    ]);
    expect((await handlers.updateItem({ id: ready.id, status: 'applied' })).ok).toBe(false);
    expect((await handlers.updateItem({ id: approved.id, status: 'applied' })).ok).toBe(true);
  });

  it('in auto mode also applies to ready jobs, oldest first', async () => {
    const { handlers, ready, approved } = jobs('auto_within_rules');
    const list = await handlers.getItems({});
    expect(list.ok && (list.data.items as { id: string }[]).map((item) => item.id)).toEqual([
      ready.id,
      approved.id,
    ]);
    expect((await handlers.updateItem({ id: ready.id, status: 'applied' })).ok).toBe(true);
  });

  it('stops at the daily cap', async () => {
    const context = setup({ ...BOTS.apply!, dailyCap: 1 });
    const first = context.store.add({ kind: 'job', status: 'approved', bot_id: 'bot-scout' });
    const second = context.store.add({ kind: 'job', status: 'approved', bot_id: 'bot-scout' });
    expect((await context.handlers.updateItem({ id: first.id, status: 'applied' })).ok).toBe(true);
    expect((await context.handlers.updateItem({ id: second.id, status: 'applied' })).ok).toBe(
      false,
    );
    expect(await context.handlers.checkCap()).toMatchObject({
      ok: true,
      data: { used: 1, cap: 1, remaining: 0 },
    });
  });

  it('cannot mark a job sent (that is the LinkedIn sender only)', async () => {
    const { handlers, approved } = jobs('approve_each');
    expect((await handlers.updateItem({ id: approved.id, status: 'sent' })).ok).toBe(false);
  });

  it('locks an item so two computers never apply to the same job', async () => {
    const { store, handlers, approved } = jobs('approve_each');
    expect(await handlers.updateItem({ id: approved.id, lock: true })).toMatchObject({
      ok: true,
      data: { locked: true },
    });
    expect(store.items[1]!.notes).toBe('in progress by pichau-desktop');

    const other = createToolHandlers({
      bot: BOTS.apply!,
      runId: 'run-2',
      workerName: 'windows',
      store,
    });
    expect(await other.updateItem({ id: approved.id, lock: true })).toMatchObject({
      ok: true,
      data: { locked: false },
    });
    const visible = await other.getItems({});
    expect(visible.ok && visible.data.count).toBe(0);
  });

  it('keeps the earlier notes through a lock', async () => {
    const { store, handlers, ready } = jobs('auto_within_rules');
    await handlers.updateItem({ id: ready.id, lock: true });
    expect(store.items[0]!.notes).toBe('in progress by pichau-desktop || Posted 20 Nov');
    await handlers.updateItem({ id: ready.id, status: 'applied' });
    expect(store.items[0]).toMatchObject({ status: 'applied', notes: 'Posted 20 Nov' });
  });

  it('records the exact question when a person is needed', async () => {
    const { store, handlers, approved } = jobs('approve_each');
    await handlers.updateItem({ id: approved.id, lock: true });
    await handlers.updateItem({
      id: approved.id,
      status: 'needs_human',
      notes: 'Form asks: salary history for the last 3 roles',
    });
    expect(store.items[1]).toMatchObject({
      status: 'needs_human',
      notes: 'Form asks: salary history for the last 3 roles',
    });
  });
});

describe('lock notes', () => {
  it('detects and strips the lock marker', () => {
    expect(isLocked('in progress by windows')).toBe(true);
    expect(isLocked('Posted 20 Nov')).toBe(false);
    expect(notesWithoutLock('in progress by windows')).toBeNull();
    expect(notesWithoutLock('in progress by windows || Posted 20 Nov')).toBe('Posted 20 Nov');
    expect(notesWithoutLock('Posted 20 Nov')).toBe('Posted 20 Nov');
  });
});

describe('log', () => {
  it('writes a progress line and hides secrets', async () => {
    const { store, handlers } = setup(BOTS.scout!);
    await handlers.log({ message: 'Found 7 so far' });
    await handlers.log({ message: 'token=abc123456789 leaked' });
    expect(store.events[0]).toEqual({ type: 'log', message: 'Found 7 so far' });
    expect(store.events[1]!.message).not.toContain('abc123456789');
  });
});
