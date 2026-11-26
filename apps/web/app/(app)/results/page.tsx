import { ItemTable } from '@/components/item-table';
import { ResultsFilters } from '@/components/results-filters';
import { canOperate, requireViewer } from '@/lib/auth';
import { getItems, parseItemFilters } from '@/lib/data';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Results' };

const PAGE_SIZE = 200;

export default async function ResultsPage(props: PageProps<'/results'>) {
  const viewer = await requireViewer();
  const params = await props.searchParams;
  const filters = parseItemFilters(params);
  const db = await createClient();
  const [items, bots] = await Promise.all([
    getItems(db, filters, PAGE_SIZE),
    db.from('bots').select('id, name').order('name'),
  ]);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value) query.set(key, value);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Results</h1>
      <ResultsFilters
        bots={bots.data ?? []}
        exportHref={`/api/export${query.size > 0 ? `?${query.toString()}` : ''}`}
        count={items.length}
        limit={PAGE_SIZE}
      />
      <ItemTable
        items={items}
        editable={canOperate(viewer.role)}
        emptyTitle="No results match"
        emptyText="Change the filters, or run a bot to find something."
      />
    </div>
  );
}
