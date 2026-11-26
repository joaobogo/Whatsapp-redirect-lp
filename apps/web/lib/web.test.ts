import { describe, expect, it } from 'vitest';
import type { ChatMessageRow, ItemRow } from '@fgv/shared';
import type { Viewer } from '@/lib/auth';
import { chatSystemPrompt, entryFromRow, historyForModel, type ChatEntry } from '@/lib/chat';
import { isMutatingTool, runChatTool, toolsFor } from '@/lib/chat-tools';
import { csvCell, itemsToCsv } from '@/lib/csv';
import { parseItemFilters, readGlobalSettings, type Db } from '@/lib/data';
import { friendlyError } from '@/lib/errors';

const owner: Viewer = { id: 'u1', email: 'o@example.com', name: 'Owner', role: 'owner' };
const viewer: Viewer = { id: 'u2', email: 'v@example.com', name: 'Viewer', role: 'viewer' };

/** A database stand-in that fails the test if anything tries to write through it. */
const noWrites = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`The chat tool touched the database (${String(property)}) before Confirm`);
    },
  },
) as unknown as Db;

describe('chat tools', () => {
  it('gives viewers read-only tools', () => {
    const names = toolsFor(viewer).map((tool) => tool.name);
    expect(names.sort()).toEqual(['get_bot', 'get_status', 'list_bots', 'search_items']);
    expect(names.some(isMutatingTool)).toBe(false);
  });

  it('gives owners and operators every tool, each mutating one with a confirm flag', () => {
    const tools = toolsFor(owner);
    expect(tools).toHaveLength(10);
    for (const tool of tools.filter((entry) => isMutatingTool(entry.name))) {
      const schema = tool.input_schema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.properties?.confirm, tool.name).toBeDefined();
      expect(schema.required, tool.name).toContain('confirm');
    }
  });

  it('refuses a mutating tool for a viewer even if the model calls it', async () => {
    for (const name of ['start_bot', 'stop_all', 'approve_items', 'update_bot_settings']) {
      const outcome = await runChatTool(noWrites, viewer, name, { confirm: true });
      expect(outcome.kind === 'result' && outcome.isError, name).toBe(true);
    }
  });

  it('never executes an action from the model, even with confirm=true: it only previews', async () => {
    const outcome = await runChatTool(noWrites, owner, 'stop_all', { confirm: true });
    expect(outcome.kind).toBe('preview');
    if (outcome.kind === 'preview') {
      expect(outcome.action.tool).toBe('stop_all');
      expect(outcome.text).toMatch(/Nothing has happened yet/);
    }
  });

  it('rejects an unknown tool', async () => {
    const outcome = await runChatTool(noWrites, owner, 'drop_database', {});
    expect(outcome.kind === 'result' && outcome.isError).toBe(true);
  });
});

describe('chat history', () => {
  const row = (role: string, content: unknown, id = 'r1'): ChatMessageRow => ({
    id,
    user_id: 'u1',
    role,
    content: content as ChatMessageRow['content'],
    created_at: '2026-11-26T12:00:00Z',
  });

  it('reads stored rows and ignores anything malformed', () => {
    expect(entryFromRow(row('user', { text: 'hi' }))).toEqual({
      id: 'r1',
      role: 'user',
      text: 'hi',
    });
    expect(entryFromRow(row('assistant', { text: 'hello', cards: [] }))).toMatchObject({
      role: 'assistant',
    });
    expect(entryFromRow(row('user', 'just a string'))).toBeNull();
    expect(entryFromRow(row('system', { text: 'x' }))).toBeNull();
  });

  it('replays plain text only, starting with the user and merging neighbours', () => {
    const entries: ChatEntry[] = [
      { id: '0', role: 'assistant', text: 'orphan', cards: [] },
      { id: '1', role: 'user', text: 'run find positions' },
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
      { id: '4', role: 'user', text: 'thanks' },
    ];
    const messages = historyForModel(entries);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2]!.content).toContain('the user tapped Confirm');
    expect(messages[2]!.content).toContain('thanks');
  });

  it('tells the model the date, the time zone and what the user may do', () => {
    const prompt = chatSystemPrompt(viewer);
    expect(prompt).toContain('You are the FGV Control Panel assistant for John, Chris and Fabi.');
    expect(prompt).toContain('America/Sao_Paulo');
    expect(prompt).toMatch(/viewer/);
    expect(chatSystemPrompt(owner)).toMatch(/an owner/);
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
