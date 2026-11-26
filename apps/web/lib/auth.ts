import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { UserRole } from '@fgv/shared';
import { createClient } from '@/lib/supabase/server';

export interface Viewer {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
}

/** The signed-in user and their role, or null. Cached for the length of one request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', claims.sub)
    .maybeSingle();
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    name: profile?.full_name ?? null,
    role: profile?.role ?? 'viewer',
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  return viewer;
}

export function canOperate(role: UserRole): boolean {
  return role === 'owner' || role === 'operator';
}
