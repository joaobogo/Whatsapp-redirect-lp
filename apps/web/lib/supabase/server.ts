import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@fgv/shared';
import { serviceRoleKey, supabasePublicKey, supabaseUrl } from '@/lib/env';

/** Server client bound to the request cookies: acts as the signed-in user, RLS applies. */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabasePublicKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there.
          // proxy.ts refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses row level security, so it is used only for
 * the two things a user session cannot do: inviting users and reading emails.
 * Every caller checks the user's role first.
 */
export function createAdminClient(): SupabaseClient<Database> {
  return createSupabaseClient<Database>(supabaseUrl(), serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
