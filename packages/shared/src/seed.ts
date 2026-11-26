import { BOT_CATALOG, type BotDefinition } from './bots/catalog';
import { defaultSettings, settingsJsonSchema } from './bots/settings';
import { APP_SETTING_KEYS, APP_TIME_ZONE, type Json } from './types';

export interface BotSeedRow {
  slug: string;
  name: string;
  channel: string;
  description: string;
  prompt_template: string;
  settings_schema: Json;
  settings: Json;
  enabled: boolean;
  schedule_cron: string | null;
  daily_cap: number;
  approval_mode: string;
  model: string;
  requires_browser: boolean;
  max_turns: number;
  max_minutes: number;
}

export function botSeedRow(bot: BotDefinition): BotSeedRow {
  return {
    slug: bot.slug,
    name: bot.name,
    channel: bot.channel,
    description: bot.description,
    prompt_template: bot.promptTemplate,
    settings_schema: settingsJsonSchema(bot.fields),
    settings: defaultSettings(bot.fields) as Json,
    enabled: false,
    schedule_cron: bot.scheduleCron,
    daily_cap: bot.dailyCap,
    approval_mode: bot.approvalMode,
    model: bot.model,
    requires_browser: bot.requiresBrowser,
    max_turns: bot.maxTurns,
    max_minutes: bot.maxMinutes,
  };
}

export const DEFAULT_APP_SETTINGS: Record<string, Json> = {
  [APP_SETTING_KEYS.killSwitch]: false,
  [APP_SETTING_KEYS.dailySpendCapUsd]: 30,
  [APP_SETTING_KEYS.linkedinDailyCap]: 20,
  [APP_SETTING_KEYS.defaultModel]: 'opus',
  [APP_SETTING_KEYS.timeZone]: APP_TIME_ZONE,
};

const DOLLAR = String.fromCharCode(36);

/** Postgres dollar-quoting, so prompt text never needs escaping. */
function dollarQuote(text: string, tag: string): string {
  let marker = tag;
  while (text.includes(DOLLAR + marker + DOLLAR)) marker += 'x';
  return DOLLAR + marker + DOLLAR + text + DOLLAR + marker + DOLLAR;
}

function sqlText(value: string | null): string {
  return value === null ? 'null' : dollarQuote(value, 'txt');
}

function sqlJson(value: Json): string {
  return dollarQuote(JSON.stringify(value), 'json') + '::jsonb';
}

/** Builds supabase/seed.sql. Safe to run more than once. */
export function buildSeedSql(): string {
  const lines: string[] = [
    '-- GENERATED FILE - do not edit by hand.',
    '-- Source: packages/shared/src/bots/catalog.ts. Rebuild with: pnpm seed:build',
    '-- Safe to run again: existing bots keep their settings, schedule, caps and prompt.',
    '',
    '-- global settings (spec section 5)',
  ];
  for (const [key, value] of Object.entries(DEFAULT_APP_SETTINGS)) {
    lines.push(
      'insert into public.app_settings (key, value) values (' +
        sqlText(key) +
        ', ' +
        sqlJson(value) +
        ') on conflict (key) do nothing;',
    );
  }
  lines.push('', '-- the eight bots (spec section 7)');
  for (const bot of BOT_CATALOG) {
    const row = botSeedRow(bot);
    const flags = [
      String(row.enabled),
      sqlText(row.schedule_cron),
      String(row.daily_cap),
      "'" + row.approval_mode + "'",
      "'" + row.model + "'",
      String(row.requires_browser),
      String(row.max_turns),
      String(row.max_minutes),
    ].join(', ');
    lines.push(
      'insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)',
      'values (',
      '  ' + sqlText(row.slug) + ', ' + sqlText(row.name) + ', ' + sqlText(row.channel) + ',',
      '  ' + sqlText(row.description) + ',',
      '  ' + sqlText(row.prompt_template) + ',',
      '  ' + sqlJson(row.settings_schema) + ',',
      '  ' + sqlJson(row.settings) + ',',
      '  ' + flags,
      ')',
      'on conflict (slug) do update set',
      '  name = excluded.name, channel = excluded.channel, description = excluded.description,',
      '  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;',
      '',
    );
  }
  return lines.join('\n');
}
