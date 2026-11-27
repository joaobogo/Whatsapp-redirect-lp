'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, CircleAlert, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { CHAT_TIMEOUT_SECONDS, type ChatCard, type ChatEntry } from '@fgv/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import {
  cancelChatAction,
  clearChatAction,
  confirmChatAction,
  loadChatAction,
} from '@/lib/chat-actions';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  "What's waiting for me?",
  'What is running right now?',
  'Run find positions for SEO managers in the UAE, 10 results',
];

const POLL_MS = 1200;

function isOpenRequest(entry: ChatEntry): boolean {
  return entry.role === 'user' && (entry.status === 'waiting' || entry.status === 'working');
}

/**
 * Chat with Claude on every page: a right-side drawer on desktop, a full-screen
 * sheet on a phone. A worker computer answers (with its own Claude access), so
 * the drawer saves the question and then watches the chat for the reply.
 * Actions arrive as cards with a Confirm button.
 */
export function ChatDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // true while a question is with a worker and the reply has not finished
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sent = useRef(0);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    loadChatAction()
      .then((history) => {
        if (cancelled) return;
        setEntries(history);
        // a question asked earlier may still be waiting for a computer
        if (history.some(isOpenRequest)) setWaiting(true);
      })
      .catch(() => {
        if (!cancelled) setError('The earlier messages could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  // while a question is open, watch the chat for the worker's reply
  useEffect(() => {
    if (!open || !waiting) return;
    let stopped = false;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      loadChatAction()
        .then((history) => {
          if (stopped) return;
          setEntries(history);
          if (!history.some(isOpenRequest)) {
            setWaiting(false);
            router.refresh();
          } else if (polls * POLL_MS > CHAT_TIMEOUT_SECONDS * 1000) {
            setWaiting(false);
            setError('No computer has answered yet. Check the Workers page, then ask again.');
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, waiting, router]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [entries, waiting, open]);

  const upsert = useCallback((entry: ChatEntry) => {
    setEntries((current) =>
      current.some((existing) => existing.id === entry.id)
        ? current.map((existing) => (existing.id === entry.id ? entry : existing))
        : [...current, entry],
    );
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending || waiting) return;
    setDraft('');
    setError(null);
    setSending(true);
    sent.current += 1;
    const tempId = `temp-${sent.current}`;
    setEntries((current) => [
      ...current,
      { id: tempId, role: 'user', text: message, status: 'waiting' },
    ]);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok || !body?.id) {
        throw new Error(body?.error ?? 'The chat is not available right now. Try again.');
      }
      setEntries((current) =>
        current.map((entry) => (entry.id === tempId ? { ...entry, id: body.id! } : entry)),
      );
      setWaiting(true);
    } catch (failure) {
      setEntries((current) => current.filter((entry) => entry.id !== tempId));
      setDraft(message);
      setError(
        failure instanceof Error && failure.message
          ? failure.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  }

  async function clear() {
    await clearChatAction();
    setEntries([]);
    setWaiting(false);
    setError(null);
  }

  const busy = sending || waiting;
  const empty = loaded && entries.length === 0;
  const last = entries.at(-1);
  // show "Thinking..." until the reply starts to arrive
  const thinking = waiting && (!last || last.role === 'user');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        placement="side"
        title="Chat"
        description="Ask about your bots, or ask to run one."
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="chat-messages">
          {!loaded ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading...
            </p>
          ) : null}
          {empty ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">Try one of these:</p>
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="min-h-11 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <ol className="flex flex-col gap-3">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Entry
                  entry={entry}
                  onSettled={(next) => {
                    upsert(next);
                    router.refresh();
                  }}
                  onNavigate={() => onOpenChange(false)}
                />
              </li>
            ))}
            {thinking ? (
              <li>
                <AssistantBubble text="" cards={[]} typing />
              </li>
            ) : null}
          </ol>
          {error ? (
            <p
              className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm"
              role="alert"
              data-testid="chat-error"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              {error}
            </p>
          ) : null}
          <div ref={bottom} />
        </div>

        <form
          className="flex items-end gap-2 border-t p-3 pb-safe-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          {entries.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear the chat"
              disabled={busy}
              onClick={() => void clear()}
            >
              <Trash2 />
            </Button>
          ) : null}
          <Textarea
            aria-label="Message"
            placeholder="Ask or tell me what to run"
            rows={1}
            className="max-h-32 min-h-11 flex-1 resize-none py-2.5"
            value={draft}
            enterKeyHint="send"
            data-testid="chat-input"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={busy || draft.trim().length === 0}
            data-testid="chat-send"
          >
            {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Entry({
  entry,
  onSettled,
  onNavigate,
}: {
  entry: ChatEntry;
  onSettled: (entry: ChatEntry) => void;
  onNavigate: () => void;
}) {
  if (entry.role === 'user') {
    return (
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap text-primary-foreground">
        {entry.text}
      </p>
    );
  }
  if (entry.role === 'assistant') {
    return <AssistantBubble text={entry.text} cards={entry.cards} onNavigate={onNavigate} />;
  }
  return <ActionCard entry={entry} onSettled={onSettled} onNavigate={onNavigate} />;
}

function AssistantBubble({
  text,
  cards,
  typing = false,
  onNavigate,
}: {
  text: string;
  cards: ChatCard[];
  typing?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex max-w-[92%] flex-col gap-2">
      {cards.map((card, index) => (
        <ToolCard key={`${card.title}-${index}`} card={card} onNavigate={onNavigate} />
      ))}
      {text ? (
        <p className="w-fit rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap">
          {text}
        </p>
      ) : typing ? (
        <p className="flex w-fit items-center gap-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Thinking...
        </p>
      ) : null}
    </div>
  );
}

function ToolCard({ card, onNavigate }: { card: ChatCard; onNavigate?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate py-2">{card.title}</span>
      {card.link ? (
        <Link
          href={card.link.href}
          onClick={onNavigate}
          className="flex h-11 shrink-0 items-center font-medium text-primary"
        >
          {card.link.label}
        </Link>
      ) : null}
    </div>
  );
}

function ActionCard({
  entry,
  onSettled,
  onNavigate,
}: {
  entry: Extract<ChatEntry, { role: 'action' }>;
  onSettled: (entry: ChatEntry) => void;
  onNavigate: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { action } = entry;

  const settle = (decision: 'confirm' | 'cancel') =>
    startTransition(async () => {
      const result =
        decision === 'confirm'
          ? await confirmChatAction(entry.id)
          : await cancelChatAction(entry.id);
      if (result.ok) onSettled(result.entry);
      else toast.error(result.error);
    });

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-3',
        action.status === 'pending' && 'border-primary bg-accent',
      )}
      data-testid="chat-action"
      data-status={action.status}
    >
      <p className="text-sm font-semibold">{action.title}</p>
      {action.lines.length > 0 ? (
        <ul className="text-xs text-muted-foreground">
          {action.lines.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      {action.status === 'pending' ? (
        <div className="flex gap-2 pt-1">
          <Button
            className="flex-1"
            disabled={pending}
            onClick={() => settle('confirm')}
            data-testid="chat-confirm"
          >
            <Check />
            {pending ? 'Working...' : 'Confirm'}
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => settle('cancel')}>
            <X />
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span
            className={cn(
              'flex items-center gap-1.5',
              action.status === 'confirmed' && 'text-success',
              action.status === 'failed' && 'text-destructive',
              action.status === 'cancelled' && 'text-muted-foreground',
            )}
          >
            {action.status === 'confirmed' ? <Check className="size-4" /> : null}
            {action.status === 'cancelled' ? 'Cancelled' : (action.result ?? 'Done')}
          </span>
          {action.link ? (
            <Link
              href={action.link.href}
              onClick={onNavigate}
              className="flex h-11 shrink-0 items-center font-medium text-primary"
              data-testid="chat-run-link"
            >
              {action.link.label}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
