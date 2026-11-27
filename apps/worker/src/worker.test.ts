import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ItemRow } from '@fgv/shared';
import { loadConfig } from './config';
import { clip, redact, summarizeToolInput, toolLabel } from './log';
import { UsageMeter, allowedToolsFor, handleMessage } from './runner';
import { CATCH_UP_MS, isDue, lastDueTime } from './scheduler';
import { SHEET_HEADER, itemToSheetRow, planSheetSync } from './sheets';

describe('log redaction', () => {
  it('hides keys, tokens, cookies and passwords', () => {
    const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(30)}.${'b'.repeat(20)}`;
    const dirty = [
      'key sk-ant-api03-abcdefghijklmnop',
      'supabase sb_secret_abcdefghijklmnop',
      `bearer ${jwt}`,
      'Cookie: li_at=AQEDAR; JSESSIONID=ajax:123',
      'password=hunter2&next=1',
      '"token":"xyz987654"',
    ].join('\n');
    const clean = redact(dirty);
    for (const secret of ['abcdefghijklmnop', jwt, 'AQEDAR', 'hunter2', 'xyz987654']) {
      expect(clean, secret).not.toContain(secret);
    }
    expect(clean).toContain('next=1');
  });

  it('leaves ordinary text alone', () => {
    const text = 'Found 7 so far: Head of Growth at Acme (London)';
    expect(redact(text)).toBe(text);
  });

  it('summarises a tool call without the page or long text', () => {
    const summary = summarizeToolInput({
      url: 'https://example.com/jobs',
      text: 'x'.repeat(500),
      html: '<html>whole page</html>',
      fields: [{}, {}],
      password: 'hunter2',
    });
    expect(summary.url).toBe('https://example.com/jobs');
    expect(summary.text!.length).toBeLessThanOrEqual(160);
    expect(summary.fields).toBe('2 form fields');
    expect(JSON.stringify(summary)).not.toContain('whole page');
    expect(JSON.stringify(summary)).not.toContain('hunter2');
  });

  it('shortens long lines and tool names', () => {
    expect(clip('a  b\n c', 10)).toBe('a b c');
    expect(clip('x'.repeat(50), 10)).toHaveLength(10);
    expect(toolLabel('mcp__playwright__browser_click')).toBe('browser_click');
    expect(toolLabel('mcp__dashboard__save_item')).toBe('save_item');
  });
});

describe('tools per bot', () => {
  it('gives a web bot search, fetch and the dashboard, nothing else', () => {
    const tools = allowedToolsFor({ slug: 'market-positions', requires_browser: false });
    expect(tools.builtIn).toEqual(['WebSearch', 'WebFetch']);
    expect(tools.all).toContain('mcp__dashboard__save_item');
    expect(tools.all.some((name) => name.startsWith('mcp__playwright__'))).toBe(false);
    expect(tools.all).not.toContain('Bash');
  });

  it('gives a browser bot the browser tools', () => {
    const tools = allowedToolsFor({ slug: 'linkedin-outreach', requires_browser: true });
    expect(tools.builtIn).toEqual([]);
    expect(tools.all).toContain('mcp__playwright__browser_navigate');
    expect(tools.all).not.toContain('mcp__playwright__browser_evaluate');
  });
});

describe('run messages', () => {
  const events: { type: string; text: string }[] = [];
  const addEvent = async (type: string, text: string) => {
    events.push({ type, text });
  };
  // a cut-down SDK message with only the fields the worker reads
  const assistant = (id: string, content: unknown[], usage: Record<string, number>) =>
    ({ type: 'assistant', message: { id, content, usage } }) as unknown as SDKMessage;

  it('streams text as log and tool use as tool, and counts usage once per message', async () => {
    events.length = 0;
    const meter = new UsageMeter();
    await handleMessage(
      assistant('m1', [{ type: 'text', text: 'Searching Workable...' }], {
        input_tokens: 100,
        output_tokens: 10,
      }),
      meter,
      addEvent,
    );
    await handleMessage(
      assistant(
        'm1',
        [{ type: 'tool_use', name: 'WebFetch', input: { url: 'https://jobs.workable.com/api' } }],
        { input_tokens: 100, output_tokens: 40 },
      ),
      meter,
      addEvent,
    );
    await handleMessage(
      assistant(
        'm2',
        [{ type: 'tool_use', name: 'mcp__dashboard__log', input: { message: 'x' } }],
        {
          input_tokens: 50,
          output_tokens: 5,
        },
      ),
      meter,
      addEvent,
    );
    expect(events).toEqual([
      { type: 'log', text: 'Searching Workable...' },
      { type: 'tool', text: 'WebFetch' },
    ]);
    expect(meter.total()).toMatchObject({ inputTokens: 150, outputTokens: 45 });
  });

  it('trims long assistant text to 2,000 characters', async () => {
    events.length = 0;
    await handleMessage(
      assistant('m3', [{ type: 'text', text: 'y'.repeat(5000) }], {}),
      new UsageMeter(),
      addEvent,
    );
    expect(events[0]!.text).toHaveLength(2000);
  });

  it('reads the final result and its cost', async () => {
    const done = await handleMessage(
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Found 5 open roles.',
        total_cost_usd: 0.42,
      } as unknown as SDKMessage,
      new UsageMeter(),
      addEvent,
    );
    expect(done).toEqual({ ok: true, text: 'Found 5 open roles.', cost: 0.42 });

    const failed = await handleMessage(
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        total_cost_usd: 1,
        errors: [],
      } as unknown as SDKMessage,
      new UsageMeter(),
      addEvent,
    );
    expect(failed).toMatchObject({ ok: false });
    expect(failed!.text).toMatch(/step limit/);
  });
});

describe('scheduler', () => {
  // Sao Paulo is UTC-3 all year
  const at = (iso: string) => new Date(iso);

  it('fires at the scheduled minute in Sao Paulo time', () => {
    // "Every day 08:00" = 11:00 UTC
    expect(lastDueTime('0 8 * * *', at('2026-11-26T11:00:30Z'))?.toISOString()).toBe(
      '2026-11-26T11:00:00.000Z',
    );
    expect(isDue('0 8 * * *', at('2026-11-26T11:00:30Z'), null)).toBe(true);
    expect(isDue('0 8 * * *', at('2026-11-26T10:59:30Z'), null)).toBe(false);
  });

  it('does not fire twice for the same moment', () => {
    const lastRun = at('2026-11-26T11:00:05Z');
    expect(isDue('0 8 * * *', at('2026-11-26T11:01:00Z'), lastRun)).toBe(false);
  });

  it('fires again at the next moment', () => {
    const lastRun = at('2026-11-26T11:00:05Z');
    expect(isDue('0 */4 * * *', at('2026-11-26T15:00:10Z'), lastRun)).toBe(true);
  });

  it('catches up after a short outage but not after a long one', () => {
    const due = at('2026-11-26T11:00:00Z').getTime();
    expect(isDue('0 8 * * *', new Date(due + CATCH_UP_MS - 1000), null)).toBe(true);
    expect(isDue('0 8 * * *', new Date(due + CATCH_UP_MS + 60_000), null)).toBe(false);
  });

  it('does not fire the moment a schedule is switched on in the middle of an interval', () => {
    expect(isDue('0 */4 * * *', at('2026-11-26T13:30:00Z'), null)).toBe(false);
  });

  it('only fires "weekdays 09:00" on weekdays', () => {
    // 28 Nov 2026 is a Saturday, 30 Nov a Monday; 09:00 Sao Paulo = 12:00 UTC
    expect(isDue('0 9 * * 1-5', at('2026-11-28T12:00:20Z'), null)).toBe(false);
    expect(isDue('0 9 * * 1-5', at('2026-11-30T12:00:20Z'), null)).toBe(true);
  });

  it('handles "nights and weekends", which is two expressions', () => {
    const cron = '0 20,22,0,2,4,6 * * 1-5;0 */2 * * 0,6';
    // Thursday 22:00 Sao Paulo = Friday 01:00 UTC
    expect(isDue(cron, at('2026-11-27T01:00:10Z'), null)).toBe(true);
    // Thursday 14:00 Sao Paulo: working hours, nothing
    expect(isDue(cron, at('2026-11-26T17:00:10Z'), null)).toBe(false);
    // Saturday 14:00 Sao Paulo
    expect(isDue(cron, at('2026-11-28T17:00:10Z'), null)).toBe(true);
  });

  it('never fires for a manual bot or a broken expression', () => {
    expect(isDue(null, new Date(), null)).toBe(false);
    expect(isDue('not a cron', new Date(), null)).toBe(false);
  });
});

describe('worker settings', () => {
  const base = {
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    ANTHROPIC_API_KEY: 'test-key-000000',
    WORKER_NAME: 'pichau-desktop',
  };

  it('reads the .env values and fills in the defaults', () => {
    const config = loadConfig({ ...base, WORKER_HAS_BROWSER: 'true', WORKER_IS_SCHEDULER: 'TRUE' });
    expect(config).toMatchObject({
      workerName: 'pichau-desktop',
      maxConcurrency: 2,
      hasBrowser: true,
      hasDesktop: false,
      ownerEmail: null,
      isScheduler: true,
      claudeModel: 'claude-opus-5-5',
      claudeModelFast: 'claude-sonnet-5-5',
      sheets: null,
    });
    expect(config.browserProfileDir.endsWith('main')).toBe(true);
  });

  it('reads who the computer belongs to and whether it offers a full desktop', () => {
    const config = loadConfig({
      ...base,
      WORKER_HAS_DESKTOP: 'true',
      WORKER_OWNER_EMAIL: 'Chris@Example.com',
    });
    expect(config.hasDesktop).toBe(true);
    expect(config.ownerEmail).toBe('chris@example.com');
    expect(() => loadConfig({ ...base, WORKER_OWNER_EMAIL: 'not an email' })).toThrow();
  });

  it('treats a missing flag as false', () => {
    const config = loadConfig(base);
    expect(config.hasBrowser).toBe(false);
    expect(config.isScheduler).toBe(false);
  });

  it('says in plain words what is missing', () => {
    expect(() => loadConfig({})).toThrow(/WORKER_NAME|SUPABASE_URL/);
    expect(() => loadConfig({ ...base, WORKER_NAME: 'My Desktop!' })).toThrow(/lower-case/);
  });
});

describe('google sheet mirror', () => {
  const item = (partial: Partial<ItemRow>): ItemRow => ({
    id: 'id-1',
    bot_id: 'b',
    run_id: null,
    kind: 'candidate',
    status: 'needs_approval',
    title: 'Sales Director',
    company: 'Acme',
    person: 'Ana',
    url: 'https://www.linkedin.com/in/ana',
    location: null,
    pay: null,
    score: 80,
    fit_reason: 'Ten years in SaaS sales',
    draft: 'Hi Ana',
    notes: null,
    dedupe_key: 'k',
    acted_at: null,
    acted_by: null,
    created_at: '2026-11-26T12:00:00Z',
    updated_at: '2026-11-26T12:05:00Z',
    ...partial,
  });

  it('writes the twelve columns A-L in order', () => {
    const row = itemToSheetRow(item({}), 'Candidates');
    expect(row).toHaveLength(SHEET_HEADER.length);
    expect(row).toEqual([
      'id-1',
      '2026-11-26',
      'Candidates',
      'Candidate',
      'Acme',
      'Ana',
      'https://www.linkedin.com/in/ana',
      'Ten years in SaaS sales',
      'Hi Ana',
      'Waiting for approval',
      '',
      '2026-11-26T12:05:00Z',
    ]);
  });

  it('adds a new item once and updates it in place afterwards (no duplicate rows)', () => {
    const header = [[...SHEET_HEADER]];
    const first = planSheetSync(header, [{ item: item({}), channel: 'Candidates' }]);
    expect(first.updates).toHaveLength(0);
    expect(first.appends).toHaveLength(1);

    const sheet = [...header, first.appends[0]!];
    const second = planSheetSync(sheet, [
      { item: item({ status: 'approved' }), channel: 'Candidates' },
    ]);
    expect(second.appends).toHaveLength(0);
    expect(second.updates).toEqual([{ row: 2, values: expect.arrayContaining(['Approved']) }]);
  });

  it('matches by link even when the link differs in case or tracking', () => {
    const sheet = [[...SHEET_HEADER], itemToSheetRow(item({}), 'Candidates')];
    const plan = planSheetSync(sheet, [
      {
        item: item({ id: 'other-id', url: 'https://www.LinkedIn.com/in/ana/?utm_source=x' }),
        channel: 'Candidates',
      },
    ]);
    expect(plan.appends).toHaveLength(0);
    expect(plan.updates[0]!.row).toBe(2);
  });

  it('falls back to the id when there is no link', () => {
    const noLink = item({ url: null });
    const sheet = [[...SHEET_HEADER], itemToSheetRow(noLink, 'Leads')];
    const plan = planSheetSync(sheet, [
      { item: { ...noLink, status: 'skipped' }, channel: 'Leads' },
    ]);
    expect(plan.updates).toHaveLength(1);
  });

  it('keeps one row when the same link changes twice in one pass', () => {
    const plan = planSheetSync(
      [[...SHEET_HEADER]],
      [
        { item: item({}), channel: 'Candidates' },
        { item: item({ status: 'approved' }), channel: 'Candidates' },
      ],
    );
    expect(plan.appends).toHaveLength(1);
    expect(plan.appends[0]).toContain('Approved');
  });

  it('stops a cell from being run as a formula', () => {
    const row = itemToSheetRow(item({ company: '=IMPORTXML("http://evil")' }), 'Leads');
    expect(row[4]!.startsWith("'=")).toBe(true);
  });
});
