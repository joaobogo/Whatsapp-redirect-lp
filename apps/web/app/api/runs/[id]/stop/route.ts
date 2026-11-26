import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canOperate, getViewer } from '@/lib/auth';
import { friendlyError } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';

/** POST /api/runs/:id/stop - ask the worker to stop this run. */
export async function POST(_request: Request, context: RouteContext<'/api/runs/[id]/stop'>) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });
  if (!canOperate(viewer.role)) {
    return NextResponse.json(
      { error: 'You do not have permission to stop runs.' },
      { status: 403 },
    );
  }
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'That run does not exist.' }, { status: 404 });
  }
  const db = await createClient();
  const { error } = await db.rpc('request_stop', { p_run: id });
  if (error) {
    return NextResponse.json(
      { error: friendlyError(error, 'Could not stop the run. Try again.') },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
