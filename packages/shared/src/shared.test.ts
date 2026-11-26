import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_APPROVAL_MODES,
  BOT_CATALOG,
  GLOBAL_RULES,
  buildSeedSql,
  buildSystemPrompt,
  capStatus,
  capabilitiesFor,
  checkContactAllowed,
  costUsd,
  dedupeKey,
  defaultSettings,
  fieldsFromJsonSchema,
  isApprovalModeAllowed,
  isValidSchedule,
  limitSaveStatus,
  parseApplicantProfile,
  parseSettings,
  presetForCron,
  renderTemplate,
  SCHEDULE_PRESETS,
  settingsJsonSchema,
  startOfDay,
  templatePlaceholders,
  workableStatuses,
  type ContactCheckInput,
} from './index';

const bot = (slug: string) => {
  const found = BOT_CATALOG.find((entry) => entry.slug === slug);
  if (!found) throw new Error(`missing bot ${slug}`);
  return found;
};

describe('bot catalog', () => {
  it('has the eight bots from the spec, each with a unique slug', () => {
    expect(BOT_CATALOG.map((entry) => entry.slug).sort()).toEqual(
      [
        'candidate-finder',
        'hiring-post-leads',
        'job-apply',
        'job-scout',
        'linkedin-outreach',
        'market-positions',
        'marketplace-proposals',
        'network-drafts',
      ].sort(),
    );
  });

  it('starts every bot in an approval mode it is allowed to use', () => {
    for (const entry of BOT_CATALOG) {
      expect(isApprovalModeAllowed(entry.slug, entry.approvalMode), entry.slug).toBe(true);
      expect(ALLOWED_APPROVAL_MODES[entry.slug], entry.slug).toBeDefined();
    }
  });

  it('only uses placeholders that exist in the bot settings', () => {
    for (const entry of BOT_CATALOG) {
      const keys = new Set(entry.fields.map((field) => field.key));
      for (const placeholder of templatePlaceholders(entry.promptTemplate)) {
        const [scope, key] = placeholder.split('.');
        if (scope === 'settings')
          expect(keys.has(key!), `${entry.slug}: ${placeholder}`).toBe(true);
      }
    }
  });

  it('marks exactly the browser bots from the spec', () => {
    const browserBots = BOT_CATALOG.filter((entry) => entry.requiresBrowser).map((e) => e.slug);
    expect(browserBots.sort()).toEqual(
      [
        'candidate-finder',
        'job-apply',
        'linkedin-outreach',
        'marketplace-proposals',
        'network-drafts',
      ].sort(),
    );
  });
});

describe('settings schemas', () => {
  it('returns the spec defaults when given nothing', () => {
    const result = parseSettings(bot('market-positions').fields, {});
    expect(result).toEqual({
      ok: true,
      settings: {
        role: 'Enterprise Sales Director',
        region: 'United Kingdom',
        workplace: 'Any',
        seniority: 'Any',
        count: 20,
        posted_within_days: '14',
      },
    });
  });

  it('every bot accepts its own defaults, except where a required field is empty', () => {
    for (const entry of BOT_CATALOG) {
      const result = parseSettings(entry.fields, defaultSettings(entry.fields));
      if (entry.slug === 'candidate-finder') {
        // role_title and job_url have no default: the user must fill them in.
        expect(result.ok).toBe(false);
      } else {
        expect(result.ok, entry.slug).toBe(true);
      }
    }
  });

  it('rejects values outside the allowed range or options', () => {
    const fields = bot('market-positions').fields;
    expect(parseSettings(fields, { count: 500 }).ok).toBe(false);
    expect(parseSettings(fields, { count: 2 }).ok).toBe(false);
    expect(parseSettings(fields, { region: 'Mars' }).ok).toBe(false);
    expect(parseSettings(fields, { role: '   ' }).ok).toBe(false);
  });

  it('drops unknown keys', () => {
    const result = parseSettings(bot('market-positions').fields, { hack: 'x', count: 10 });
    expect(result.ok && 'hack' in result.settings).toBe(false);
  });

  it('keeps locked fields at their default whatever is sent', () => {
    const result = parseSettings(bot('linkedin-outreach').fields, { only_first_time: false });
    expect(result.ok && result.settings.only_first_time).toBe(true);
  });

  it('never lets LinkedIn settings exceed the hard limits', () => {
    const fields = bot('linkedin-outreach').fields;
    expect(parseSettings(fields, { max_messages: 21 }).ok).toBe(false);
    expect(parseSettings(fields, { spacing_minutes: 1 }).ok).toBe(false);
  });

  it('requires a real link for the candidate finder', () => {
    const fields = bot('candidate-finder').fields;
    const base = { role_title: 'Enterprise Sales Director' };
    expect(parseSettings(fields, { ...base, job_url: 'not a link' }).ok).toBe(false);
    expect(parseSettings(fields, { ...base, job_url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(parseSettings(fields, { ...base, job_url: 'https://example.com/job/1' }).ok).toBe(true);
  });

  it('checks salary ranges are in order', () => {
    const fields = bot('job-apply').fields;
    expect(parseSettings(fields, { salary_senior_usd: [5000, 4000] }).ok).toBe(false);
    expect(parseSettings(fields, { salary_senior_usd: [4000, 5000] }).ok).toBe(true);
  });

  it('round-trips through the JSON Schema stored in the database', () => {
    for (const entry of BOT_CATALOG) {
      const schema = JSON.parse(JSON.stringify(settingsJsonSchema(entry.fields)));
      expect(schema.type).toBe('object');
      expect(fieldsFromJsonSchema(schema)).toEqual(entry.fields);
    }
  });

  it('builds a usable form from plain JSON Schema without hints', () => {
    const fields = fieldsFromJsonSchema({
      type: 'object',
      properties: {
        city: { type: 'string', default: 'Curitiba' },
        size: { type: 'string', enum: ['S', 'M'] },
        count: { type: 'integer', minimum: 1, maximum: 9, default: 3 },
        on: { type: 'boolean', default: true },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(fields.map((field) => field.kind)).toEqual([
      'text',
      'select',
      'number',
      'toggle',
      'tags',
    ]);
  });
});

describe('prompt rendering', () => {
  it('replaces settings and joins arrays with a comma', () => {
    const text = renderTemplate('Roles: {{settings.roles}} x{{ settings.count }}', {
      settings: { roles: ['CMO', 'Head of Growth'], count: 5 },
    });
    expect(text).toBe('Roles: CMO, Head of Growth x5');
  });

  it('renders unknown placeholders as nothing', () => {
    expect(renderTemplate('a{{settings.missing}}b{{nope}}c', { settings: {} })).toBe('abc');
  });

  it('puts the global rules first in every system prompt', () => {
    const entry = bot('market-positions');
    const prompt = buildSystemPrompt(entry.promptTemplate, {
      settings: defaultSettings(entry.fields),
      today: 'Thursday, 26 November 2026',
      worker: 'pichau-desktop',
    });
    expect(prompt.startsWith(GLOBAL_RULES)).toBe(true);
    expect(prompt).toContain('Enterprise Sales Director');
    expect(prompt).toContain('save_item');
    expect(prompt).not.toContain('{{');
  });

  it('keeps the eleven safety rules intact', () => {
    for (let rule = 1; rule <= 11; rule += 1)
      expect(GLOBAL_RULES).toMatch(new RegExp(`^${rule}\\.`, 'm'));
    expect(GLOBAL_RULES).toContain('company tax number (CNPJ)');
    expect(GLOBAL_RULES).toContain('Never solve, bypass or work around CAPTCHAs');
  });
});

describe('dedupe keys', () => {
  it('uses the lower-cased url without tracking parameters', () => {
    const a = dedupeKey({ kind: 'job', url: 'https://Jobs.Example.com/Role/1/?utm_source=x#top' });
    const b = dedupeKey({ kind: 'job', url: 'https://jobs.example.com/role/1' });
    expect(a).toBe(b);
  });

  it('keeps meaningful query parameters', () => {
    const a = dedupeKey({ kind: 'job', url: 'https://boards.example.com/jobs?id=1' });
    const b = dedupeKey({ kind: 'job', url: 'https://boards.example.com/jobs?id=2' });
    expect(a).not.toBe(b);
  });

  it('falls back to kind|company|title|person', () => {
    expect(dedupeKey({ kind: 'lead', company: ' Acme  Inc ', title: 'CMO', person: null })).toBe(
      'lead|acme inc|cmo|',
    );
  });
});

describe('approval mode gates', () => {
  it('never saves an item as approved, sent or applied', () => {
    expect(limitSaveStatus('sent', 'approve_each')).toBe('needs_approval');
    expect(limitSaveStatus('applied', 'auto_within_rules')).toBe('needs_approval');
    expect(limitSaveStatus('approved', 'approve_each')).toBe('needs_approval');
  });

  it('keeps draft-only bots out of the approval queue', () => {
    expect(limitSaveStatus('needs_approval', 'draft_only')).toBe('found');
    expect(limitSaveStatus('sent', 'draft_only')).toBe('found');
    expect(limitSaveStatus(undefined, 'draft_only')).toBe('found');
    expect(limitSaveStatus('ready', 'draft_only')).toBe('ready');
  });

  it('only job-apply may use auto mode and linkedin-outreach must ask each time', () => {
    expect(isApprovalModeAllowed('job-apply', 'auto_within_rules')).toBe(true);
    expect(isApprovalModeAllowed('job-apply', 'draft_only')).toBe(false);
    expect(isApprovalModeAllowed('linkedin-outreach', 'auto_within_rules')).toBe(false);
    expect(isApprovalModeAllowed('linkedin-outreach', 'draft_only')).toBe(false);
    expect(isApprovalModeAllowed('candidate-finder', 'auto_within_rules')).toBe(false);
    expect(isApprovalModeAllowed('some-new-bot', 'auto_within_rules')).toBe(false);
  });

  it('job-apply picks up ready jobs only in auto mode', () => {
    expect(workableStatuses('job-apply', 'approve_each')).toEqual(['approved']);
    expect(workableStatuses('job-apply', 'auto_within_rules')).toEqual(['ready', 'approved']);
    expect(workableStatuses('linkedin-outreach', 'approve_each')).toEqual(['approved']);
  });
});

describe('contact gate (rules 5 and 6)', () => {
  const base: ContactCheckInput = {
    botSlug: 'linkedin-outreach',
    approvalMode: 'approve_each',
    currentStatus: 'approved',
    nextStatus: 'sent',
    itemUrl: 'https://www.linkedin.com/in/someone',
    usedToday: 0,
    dailyCap: 20,
    linkedinSentToday: 0,
    linkedinDailyCap: 20,
    linkedinAppliedToday: 0,
    secondsSinceLastLinkedinSend: null,
    spacingMinutes: 3,
  };

  it('lets linkedin-outreach send an approved item', () => {
    expect(checkContactAllowed(base)).toEqual({ allowed: true });
  });

  it('refuses items that are not approved', () => {
    for (const status of ['found', 'ready', 'needs_approval', 'skipped', 'needs_human'] as const) {
      expect(checkContactAllowed({ ...base, currentStatus: status }).allowed, status).toBe(false);
    }
  });

  it('refuses past the LinkedIn daily cap, and the setting cannot raise it above 20', () => {
    expect(checkContactAllowed({ ...base, linkedinSentToday: 20 }).allowed).toBe(false);
    expect(
      checkContactAllowed({ ...base, linkedinSentToday: 20, linkedinDailyCap: 500, dailyCap: 500 })
        .allowed,
    ).toBe(false);
    expect(
      checkContactAllowed({ ...base, linkedinSentToday: 5, linkedinDailyCap: 5 }).allowed,
    ).toBe(false);
  });

  it('refuses past the bot daily cap', () => {
    expect(checkContactAllowed({ ...base, usedToday: 20 }).allowed).toBe(false);
  });

  it('enforces spacing between LinkedIn messages, never below two minutes', () => {
    expect(checkContactAllowed({ ...base, secondsSinceLastLinkedinSend: 60 }).allowed).toBe(false);
    expect(checkContactAllowed({ ...base, secondsSinceLastLinkedinSend: 181 }).allowed).toBe(true);
    expect(
      checkContactAllowed({ ...base, spacingMinutes: 0, secondsSinceLastLinkedinSend: 90 }).allowed,
    ).toBe(false);
  });

  it('draft bots can never contact anyone', () => {
    for (const slug of ['candidate-finder', 'network-drafts', 'hiring-post-leads', 'job-scout']) {
      expect(checkContactAllowed({ ...base, botSlug: slug }).allowed, slug).toBe(false);
      expect(capabilitiesFor(slug).contactStatus).toBeNull();
    }
    expect(checkContactAllowed({ ...base, botSlug: 'unknown-bot' }).allowed).toBe(false);
  });

  it('job-apply applies to approved jobs, and to ready jobs only in auto mode', () => {
    const apply: ContactCheckInput = {
      ...base,
      botSlug: 'job-apply',
      nextStatus: 'applied',
      itemUrl: 'https://apply.workable.com/acme/j/1',
      dailyCap: 60,
    };
    expect(checkContactAllowed(apply).allowed).toBe(true);
    expect(checkContactAllowed({ ...apply, currentStatus: 'ready' }).allowed).toBe(false);
    expect(
      checkContactAllowed({ ...apply, currentStatus: 'ready', approvalMode: 'auto_within_rules' })
        .allowed,
    ).toBe(true);
    expect(checkContactAllowed({ ...apply, nextStatus: 'sent' }).allowed).toBe(false);
    expect(checkContactAllowed({ ...apply, usedToday: 60 }).allowed).toBe(false);
  });

  it('limits LinkedIn Easy Apply to 50 a day', () => {
    const apply: ContactCheckInput = {
      ...base,
      botSlug: 'job-apply',
      nextStatus: 'applied',
      dailyCap: 60,
      itemUrl: 'https://www.linkedin.com/jobs/view/1',
      linkedinAppliedToday: 50,
    };
    expect(checkContactAllowed(apply).allowed).toBe(false);
    expect(
      checkContactAllowed({ ...apply, itemUrl: 'https://apply.workable.com/acme/j/1' }).allowed,
    ).toBe(true);
  });

  it('reports used, cap and remaining', () => {
    expect(capStatus(12, 50)).toEqual({ used: 12, cap: 50, remaining: 38 });
    expect(capStatus(70, 50).remaining).toBe(0);
  });
});

describe('schedules', () => {
  it('recognises every preset from its cron', () => {
    for (const preset of SCHEDULE_PRESETS) {
      expect(presetForCron(preset.cron)?.id).toBe(preset.id);
      expect(isValidSchedule(preset.cron)).toBe(true);
    }
  });

  it('rejects text that is not a cron expression', () => {
    expect(isValidSchedule('every day')).toBe(false);
    expect(isValidSchedule('* * * *')).toBe(false);
    expect(isValidSchedule('')).toBe(false);
  });
});

describe('cost and time', () => {
  it('prices tokens from the table', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      24,
    );
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 500_000, outputTokens: 100_000 })).toBe(2);
  });

  it('starts the day at midnight in Sao Paulo', () => {
    // 02:30 UTC on 27 Nov is 23:30 on 26 Nov in Sao Paulo (UTC-3).
    const start = startOfDay(new Date('2026-11-27T02:30:00Z'));
    expect(start.toISOString()).toBe('2026-11-26T03:00:00.000Z');
  });
});

describe('applicant profile', () => {
  const valid = {
    full_name: 'Test Person',
    email_for_applications: 'test@example.com',
    phone: '+1 555 0100',
    address: '1 Test Street',
    linkedin: 'https://www.linkedin.com/in/test',
    current_role: 'CMO',
    experience_summary: '10 years',
    languages: ['English'],
    citizenship: ['Brazil'],
    work_model: 'Contractor',
    cv_path: './assets/cv.pdf',
  };

  it('accepts a complete profile', () => {
    expect(parseApplicantProfile(JSON.stringify(valid)).full_name).toBe('Test Person');
  });

  it('refuses a profile that carries a tax number or a password', () => {
    expect(() => parseApplicantProfile(JSON.stringify({ ...valid, cnpj: '00' }))).toThrow(/cnpj/);
    expect(() => parseApplicantProfile(JSON.stringify({ ...valid, password: 'x' }))).toThrow();
  });

  it('explains what is missing', () => {
    expect(() => parseApplicantProfile(JSON.stringify({ ...valid, phone: undefined }))).toThrow(
      /phone/,
    );
  });
});

describe('seed file', () => {
  it('is up to date with the catalog (run `pnpm seed:build` if this fails)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const onDisk = readFileSync(resolve(here, '../../../supabase/seed.sql'), 'utf8');
    expect(onDisk).toBe(buildSeedSql());
  });

  it('seeds eight bots and the global settings', () => {
    const sql = buildSeedSql();
    expect(sql.match(/insert into public\.bots/g)).toHaveLength(8);
    expect(sql).toContain('kill_switch');
    expect(sql).toContain('daily_spend_cap_usd');
    expect(sql).toContain('linkedin_daily_cap');
  });
});
