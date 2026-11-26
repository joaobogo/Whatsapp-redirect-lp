-- FGV Control Panel - initial schema (build spec section 5).
--
-- Apply once on a new Supabase project, then run supabase/seed.sql.
-- Two columns were added to the spec's tables, both needed by spec features:
--   workers.paused   - "Pause this worker" on the Workers page (6.7)
--   items.acted_by   - which bot sent / applied, so daily caps count the acting bot
-- Everything else follows the spec. The starred safety rules of section 9 are
-- enforced here as triggers, on top of the checks in the worker.

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'operator', 'viewer');
create type public.approval_mode as enum ('draft_only', 'approve_each', 'auto_within_rules');
create type public.run_status as enum (
  'queued', 'claimed', 'running', 'stop_requested', 'succeeded', 'failed', 'stopped'
);
create type public.item_status as enum (
  'found', 'ready', 'needs_approval', 'approved', 'sent', 'applied',
  'skipped', 'needs_human', 'closed', 'error'
);
create type public.item_kind as enum (
  'job', 'lead', 'candidate', 'message_draft', 'proposal', 'other'
);

-- ---------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role public.user_role not null default 'viewer',
  created_at timestamptz default now()
);

create table public.workers (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,                    -- 'pichau-desktop', 'windows', 'chromebook'
  status text not null default 'offline',       -- online | busy | offline (offline = no heartbeat 90s)
  has_browser boolean not null default true,
  is_scheduler boolean not null default false,
  max_concurrency int not null default 2 check (max_concurrency between 1 and 20),
  active_runs int not null default 0,
  paused boolean not null default false,        -- a paused worker stops claiming new runs
  last_heartbeat timestamptz,
  version text,
  created_at timestamptz default now()
);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  channel text not null,                        -- 'Jobs','Candidates','LinkedIn','Leads','Marketplaces','Demo'
  description text not null,
  prompt_template text not null,                -- uses {{settings.x}} placeholders
  settings_schema jsonb not null,               -- JSON Schema generated from the zod schema
  settings jsonb not null default '{}',
  enabled boolean not null default false,       -- schedule on/off
  schedule_cron text,                           -- null = manual only
  daily_cap int not null default 20 check (daily_cap between 0 and 1000),
  approval_mode public.approval_mode not null default 'approve_each',
  model text not null default 'opus' check (model in ('opus', 'fast')),
  requires_browser boolean not null default false,
  preferred_worker uuid references public.workers(id) on delete set null,
  max_turns int not null default 60 check (max_turns between 1 and 1000),
  max_minutes int not null default 45 check (max_minutes between 1 and 600),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  status public.run_status not null default 'queued',
  settings_snapshot jsonb not null,
  requested_by uuid references public.profiles(id) on delete set null,  -- null = scheduler
  source text not null default 'button' check (source in ('button', 'schedule', 'chat')),
  worker_id uuid references public.workers(id) on delete set null,
  queued_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  summary text,
  error text,
  input_tokens int default 0,
  output_tokens int default 0,
  cost_usd numeric(10,4) default 0
);
create index runs_status_queued_idx on public.runs (status, queued_at);
create index runs_bot_queued_idx on public.runs (bot_id, queued_at desc);

create table public.run_events (
  id bigserial primary key,
  run_id uuid not null references public.runs(id) on delete cascade,
  ts timestamptz default now(),
  type text not null check (type in ('log', 'tool', 'item', 'result', 'error')),
  message text not null,
  data jsonb
);
create index run_events_run_idx on public.run_events (run_id, id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid references public.bots(id) on delete set null,
  run_id uuid references public.runs(id) on delete set null,
  kind public.item_kind not null,
  status public.item_status not null default 'found',
  title text,
  company text,
  person text,
  url text,
  location text,
  pay text,
  score int check (score is null or score between 0 and 100),
  fit_reason text,
  draft text,
  notes text,
  dedupe_key text unique,                       -- lower(url) or kind|company|title|person
  acted_at timestamptz,
  acted_by uuid references public.bots(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index items_status_idx on public.items (status);
create index items_kind_created_idx on public.items (kind, created_at desc);
create index items_run_idx on public.items (run_id);
create index items_acted_idx on public.items (acted_at) where acted_at is not null;

create table public.app_settings (
  key text primary key,
  value jsonb not null
);
-- seed (supabase/seed.sql): kill_switch=false, daily_spend_cap_usd=30, linkedin_daily_cap=20

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade default auth.uid(),
  role text not null,
  content jsonb not null,
  created_at timestamptz default now()
);
create index chat_messages_user_idx on public.chat_messages (user_id, created_at);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger bots_set_updated_at before update on public.bots
  for each row execute function public.set_updated_at();
create trigger items_set_updated_at before update on public.items
  for each row execute function public.set_updated_at();

-- Role of the signed-in user (null when nobody is signed in).
create function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- True for the workers (service role key) and for direct database access
-- (SQL editor, migrations). False for people signed in through the web app.
create function public.is_privileged() returns boolean
language sql stable as $$
  select coalesce(auth.role(), 'service_role') = 'service_role'
$$;

create function public.can_operate() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_privileged() or public.app_role() in ('owner', 'operator')
$$;

-- Start of "today" in the app time zone, as an instant.
create function public.today_start() returns timestamptz
language sql stable as $$
  select date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
$$;

-- Table in section 9: which approval modes a bot may use.
create function public.approval_mode_allowed(p_slug text, p_mode public.approval_mode)
returns boolean language sql immutable as $$
  select case
    when p_slug = 'job-apply' then p_mode in ('approve_each', 'auto_within_rules')
    when p_slug = 'linkedin-outreach' then p_mode = 'approve_each'
    else p_mode in ('draft_only', 'approve_each')
  end
$$;

-- Table in section 9, "Contacts people?": only two bots ever do.
create function public.bot_may_contact(p_slug text, p_status public.item_status)
returns boolean language sql immutable as $$
  select (p_slug = 'linkedin-outreach' and p_status = 'sent')
      or (p_slug = 'job-apply' and p_status = 'applied')
$$;

-- ---------------------------------------------------------------------------
-- functions from the spec
-- ---------------------------------------------------------------------------

-- atomic claim: a worker takes the oldest queued run it is allowed to run
create function public.claim_next_run(p_worker uuid, p_has_browser boolean)
returns public.runs language plpgsql security definer set search_path = public as $$
declare r public.runs;
begin
  if (select (value)::boolean from app_settings where key = 'kill_switch') then return null; end if;
  if (select paused from workers where id = p_worker) then return null; end if;
  select runs.* into r from runs join bots on bots.id = runs.bot_id
   where runs.status = 'queued'
     and (not bots.requires_browser or p_has_browser)
     and (bots.preferred_worker is null or bots.preferred_worker = p_worker)
   order by runs.queued_at
   for update of runs skip locked limit 1;
  if r.id is null then return null; end if;
  update runs set status = 'claimed', worker_id = p_worker, started_at = now()
   where id = r.id returning * into r;
  return r;
end $$;

-- count of contact actions today for a bot (for daily caps)
create function public.bot_actions_today(p_bot uuid) returns int
language sql stable as $$
  select count(*)::int from public.items
   where coalesce(acted_by, bot_id) = p_bot
     and status in ('sent', 'applied')
     and acted_at >= public.today_start();
$$;

-- LinkedIn messages sent today by every bot ('sent' is only ever a LinkedIn message)
create function public.linkedin_sent_today() returns int
language sql stable as $$
  select count(*)::int from public.items
   where status = 'sent' and acted_at >= public.today_start();
$$;

-- what the bots cost today, in USD
create function public.spend_today() returns numeric
language sql stable as $$
  select coalesce(sum(cost_usd), 0)::numeric from public.runs
   where coalesce(started_at, queued_at) >= public.today_start();
$$;

-- stop everything (the spec's function, plus a role check: viewers may not call it)
create function public.stop_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_operate() then
    raise exception 'Only owners and operators can stop the bots' using errcode = '42501';
  end if;
  insert into app_settings (key, value) values ('kill_switch', 'true')
    on conflict (key) do update set value = 'true';
  update runs set status = 'stop_requested' where status in ('claimed', 'running');
  update runs set status = 'stopped', finished_at = now() where status = 'queued';
end $$;

-- the "Resume" button on the banner
create function public.resume_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_operate() then
    raise exception 'Only owners and operators can resume the bots' using errcode = '42501';
  end if;
  update app_settings set value = 'false' where key = 'kill_switch';
end $$;

-- the "Stop" button on a run page
create function public.request_stop(p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_operate() then
    raise exception 'Only owners and operators can stop a run' using errcode = '42501';
  end if;
  update runs set status = 'stop_requested' where id = p_run and status in ('claimed', 'running');
  update runs set status = 'stopped', finished_at = now() where id = p_run and status = 'queued';
end $$;

-- ---------------------------------------------------------------------------
-- triggers that enforce the rules
-- ---------------------------------------------------------------------------

-- every new login gets a profile; the first user ever becomes the owner
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  lock table public.profiles in share row exclusive mode;
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'owner'::public.user_role else 'viewer'::public.user_role end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- only an owner may change a role, and the last owner cannot be demoted
create function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    if not public.is_privileged() and public.app_role() is distinct from 'owner' then
      raise exception 'Only an owner can change roles' using errcode = '42501';
    end if;
    if old.role = 'owner' and not exists (
      select 1 from public.profiles where role = 'owner' and id <> old.id
    ) then
      raise exception 'There must always be at least one owner';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profiles();

-- bots: approval mode must be allowed for the bot (section 9); operators may
-- only change the click-settings, never the prompt or the bot's identity
create function public.guard_bots() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.approval_mode_allowed(new.slug, new.approval_mode) then
    raise exception 'Approval mode % is not allowed for bot %', new.approval_mode, new.slug;
  end if;
  if tg_op = 'UPDATE' and not public.is_privileged() and public.app_role() is distinct from 'owner' then
    if new.slug is distinct from old.slug
       or new.name is distinct from old.name
       or new.channel is distinct from old.channel
       or new.description is distinct from old.description
       or new.prompt_template is distinct from old.prompt_template
       or new.settings_schema is distinct from old.settings_schema
       or new.requires_browser is distinct from old.requires_browser
       or new.max_turns is distinct from old.max_turns then
      raise exception 'Only an owner can change the prompt or identity of a bot' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger bots_guard before insert or update on public.bots
  for each row execute function public.guard_bots();

-- runs: people can only queue a run for themselves, never while everything is
-- stopped, and never past the daily spend cap
create function public.guard_run_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap numeric;
begin
  if (select (value)::boolean from app_settings where key = 'kill_switch') then
    raise exception 'All bots are stopped. Press Resume first.' using errcode = 'P0001';
  end if;
  select (value)::numeric into cap from app_settings where key = 'daily_spend_cap_usd';
  if cap is not null and public.spend_today() >= cap then
    raise exception 'Daily spend cap reached' using errcode = 'P0001';
  end if;
  if not public.is_privileged() then
    new.requested_by := auth.uid();
    new.status := 'queued';
    new.worker_id := null;
    new.queued_at := now();
    new.started_at := null;
    new.finished_at := null;
    new.summary := null;
    new.error := null;
    new.input_tokens := 0;
    new.output_tokens := 0;
    new.cost_usd := 0;
    if new.source not in ('button', 'chat') then new.source := 'button'; end if;
  end if;
  return new;
end $$;

create trigger runs_guard_insert before insert on public.runs
  for each row execute function public.guard_run_insert();

-- items: nothing is created already approved / sent / applied
create function public.guard_item_insert() returns trigger
language plpgsql as $$
begin
  if new.status in ('approved', 'sent', 'applied') then
    raise exception 'Items cannot be created as %', new.status;
  end if;
  return new;
end $$;

create trigger items_guard_insert before insert on public.items
  for each row execute function public.guard_item_insert();

-- items: rules 5 and 6 of section 9
create function public.guard_item_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor public.bots;
  linkedin_cap int;
begin
  if not public.is_privileged() then
    -- people may approve, skip, edit the draft and leave notes - nothing else
    if new.bot_id is distinct from old.bot_id
       or new.run_id is distinct from old.run_id
       or new.kind is distinct from old.kind
       or new.title is distinct from old.title
       or new.company is distinct from old.company
       or new.person is distinct from old.person
       or new.url is distinct from old.url
       or new.location is distinct from old.location
       or new.pay is distinct from old.pay
       or new.score is distinct from old.score
       or new.fit_reason is distinct from old.fit_reason
       or new.dedupe_key is distinct from old.dedupe_key
       or new.acted_by is distinct from old.acted_by then
      raise exception 'Only the status, draft and notes of an item can be changed' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status and new.status in ('sent', 'applied') then
    if public.is_privileged() and new.acted_by is not null then
      -- a bot is reporting that it contacted someone or submitted something
      select * into actor from public.bots where id = new.acted_by;
      if actor.id is null or actor.approval_mode = 'draft_only'
         or not public.bot_may_contact(actor.slug, new.status) then
        raise exception 'This bot only drafts. It never contacts anyone.';
      end if;
      if not (
        old.status = 'approved'
        or (new.status = 'applied' and old.status = 'ready'
            and actor.slug = 'job-apply' and actor.approval_mode = 'auto_within_rules')
      ) then
        raise exception 'Item is %, not approved. Nothing is sent without approval.', old.status;
      end if;
      if public.bot_actions_today(actor.id) >= actor.daily_cap then
        raise exception 'Daily cap reached for bot %', actor.slug;
      end if;
      if new.status = 'sent' then
        select least(coalesce((value)::int, 20), 20) into linkedin_cap
          from app_settings where key = 'linkedin_daily_cap';
        if public.linkedin_sent_today() >= coalesce(linkedin_cap, 20) then
          raise exception 'LinkedIn daily cap reached';
        end if;
      end if;
    elsif public.is_privileged() then
      raise exception 'A bot must say who acted (acted_by) when it marks an item %', new.status;
    end if;
    -- a person marking something sent / applied by hand lands here too
    new.acted_at := now();
  elsif new.status is distinct from old.status then
    if old.status in ('sent', 'applied') and public.is_privileged() and new.acted_by is not null
       and new.acted_by = old.acted_by then
      raise exception 'A bot cannot undo a sent or applied item';
    end if;
  end if;
  return new;
end $$;

create trigger items_guard_update before update on public.items
  for each row execute function public.guard_item_update();

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.workers enable row level security;
alter table public.bots enable row level security;
alter table public.runs enable row level security;
alter table public.run_events enable row level security;
alter table public.items enable row level security;
alter table public.app_settings enable row level security;
alter table public.chat_messages enable row level security;

-- any signed-in user (owner, operator or viewer) can read everything except chat
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy workers_select on public.workers for select to authenticated using (true);
create policy bots_select on public.bots for select to authenticated using (true);
create policy runs_select on public.runs for select to authenticated using (true);
create policy run_events_select on public.run_events for select to authenticated using (true);
create policy items_select on public.items for select to authenticated using (true);
create policy app_settings_select on public.app_settings for select to authenticated using (true);

-- chat history: own rows only
create policy chat_select on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy chat_update on public.chat_messages for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_delete on public.chat_messages for delete to authenticated
  using (user_id = (select auth.uid()));

-- owner and operator: queue runs, change bot settings, approve / skip / edit items
create policy runs_insert on public.runs for insert to authenticated
  with check ((select public.app_role()) in ('owner', 'operator'));
create policy bots_update on public.bots for update to authenticated
  using ((select public.app_role()) in ('owner', 'operator'))
  with check ((select public.app_role()) in ('owner', 'operator'));
create policy items_update on public.items for update to authenticated
  using ((select public.app_role()) in ('owner', 'operator'))
  with check ((select public.app_role()) in ('owner', 'operator'));

-- owner only: roles, global settings, deleting and adding bots, worker limits
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.app_role()) = 'owner') with check ((select public.app_role()) = 'owner');
create policy app_settings_insert on public.app_settings for insert to authenticated
  with check ((select public.app_role()) = 'owner');
create policy app_settings_update on public.app_settings for update to authenticated
  using ((select public.app_role()) = 'owner') with check ((select public.app_role()) = 'owner');
create policy bots_insert on public.bots for insert to authenticated
  with check ((select public.app_role()) = 'owner');
create policy bots_delete on public.bots for delete to authenticated
  using ((select public.app_role()) = 'owner');
create policy workers_update on public.workers for update to authenticated
  using ((select public.app_role()) = 'owner') with check ((select public.app_role()) = 'owner');

-- Workers use the service role key (server-side only) and bypass RLS.

-- ---------------------------------------------------------------------------
-- grants (explicit, so the Data API works whatever the project defaults are)
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.app_role(), public.is_privileged(), public.can_operate(), public.today_start(),
  public.approval_mode_allowed(text, public.approval_mode),
  public.bot_may_contact(text, public.item_status),
  public.bot_actions_today(uuid), public.linkedin_sent_today(), public.spend_today(),
  public.stop_all(), public.resume_all(), public.request_stop(uuid)
  to authenticated, service_role;
grant execute on function public.claim_next_run(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- realtime: pages update live without refresh
-- (spec: runs, run_events, items, workers; bots and app_settings are added so
--  the schedule switch and the "All bots are stopped" banner are live too)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.runs, public.run_events, public.items, public.workers, public.bots, public.app_settings;
