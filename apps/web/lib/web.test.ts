import { describe, expect, it } from 'vitest';
import {
  MUTATING_CHAT_TOOLS,
  chatEntryFromRow,
  chatPrompt,
  chatSystemPrompt,
  isMutatingChatTool,
  type ChatEntry,
  type ItemRow,
  type PendingAction,
} from '@fgv/shared';
import type { Viewer } from '@/lib/auth';
import { confirmAction } from '@/lib/chat-tools';
import { csvCell, itemsToCsv } from '@/lib/csv';
import { parseItemFilters, readGlobalSettings, type Db } from '@/lib/data';
import { friendlyError } from '@/lib/errors';

const owner: Viewer = { id: 'u1', email: 'o@example.com', name: 'Owner', role: 'owner' };
const viewer: Viewer = { id: 'u2', email: 'v@example.com', name: 'Viewer', role: 'viewer' };

/** A database stand-in that fails the test if anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`The database was used (${String(property)})`);
    },
  },
) as unknown as Db;

describe('chat actions', () => {
  it('a viewer cannot confirm an action, even one saved in their own chat', async () => {
    for (const tool of ['start_bot', 'stop_all', 'approve_items', 'update_bot_settings'] as const) {
      const result = await confirmAction(untouchable, viewer, {
        tool,
        input: {},
        title: 'x',
        lines: [],
      });
      expect(result.ok, tool).toBe(false);
    }
  });

  it('checks a confirmed action again before running it', async () => {
    // inputs that do not fit the tool are refused before the database is touched
    const cases: [PendingAction['tool'], Record<string, unknown>][] = [
      ['start_bot', {}],
      ['stop_run', { run_id: 'not-a-uuid' }],
      ['set_bot_enabled', { slug: 'job-scout' }],
      ['update_bot_settings', { slug: 'job-scout', settings: 'oops' }],
      ['approve_items', { ids: [] }],
    ];
    for (const [tool, input] of cases) {
      const result = await confirmAction(untouchable, owner, {
        tool,
        input,
        title: 'x',
        lines: [],
      });
      expect(result, tool).toEqual({ ok: false, message: 'That action is no longer valid.' });
    }
  });
});

describe('chat history', () => {
  const row = (role: string, content: unknown, id = 'r1') => ({ id, role, content });

  it('reads stored rows and ignores anything malformed', () => {
    expect(chatEntryFromRow(row('user', { text: 'hi', status: 'waiting' }))).toEqual({
      id: 'r1',
      role: 'user',
      text: 'hi',
      status: 'waiting',
    });
    expect(chatEntryFromRow(row('user', { text: 'old message' }))).toMatchObject({
      status: 'done',
    });
    expect(chatEntryFromRow(row('assistant', { text: 'hello', cards: [] }))).toMatchObject({
      role: 'assistant',
    });
    expect(chatEntryFromRow(row('user', 'just a string'))).toBeNull();
    expect(chatEntryFromRow(row('system', { text: 'x' }))).toBeNull();
    // an action row for a tool that does not exist is not shown, so it can never be confirmed
    expect(
      chatEntryFromRow(row('action', { tool: 'drop_database', input: {}, title: 'x', lines: [] })),
    ).toBeNull();
  });

  it('replays plain text only, with notes for what the user confirmed', () => {
    const entries: ChatEntry[] = [
      { id: '1', role: 'user', text: 'run find positions', status: 'done' },
      { id: '2', role: 'assistant', text: 'Tap Confirm to start.', cards: [] },
      {
        id: '3',
        role: 'action',
        action: {
          tool: 'start_bot',
          input: {},
          title: 'Start Find positions in the market',
          lines: [],
          status: 'confirmed',
          result: 'Started Find positions in the market',
        },
      },
    ];
    const prompt = chatPrompt(entries, 'thanks, what is running now?');
    expect(prompt).toContain('User: run find positions');
    expect(prompt).toContain('Assistant: Tap Confirm to start.');
    expect(prompt).toContain('the user tapped Confirm');
    expect(prompt.trimEnd().endsWith('thanks, what is running now?')).toBe(true);
    expect(chatPrompt([], 'hello')).toBe("The user's new message:\nhello");
  });

  it('tells Claude the date, the time zone and what the user may do', () => {
    const prompt = chatSystemPrompt('viewer');
    expect(prompt).toContain('You are the FGV Control Panel assistant for John, Chris and Fabi.');
    expect(prompt).toContain('America/Sao_Paulo');
    expect(prompt).toMatch(/viewer/);
    expect(chatSystemPrompt('owner')).toMatch(/an owner/);
  });

  it('knows which chat tools change things', () => {
    expect(MUTATING_CHAT_TOOLS).toHaveLength(6);
    expect(isMutatingChatTool('stop_all')).toBe(true);
    expect(isMutatingChatTool('get_status')).toBe(false);
  });
});

describe('csv export', () => {
  const item: ItemRow = {
    id: 'i1',
    bot_id: 'b1',
    run_id: 'r1',
    kind: 'job',
    status: 'found',
    title: 'Head of Growth, EMEA',
    company: 'Acme "Labs"',
    person: null,
    url: 'https://example.com/jobs/1',
    location: 'London',
    pay: null,
    score: null,
    fit_reason: null,
    draft: 'line one\nline two',
    notes: '=HYPERLINK("http://evil","x")',
    dedupe_key: 'k',
    acted_at: null,
    acted_by: null,
    created_at: '2026-11-26T12:00:00Z',
    updated_at: '2026-11-26T12:00:00Z',
  };

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('stops cells from being run as spreadsheet formulas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+55 41 9999')).toBe("'+55 41 9999");
    expect(csvCell('@handle')).toBe("'@handle");
  });

  it('writes a header and one line per item', () => {
    const csv = itemsToCsv([item]);
    const [header, first] = csv.replace('﻿', '').split('\r\n');
    expect(header).toContain('Type,Status,Title,Company');
    expect(first).toContain('"Head of Growth, EMEA"');
    expect(first).toContain('"Acme ""Labs"""');
    expect(csv).toContain(`"'=HYPERLINK`);
  });
});

describe('result filters', () => {
  it('keeps known values and drops everything else', () => {
    expect(
      parseItemFilters({
        kind: 'job',
        status: 'applied',
        sort: 'score',
        from: '2026-11-01',
        to: '2026-11-26',
        q: '  growth  ',
      }),
    ).toMatchObject({
      kind: 'job',
      status: 'applied',
      sort: 'score',
      from: '2026-11-01',
      to: '2026-11-26',
      search: 'growth',
    });
    expect(
      parseItemFilters({
        kind: "job'; drop table items",
        status: 'nonsense',
        bot: 'not-a-uuid',
        from: 'yesterday',
        sort: 'random',
      }),
    ).toEqual({
      kind: undefined,
      status: undefined,
      botId: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
      sort: 'newest',
    });
  });
});

describe('global settings and errors', () => {
  it('reads settings rows with safe fallbacks', () => {
    expect(
      readGlobalSettings([
        { key: 'kill_switch', value: true },
        { key: 'daily_spend_cap_usd', value: 45 },
        { key: 'linkedin_daily_cap', value: 12 },
        { key: 'default_model', value: 'fast' },
      ]),
    ).toEqual({
      killSwitch: true,
      dailySpendCapUsd: 45,
      linkedinDailyCap: 12,
      defaultModel: 'fast',
    });
    expect(readGlobalSettings([])).toEqual({
      killSwitch: false,
      dailySpendCapUsd: 30,
      linkedinDailyCap: 20,
      defaultModel: 'opus',
    });
  });

  it('turns database errors into one plain sentence, never a stack trace', () => {
    expect(
      friendlyError({ code: '42501', message: 'new row violates row-level security' }),
    ).toMatch(/permission/);
    expect(friendlyError({ code: 'P0001', message: 'Daily spend cap reached' })).toBe(
      'Daily spend cap reached',
    );
    expect(friendlyError(new Error('fetch failed'))).toMatch(/connection/);
    expect(friendlyError({ code: 'XX000', message: 'internal: at pg_exec line 4' })).toBe(
      'Something went wrong. Try again.',
    );
    expect(friendlyError(null)).toBe('Something went wrong. Try again.');
  });
});
