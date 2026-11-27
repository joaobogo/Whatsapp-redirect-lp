import 'server-only';
import { z } from 'zod';
import { fieldsFromJsonSchema, parseSettings, type BotRow, type PendingAction } from '@fgv/shared';
import type { Viewer } from '@/lib/auth';
import { canOperate } from '@/lib/auth';
import type { Db } from '@/lib/data';
import { friendlyError } from '@/lib/errors';
import { createRun } from '@/lib/runs';

/**
 * Runs the chat actions a user confirmed.
 *
 * Claude (on a worker) can only PROPOSE an action: it saves a preview card in
 * the user's chat. Nothing happens until the user taps Confirm, which lands
 * here - in the web app, with the user's own permissions.
 */

const slugSchema = z.string().min(1).max(80);
const inputs = {
  start_bot: z.object({
    slug: slugSchema,
    settings_overrides: z.record(z.string(), z.unknown()).optional(),
  }),
  stop_run: z.object({ run_id: z.uuid() }),
  stop_all: z.object({}),
  set_bot_enabled: z.object({ slug: slugSchema, enabled: z.boolean() }),
  update_bot_settings: z.object({ slug: slugSchema, settings: z.record(z.string(), z.unknown()) }),
  approve_items: z.object({ ids: z.array(z.uuid()).min(1).max(50) }),
};

async function findBot(db: Db, slug: string): Promise<BotRow | null> {
  const { data } = await db.from('bots').select('*').eq('slug', slug).maybeSingle();
  return data;
}

export interface ConfirmResult {
  ok: boolean;
  message: string;
  link?: { href: string; label: string };
}

/**
 * Executes an action the user confirmed. The action is re-read from the
 * database row it was stored in and every input is validated again, so a
 * tampered request cannot run something the user did not see.
 */
export async function confirmAction(
  db: Db,
  viewer: Viewer,
  action: PendingAction,
): Promise<ConfirmResult> {
  if (!canOperate(viewer.role)) {
    return { ok: false, message: 'You do not have permission to do that.' };
  }

  switch (action.tool) {
    case 'start_bot': {
      const parsed = inputs.start_bot.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const result = await createRun(db, {
        slug: parsed.data.slug,
        overrides: parsed.data.settings_overrides,
        source: 'chat',
      });
      if (!result.ok) return { ok: false, message: result.error };
      return {
        ok: true,
        message: `Started ${result.bot.name}`,
        link: { href: `/runs/${result.runId}`, label: 'Open run' },
      };
    }
    case 'stop_run': {
      const parsed = inputs.stop_run.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const { error: failure } = await db.rpc('request_stop', { p_run: parsed.data.run_id });
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: 'Stopping the run',
        link: { href: `/runs/${parsed.data.run_id}`, label: 'Open run' },
      };
    }
    case 'stop_all': {
      const { error: failure } = await db.rpc('stop_all');
      if (failure) return { ok: false, message: friendlyError(failure) };
      return { ok: true, message: 'All bots are stopping' };
    }
    case 'set_bot_enabled': {
      const parsed = inputs.set_bot_enabled.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return { ok: false, message: 'That bot does not exist.' };
      if (parsed.data.enabled && !bot.schedule_cron) {
        return { ok: false, message: 'Pick a schedule for this bot first.' };
      }
      const { error: failure } = await db
        .from('bots')
        .update({ enabled: parsed.data.enabled })
        .eq('id', bot.id);
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: `Schedule ${parsed.data.enabled ? 'on' : 'off'} for ${bot.name}`,
        link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
      };
    }
    case 'update_bot_settings': {
      const parsed = inputs.update_bot_settings.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const bot = await findBot(db, parsed.data.slug);
      if (!bot) return { ok: false, message: 'That bot does not exist.' };
      const checked = parseSettings(fieldsFromJsonSchema(bot.settings_schema), {
        ...bot.settings,
        ...parsed.data.settings,
      });
      if (!checked.ok) return { ok: false, message: checked.message };
      const { error: failure } = await db
        .from('bots')
        .update({ settings: checked.settings })
        .eq('id', bot.id);
      if (failure) return { ok: false, message: friendlyError(failure) };
      return {
        ok: true,
        message: `Saved the settings of ${bot.name}`,
        link: { href: `/bots/${bot.slug}`, label: 'Open bot' },
      };
    }
    case 'approve_items': {
      const parsed = inputs.approve_items.safeParse(action.input);
      if (!parsed.success) return { ok: false, message: 'That action is no longer valid.' };
      const { data, error: failure } = await db
        .from('items')
        .update({ status: 'approved' })
        .in('id', parsed.data.ids)
        .in('status', ['needs_approval', 'ready'])
        .select('id');
      if (failure) return { ok: false, message: friendlyError(failure) };
      const count = data?.length ?? 0;
      return {
        ok: count > 0,
        message:
          count > 0
            ? `Approved ${count} ${count === 1 ? 'item' : 'items'}`
            : 'Those items were no longer waiting for approval.',
        link: { href: '/approvals', label: 'Open approvals' },
      };
    }
  }
}
