import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';
import { parseApplicantProfile, type ApplicantProfile } from '@fgv/shared';

/** apps/worker */
export const WORKER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(WORKER_ROOT, '.env'), quiet: true });

const flag = z
  .string()
  .optional()
  .transform((value) => ['true', '1', 'yes'].includes((value ?? '').trim().toLowerCase()));

const envSchema = z.object({
  SUPABASE_URL: z.url('SUPABASE_URL must be the project URL (https://....supabase.co)'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY is missing'),
  // Optional. Leave both empty to use this computer's own Claude login (subscription).
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  // Model strings are never hard-coded outside env/config (spec section 3).
  CLAUDE_MODEL: z.string().min(1).default('claude-opus-5-5'),
  CLAUDE_MODEL_FAST: z.string().min(1).default('claude-sonnet-5-5'),
  WORKER_NAME: z
    .string()
    .min(1, 'WORKER_NAME is missing (for example pichau-desktop)')
    .max(40)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'WORKER_NAME may only use lower-case letters, numbers and dashes',
    ),
  WORKER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_HAS_BROWSER: flag,
  WORKER_HAS_DESKTOP: flag,
  WORKER_OWNER_EMAIL: z.union([z.literal(''), z.email()]).optional(),
  WORKER_IS_SCHEDULER: flag,
  BROWSER_PROFILE_DIR: z.string().default('./profiles/main'),
  APPLICANT_PROFILE_JSON: z.string().default('./assets/profile.json'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  SALES_QUEUE_SHEET_ID: z.string().optional(),
  SALES_QUEUE_TAB: z.string().default('John'),
});

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  claudeModel: string;
  claudeModelFast: string;
  /** how this computer reaches Claude */
  claudeAccess: 'login' | 'token' | 'api-key';
  workerName: string;
  maxConcurrency: number;
  hasBrowser: boolean;
  /** this computer offers full desktop control (recorded for routing; no bot uses it yet) */
  hasDesktop: boolean;
  /** login email of the person this computer belongs to, if set */
  ownerEmail: string | null;
  isScheduler: boolean;
  /** absolute path of the persistent Chrome profile */
  browserProfileDir: string;
  /** absolute path of profile.json (may not exist yet) */
  applicantProfilePath: string;
  /** absolute path of the assets folder (CV, photo) */
  assetsDir: string;
  sheets: { credentials: string; sheetId: string; tab: string } | null;
  version: string;
}

function resolveFromRoot(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(WORKER_ROOT, value);
}

function readVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(path.join(WORKER_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Reads and checks the worker's .env. Explains in plain words what is missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(
      `The worker settings in apps/worker/.env are not complete:\n${problems.join('\n')}\n` +
        'Copy apps/worker/.env.example to apps/worker/.env and fill it in.',
    );
  }
  const values = parsed.data;
  // An empty "ANTHROPIC_API_KEY=" line must not count as a key: a key always
  // wins over the Claude login, so an empty one would break the login.
  for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const) {
    if (!env[name]?.trim()) delete env[name];
  }
  const claudeAccess = env.ANTHROPIC_API_KEY
    ? 'api-key'
    : env.CLAUDE_CODE_OAUTH_TOKEN
      ? 'token'
      : 'login';
  const sheets =
    values.GOOGLE_SERVICE_ACCOUNT_JSON && values.SALES_QUEUE_SHEET_ID
      ? {
          credentials: values.GOOGLE_SERVICE_ACCOUNT_JSON,
          sheetId: values.SALES_QUEUE_SHEET_ID,
          tab: values.SALES_QUEUE_TAB,
        }
      : null;
  return {
    supabaseUrl: values.SUPABASE_URL,
    serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY,
    claudeModel: values.CLAUDE_MODEL,
    claudeModelFast: values.CLAUDE_MODEL_FAST,
    claudeAccess,
    workerName: values.WORKER_NAME,
    maxConcurrency: values.WORKER_MAX_CONCURRENCY,
    hasBrowser: values.WORKER_HAS_BROWSER,
    hasDesktop: values.WORKER_HAS_DESKTOP,
    ownerEmail: values.WORKER_OWNER_EMAIL ? values.WORKER_OWNER_EMAIL.toLowerCase() : null,
    isScheduler: values.WORKER_IS_SCHEDULER,
    browserProfileDir: resolveFromRoot(values.BROWSER_PROFILE_DIR),
    applicantProfilePath: resolveFromRoot(values.APPLICANT_PROFILE_JSON),
    assetsDir: path.join(WORKER_ROOT, 'assets'),
    sheets,
    version: readVersion(),
  };
}

export interface LoadedProfile {
  profile: ApplicantProfile;
  cvPath: string;
  photoPath: string | undefined;
}

/**
 * Loads the applicant profile for the job bots. Returns a reason instead of
 * throwing, so a missing file fails only the run that needs it.
 */
export function loadApplicantProfile(
  config: Pick<WorkerConfig, 'applicantProfilePath' | 'assetsDir'>,
): { ok: true; value: LoadedProfile } | { ok: false; reason: string } {
  if (!existsSync(config.applicantProfilePath)) {
    return {
      ok: false,
      reason:
        'The applicant profile is missing. Put profile.json, the CV and the photo in apps/worker/assets/ (see the README).',
    };
  }
  try {
    const profile = parseApplicantProfile(readFileSync(config.applicantProfilePath, 'utf8'));
    const fromWorkerRoot = (file: string) =>
      path.isAbsolute(file) ? file : path.resolve(WORKER_ROOT, file);
    const cvPath = fromWorkerRoot(profile.cv_path);
    if (!existsSync(cvPath)) {
      return { ok: false, reason: `The CV file was not found at ${profile.cv_path}.` };
    }
    const photoPath = profile.photo_path ? fromWorkerRoot(profile.photo_path) : undefined;
    return {
      ok: true,
      value: {
        profile,
        cvPath,
        photoPath: photoPath && existsSync(photoPath) ? photoPath : undefined,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'The applicant profile could not be read.',
    };
  }
}
