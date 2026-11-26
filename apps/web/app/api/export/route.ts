import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth';
import { itemsToCsv } from '@/lib/csv';
import { getItems, parseItemFilters } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

const MAX_ROWS = 5000;

/**
 * GET /api/export - CSV of items.
 *   ?run=<id>   the items of one run
 *   otherwise   the same filters as the Results page (kind, status, bot, from, to, q, sort)
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Please log in again.' }, { status: 401 });

  const db = await createClient();
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const runId = params.run;

  let items;
  let name = 'fgv-results';
  if (runId) {
    if (!z.uuid().safeParse(runId).success) {
      return NextResponse.json({ error: 'That run does not exist.' }, { status: 404 });
    }
    const { data } = await db
      .from('items')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS);
    items = data ?? [];
    name = `fgv-run-${runId.slice(0, 8)}`;
  } else {
    items = await getItems(db, parseItemFilters(params), MAX_ROWS);
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(itemsToCsv(items), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}-${date}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
