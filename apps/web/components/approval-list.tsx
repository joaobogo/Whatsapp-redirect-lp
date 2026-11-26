'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { ITEM_KIND_LABELS, timeAgo, type ItemKind, type ItemRow } from '@fgv/shared';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { updateItemsAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

interface BotOption {
  id: string;
  name: string;
  channel: string;
}

function who(item: ItemRow): string {
  return item.person ?? item.title ?? item.company ?? 'Untitled';
}

function what(item: ItemRow): string {
  return [item.person ? item.title : null, item.company, item.location].filter(Boolean).join(' - ');
}

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The Approvals inbox: filter chips, bulk approve, and one card per item. */
export function ApprovalList({
  items,
  bots,
  canOperate,
}: {
  items: ItemRow[];
  bots: BotOption[];
  canOperate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bot, setBot] = useState('');
  const [channel, setChannel] = useState('');
  const [kind, setKind] = useState('');

  const botsById = useMemo(() => new Map(bots.map((entry) => [entry.id, entry])), [bots]);
  const present = useMemo(() => {
    const botIds = new Set(items.map((item) => item.bot_id).filter(Boolean) as string[]);
    return {
      bots: bots.filter((entry) => botIds.has(entry.id)),
      channels: [...new Set(bots.filter((entry) => botIds.has(entry.id)).map((b) => b.channel))],
      kinds: [...new Set(items.map((item) => item.kind))],
    };
  }, [items, bots]);

  const visible = items.filter((item) => {
    const owner = item.bot_id ? botsById.get(item.bot_id) : undefined;
    if (bot && item.bot_id !== bot) return false;
    if (channel && owner?.channel !== channel) return false;
    if (kind && item.kind !== kind) return false;
    return true;
  });
  const visibleIds = new Set(visible.map((item) => item.id));
  const chosen = [...selected].filter((id) => visibleIds.has(id));

  const change = (ids: string[], status: 'approved' | 'skipped', draft?: string) =>
    startTransition(async () => {
      const result = await updateItemsAction({ ids, status, draft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const count = result.data.changed;
      toast.success(
        status === 'approved'
          ? `Approved ${count} ${count === 1 ? 'item' : 'items'}`
          : `Skipped ${count} ${count === 1 ? 'item' : 'items'}`,
      );
      setSelected((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      router.refresh();
    });

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing is waiting for you"
        text="When a bot prepares a message, a proposal or an application, it shows up here for your OK."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" aria-label="Filters">
        <ChipRow
          label="Bot"
          value={bot}
          onChange={setBot}
          options={present.bots.map((entry) => ({ value: entry.id, label: entry.name }))}
        />
        <ChipRow
          label="Channel"
          value={channel}
          onChange={setChannel}
          options={present.channels.map((name) => ({ value: name, label: name }))}
        />
        <ChipRow
          label="Type"
          value={kind}
          onChange={setKind}
          options={present.kinds.map((name) => ({
            value: name,
            label: ITEM_KIND_LABELS[name as ItemKind],
          }))}
        />
      </div>

      {canOperate ? (
        <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={visible.length > 0 && chosen.length === visible.length}
              onChange={(event) =>
                setSelected(
                  event.target.checked ? new Set(visible.map((item) => item.id)) : new Set(),
                )
              }
            />
            Select all ({visible.length})
          </label>
          <Button
            className="ml-auto"
            disabled={pending || chosen.length === 0}
            onClick={() => change(chosen, 'approved')}
            data-testid="approve-selected"
          >
            <Check />
            Approve selected{chosen.length > 0 ? ` (${chosen.length})` : ''}
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title="Nothing matches these filters" />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => (
            <li key={item.id}>
              <ApprovalCard
                item={item}
                botName={item.bot_id ? (botsById.get(item.bot_id)?.name ?? null) : null}
                canOperate={canOperate}
                busy={pending}
                selected={selected.has(item.id)}
                onSelect={(value) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (value) next.add(item.id);
                    else next.delete(item.id);
                    return next;
                  })
                }
                onApprove={(draft) => change([item.id], 'approved', draft)}
                onSkip={() => change([item.id], 'skipped')}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChipRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  if (options.length < 2) return null;
  const chip = (active: boolean) =>
    cn(
      'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium',
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card',
    );
  return (
    <div className="no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <button type="button" className={chip(value === '')} onClick={() => onChange('')}>
        All
      </button>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={chip(value === option.value)}
          aria-pressed={value === option.value}
          onClick={() => onChange(value === option.value ? '' : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ApprovalCard({
  item,
  botName,
  canOperate,
  busy,
  selected,
  onSelect,
  onApprove,
  onSkip,
}: {
  item: ItemRow;
  botName: string | null;
  canOperate: boolean;
  busy: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onApprove: (draft?: string) => void;
  onSkip: () => void;
}) {
  const original = item.draft ?? '';
  const [draft, setDraft] = useState(original);
  const edited = draft !== original;
  const href = safeHref(item.url);
  const isJob = item.kind === 'job';

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="approval-card">
      <div className="flex items-start gap-3">
        {canOperate ? (
          <input
            type="checkbox"
            aria-label={`Select ${who(item)}`}
            className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
            checked={selected}
            onChange={(event) => onSelect(event.target.checked)}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{who(item)}</p>
          {what(item) ? (
            <p className="text-sm break-words text-muted-foreground">{what(item)}</p>
          ) : null}
        </div>
        {item.score !== null ? <Badge variant="accent">Fit {item.score}</Badge> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{ITEM_KIND_LABELS[item.kind]}</Badge>
        {botName ? <span>{botName}</span> : null}
        <span>{timeAgo(item.created_at)}</span>
        {item.pay ? <span>{item.pay}</span> : null}
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex h-11 items-center gap-1 text-sm font-medium text-primary"
          >
            Open <ExternalLink className="size-4" />
          </a>
        ) : null}
      </div>

      {item.fit_reason ? (
        <p className="text-sm">
          <span className="font-medium">Why it fits: </span>
          {item.fit_reason}
        </p>
      ) : null}
      {item.notes ? <p className="text-sm text-muted-foreground">{item.notes}</p> : null}

      {isJob && !original ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Approve to let the job applier send an application for this role.
        </p>
      ) : (
        <Textarea
          aria-label="Draft"
          value={draft}
          readOnly={!canOperate}
          rows={Math.min(12, Math.max(4, Math.ceil(draft.length / 60)))}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {!isJob ? (
        <p className="text-xs text-muted-foreground tabular-nums">{draft.length} characters</p>
      ) : null}

      {canOperate ? (
        <div className="flex flex-wrap gap-2">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => onApprove(edited ? draft : undefined)}
            data-testid="approve"
          >
            <Check />
            {edited ? 'Edit then approve' : 'Approve'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onSkip} data-testid="skip">
            <SkipForward />
            Skip
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
