'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { chatEntryFromRow, type ChatEntry, type Json, type StoredAction } from '@fgv/shared';
import { getViewer } from '@/lib/auth';
import { loadHistory } from '@/lib/chat';
import { confirmAction } from '@/lib/chat-tools';
import { createClient } from '@/lib/supabase/server';

export async function loadChatAction(): Promise<ChatEntry[]> {
  const viewer = await getViewer();
  if (!viewer) return [];
  return loadHistory(await createClient(), viewer.id);
}

type Outcome = { ok: true; entry: ChatEntry } | { ok: false; error: string };

/**
 * The user tapped Confirm (or Cancel) on a preview card. The action is read
 * back from the user's own chat row - never from the browser - then validated
 * and executed with the user's own permissions.
 */
async function settle(id: string, decision: 'confirm' | 'cancel'): Promise<Outcome> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Please log in again.' };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'That card is no longer valid.' };

  const db = await createClient();
  const { data: row } = await db
    .from('chat_messages')
    .select('*')
    .eq('id', id)
    .eq('user_id', viewer.id)
    .eq('role', 'action')
    .maybeSingle();
  const entry = row ? chatEntryFromRow(row) : null;
  if (!row || !entry || entry.role !== 'action') {
    return { ok: false, error: 'That card is no longer valid.' };
  }
  if (entry.action.status !== 'pending') {
    return { ok: false, error: 'That was already answered.' };
  }

  let next: StoredAction;
  if (decision === 'cancel') {
    next = { ...entry.action, status: 'cancelled' };
  } else {
    // claim the card first, so a double tap cannot run the action twice
    const claimed = await db
      .from('chat_messages')
      .update({ content: { ...entry.action, status: 'confirmed', result: 'Working...' } as Json })
      .eq('id', id)
      .eq('content->>status', 'pending')
      .select('id');
    if (!claimed.data || claimed.data.length === 0) {
      return { ok: false, error: 'That was already answered.' };
    }
    const result = await confirmAction(db, viewer, entry.action);
    next = {
      ...entry.action,
      status: result.ok ? 'confirmed' : 'failed',
      result: result.message,
      link: result.link,
    };
  }

  await db
    .from('chat_messages')
    .update({ content: { ...next } as Json })
    .eq('id', id);
  revalidatePath('/', 'layout');
  return { ok: true, entry: { id, role: 'action', action: next } };
}

export async function confirmChatAction(id: string): Promise<Outcome> {
  return settle(id, 'confirm');
}

export async function cancelChatAction(id: string): Promise<Outcome> {
  return settle(id, 'cancel');
}

export async function clearChatAction(): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) return;
  const db = await createClient();
  await db.from('chat_messages').delete().eq('user_id', viewer.id);
}
