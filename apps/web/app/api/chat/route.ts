import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isWorkerOnline, type Json } from '@fgv/shared';
import { getViewer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/**
 * POST /api/chat - ask the built-in Claude chat something.
 *
 * The web app does not call Claude. It saves the question with status
 * "waiting"; a worker computer picks it up, answers with its own Claude
 * access, and writes the reply into the user's chat, where the drawer shows it.
 * So the web app holds no Claude key at all.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  }

  const db = await createClient();
  const { data: workers } = await db.from('workers').select('last_heartbeat');
  if (!(workers ?? []).some((worker) => isWorkerOnline(worker.last_heartbeat))) {
    return NextResponse.json(
      { error: 'No worker computer is online to answer. Start one, then ask again.' },
      { status: 503 },
    );
  }

  const content = { text: parsed.data.message, status: 'waiting' } as Json;
  const { data, error } = await db
    .from('chat_messages')
    .insert({ role: 'user', content })
    .select('id')
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: 'Your message could not be saved. Try again.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: data.id }, { status: 202 });
}
