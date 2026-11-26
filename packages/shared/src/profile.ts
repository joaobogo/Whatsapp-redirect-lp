import { z } from 'zod';

/**
 * Applicant profile used by the job bots (spec section 7.9).
 * The real values are personal data: they live in apps/worker/assets/profile.json
 * on each worker computer (git-ignored), pointed to by APPLICANT_PROFILE_JSON.
 * The company tax number (CNPJ) is never part of the profile.
 */
export const applicantProfileSchema = z
  .object({
    full_name: z.string().min(1),
    email_for_applications: z.email(),
    phone: z.string().min(5),
    address: z.string().min(1),
    linkedin: z.url(),
    current_role: z.string().min(1),
    experience_summary: z.string().min(1),
    languages: z.array(z.string()).min(1),
    citizenship: z.array(z.string()).default([]),
    work_model: z.string().default(''),
    cv_path: z.string().min(1),
    photo_path: z.string().optional(),
  })
  .strict();

export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

const FORBIDDEN_KEYS = /cnpj|tax[_ ]?(id|number)|password|passcode|card|cpf|ssn/i;

/** Parses the profile JSON text. Refuses files that try to carry secrets or tax numbers. */
export function parseApplicantProfile(jsonText: string): ApplicantProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('The applicant profile is not valid JSON.');
  }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(raw)) {
      if (FORBIDDEN_KEYS.test(key)) {
        throw new Error(
          `The applicant profile must not contain "${key}". Passwords and tax numbers are never stored.`,
        );
      }
    }
  }
  const parsed = applicantProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'profile';
    throw new Error(
      `The applicant profile is incomplete: ${where} - ${issue?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}

/** Text block added to a job bot's prompt. File paths are passed in already resolved. */
export function profileForPrompt(
  profile: ApplicantProfile,
  paths: { cv: string; photo?: string },
): string {
  const lines = [
    `Full name: ${profile.full_name}`,
    `Email for applications: ${profile.email_for_applications}`,
    `Phone: ${profile.phone}`,
    `Address: ${profile.address}`,
    `LinkedIn: ${profile.linkedin}`,
    `Current role: ${profile.current_role}`,
    `Experience: ${profile.experience_summary}`,
    `Languages: ${profile.languages.join(', ')}`,
    `Citizenship: ${profile.citizenship.join(', ')}`,
    `Work model: ${profile.work_model}`,
    `CV file to upload (cv_path): ${paths.cv}`,
  ];
  if (paths.photo) lines.push(`Photo file (photo_path): ${paths.photo}`);
  return lines.join('\n');
}
