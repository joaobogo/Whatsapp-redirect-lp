import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@fgv/shared';
import type { WorkerConfig } from './config';

export type Db = SupabaseClient<Database>;

/**
 * Service-role client. It bypasses row level security, which is why the key
 * lives only in apps/worker/.env on the worker computers and never in the
 * browser. The database triggers still apply to everything it writes.
 */
export function createDb(config: Pick<WorkerConfig, 'supabaseUrl' | 'serviceRoleKey'>): Db {
  return createClient<Database>(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
