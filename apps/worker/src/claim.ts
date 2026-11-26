import type { RunRow } from '@fgv/shared';
import type { Db } from './db';

/**
 * Atomically takes the oldest queued run this worker may run (the
 * claim_next_run function locks the row, so two workers never get the same run).
 * `browserFree` is false while this worker's single Chrome profile is in use.
 */
export async function claimNextRun(
  db: Db,
  workerId: string,
  browserFree: boolean,
): Promise<RunRow | null> {
  const { data, error } = await db.rpc('claim_next_run', {
    p_worker: workerId,
    p_has_browser: browserFree,
  });
  if (error) throw new Error(error.message);
  // an empty claim comes back as null or as a row of nulls
  return data && data.id ? data : null;
}
