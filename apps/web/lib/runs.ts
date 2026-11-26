import 'server-only';
import {
  fieldsFromJsonSchema,
  parseSettings,
  type BotRow,
  type BotSettings,
  type RunSource,
} from '@fgv/shared';
import { friendlyError } from '@/lib/errors';
import { getGlobalSettings, type Db } from '@/lib/data';

export interface CreateRunInput {
  slug: string;
  /** Values that differ from the bot's saved settings, for this run only. */
  overrides?: unknown;
  saveAsDefault?: boolean;
  source: Exclude<RunSource, 'schedule'>;
}

export type CreateRunResult =
  | { ok: true; runId: string; bot: BotRow; settings: BotSettings }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; status: number };

/**
 * Validates the settings with the bot's schema and resolves what would run.
 * Used for the chat preview card (no database write) and by createRun.
 */
export async function prepareRun(
  db: Db,
  input: Pick<CreateRunInput, 'slug' | 'overrides'>,
): Promise<
  | { ok: true; bot: BotRow; settings: BotSettings }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; status: number }
> {
  const { data: bot, error } = await db
    .from('bots')
    .select('*')
    .eq('slug', input.slug)
    .maybeSingle();
  if (error) return { ok: false, error: friendlyError(error), status: 500 };
  if (!bot) return { ok: false, error: 'That bot does not exist.', status: 404 };

  const overrides =
    input.overrides && typeof input.overrides === 'object' && !Array.isArray(input.overrides)
      ? (input.overrides as Record<string, unknown>)
      : {};
  const fields = fieldsFromJsonSchema(bot.settings_schema);
  const parsed = parseSettings(fields, { ...bot.settings, ...overrides });
  if (!parsed.ok) {
    return { ok: false, error: parsed.message, fieldErrors: parsed.errors, status: 400 };
  }
  return { ok: true, bot, settings: parsed.settings };
}

/**
 * Queues a run. The web app never runs a bot itself: it only writes a row to
 * the runs table and a worker picks it up (spec section 2).
 * The database refuses the insert for viewers, while the kill switch is on,
 * and past the daily spend cap; this function turns those into plain sentences.
 */
export async function createRun(db: Db, input: CreateRunInput): Promise<CreateRunResult> {
  const prepared = await prepareRun(db, input);
  if (!prepared.ok) return prepared;
  const { bot, settings } = prepared;

  const global = await getGlobalSettings(db);
  if (global.killSwitch) {
    return { ok: false, error: 'All bots are stopped. Press Resume first.', status: 409 };
  }

  if (input.saveAsDefault) {
    const { error } = await db.from('bots').update({ settings }).eq('id', bot.id);
    if (error) return { ok: false, error: friendlyError(error), status: 403 };
  }

  const { data: run, error } = await db
    .from('runs')
    .insert({ bot_id: bot.id, settings_snapshot: settings, source: input.source })
    .select('id')
    .single();
  if (error || !run) {
    const message = friendlyError(error, 'The run could not be started. Try again.');
    const status = error?.code === '42501' ? 403 : error?.code === 'P0001' ? 409 : 500;
    return { ok: false, error: message, status };
  }
  return { ok: true, runId: run.id, bot, settings };
}
