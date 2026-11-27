import 'server-only';
import { chatEntryFromRow, type ChatEntry } from '@fgv/shared';
import type { Db } from '@/lib/data';

export type { ChatEntry };

/** The signed-in user's recent chat, oldest first. Row level security limits it to their own rows. */
export async function loadHistory(db: Db, userId: string, limit = 60): Promise<ChatEntry[]> {
  const { data } = await db
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? [])
    .reverse()
    .map(chatEntryFromRow)
    .filter((entry): entry is ChatEntry => entry !== null);
}
