'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, Search, SlidersHorizontal } from 'lucide-react';
import { ITEM_KINDS, ITEM_KIND_LABELS, ITEM_STATUSES, ITEM_STATUS_LABELS } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';

/** Filters live in the URL, so a filtered view can be shared and exported as-is. */
export function ResultsFilters({
  bots,
  exportHref,
  count,
  limit,
}: {
  bots: { id: string; name: string }[];
  exportHref: string;
  count: number;
  limit: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const active = ['kind', 'status', 'bot', 'from', 'to', 'sort'].filter((key) => params.get(key));
  const [open, setOpen] = useState(active.length > 0);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size > 0 ? `?${next.toString()}` : ''}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-3">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          set('q', search.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search results"
            placeholder="Search title, company, person"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <SlidersHorizontal />
          <span className="hidden sm:inline">Filters</span>
          {active.length > 0 ? ` (${active.length})` : ''}
        </Button>
      </form>

      {open ? (
        <div className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 md:grid-cols-3">
          <Filter label="Type" id="f-kind">
            <Select
              id="f-kind"
              value={params.get('kind') ?? ''}
              onChange={(event) => set('kind', event.target.value)}
            >
              <option value="">All types</option>
              {ITEM_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ITEM_KIND_LABELS[kind]}
                </option>
              ))}
            </Select>
          </Filter>
          <Filter label="Status" id="f-status">
            <Select
              id="f-status"
              value={params.get('status') ?? ''}
              onChange={(event) => set('status', event.target.value)}
            >
              <option value="">All statuses</option>
              {ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ITEM_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Filter>
          <Filter label="Bot" id="f-bot">
            <Select
              id="f-bot"
              value={params.get('bot') ?? ''}
              onChange={(event) => set('bot', event.target.value)}
            >
              <option value="">All bots</option>
              {bots.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name}
                </option>
              ))}
            </Select>
          </Filter>
          <Filter label="From" id="f-from">
            <Input
              id="f-from"
              type="date"
              value={params.get('from') ?? ''}
              onChange={(event) => set('from', event.target.value)}
            />
          </Filter>
          <Filter label="To" id="f-to">
            <Input
              id="f-to"
              type="date"
              value={params.get('to') ?? ''}
              onChange={(event) => set('to', event.target.value)}
            />
          </Filter>
          <Filter label="Sort" id="f-sort">
            <Select
              id="f-sort"
              value={params.get('sort') ?? ''}
              onChange={(event) => set('sort', event.target.value)}
            >
              <option value="">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="score">Best fit first</option>
              <option value="company">Company A-Z</option>
            </Select>
          </Filter>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="result-count">
          {count >= limit
            ? `Showing the first ${limit}`
            : `${count} ${count === 1 ? 'result' : 'results'}`}
        </p>
        <Button variant="outline" asChild>
          <a href={exportHref} download data-testid="export-csv">
            <Download />
            Export CSV
          </a>
        </Button>
      </div>
    </div>
  );
}

function Filter({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
