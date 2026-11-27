// Database row types. They mirror supabase/migrations/0001_init.sql.
// If you change the migration, change this file in the same commit
// (or regenerate with `supabase gen types typescript`).

export const USER_ROLES = ['owner', 'operator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const APPROVAL_MODES = ['draft_only', 'approve_each', 'auto_within_rules'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const RUN_STATUSES = [
  'queued',
  'claimed',
  'running',
  'stop_requested',
  'succeeded',
  'failed',
  'stopped',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ITEM_STATUSES = [
  'found',
  'ready',
  'needs_approval',
  'approved',
  'sent',
  'applied',
  'skipped',
  'needs_human',
  'closed',
  'error',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_KINDS = [
  'job',
  'lead',
  'candidate',
  'message_draft',
  'proposal',
  'other',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const CHANNELS = [
  'Demo',
  'Jobs',
  'Candidates',
  'LinkedIn',
  'Leads',
  'Marketplaces',
] as const;
export type Channel = (typeof CHANNELS)[number];

export const BOT_MODELS = ['opus', 'fast'] as const;
export type BotModel = (typeof BOT_MODELS)[number];

export const RUN_SOURCES = ['button', 'schedule', 'chat'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

export const RUN_EVENT_TYPES = ['log', 'tool', 'item', 'result', 'error'] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SettingsValue = string | number | boolean | string[] | number[];
export type BotSettings = Record<string, SettingsValue>;

export type ProfileRow = {
  id: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

export type WorkerStatus = 'online' | 'busy' | 'offline';

export type WorkerRow = {
  id: string;
  name: string;
  status: WorkerStatus;
  has_browser: boolean;
  /** The computer offers full desktop control, not only a browser. Recorded; no bot uses it yet. */
  has_desktop: boolean;
  /** Whose computer this is. They may pause it and set how many runs it takes. */
  owner_id: string | null;
  is_scheduler: boolean;
  max_concurrency: number;
  active_runs: number;
  /** Added to the spec's table so "Pause this worker" has somewhere to live. */
  paused: boolean;
  last_heartbeat: string | null;
  version: string | null;
  created_at: string;
};

export type BotRow = {
  id: string;
  slug: string;
  name: string;
  channel: string;
  description: string;
  prompt_template: string;
  settings_schema: Json;
  settings: BotSettings;
  enabled: boolean;
  schedule_cron: string | null;
  daily_cap: number;
  approval_mode: ApprovalMode;
  model: BotModel;
  requires_browser: boolean;
  preferred_worker: string | null;
  max_turns: number;
  max_minutes: number;
  created_at: string;
  updated_at: string;
};

export type RunRow = {
  id: string;
  bot_id: string;
  status: RunStatus;
  settings_snapshot: BotSettings;
  requested_by: string | null;
  source: RunSource;
  worker_id: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
};

export type RunEventRow = {
  id: number;
  run_id: string;
  ts: string;
  type: RunEventType;
  message: string;
  data: Json | null;
};

export type ItemRow = {
  id: string;
  bot_id: string | null;
  run_id: string | null;
  kind: ItemKind;
  status: ItemStatus;
  title: string | null;
  company: string | null;
  person: string | null;
  url: string | null;
  location: string | null;
  pay: string | null;
  score: number | null;
  fit_reason: string | null;
  draft: string | null;
  notes: string | null;
  dedupe_key: string | null;
  acted_at: string | null;
  /** Bot that sent / applied. Added so caps count the acting bot, not the bot that found the item. */
  acted_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSettingRow = {
  key: string;
  value: Json;
};

export type ChatMessageRow = {
  id: string;
  user_id: string | null;
  role: string;
  content: Json;
  created_at: string;
};

type TableDef<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

/** Shape expected by `createClient<Database>()` from @supabase/supabase-js. */
export type Database = {
  public: {
    Tables: {
      profiles: TableDef<
        ProfileRow,
        Pick<ProfileRow, 'id'> & Partial<ProfileRow>,
        Partial<ProfileRow>
      >;
      workers: TableDef<
        WorkerRow,
        Pick<WorkerRow, 'name'> & Partial<WorkerRow>,
        Partial<WorkerRow>
      >;
      bots: TableDef<
        BotRow,
        Pick<
          BotRow,
          'slug' | 'name' | 'channel' | 'description' | 'prompt_template' | 'settings_schema'
        > &
          Partial<BotRow>,
        Partial<BotRow>
      >;
      runs: TableDef<
        RunRow,
        Pick<RunRow, 'bot_id' | 'settings_snapshot'> & Partial<RunRow>,
        Partial<RunRow>
      >;
      run_events: TableDef<
        RunEventRow,
        Pick<RunEventRow, 'run_id' | 'type' | 'message'> & Partial<RunEventRow>,
        Partial<RunEventRow>
      >;
      items: TableDef<ItemRow, Pick<ItemRow, 'kind'> & Partial<ItemRow>, Partial<ItemRow>>;
      app_settings: TableDef<AppSettingRow, AppSettingRow, Partial<AppSettingRow>>;
      chat_messages: TableDef<
        ChatMessageRow,
        Pick<ChatMessageRow, 'role' | 'content'> & Partial<ChatMessageRow>,
        Partial<ChatMessageRow>
      >;
    };
    Views: Record<never, never>;
    Functions: {
      claim_next_run: {
        Args: { p_worker: string; p_has_browser: boolean };
        Returns: RunRow | null;
      };
      bot_actions_today: { Args: { p_bot: string }; Returns: number };
      linkedin_sent_today: { Args: Record<never, never>; Returns: number };
      spend_today: { Args: Record<never, never>; Returns: number };
      stop_all: { Args: Record<never, never>; Returns: undefined };
      resume_all: { Args: Record<never, never>; Returns: undefined };
      request_stop: { Args: { p_run: string }; Returns: undefined };
      app_role: { Args: Record<never, never>; Returns: UserRole | null };
    };
    Enums: {
      user_role: UserRole;
      approval_mode: ApprovalMode;
      run_status: RunStatus;
      item_status: ItemStatus;
      item_kind: ItemKind;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Keys stored in the app_settings table. */
export const APP_SETTING_KEYS = {
  killSwitch: 'kill_switch',
  dailySpendCapUsd: 'daily_spend_cap_usd',
  linkedinDailyCap: 'linkedin_daily_cap',
  defaultModel: 'default_model',
  timeZone: 'time_zone',
} as const;

export const APP_TIME_ZONE = 'America/Sao_Paulo';
