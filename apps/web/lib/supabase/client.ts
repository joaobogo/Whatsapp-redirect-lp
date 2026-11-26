'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@fgv/shared';

let client: SupabaseClient<Database> | undefined;

/** Browser client (uses the signed-in user's session; row level security applies). */
export function createClient(): SupabaseClient<Database> {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    );
  }
  return client;
}
