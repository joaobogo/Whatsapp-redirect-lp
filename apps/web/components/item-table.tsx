'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  ITEM_KIND_LABELS,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  type ItemKind,
  type ItemRow,
  type ItemStatus,
} from '@fgv/shared';
import { EmptyState } from '@/components/empty-state';
import { ItemStatusPill } from '@/components/status-pill';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { updateItemsAction } from '@/lib/actions';

type ColumnId = 'what' | 'company' | 'location' | 'pay' | 'score' | 'kind' | 'notes';

/** Which columns make sense for the kinds of item on screen. */
function columnsFor(kinds: Set<ItemKind>): ColumnId[] {
  const columns: ColumnId[] = ['what', 'company'];
  const has = (...list: ItemKind[]) => list.some((kind) => kinds.has(kind));
  if (kinds.size > 1) columns.push('kind');
  if (has('job', 'candidate', 'lead')) columns.push('location');
  if (has('job', 'proposal')) columns.push('pay');
  if (has('candidate', 'lead', 'message_draft')) columns.push('score');
  if (has('job')) columns.push('notes');
  return columns;
}

const HEADINGS: Record<ColumnId, string> = {
  what: 'Title / person',
  company: 'Company',
  location: 'Location',
  pay: 'Pay',
  score: 'Fit',
  kind: 'Type',
  notes: 'Notes',
};

/** Only http(s) links are rendered as links; anything else a bot saved is shown as text. */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function primary(item: ItemRow): string {
  if (item.kind === 'candidate' || item.kind === 'message_draft') {
    return item.person ?? item.title ?? 'Unnamed';
  }
  return item.title ?? item.person ?? item.company ?? 'Untitled';
}

function secondary(item: ItemRow): string | null {
  if (item.kind === 'candidate' || item.kind === 'message_draft') return item.title;
  return item.person;
}

function cell(item: ItemRow, column: ColumnId): string {
  switch (column) {
    case 'what':
      return primary(item);
    case 'company':
      return item.company ?? '';
    case 'location':
      return item.location ?? '';
    case 'pay':
      return item.pay ?? '';
    case 'score':
      return item.score === null ? '' : String(item.score);
    case 'kind':
      return ITEM_KIND_LABELS[item.kind];
    case 'notes':
      return item.notes ?? '';
  }
}

/**
 * One table of items with kind-aware columns. On a phone it becomes a list of
 * cards, so there is never a horizontal scroll.
 */
export function ItemTable({
  items,
  editable = false,
  emptyTitle = 'Nothing here yet',
  emptyText,
}: {
  items: ItemRow[];
  /** owner / operator may change the status inline (Results page) */
  editable?: boolean;
  emptyTitle?: string;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyState title={emptyTitle} text={emptyText} />;
  const columns = columnsFor(new Set(items.map((item) => item.kind)));

  return (
    <>
      {/* phone: cards */}
      <ul className="flex flex-col gap-3 md:hidden" data-testid="item-list">
        {items.map((item) => {
          const href = safeHref(item.url);
          const sub = secondary(item);
          return (
            <li key={item.id}>
              <Card className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{primary(item)}</p>
                    {sub ? (
                      <p className="text-sm break-words text-muted-foreground">{sub}</p>
                    ) : null}
                  </div>
                  <ItemStatusPill status={item.status} />
                </div>
                <p className="text-sm break-words text-muted-foreground">
                  {[
                    item.company,
                    item.location,
                    item.pay,
                    item.score !== null ? `Fit ${item.score}` : null,
                  ]
                    .filter(Boolean)
                    .join(' - ')}
                </p>
                {item.notes ? (
                  <p className="text-sm break-words text-muted-foreground">{item.notes}</p>
                ) : null}
                <div className="flex items-center gap-2">
                  {editable ? <StatusSelect item={item} /> : null}
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex h-11 items-center gap-1.5 text-sm font-medium text-primary"
                    >
                      Open <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {/* desktop: table */}
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full table-fixed text-left text-sm" data-testid="item-table">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-3 py-2.5 font-medium">
                  {HEADINGS[column]}
                </th>
              ))}
              <th className="w-44 px-3 py-2.5 font-medium">Status</th>
              <th className="w-16 px-3 py-2.5 font-medium">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => {
              const href = safeHref(item.url);
              return (
                <tr key={item.id} className="align-top">
                  {columns.map((column) => (
                    <td key={column} className="px-3 py-2.5 break-words">
                      {column === 'what' ? (
                        <>
                          <span className="font-medium">{primary(item)}</span>
                          {secondary(item) ? (
                            <span className="block text-muted-foreground">{secondary(item)}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{cell(item, column)}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {editable ? (
                      <StatusSelect item={item} />
                    ) : (
                      <ItemStatusPill status={item.status} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${primary(item)} in a new tab`}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-primary hover:bg-muted"
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function StatusSelect({ item }: { item: ItemRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (status: ItemStatus) =>
    startTransition(async () => {
      const result = await updateItemsAction({ ids: [item.id], status });
      if (result.ok) {
        toast.success(`Marked ${ITEM_STATUS_LABELS[status].toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  return (
    <Select
      aria-label={`Status of ${primary(item)}`}
      value={item.status}
      disabled={pending}
      onChange={(event) => change(event.target.value as ItemStatus)}
      className="w-full max-w-44"
    >
      {ITEM_STATUSES.map((status) => (
        <option key={status} value={status}>
          {ITEM_STATUS_LABELS[status]}
        </option>
      ))}
    </Select>
  );
}
