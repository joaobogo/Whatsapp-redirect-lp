import { APP_SETTING_KEYS, HARD_LIMITS, startOfDay, type ItemRow, type Json } from '@fgv/shared';
import type { Db } from './db';
import { LOCK_PREFIX, type ItemStore } from './tools';

const UNIQUE_VIOLATION = '23505';

/** The ItemStore the dashboard tools use, backed by Supabase. */
export function createItemStore(db: Db, runId: string): ItemStore {
  return {
    async findByDedupeKey(key) {
      const { data, error } = await db
        .from('items')
        .select('*')
        .eq('dedupe_key', key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async findById(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data, error } = await db.from('items').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },

    async insert(item) {
      const { data, error } = await db.from('items').insert(item).select('*').single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return null;
        throw new Error(error.message);
      }
      return data;
    },

    async update(id, patch, condition) {
      let query = db.from('items').update(patch).eq('id', id).eq('status', condition.ifStatus);
      if (condition.ifUnlocked) {
        query = query.or(`notes.is.null,notes.not.like.${LOCK_PREFIX}%`);
      }
      const { data, error } = await query.select('*');
      // P0001 = a rule in the database refused (approval, cap); its message is for the bot
      if (error) throw new Error(error.message);
      return (data as ItemRow[] | null)?.[0] ?? null;
    },

    async list(filter) {
      let query = db.from('items').select('*');
      if (filter.botId) query = query.eq('bot_id', filter.botId);
      if (filter.kinds) query = query.in('kind', filter.kinds);
      if (filter.statuses) query = query.in('status', filter.statuses);
      const { data, error } = await query
        .order('created_at', { ascending: filter.oldestFirst })
        .limit(filter.limit);
      if (error) throw new Error(error.message);
      return data ?? [];
    },

    async botActionsToday(botId) {
      const { data, error } = await db.rpc('bot_actions_today', { p_bot: botId });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },

    async linkedinSentToday() {
      const { data, error } = await db.rpc('linkedin_sent_today');
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },

    async linkedinAppliedToday() {
      const { count, error } = await db
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'applied')
        .ilike('url', '%linkedin.com%')
        .gte('acted_at', startOfDay().toISOString());
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async lastLinkedinSendAt() {
      const { data, error } = await db
        .from('items')
        .select('acted_at')
        .eq('status', 'sent')
        .not('acted_at', 'is', null)
        .order('acted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.acted_at ? new Date(data.acted_at) : null;
    },

    async linkedinDailyCap() {
      const { data } = await db
        .from('app_settings')
        .select('value')
        .eq('key', APP_SETTING_KEYS.linkedinDailyCap)
        .maybeSingle();
      const value = Number(data?.value);
      const cap = Number.isFinite(value) ? value : HARD_LIMITS.linkedinMessagesPerDay;
      return Math.min(cap, HARD_LIMITS.linkedinMessagesPerDay);
    },

    async addEvent(type, message, data) {
      await db
        .from('run_events')
        .insert({ run_id: runId, type, message, data: (data ?? null) as Json | null });
    },
  };
}
