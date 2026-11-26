import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { getViewer } from '@/lib/auth';
import {
  chatSystemPrompt,
  historyForModel,
  loadHistory,
  saveEntry,
  type ChatEntry,
} from '@/lib/chat';
import { runChatTool, toolsFor, type ChatCard, type StoredAction } from '@/lib/chat-tools';
import { anthropicConfigured, claudeModel } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 120;

const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

/** Lines sent to the browser, one JSON object per line. */
type StreamEvent =
  | { type: 'user'; entry: ChatEntry }
  | { type: 'text'; text: string }
  | { type: 'card'; card: ChatCard }
  | { type: 'action'; entry: ChatEntry }
  | { type: 'assistant'; entry: ChatEntry }
  | { type: 'error'; message: string }
  | { type: 'done' };

const MAX_TOOL_ROUNDS = 6;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key is not valid. Check ANTHROPIC_API_KEY.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Claude is busy right now. Wait a minute and try again.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check the connection and try again.';
  }
  if (error instanceof Anthropic.APIError) {
    return error.status && error.status >= 500
      ? 'Claude had a problem. Try again in a moment.'
      : 'Claude could not answer that. Try saying it another way.';
  }
  return 'The chat stopped unexpectedly. Try again.';
}

/**
 * POST /api/chat - Claude chat with tools (spec 8.3).
 * The Anthropic key stays on the server; the browser only sees the stream below.
 */
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return json({ error: 'Please log in again.' }, 401);
  if (!anthropicConfigured()) {
    return json({ error: 'The chat needs an Anthropic API key. Add ANTHROPIC_API_KEY.' }, 503);
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'Type a message first.' }, 400);

  const db = await createClient();
  const history = await loadHistory(db, viewer.id);
  const userText = parsed.data.message;
  const userId = await saveEntry(db, 'user', { text: userText });

  const client = new Anthropic();
  const tools = toolsFor(viewer);
  // earlier turns as plain text, ending on the new user message
  const messages: Anthropic.MessageParam[] = historyForModel([
    ...history,
    { id: userId ?? 'new', role: 'user', text: userText },
  ]);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      let fullText = '';
      const cards: ChatCard[] = [];

      try {
        if (userId) send({ type: 'user', entry: { id: userId, role: 'user', text: userText } });

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const run = client.messages.stream(
            {
              model: claudeModel(),
              max_tokens: 16000,
              system: chatSystemPrompt(viewer),
              // a chat drawer wants quick, short answers
              output_config: { effort: 'low' },
              tools,
              messages,
            },
            { signal: request.signal },
          );
          run.on('text', (delta) => {
            fullText += delta;
            send({ type: 'text', text: delta });
          });
          const message = await run.finalMessage();

          if (message.stop_reason === 'refusal') {
            const text = "I can't help with that one.";
            fullText += fullText ? `\n\n${text}` : text;
            send({ type: 'text', text });
            break;
          }
          const toolUses = message.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
          );
          // never act on a tool call that was cut off mid-way
          if (toolUses.length === 0 || message.stop_reason === 'max_tokens') break;

          messages.push({ role: 'assistant', content: message.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            const outcome = await runChatTool(db, viewer, use.name, use.input);
            if (outcome.kind === 'preview') {
              const stored: StoredAction = { ...outcome.action, status: 'pending' };
              const id = await saveEntry(db, 'action', { ...stored });
              if (id) send({ type: 'action', entry: { id, role: 'action', action: stored } });
            } else if (outcome.card) {
              cards.push(outcome.card);
              send({ type: 'card', card: outcome.card });
            }
            results.push({
              type: 'tool_result',
              tool_use_id: use.id,
              content: outcome.text,
              is_error: outcome.kind === 'result' && outcome.isError ? true : undefined,
            });
          }
          messages.push({ role: 'user', content: results });
          if (fullText && !fullText.endsWith('\n')) {
            fullText += '\n\n';
            send({ type: 'text', text: '\n\n' });
          }
        }

        const text = fullText.trim();
        const assistantId = await saveEntry(db, 'assistant', { text, cards });
        if (assistantId) {
          send({ type: 'assistant', entry: { id: assistantId, role: 'assistant', text, cards } });
        }
        send({ type: 'done' });
      } catch (error) {
        if (!request.signal.aborted) {
          // keep what was already said, so the history stays truthful
          if (fullText.trim()) await saveEntry(db, 'assistant', { text: fullText.trim(), cards });
          send({ type: 'error', message: describeFailure(error) });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
