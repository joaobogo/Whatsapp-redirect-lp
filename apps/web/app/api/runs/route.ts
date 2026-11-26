import { NextResponse } from 'next/server';
import { z } from 'zod';
import { canOperate, getViewer } from '@/lib/auth';
import { createRun } from '@/lib/runs';
import { createClient } from '@/lib/supabase/server';

const bodySchema = z.object({
  slug: z.string().min(1).max(80),
  settings: z.record(z.string(), z.unknown()).optional(),
  saveAsDefault: z.boolean().optional(),
});

/** POST /api/runs - queue a run. Everything is validated again on the server. */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });
  if (!canOperate(viewer.role)) {
    return NextResponse.json(
      { error: 'You can look but not run bots. Ask an owner to make you an operator.' },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'That request is not valid.' }, { status: 400 });
  }

  const result = await createRun(await createClient(), {
    slug: parsed.data.slug,
    overrides: parsed.data.settings,
    saveAsDefault: parsed.data.saveAsDefault,
    source: 'button',
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, fieldErrors: result.fieldErrors },
      { status: result.status },
    );
  }
  return NextResponse.json({ runId: result.runId }, { status: 201 });
}
