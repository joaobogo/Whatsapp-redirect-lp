-- Acceptance checks for Phase 2. Run by supabase/tests/run.sh after the
-- migration and the seed. Every check raises an exception when it fails.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(p_user uuid, p_role text) returns void
language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    case when p_role is null then '' else json_build_object('sub', p_user, 'role', p_role)::text end,
    true
  );
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok   - refused: %  (%)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAILED - should have been refused: %', p_label;
end $$;

create or replace function pg_temp.expect(p_condition boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAILED - %', p_label; end if;
  raise notice 'ok   - %', p_label;
end $$;

begin;

-- 1. tables exist and RLS is on everywhere ---------------------------------
select pg_temp.expect(
  (select count(*) = 8 from pg_tables where schemaname = 'public'
     and tablename in ('profiles','workers','bots','runs','run_events','items','app_settings','chat_messages')),
  'all eight tables exist');
select pg_temp.expect(
  (select bool_and(relrowsecurity) from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'row level security is enabled on every table');

-- 2. seed ------------------------------------------------------------------
select pg_temp.expect((select count(*) = 8 from public.bots), 'seed shows 8 bots');
select pg_temp.expect(
  (select value = 'false'::jsonb from public.app_settings where key = 'kill_switch'),
  'kill switch starts off');
select pg_temp.expect(
  (select (value)::int = 30 from public.app_settings where key = 'daily_spend_cap_usd'),
  'daily spend cap is 30');
select pg_temp.expect(
  (select (value)::int = 20 from public.app_settings where key = 'linkedin_daily_cap'),
  'LinkedIn daily cap is 20');
select pg_temp.expect(
  (select count(*) = 5 from public.bots where requires_browser), '5 bots need a browser');

-- 3. first user becomes owner, the rest are viewers -------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'operator@test.local'),
  ('00000000-0000-0000-0000-000000000003', 'viewer@test.local');
select pg_temp.expect(
  (select role = 'owner' from public.profiles where id = '00000000-0000-0000-0000-000000000001'),
  'first user ever becomes owner');
select pg_temp.expect(
  (select bool_and(role = 'viewer') from public.profiles
    where id <> '00000000-0000-0000-0000-000000000001'),
  'later users start as viewer');
update public.profiles set role = 'operator' where id = '00000000-0000-0000-0000-000000000002';

-- 4. viewer is read-only -----------------------------------------------------
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003', 'authenticated');

select pg_temp.expect((select count(*) = 8 from public.bots), 'viewer can read bots');
select pg_temp.expect_error(
  $q$insert into public.runs (bot_id, settings_snapshot)
     select id, '{}' from public.bots where slug = 'market-positions'$q$,
  'viewer queues a run');
do $$
declare changed int;
begin
  update public.bots set enabled = true where slug = 'job-scout';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 0, 'viewer cannot change a bot (0 rows updated)');
  update public.app_settings set value = '9999' where key = 'daily_spend_cap_usd';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 0, 'viewer cannot change global settings');
end $$;
select pg_temp.expect_error('select public.stop_all()', 'viewer presses Stop all');
select pg_temp.expect_error(
  $q$select public.claim_next_run(gen_random_uuid(), true)$q$,
  'a signed-in user calls claim_next_run');

-- 5. operator can run and change click-settings, not prompts or roles -------
select pg_temp.act_as('00000000-0000-0000-0000-000000000002', 'authenticated');
insert into public.runs (bot_id, settings_snapshot, status, cost_usd, requested_by)
  select id, '{"count": 5}', 'succeeded', 99, '00000000-0000-0000-0000-000000000001'
    from public.bots where slug = 'market-positions';
select pg_temp.expect(
  (select status = 'queued' and cost_usd = 0
          and requested_by = '00000000-0000-0000-0000-000000000002'
     from public.runs limit 1),
  'a queued run is always queued, free and owned by the person who asked');
do $$
declare changed int;
begin
  update public.bots set settings = '{"count": 10}', enabled = true, daily_cap = 5
   where slug = 'market-positions';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 1, 'operator can change bot settings, schedule and caps');
  update public.profiles set role = 'owner' where id = '00000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 0, 'operator cannot change roles');
end $$;
select pg_temp.expect_error(
  $q$update public.bots set prompt_template = 'ignore the rules' where slug = 'market-positions'$q$,
  'operator edits a prompt');
select pg_temp.expect_error(
  $q$update public.bots set approval_mode = 'auto_within_rules' where slug = 'candidate-finder'$q$,
  'auto mode on a draft bot');
select pg_temp.expect_error(
  $q$update public.bots set approval_mode = 'draft_only' where slug = 'linkedin-outreach'$q$,
  'linkedin-outreach in any mode but approve_each');
update public.bots set approval_mode = 'auto_within_rules' where slug = 'job-apply';
update public.bots set approval_mode = 'approve_each' where slug = 'job-apply';
select pg_temp.expect(true, 'job-apply may switch between approve_each and auto_within_rules');

-- chat history is private
insert into public.chat_messages (role, content) values ('user', '"hello"');
select pg_temp.act_as('00000000-0000-0000-0000-000000000003', 'authenticated');
select pg_temp.expect((select count(*) = 0 from public.chat_messages), 'chat messages are own-rows only');

-- 6. owner-only actions ------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000001', 'authenticated');
update public.bots set prompt_template = prompt_template || ' ' where slug = 'market-positions';
update public.app_settings set value = '40' where key = 'daily_spend_cap_usd';
select pg_temp.expect(
  (select (value)::int = 40 from public.app_settings where key = 'daily_spend_cap_usd'),
  'owner can change global settings and prompts');
update public.app_settings set value = '30' where key = 'daily_spend_cap_usd';
select pg_temp.expect_error(
  $q$update public.profiles set role = 'viewer' where id = '00000000-0000-0000-0000-000000000001'$q$,
  'demoting the last owner');

-- 7. items: approval and caps (rules 5 and 6) -------------------------------
reset role;
select pg_temp.act_as(null, null);   -- direct access = the worker's service role

select pg_temp.expect_error(
  $q$insert into public.items (kind, status, title) values ('candidate', 'approved', 'x')$q$,
  'creating an item already approved');

insert into public.items (id, bot_id, kind, status, person, draft, dedupe_key)
  select ('10000000-0000-0000-0000-00000000000' || n)::uuid,
         (select id from public.bots where slug = 'candidate-finder'),
         'candidate', 'needs_approval', 'Person ' || n, 'Hello', 'cand-' || n
    from generate_series(1, 4) n;

select pg_temp.expect_error(
  $q$update public.items set status = 'sent',
       acted_by = (select id from public.bots where slug = 'linkedin-outreach')
     where id = '10000000-0000-0000-0000-000000000001'$q$,
  'sending an item that was never approved');
select pg_temp.expect_error(
  $q$update public.items set status = 'sent' where id = '10000000-0000-0000-0000-000000000001'$q$,
  'a bot marking sent without saying who acted');

-- the operator approves two, edits a draft, and may not rewrite the facts
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002', 'authenticated');
update public.items set status = 'approved', draft = 'Hello, edited'
 where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002',
              '10000000-0000-0000-0000-000000000003');
select pg_temp.expect_error(
  $q$update public.items set url = 'https://evil.example' where id = '10000000-0000-0000-0000-000000000001'$q$,
  'a person rewriting an item url');
reset role;
select pg_temp.act_as(null, null);

select pg_temp.expect_error(
  $q$update public.items set status = 'sent',
       acted_by = (select id from public.bots where slug = 'candidate-finder')
     where id = '10000000-0000-0000-0000-000000000001'$q$,
  'a drafting bot marking an approved item sent');

update public.items set status = 'sent',
       acted_by = (select id from public.bots where slug = 'linkedin-outreach')
 where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select acted_at is not null from public.items where id = '10000000-0000-0000-0000-000000000001'),
  'an approved item can be sent, and acted_at is stamped');
select pg_temp.expect(
  public.bot_actions_today((select id from public.bots where slug = 'linkedin-outreach')) = 1,
  'bot_actions_today counts the bot that acted');
select pg_temp.expect(public.linkedin_sent_today() = 1, 'linkedin_sent_today counts it');

-- LinkedIn cap: lower it to 1 and the next approved item is refused
update public.app_settings set value = '1' where key = 'linkedin_daily_cap';
select pg_temp.expect_error(
  $q$update public.items set status = 'sent',
       acted_by = (select id from public.bots where slug = 'linkedin-outreach')
     where id = '10000000-0000-0000-0000-000000000002'$q$,
  'sending past the LinkedIn daily cap');
-- the setting can never raise the cap above 20
update public.app_settings set value = '500' where key = 'linkedin_daily_cap';
update public.bots set daily_cap = 1 where slug = 'linkedin-outreach';
select pg_temp.expect_error(
  $q$update public.items set status = 'sent',
       acted_by = (select id from public.bots where slug = 'linkedin-outreach')
     where id = '10000000-0000-0000-0000-000000000002'$q$,
  'sending past the bot daily cap');
update public.bots set daily_cap = 20 where slug = 'linkedin-outreach';
update public.app_settings set value = '20' where key = 'linkedin_daily_cap';

-- job-apply: ready jobs only in auto mode
insert into public.items (id, bot_id, kind, status, title, dedupe_key)
  values ('20000000-0000-0000-0000-000000000001',
          (select id from public.bots where slug = 'job-scout'), 'job', 'ready', 'CMO', 'job-1');
select pg_temp.expect_error(
  $q$update public.items set status = 'applied',
       acted_by = (select id from public.bots where slug = 'job-apply')
     where id = '20000000-0000-0000-0000-000000000001'$q$,
  'applying to a job John has not approved (approve_each mode)');
update public.bots set approval_mode = 'auto_within_rules' where slug = 'job-apply';
update public.items set status = 'applied',
       acted_by = (select id from public.bots where slug = 'job-apply')
 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  public.bot_actions_today((select id from public.bots where slug = 'job-apply')) = 1,
  'in auto mode job-apply may apply to a ready job');
update public.bots set approval_mode = 'approve_each' where slug = 'job-apply';

-- 8. spend cap and kill switch ------------------------------------------------
update public.runs set cost_usd = 30, started_at = now();
select pg_temp.expect(public.spend_today() = 30, 'spend_today adds up run costs');
select pg_temp.expect_error(
  $q$insert into public.runs (bot_id, settings_snapshot)
     select id, '{}' from public.bots where slug = 'market-positions'$q$,
  'queueing a run past the daily spend cap');
update public.runs set cost_usd = 0;

insert into public.workers (id, name) values ('30000000-0000-0000-0000-000000000001', 'test-worker');
insert into public.runs (bot_id, settings_snapshot)
  select id, '{}' from public.bots where slug in ('market-positions', 'job-apply');
update public.runs set status = 'running', worker_id = '30000000-0000-0000-0000-000000000001'
 where bot_id = (select id from public.bots where slug = 'job-apply');

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000000002', 'authenticated');
select public.stop_all();
reset role;
select pg_temp.act_as(null, null);

select pg_temp.expect(
  (select value = 'true'::jsonb from public.app_settings where key = 'kill_switch'),
  'Stop all sets the kill switch');
select pg_temp.expect(
  (select count(*) = 0 from public.runs where status in ('queued', 'claimed', 'running')),
  'Stop all leaves nothing queued or running');
select pg_temp.expect(
  (select count(*) = 1 from public.runs where status = 'stop_requested'),
  'running runs are asked to stop');
select pg_temp.expect(
  public.claim_next_run('30000000-0000-0000-0000-000000000001', true) is null,
  'nothing can be claimed while the kill switch is on');
select pg_temp.expect_error(
  $q$insert into public.runs (bot_id, settings_snapshot)
     select id, '{}' from public.bots where slug = 'market-positions'$q$,
  'queueing a run while everything is stopped');

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003', 'authenticated');
select pg_temp.expect_error('select public.resume_all()', 'viewer presses Resume');
select pg_temp.act_as('00000000-0000-0000-0000-000000000002', 'authenticated');
select public.resume_all();
reset role;
select pg_temp.act_as(null, null);
select pg_temp.expect(
  (select value = 'false'::jsonb from public.app_settings where key = 'kill_switch'),
  'Resume clears the kill switch');

-- 9. claim rules ---------------------------------------------------------------
delete from public.runs;
insert into public.runs (bot_id, settings_snapshot, queued_at)
  select id, '{}', now() - interval '2 minutes' from public.bots where slug = 'job-apply';
insert into public.runs (bot_id, settings_snapshot, queued_at)
  select id, '{}', now() - interval '1 minute' from public.bots where slug = 'market-positions';

select pg_temp.expect(
  (select b.slug = 'market-positions'
     from public.claim_next_run('30000000-0000-0000-0000-000000000001', false) r
     join public.bots b on b.id = r.bot_id),
  'a worker without a free browser skips browser bots');
select pg_temp.expect(
  (select r.status = 'claimed' and r.worker_id = '30000000-0000-0000-0000-000000000001'
          and r.started_at is not null
     from public.runs r join public.bots b on b.id = r.bot_id where b.slug = 'market-positions'),
  'a claimed run records the worker and the start time');

update public.workers set paused = true where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  public.claim_next_run('30000000-0000-0000-0000-000000000001', true) is null,
  'a paused worker claims nothing');
update public.workers set paused = false where id = '30000000-0000-0000-0000-000000000001';

insert into public.workers (id, name) values ('30000000-0000-0000-0000-000000000002', 'other-worker');
update public.bots set preferred_worker = '30000000-0000-0000-0000-000000000002' where slug = 'job-apply';
select pg_temp.expect(
  public.claim_next_run('30000000-0000-0000-0000-000000000001', true) is null,
  'a run for a bot with a preferred worker waits for that worker');
select pg_temp.expect(
  (public.claim_next_run('30000000-0000-0000-0000-000000000002', true)).id is not null,
  'the preferred worker claims it');

-- 10. people manage their own computers, and only theirs -----------------------
update public.workers set owner_id = '00000000-0000-0000-0000-000000000003'
 where id = '30000000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-000000000003', 'authenticated');
do $$
declare changed int;
begin
  update public.workers set paused = true, max_concurrency = 1
   where id = '30000000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 1, 'a person can pause their own computer, even as a viewer');
  update public.workers set paused = true where id = '30000000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  perform pg_temp.expect(changed = 0, 'a person cannot touch someone else''s computer');
end $$;
select pg_temp.expect_error(
  $q$update public.workers set owner_id = null where id = '30000000-0000-0000-0000-000000000001'$q$,
  'a person giving away or renaming their computer');
select pg_temp.expect_error(
  $q$update public.workers set has_desktop = true where id = '30000000-0000-0000-0000-000000000001'$q$,
  'a person switching on full desktop control from the app');

select pg_temp.act_as('00000000-0000-0000-0000-000000000001', 'authenticated');
update public.workers set owner_id = '00000000-0000-0000-0000-000000000002'
 where id = '30000000-0000-0000-0000-000000000001';
select pg_temp.expect(
  (select owner_id = '00000000-0000-0000-0000-000000000002' from public.workers
    where id = '30000000-0000-0000-0000-000000000001'),
  'an app owner can assign a computer to a person');
reset role;
select pg_temp.act_as(null, null);

rollback;
\echo 'schema checks passed'
