#!/usr/bin/env bash
# Runs the end-to-end smoke test with no Supabase account:
# a throwaway Postgres database + the small test stand-in in server.mjs.
#
#   LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fgv_e2e pnpm e2e:local
#
# The database is wiped and rebuilt on every run.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
url="${LOCAL_DATABASE_URL:-}"
if [ -z "$url" ]; then
  echo "Set LOCAL_DATABASE_URL to a throwaway Postgres database." >&2
  exit 2
fi

sql() { psql "$url" -v ON_ERROR_STOP=1 -q "$@" >/dev/null; }
sql -c "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;"
sql -f "$root/supabase/tests/00_supabase_stubs.sql"
sql -f "$root/supabase/migrations/0001_init.sql"
sql -f "$root/supabase/seed.sql"

export LOCAL_DATABASE_URL="$url"
export E2E_LOCAL=1
cd "$root"
exec pnpm exec playwright test "$@"
