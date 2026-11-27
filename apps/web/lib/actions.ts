'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  APPROVAL_MODES,
  APP_SETTING_KEYS,
  BOT_MODELS,
  HARD_LIMITS,
  ITEM_STATUSES,
  USER_ROLES,
  allowedApprovalModes,
  fieldsFromJsonSchema,
  isValidSchedule,
  parseSettings,
  type BotRow,
  type ItemStatus,
} from '@fgv/shared';
import { canOperate, getViewer } from '@/lib/auth';
import { fail, type ActionResult } from '@/lib/errors';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const NOT_ALLOWED = 'You can look but not change things. Ask an owner to make you an operator.';
const OWNER_ONLY = 'Only an owner can do that.';
const uuid = z.uuid();

async function operator() {
  const viewer = await getViewer();
  if (!viewer) return { error: 'Please log in again.' as const };
  if (!canOperate(viewer.role)) return { error: NOT_ALLOWED };
  return { viewer, db: await createClient() };
}

async function owner() {
  const viewer = await getViewer();
  if (!viewer) return { error: 'Please log in again.' as const };
  if (viewer.role !== 'owner') return { error: OWNER_ONLY };
  return { viewer, db: await createClient() };
}

// --- stop / resume ---------------------------------------------------------

export async function stopAllAction(): Promise<ActionResult> {
  const session = await operator();
  if ('error' in session) return fail(session.error);
  const { error } = await session.db.rpc('stop_all');
  if (error) return fail(error, 'Could not stop the bots. Try again.');
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function resumeAllAction(): Promise<ActionResult> {
  const session = await operator();
  if ('error' in session) return fail(session.error);
  const { error } = await session.db.rpc('resume_all');
  if (error) return fail(error, 'Could not resume. Try again.');
  revalidatePath('/', 'layout');
  return { ok: true };
}

// --- bots ------------------------------------------------------------------

const botPatchSchema = z.object({
  settings: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  schedule_cron: z.string().max(200).nullable().optional(),
  approval_mode: z.enum(APPROVAL_MODES).optional(),
  daily_cap: z.number().int().min(0).max(1000).optional(),
  model: z.enum(BOT_MODELS).optional(),
  preferred_worker: uuid.nullable().optional(),
  max_minutes: z.number().int().min(1).max(600).optional(),
  prompt_template: z.string().min(20).max(20000).optional(),
});

export type BotPatch = z.infer<typeof botPatchSchema>;

export async function updateBotAction(
  slug: string,
  patch: BotPatch,
): Promise<ActionResult & { fieldErrors?: Record<string, string> }> {
  const session = await operator();
  if ('error' in session) return fail(session.error);
  const parsed = botPatchSchema.safeParse(patch);
  if (!parsed.success) return fail('Some values are not valid. Check the form and try again.');

  const { data: bot } = await session.db.from('bots').select('*').eq('slug', slug).maybeSingle();
  if (!bot) return fail('That bot does not exist.');

  const update: Partial<BotRow> = {};
  const input = parsed.data;

  if (input.settings !== undefined) {
    const fields = fieldsFromJsonSchema(bot.settings_schema);
    const result = parseSettings(fields, { ...bot.settings, ...input.settings });
    if (!result.ok) return { ok: false, error: result.message, fieldErrors: result.errors };
    update.settings = result.settings;
  }
  if (input.schedule_cron !== undefined) {
    if (!isValidSchedule(input.schedule_cron)) return fail('That schedule is not valid.');
    update.schedule_cron = input.schedule_cron;
    // a bot with no schedule cannot have its schedule switched on
    if (input.schedule_cron === null) update.enabled = false;
  }
  if (input.enabled !== undefined) {
    const cron = update.schedule_cron !== undefined ? update.schedule_cron : bot.schedule_cron;
    if (input.enabled && !cron) return fail('Pick a schedule first, then switch it on.');
    update.enabled = input.enabled;
  }
  if (input.approval_mode !== undefined) {
    if (!allowedApprovalModes(bot.slug).includes(input.approval_mode)) {
      return fail('That approval mode is not allowed for this bot.');
    }
    update.approval_mode = input.approval_mode;
  }
  if (input.daily_cap !== undefined) {
    const linkedinLimit =
      bot.slug === 'linkedin-outreach' ? HARD_LIMITS.linkedinMessagesPerDay : 1000;
    update.daily_cap = Math.min(input.daily_cap, linkedinLimit);
  }
  if (input.model !== undefined) update.model = input.model;
  if (input.preferred_worker !== undefined) update.preferred_worker = input.preferred_worker;
  if (input.max_minutes !== undefined) update.max_minutes = input.max_minutes;
  if (input.prompt_template !== undefined) {
    if (session.viewer.role !== 'owner') return fail(OWNER_ONLY);
    update.prompt_template = input.prompt_template;
  }

  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await session.db.from('bots').update(update).eq('id', bot.id);
  if (error) return fail(error, 'Could not save. Try again.');
  revalidatePath('/', 'layout');
  return { ok: true };
}

// --- items -----------------------------------------------------------------

/** Statuses a person may set from the app. */
const HUMAN_STATUSES = ITEM_STATUSES;

const itemChangeSchema = z.object({
  ids: z.array(uuid).min(1).max(200),
  status: z.enum(HUMAN_STATUSES).optional(),
  draft: z.string().max(10000).optional(),
});

export async function updateItemsAction(input: {
  ids: string[];
  status?: ItemStatus;
  draft?: string;
}): Promise<ActionResult<{ changed: number }>> {
  const session = await operator();
  if ('error' in session) return fail(session.error);
  const parsed = itemChangeSchema.safeParse(input);
  if (!parsed.success) return fail('That change is not valid.');
  const { ids, status, draft } = parsed.data;
  if (status === undefined && draft === undefined) return { ok: true, data: { changed: 0 } };
  if (draft !== undefined && ids.length !== 1) return fail('Edit one draft at a time.');

  const update: { status?: ItemStatus; draft?: string } = {};
  if (status !== undefined) update.status = status;
  if (draft !== undefined) update.draft = draft;

  const { data, error } = await session.db.from('items').update(update).in('id', ids).select('id');
  if (error) return fail(error, 'Could not save the change. Try again.');
  revalidatePath('/', 'layout');
  return { ok: true, data: { changed: data?.length ?? 0 } };
}

// --- workers ---------------------------------------------------------------

/**
 * An app owner can change any computer and say whose it is. Anyone else can
 * pause their own computers and set how many runs they take - nothing more.
 * The database enforces the same rule (guard_workers).
 */
export async function updateWorkerAction(
  id: string,
  patch: { max_concurrency?: number; paused?: boolean; owner_id?: string | null },
): Promise<ActionResult> {
  const viewer = await getViewer();
  if (!viewer) return fail('Please log in again.');
  const parsed = z
    .object({
      id: uuid,
      max_concurrency: z.number().int().min(1).max(20).optional(),
      paused: z.boolean().optional(),
      owner_id: uuid.nullable().optional(),
    })
    .safeParse({ id, ...patch });
  if (!parsed.success) return fail('That value is not valid.');
  const { id: workerId, ...update } = parsed.data;

  const db = await createClient();
  const { data: worker } = await db
    .from('workers')
    .select('owner_id')
    .eq('id', workerId)
    .maybeSingle();
  if (!worker) return fail('That computer does not exist.');
  const isAppOwner = viewer.role === 'owner';
  if (!isAppOwner && worker.owner_id !== viewer.id) {
    return fail('You can only change your own computers.');
  }
  if (update.owner_id !== undefined && !isAppOwner) return fail(OWNER_ONLY);
  const session = { db };
  const { error } = await session.db.from('workers').update(update).eq('id', workerId);
  if (error) return fail(error, 'Could not save. Try again.');
  revalidatePath('/workers');
  return { ok: true };
}

// --- global settings -------------------------------------------------------

const globalSchema = z.object({
  dailySpendCapUsd: z.number().min(0).max(10000).optional(),
  linkedinDailyCap: z.number().int().min(0).max(HARD_LIMITS.linkedinMessagesPerDay).optional(),
  defaultModel: z.enum(BOT_MODELS).optional(),
});

export async function updateGlobalSettingsAction(
  input: z.infer<typeof globalSchema>,
): Promise<ActionResult> {
  const session = await owner();
  if ('error' in session) return fail(session.error);
  const parsed = globalSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      `That value is not valid. The LinkedIn cap can be at most ${HARD_LIMITS.linkedinMessagesPerDay}.`,
    );
  }
  const rows: { key: string; value: number | string }[] = [];
  if (parsed.data.dailySpendCapUsd !== undefined) {
    rows.push({ key: APP_SETTING_KEYS.dailySpendCapUsd, value: parsed.data.dailySpendCapUsd });
  }
  if (parsed.data.linkedinDailyCap !== undefined) {
    rows.push({ key: APP_SETTING_KEYS.linkedinDailyCap, value: parsed.data.linkedinDailyCap });
  }
  if (parsed.data.defaultModel !== undefined) {
    rows.push({ key: APP_SETTING_KEYS.defaultModel, value: parsed.data.defaultModel });
  }
  if (rows.length === 0) return { ok: true };
  const { error } = await session.db.from('app_settings').upsert(rows);
  if (error) return fail(error, 'Could not save. Try again.');
  revalidatePath('/', 'layout');
  return { ok: true };
}

// --- users -----------------------------------------------------------------

export async function setUserRoleAction(userId: string, role: string): Promise<ActionResult> {
  const session = await owner();
  if ('error' in session) return fail(session.error);
  const parsed = z.object({ userId: uuid, role: z.enum(USER_ROLES) }).safeParse({ userId, role });
  if (!parsed.success) return fail('That role is not valid.');
  const { error } = await session.db
    .from('profiles')
    .update({ role: parsed.data.role })
    .eq('id', parsed.data.userId);
  if (error) {
    return fail(
      /at least one owner/i.test(error.message)
        ? 'There must always be at least one owner.'
        : error,
    );
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function inviteUserAction(email: string): Promise<ActionResult> {
  const session = await owner();
  if ('error' in session) return fail(session.error);
  const parsed = z.email().safeParse(email.trim().toLowerCase());
  if (!parsed.success) return fail('That does not look like an email address.');
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.inviteUserByEmail(parsed.data);
    if (error) {
      if (/already/i.test(error.message)) return fail('That person already has an account.');
      return fail('The invite could not be sent. Check the email address and try again.');
    }
  } catch {
    return fail('Invites need the server key. Add SUPABASE_SERVICE_ROLE_KEY and try again.');
  }
  revalidatePath('/settings');
  return { ok: true };
}

export async function signOutAction(): Promise<void> {
  const db = await createClient();
  await db.auth.signOut();
  redirect('/login');
}
