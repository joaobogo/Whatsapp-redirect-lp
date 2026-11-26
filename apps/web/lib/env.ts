// Server-side environment access. Nothing here is ever sent to the browser
// except the two NEXT_PUBLIC_ values, which are public by design.

export function supabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set. See apps/web/.env.example.');
  return value;
}

/** Docs now call this the publishable key; the older anon key is accepted too. */
export function supabasePublicKey(): string {
  const value =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) {
    throw new Error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. See apps/web/.env.example.');
  }
  return value;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}

export function serviceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. See apps/web/.env.example.');
  return value;
}

/** Model strings live only in env/config (spec section 3, "Models"). */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const DEFAULT_CLAUDE_MODEL_FAST = 'claude-sonnet-5-5';

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
}

export function anthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
