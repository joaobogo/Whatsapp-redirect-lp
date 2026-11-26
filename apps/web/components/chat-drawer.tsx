'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, CircleAlert, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import type { ChatEntry } from '@/lib/chat';
import {
  cancelChatAction,
  clearChatAction,
  confirmChatAction,
  loadChatAction,
} from '@/lib/chat-actions';
import type { ChatCard } from '@/lib/chat-tools';
import { cn } from '@/lib/utils';

type StreamEvent =
  | { type: 'user'; entry: ChatEntry }
  | { type: 'text'; text: string }
  | { type: 'card'; card: ChatCard }
  | { type: 'action'; entry: ChatEntry }
  | { type: 'assistant'; entry: ChatEntry }
  | { type: 'error'; message: string }
  | { type: 'done' };

const SUGGESTIONS = [
  "What's waiting for me?",
  'What is running right now?',
  'Run find positions for SEO managers in the UAE, 10 results',
];

/**
 * Chat with Claude on every page: a right-side drawer on desktop, a full-screen
 * sheet on a phone. Actions arrive as cards with a Confirm button.
 */
export function ChatDrawer({
  open,
  onOpenChange,
  ready,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ready: boolean;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<{ text: string; cards: ChatCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    loadChatAction()
      .then((history) => {
        if (!cancelled) setEntries(history);
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

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [entries, live, open]);

  useEffect(() => () => abort.current?.abort(), []);

  const upsert = useCallback((entry: ChatEntry) => {
    setEntries((current) =>
      current.some((existing) => existing.id === entry.id)
        ? current.map((existing) => (existing.id === entry.id ? entry : existing))
        : [...current, entry],
    );
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || streaming) return;
    setDraft('');
    setError(null);
    setStreaming(true);
    setLive({ text: '', cards: [] });
    const tempId = `temp-${Date.now()}`;
    setEntries((current) => [...current, { id: tempId, role: 'user', text: message }]);
    abort.current = new AbortController();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abort.current.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'The chat is not available right now. Try again.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case 'user':
            setEntries((current) =>
              current.map((entry) => (entry.id === tempId ? event.entry : entry)),
            );
            break;
          case 'text':
            setLive((current) => ({
              text: (current?.text ?? '') + event.text,
              cards: current?.cards ?? [],
            }));
            break;
          case 'card':
            setLive((current) => ({
              text: current?.text ?? '',
              cards: [...(current?.cards ?? []), event.card],
            }));
            break;
          case 'action':
            upsert(event.entry);
            break;
          case 'assistant':
            setLive(null);
            upsert(event.entry);
            break;
          case 'error':
            setError(event.message);
            break;
          case 'done':
            break;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) handle(JSON.parse(line) as StreamEvent);
        }
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
        setError(
          failure instanceof Error && failure.message
            ? failure.message
            : 'The chat stopped unexpectedly. Try again.',
        );
      }
    } finally {
      setLive(null);
      setStreaming(false);
      abort.current = null;
    }
  }

  async function clear() {
    await clearChatAction();
    setEntries([]);
    setError(null);
  }

  const empty = loaded && entries.length === 0 && !live;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        placement="side"
        title="Chat"
        description="Ask about your bots, or ask to run one."
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="chat-messages">
          {!ready ? (
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              The chat needs an Anthropic API key. Add ANTHROPIC_API_KEY to the web app&apos;s
              settings, then reload.
            </p>
          ) : null}
          {!loaded ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading...
            </p>
          ) : null}
          {empty && ready ? (
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
            {live ? (
              <li>
                <AssistantBubble text={live.text} cards={live.cards} typing />
              </li>
            ) : null}
          </ol>
          {error ? (
            <p
              className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm"
              role="alert"
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
              disabled={streaming}
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
            disabled={!ready}
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
            disabled={!ready || streaming || draft.trim().length === 0}
            data-testid="chat-send"
          >
            {streaming ? <Loader2 className="animate-spin" /> : <ArrowUp />}
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
