#!/usr/bin/env bash
# Phase 2 acceptance checks for the database.
#
#   TEST_DATABASE_URL=postgresql://user:pass@host:5432/dbname  pnpm db:test
#
# Point it at a THROWAWAY database: the script drops and recreates the public
# schema. On plain Postgres it first creates small stand-ins for the things a
# Supabase project already has (auth schema, roles, realtime publication).
# Against a local Supabase (`supabase start`) set SKIP_STUBS=1.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
url="${TEST_DATABASE_URL:-}"

if [ -z "$url" ]; then
  echo "Set TEST_DATABASE_URL to a throwaway Postgres database." >&2
  exit 2
fi

run_sql() { psql "$url" -v ON_ERROR_STOP=1 -q "$@"; }

echo "== reset"
run_sql -c "drop schema if exists public cascade; create schema public;" >/dev/null
if [ "${SKIP_STUBS:-0}" != "1" ]; then
  run_sql -c "drop schema if exists auth cascade;" >/dev/null
  run_sql -f "$here/00_supabase_stubs.sql" >/dev/null
fi

echo "== migration"
run_sql -f "$root/supabase/migrations/0001_init.sql" >/dev/null
echo "== seed (twice, to prove it is safe to re-run)"
run_sql -f "$root/supabase/seed.sql" >/dev/null
run_sql -f "$root/supabase/seed.sql" >/dev/null

echo "== schema, RLS and safety-rule checks"
run_sql -f "$here/01_schema_test.sql" 2>&1 | grep -E "ok   -|FAILED|ERROR|passed" || true
run_sql -f "$here/01_schema_test.sql" >/dev/null 2>&1

echo "== claim_next_run under concurrency (no double claims)"
RUNS=60
CLAIMERS=8
run_sql >/dev/null <<SQL
delete from public.runs;
delete from public.workers;
insert into public.workers (id, name)
  select ('40000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'claimer-' || n
    from generate_series(1, $CLAIMERS) n;
insert into public.runs (bot_id, settings_snapshot)
  select (select id from public.bots where slug = 'market-positions'), '{}'
    from generate_series(1, $RUNS);
SQL

out="$(mktemp -d)"
for n in $(seq 1 "$CLAIMERS"); do
  worker="40000000-0000-0000-0000-0000000000$(printf '%02d' "$n")"
  (
    while true; do
      id="$(psql "$url" -At -v ON_ERROR_STOP=1 \
        -c "select (public.claim_next_run('$worker', true)).id")"
      [ -z "$id" ] && break
      echo "$id" >> "$out/claimer-$n.txt"
    done
  ) &
done
wait

total="$(cat "$out"/claimer-*.txt | wc -l | tr -d ' ')"
unique="$(cat "$out"/claimer-*.txt | sort -u | wc -l | tr -d ' ')"
left="$(psql "$url" -At -c "select count(*) from public.runs where status = 'queued'")"
echo "claimed $total runs with $CLAIMERS concurrent workers, $unique unique, $left left queued"
if [ "$total" != "$RUNS" ] || [ "$unique" != "$RUNS" ] || [ "$left" != "0" ]; then
  echo "FAILED - a run was claimed twice or left behind" >&2
  exit 1
fi
echo "ok   - two concurrent claims never return the same run"

run_sql -c "delete from public.runs; delete from public.workers;" >/dev/null
echo "ALL DATABASE CHECKS PASSED"
