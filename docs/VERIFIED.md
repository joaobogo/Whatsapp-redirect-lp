# VERIFIED - Phase 0 ground truth

Checked on 26 November 2026, before any code that depends on these was written.
Sources: the installed packages' own type definitions and READMEs, the docs
bundled inside `next` (`node_modules/next/dist/docs`), code.claude.com (Agent
SDK), and the official Supabase Next.js example on GitHub.

Each line is an assumption from the build spec, marked **confirmed** or
**changed to ...**. Where the spec and the current docs disagree, the docs win
and the change is listed again under "What changed and why".

## Packages and versions

| Spec says                                                        | Status                                                                          | Installed                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| pnpm workspaces + Turborepo                                      | confirmed                                                                       | pnpm 10.28, turbo 2.11                                                                               |
| Next.js latest stable, App Router, React, TypeScript             | confirmed                                                                       | next 16.4.6, react 19.3                                                                              |
| TypeScript strict mode                                           | confirmed, pinned to 6.0                                                        | typescript 6.0.3. 7.0 is out but `typescript-eslint` only supports `<6.1`, so lint would break.      |
| Tailwind CSS + shadcn/ui + lucide-react                          | confirmed, with one change (below)                                              | tailwindcss 4.3, lucide-react 1.81, radix-ui 1.8                                                     |
| react-hook-form + zod                                            | confirmed                                                                       | react-hook-form 7.92, zod 4.6                                                                        |
| `@supabase/supabase-js` and `@supabase/ssr`                      | confirmed                                                                       | 2.119 and 0.12.7                                                                                     |
| `@anthropic-ai/sdk`, streaming, tool use                         | confirmed, then **removed from the web app** (see "Claude access and the chat") | peer of the Agent SDK only                                                                           |
| `@anthropic-ai/claude-agent-sdk`                                 | confirmed (name unchanged)                                                      | 0.3.332 (peers: zod ^4, @anthropic-ai/sdk, @modelcontextprotocol/sdk)                                |
| `@playwright/mcp` with a persistent user-data-dir, headed Chrome | confirmed                                                                       | 0.0.86                                                                                               |
| cron-parser                                                      | confirmed                                                                       | 5.10 (`CronExpressionParser.parse(expr, { tz, currentDate }).prev()`)                                |
| pm2 (+ pm2 startup / pm2-installer or NSSM on Windows)           | confirmed                                                                       | pm2 7.1, installed globally per the README                                                           |
| googleapis (service account)                                     | confirmed                                                                       | 190.0                                                                                                |
| Vitest, Playwright test                                          | confirmed                                                                       | vitest 5.1, @playwright/test 1.65                                                                    |
| ESLint                                                           | confirmed, pinned to 9                                                          | eslint 9.39. ESLint 10 is out but the plugins inside `eslint-config-next` 16.4 only support up to 9. |

## Claude Agent SDK (TypeScript) - `query()` options

Read from `sdk.d.ts` 0.3.332 and code.claude.com/docs/en/agent-sdk.

| Option the spec relies on                                          | Status                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `query({ prompt, options })` returns an async iterator of messages | confirmed                                                                                                                                                                                                                                        |
| `model`                                                            | confirmed                                                                                                                                                                                                                                        |
| `systemPrompt` (plain string = custom prompt)                      | confirmed                                                                                                                                                                                                                                        |
| `mcpServers` (record of stdio config or in-process server)         | confirmed                                                                                                                                                                                                                                        |
| in-process custom tools                                            | confirmed: `tool(name, description, zodShape, handler)` + `createSdkMcpServer({ name, version, tools })`; tool names become `mcp__<server>__<tool>`                                                                                              |
| `allowedTools` / `disallowedTools`                                 | confirmed, **meaning changed**: `allowedTools` only pre-approves, it does not restrict. The built-in tool list is restricted with the separate `tools` option (`tools: ['WebSearch','WebFetch']`); `disallowedTools` removes tools from context. |
| permission callback                                                | **changed to a `PreToolUse` hook** (see below). `canUseTool` exists but is never called for tools listed in `allowedTools`, nor in `dontAsk` mode.                                                                                               |
| `maxTurns`                                                         | confirmed                                                                                                                                                                                                                                        |
| abort support                                                      | confirmed: `abortController` option; the iterator throws `AbortError`                                                                                                                                                                            |
| permission mode                                                    | `permissionMode: 'dontAsk'` - anything not pre-approved is denied without a prompt (the documented setup for a headless, locked-down agent)                                                                                                      |
| isolation                                                          | `settingSources: []` (ignore settings files on the worker), `strictMcpConfig: true` (only our two MCP servers), `persistSession: false`                                                                                                          |
| result message                                                     | confirmed: `type: 'result'`, `subtype: 'success'` carries `result` (final text), `total_cost_usd`, `modelUsage`; error subtypes `error_max_turns`, `error_during_execution`, ...                                                                 |
| usage while running                                                | confirmed: every `assistant` message carries `message.usage`; summed per message id and priced from `packages/shared/src/pricing.ts`                                                                                                             |
| hooks                                                              | confirmed: `hooks: { PreToolUse: [{ hooks: [fn], onFailure: 'block' }], PostToolUse: [...] }`; a deny is `{ hookSpecificOutput: { hookEventName, permissionDecision: 'deny', permissionDecisionReason } }`                                       |

## Playwright MCP

Read from `npx @playwright/mcp --help` and its README.

| Assumption         | Status                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| persistent profile | confirmed: `--user-data-dir <path>` (a profile can be used by one browser at a time, which is why a worker runs one browser bot at a time)                                                                                                                           |
| headed Chrome      | confirmed: headed is the default; `--browser chrome` picks installed Chrome                                                                                                                                                                                          |
| allowed tools list | confirmed via the Agent SDK `allowedTools`; we allow only navigate, navigate_back, snapshot, find, click, type, fill_form, select_option, press_key, hover, wait_for, tabs, file_upload, handle_dialog, close                                                        |
| tool parameters    | **changed**: elements are addressed by `target` (a snapshot ref or selector) plus an optional human `element` description - not `ref`. The guard reads both, and also looks the ref up in the last page snapshot so it does not rely on the model's own description. |
| never allowed      | `browser_evaluate`, `browser_run_code_unsafe`, cookie / storage / network-route tools: they could be used to get around the guard                                                                                                                                    |

## Next.js 16 + Supabase SSR auth

| Assumption                                                                    | Status                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Router route handlers, server actions                                     | confirmed                                                                                                                                                                                                                                                                         |
| `middleware.ts` refreshes the session                                         | **changed to `proxy.ts`** exporting `proxy()` - Next.js 16 renamed the file convention                                                                                                                                                                                            |
| page `params` / `searchParams`                                                | confirmed as Promises; typed with the generated `PageProps<'/route'>` and `RouteContext<'/route'>` helpers (`next typegen`)                                                                                                                                                       |
| `createBrowserClient` / `createServerClient` with `cookies.getAll` / `setAll` | confirmed                                                                                                                                                                                                                                                                         |
| checking the user on the server                                               | **changed to `supabase.auth.getClaims()`** (current recommendation; `getSession()` is not trusted on the server)                                                                                                                                                                  |
| env var `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                       | **changed to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** (Supabase's current name, `sb_publishable_...`). The old name still works as a fallback. `SUPABASE_SERVICE_ROLE_KEY` keeps its name and accepts either the new secret key (`sb_secret_...`) or the legacy service_role key. |
| email magic link                                                              | confirmed: `signInWithOtp({ email, options: { emailRedirectTo } })`; `/auth/confirm` accepts both `?token_hash=&type=` and `?code=`; a 6-digit code can be typed as a fallback                                                                                                    |

## Supabase Realtime

| Assumption                                                          | Status    |
| ------------------------------------------------------------------- | --------- |
| `postgres_changes` on tables in the `supabase_realtime` publication | confirmed |
| row level security applies to what a signed-in browser receives     | confirmed |
| filter by column (`run_id=eq.<id>`)                                 | confirmed |

## Claude access and the chat

| Assumption                                                   | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| model ids `claude-opus-5-5` and `claude-sonnet-5-5`          | confirmed; read only from `CLAUDE_MODEL` / `CLAUDE_MODEL_FAST` in the worker's `.env`                                                                                                                                                                                                                                                                                                                                                                           |
| workers authenticate with `ANTHROPIC_API_KEY`                | **changed at John's request: no API key.** The Agent SDK uses `ANTHROPIC_API_KEY` if set, then `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, one year, subscription), then the computer's own Claude login. The worker leaves the key empty and reports which one is in use. Source: code.claude.com/docs/en/authentication.                                                                                                                            |
| chat route calls the Anthropic Messages API from the web app | **changed: the chat runs on the workers.** The web app saves the question (`status: waiting`), a worker claims it (`claim_next_chat`), asks Claude through the Agent SDK with in-process tools, and writes the reply rows. The web app has no Claude key and no `@anthropic-ai/sdk` dependency. Tools that start, stop, change or approve still only save a preview card; the action runs in the web app with the user's own permissions when they tap Confirm. |
| policy                                                       | The Agent SDK overview says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." One's own computers with one's own login is the documented `setup-token` use ("CI pipelines, scripts"); offering this to other people is what the sentence covers.                                                                       |

## What changed and why (tell John)

1. **Safety enforcement moved from the permission callback to a `PreToolUse` hook.**
   The spec asks for the SDK's permission callback. The current docs say that
   callback is skipped for every pre-approved tool, so rules placed there would
   be silently bypassed. A `PreToolUse` hook runs for every tool call, including
   pre-approved ones, and is registered with `onFailure: 'block'` so a crash in
   the check blocks the action instead of letting it through. Same rules,
   stronger enforcement.
2. **`proxy.ts` instead of `middleware.ts`** (Next.js 16 rename).
3. **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` instead of `..._ANON_KEY`**
   (Supabase rename; the old name still works).
4. **shadcn/ui components are written into `apps/web/components/ui` by hand.**
   The shadcn registry (ui.shadcn.com) was not reachable from the build
   machine. The components follow the shadcn structure and `components.json`
   is in place, so `npx shadcn add ...` works later from a normal computer.
5. **Four database columns were added** to the spec's tables. Two are required
   by spec features: `workers.paused` ("Pause this worker") and `items.acted_by`
   (so a daily cap counts the bot that sent or applied, not the bot that found
   the item). Two were added at John's request after the first build, for the
   plan to add more computers: `workers.owner_id` (people manage their own
   computers) and `workers.has_desktop` (full desktop versus browser only;
   recorded and shown, not used for routing until a desktop-control bot exists).
6. **`stop_all()` checks the caller's role**, and `resume_all()` and
   `request_stop()` were added next to it. As written in the spec, any
   signed-in viewer could have called `stop_all()`.
7. **Schedules can hold several cron expressions separated by `;`**, because
   "nights and weekends" cannot be written as one expression.
8. **No Claude API key anywhere, and the chat moved to the workers** (John's
   request after the first build). See "Claude access and the chat" above.

9. **`update_item` accepts `lock: true`**, which performs the conditional
   "lock it first" update that section 7.3 describes. The five tools are
   otherwise as specified.

## Not verifiable from the build machine

These need John's accounts or computers and are checked at the STOP FOR JOHN
points: a real Supabase project (auth emails, Realtime), a real Anthropic key
(bot runs, chat), logged-in browser profiles (LinkedIn, Workable, ...),
Vercel, and the three worker computers.
