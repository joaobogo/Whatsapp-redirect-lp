/**
 * Turns a database or network error into one plain sentence. Users never see
 * stack traces, SQL or keys (spec section 13).
 */
export function friendlyError(
  error: unknown,
  fallback = 'Something went wrong. Try again.',
): string {
  if (!error || typeof error !== 'object') return fallback;
  const { code, message } = error as { code?: string; message?: string };
  if (code === '42501' || /row-level security|permission denied/i.test(message ?? '')) {
    return 'You do not have permission to do that. Ask an owner to change your role.';
  }
  // P0001 = a rule in the database refused the action; its message is written for people.
  if (code === 'P0001' && message) return message;
  if (code === '23505') return 'That already exists.';
  if (code === 'PGRST116') return 'That could not be found.';
  if (/fetch failed|network|ECONN|timeout/i.test(message ?? '')) {
    return 'Could not reach the database. Check your connection and try again.';
  }
  return fallback;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

export function fail(error: unknown, fallback?: string): { ok: false; error: string } {
  return { ok: false, error: typeof error === 'string' ? error : friendlyError(error, fallback) };
}
