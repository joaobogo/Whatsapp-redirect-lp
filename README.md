# FGV Control Panel

One screen to run Flow Group Ventures bots: switch them on and off, start them
with one tap, change what they do with click-only settings, approve their work,
watch results arrive live, and ask a built-in Claude chat to do any of it.

- **Web app** (phone-first) - what you look at. Hosted on Vercel.
- **Database** - Supabase. The single source of truth.
- **Workers** - a small program on each of your computers (Pichau desktop,
  Windows laptop, Chromebook). They pick up runs and do the work with Claude.

The web app never runs a bot itself. It only writes "please run this" into the
database; a worker computer picks it up. More computers = more bots at once.

---

## What only you can do

Everything else is already built. These steps need your accounts or your hands.

| When              | What you do                                                              | Time        |
| ----------------- | ------------------------------------------------------------------------ | ----------- |
| Step 1            | Create a Supabase project, paste the URL and keys                        | 5 min       |
| Step 3            | Log in to Claude on each worker computer (your subscription; no API key) | 5 min       |
| Step 5            | Sign in to LinkedIn, Indeed, Workable, Gmail in the bots' Chrome window  | 10 min      |
| Step 6            | Copy your CV, photo and profile.json into `apps/worker/assets/`          | 2 min       |
| Step 7            | Vercel account, connect GitHub, paste the keys                           | 15 min      |
| Step 8            | Install the worker on each computer                                      | 15 min each |
| Step 9 (optional) | Google service account for the Sales Queue sheet                         | 10 min      |

You need on your computer: **Node.js LTS** (nodejs.org), **Git**, and **pnpm**
(`npm install -g pnpm`). Then, in this folder:

```bash
pnpm install
```

---

## Step 1 - Supabase (the database)

1. Go to **supabase.com**, sign in, press **New project**. Any name (for
   example `fgv-control-panel`), any strong database password, the region
   closest to you. The free tier is enough. Wait about a minute.
2. Open **SQL Editor** (left menu) > **New query**. Open the file
   `supabase/migrations/0001_init.sql` from this folder, copy everything, paste
   it, press **Run**. It should say "Success".
3. **New query** again. Do the same with `supabase/seed.sql`. This adds the
   eight bots and the global settings. (Running it twice is harmless.)
4. Open **Project Settings > API Keys** (and **Data API** for the URL). You need
   three values:
   - **Project URL** - looks like `https://abcdefgh.supabase.co`
   - **Publishable key** - starts with `sb_publishable_` (the older "anon" key works too)
   - **Secret key** - starts with `sb_secret_` (the older "service_role" key works too).
     Treat it like a password.
5. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in:

   ```
   NEXT_PUBLIC_SUPABASE_URL=        <- Project URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   <- Publishable key
   SUPABASE_SERVICE_ROLE_KEY=       <- Secret key
   ```

6. Make the login email work on your phone. In Supabase open
   **Authentication > Emails > Templates > Magic Link** and replace the body with:

   ```html
   <h2>Log in to FGV Control Panel</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Log in</a></p>
   <p>Or type this code: <strong>{{ .Token }}</strong></p>
   ```

   Do the same for the **Invite user** template (use `type=invite` in the link).
   With this, the link works even when your email app opens it in a different
   browser, and the 6-digit code is there as a fallback.

`.env.local` is never committed. Keys live only in `.env.local` (web) and
`.env` (worker).

**Check it worked:** in SQL Editor run `select name, channel from bots;` - you
should see 8 rows.

## Step 2 - Run the web app on your computer

```bash
pnpm --filter @fgv/web dev
```

Open http://localhost:3000. Type your email, press **Send me a login link**,
open the email, tap the link (or type the code). **The first person who ever
logs in becomes the owner.** Everyone after that starts as a viewer until an
owner changes their role in **Settings > Users**.

You should see the Home screen with 8 bot cards grouped by channel.

## Step 3 - Claude access (no API key needed)

The bots and the chat run on your worker computers and use **that computer's
own Claude access**. The web app holds no Claude key at all. Per computer, pick
one:

1. **Your Claude subscription, by logging in (simplest).** Install Claude Code
   on the computer (`npm install -g @anthropic-ai/claude-code`), run `claude`
   once and log in with your claude.ai account. Leave both Claude lines in
   `apps/worker/.env` empty.
2. **Your Claude subscription, by token.** On a computer where you do not want
   to log in by hand, run `claude setup-token` on any logged-in computer, and
   paste the token it prints as `CLAUDE_CODE_OAUTH_TOKEN=` in that worker's
   `.env`. The token lasts one year. Treat it like a password.
3. **A pay-per-use API key.** Only if you ever want it: set `ANTHROPIC_API_KEY=`.
   If that line is filled in it is always used, even on a logged-in computer.

The worker prints which one it is using when it starts ("Claude access: ...").

Things to know about running on a subscription:

- Your plan's usage limits apply, and every computer on the same account
  shares them. When the limit is reached, runs fail with "Claude is not
  available: ... usage limit" and work again after it resets. More computers
  do not mean more usage allowance.
- The "cost" and "spend today" numbers are **estimates** of what the same work
  would cost on the API. They are not money charged to you. The daily cap in
  Settings still stops new runs when the estimate reaches it.
- Anthropic's Agent SDK docs say: "Unless previously approved, Anthropic does
  not allow third party developers to offer claude.ai login or rate limits for
  their products, including agents built on the Claude Agent SDK." Running
  this on your own computers with your own login is one thing; offering it to
  other people on your login, or on theirs, is what that sentence is about.
  Check with Anthropic before you do that.

The models are set in `apps/worker/.env` and nowhere else: `CLAUDE_MODEL`
(default `claude-opus-5-5`, for bots that write, judge or apply, and for the
chat) and `CLAUDE_MODEL_FAST` (default `claude-sonnet-5-5`, for cheap
scouting). Leave them empty to use the defaults.

## Step 4 - Start a worker on this computer

1. Copy `apps/worker/.env.example` to `apps/worker/.env` and fill in:

   ```
   SUPABASE_URL=                 <- same Project URL
   SUPABASE_SERVICE_ROLE_KEY=    <- same Secret key
   CLAUDE_CODE_OAUTH_TOKEN=      <- leave empty to use this computer's Claude login (Step 3)
   ANTHROPIC_API_KEY=            <- leave empty
   WORKER_NAME=pichau-desktop    <- a short name for this computer
   WORKER_MAX_CONCURRENCY=3
   WORKER_HAS_BROWSER=true
   WORKER_HAS_DESKTOP=false      <- true if this computer also offers full desktop control
   WORKER_OWNER_EMAIL=           <- login email of the person this computer belongs to
   WORKER_IS_SCHEDULER=true      <- true on ONE computer only (the always-on one)
   BROWSER_PROFILE_DIR=./profiles/main
   APPLICANT_PROFILE_JSON=./assets/profile.json
   ```

2. Start it:

   ```bash
   pnpm worker:dev
   ```

   It prints `Worker "pichau-desktop" is online`. The **Workers** page in the
   app shows it within a few seconds.

3. Try the demo bot: on Home, tap **Run now** on "Find positions in the
   market", set role = "Head of Marketing", region = "Worldwide", how many = 5,
   tap **Run now**. The run page shows the live log, then the results and the cost.

## Step 5 - Sign in for the browser bots

Five bots use a real Chrome window (job applier, candidate finder, LinkedIn
sender, network drafter, marketplace proposals). They use **their own Chrome
profile on the worker**, not your everyday Chrome, and they never type
passwords. You sign in once, by hand:

1. Install **Google Chrome** on the worker computer if it is not there.
2. Stop the worker (Ctrl+C), then run:

   ```bash
   pnpm worker:login
   ```

3. A Chrome window opens. Sign in to **LinkedIn, Indeed, Workable and Gmail**,
   and any other site a bot should use (Upwork, Workana, 99Freelas...).
4. Close the Chrome window. The sessions are saved in `apps/worker/profiles/`
   (never committed). Start the worker again.

If a site later asks for a password, a code or a CAPTCHA, the bot stops that
item and marks it **Needs you**. Run `pnpm worker:login` again to sign back in.

## Step 6 - Your profile, CV and photo (job applier)

Put three files in `apps/worker/assets/` on each worker that runs the job applier:

- your CV as a PDF
- your photo as a JPG
- `profile.json` - copy `profile.example.json`, rename it, fill it in. Make
  `cv_path` and `photo_path` match your file names.

These files are personal and are never committed. The company tax number
(CNPJ) is never stored and never typed into any form; the worker refuses a
profile that contains one.

## Step 7 - Put the web app on the internet (Vercel)

1. Go to **vercel.com**, sign in with GitHub, **Add New > Project**, pick this
   repository.
2. Set **Root Directory** to `apps/web`. Framework: Next.js (detected).
3. Under **Environment Variables** add the same three values as in
   `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
   No Claude key goes to Vercel.
4. Press **Deploy**. You get an address like `https://fgv-control-panel.vercel.app`.
5. Back in Supabase: **Authentication > URL Configuration**. Set **Site URL** to
   that address and add `https://your-address/auth/confirm` under **Redirect URLs**.
6. On your phone open the address, log in, then use the browser menu >
   **Add to Home Screen**. It opens like an app from then on.

## Step 8 - Install the worker on each computer

Do Steps 4-6 on each computer, with a different `WORKER_NAME`, then make it
start by itself with **pm2**.

| Computer                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pichau desktop (Windows)** | `WORKER_NAME=pichau-desktop`, `WORKER_IS_SCHEDULER=true` (it is always on)                                                                                                                                                                                                                                                                                                                                                         |
| **Windows laptop**           | `WORKER_NAME=windows`, `WORKER_IS_SCHEDULER=false`                                                                                                                                                                                                                                                                                                                                                                                 |
| **Chromebook**               | Turn on Linux first: **Settings > About ChromeOS > Developers > Linux development environment**. In the Linux terminal install Node LTS with nvm, then pnpm and Git, then the same steps. `WORKER_NAME=chromebook`, `WORKER_IS_SCHEDULER=false`. Chrome runs inside the Linux container. If the Chromebook has an ARM processor there is no Chrome for Linux: set `WORKER_HAS_BROWSER=false` and it will run the non-browser bots. |

On every computer:

```bash
git clone <this repository>
cd <folder>
pnpm install
# create apps/worker/.env (Step 4), assets (Step 6)
pnpm worker:login          # Step 5, only where WORKER_HAS_BROWSER=true
npm install -g pm2
cd apps/worker
pm2 start ecosystem.config.cjs
pm2 install pm2-logrotate  # keeps the log files small
pm2 save
```

Start with the computer:

- **Windows:** `npm install -g pm2-windows-startup`, then `pm2-startup install`, then `pm2 save`.
- **Linux / Chromebook:** `pm2 startup` (run the line it prints), then `pm2 save`.
  On a Chromebook the Linux container only runs while it is open; open the
  Terminal app once after you restart.

**Sleep:** while a bot is running the worker asks the computer to stay awake
and lets it sleep again when idle. Also set **sleep to Never while plugged
in** in the system power settings, so scheduled runs are not missed.

**Whose computer is it?** Each computer can belong to a person
(`WORKER_OWNER_EMAIL`, or an owner picks them under **Belongs to** on the
Workers page). People see their own computers first and can pause them or
change how many runs they take, whatever their role. Only an owner can change
someone else's computer or reassign one.

**Full desktop or browser only?** The Workers page shows which each computer
offers. Today every bot works through the browser or the web; the "full
desktop" flag is recorded so desktop-control bots can be sent only to those
computers when they are added.

**Everyone shares one queue.** All computers pull from the same database, so
however many are running, the same person or posting is never saved or
contacted twice, and the daily caps count across all of them.

Useful pm2 commands: `pm2 status`, `pm2 logs fgv-worker`, `pm2 restart fgv-worker`.

**Check it worked:** the Workers page shows three computers online. Only one
has "Runs the schedule".

## Step 9 - Google Sheet mirror (optional)

Copies every item into the "Sales Queue" sheet, tab "John", columns A-L
(ID, Date, Channel, Type, Company, Person, Link, Why it fits, Draft, Status,
Notes, Last updated). Rows are matched by Link, so there are no duplicates.

1. In **console.cloud.google.com** create a project, enable the **Google Sheets
   API**, create a **service account**, and download its JSON key.
2. Open the sheet > **Share** > add the service account's email as **Editor**.
3. Save the JSON key as `apps/worker/assets/google.json` on the scheduler
   computer and add to its `apps/worker/.env`:

   ```
   GOOGLE_SERVICE_ACCOUNT_JSON=./assets/google.json
   SALES_QUEUE_SHEET_ID=<the long id in the sheet's address>
   SALES_QUEUE_TAB=John
   ```

4. `pm2 restart fgv-worker`. New and changed items appear in the sheet within a minute.

---

## Using it

- **Home** - today's numbers, then one card per bot. The switch turns the bot's
  schedule on or off (pick the schedule on the bot's settings page first).
  **Run now** opens the settings for that one run; tick "Save as default" to keep them.
- **A bot's page** (the gear icon) - click-only settings, schedule, approval
  mode, daily cap, model, which computer, run history.
- **A run page** - live log, results, cost, **Stop**. When finished: summary,
  **Run again with same settings**, **Export CSV**.
- **Approvals** - everything waiting for your OK. Approve, Skip, or edit the
  draft then approve. Tick several and **Approve selected**.
- **Results** - everything every bot found, with filters, search and CSV export.
- **Workers** - which computers are online, whose they are, and what they are running.
- **Settings** - users and roles, daily spend cap, LinkedIn daily cap, kill switch.
- **Chat** (speech-bubble button) - ask "what's waiting for me?" or "run find
  positions for SEO managers in the UAE, 10 results". Anything that starts,
  stops or changes something shows a card with a **Confirm** button first.
  A worker computer answers, so at least one must be online, and a reply takes
  about 10-20 seconds.
- **Stop all** (red, top right) - stops every running bot within about 15
  seconds and blocks new runs until you press **Resume**.

### Roles

| Role     | Can do                                                       |
| -------- | ------------------------------------------------------------ |
| Owner    | Everything, including users, global settings and bot prompts |
| Operator | Run and stop bots, change bot settings, approve items        |
| Viewer   | Look only                                                    |

### The eight bots

| Bot                          | Channel      | What it does                                                            | Contacts people?           |
| ---------------------------- | ------------ | ----------------------------------------------------------------------- | -------------------------- |
| Find positions in the market | Demo         | Finds real open positions for a role and region                         | No                         |
| Job scout                    | Jobs         | Fills the queue of roles to apply to                                    | No                         |
| Job applier                  | Jobs         | Applies to roles in the queue (browser)                                 | Submits applications       |
| Candidate finder             | Candidates   | Finds candidates in your LinkedIn network and drafts messages (browser) | No, drafts only            |
| LinkedIn outreach sender     | LinkedIn     | Sends the messages you approved, one at a time (browser)                | Sends approved drafts only |
| Network message drafter      | LinkedIn     | Drafts first-time messages to connections (browser)                     | No, drafts only            |
| Hiring-post leads            | Leads        | Finds companies hiring marketing leaders, drafts a pitch                | No, drafts only            |
| Marketplace proposals        | Marketplaces | Finds projects and drafts proposals, never submits (browser)            | No, drafts only            |

---

## Safety rules

The eleven rules in `packages/shared/src/rules.ts` are added to the top of
every bot's instructions. The important ones do not rely on the bot behaving:
they are enforced in code in three places.

| Rule                                                                 | Enforced where                                                                                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Never type passwords, codes, card numbers, ID numbers or the CNPJ    | `apps/worker/src/guard.ts` checks every browser action before it runs                                                                                                 |
| Never pay, buy, subscribe or open a checkout page                    | `guard.ts` (blocked URLs and buttons)                                                                                                                                 |
| Never solve CAPTCHAs or get around bot detection                     | `guard.ts`; the bot marks the item "Needs you"                                                                                                                        |
| Never accept terms or consent banners                                | `guard.ts`                                                                                                                                                            |
| Never send or submit without approval                                | `apps/worker/src/tools.ts` and a database trigger: an item can only become "sent" or "applied" if it was approved (or the job applier is in "Auto within rules" mode) |
| Daily caps, and at most 20 LinkedIn messages a day, 2+ minutes apart | `tools.ts` and the database trigger; the setting can lower the cap, never raise it                                                                                    |
| Only the listed tools                                                | The bot has no shell, no file access, no script tools; `guard.ts` refuses anything else                                                                               |

Also: logs never contain keys, cookies, passwords or whole pages; errors shown
to users are one plain sentence; the daily spend cap stops new runs.

**About LinkedIn and job sites.** Automated activity is against the terms of
LinkedIn and several job boards, and accounts that look automated can be
limited or closed. The caps, the slow pacing and the approve-first rule keep
volume low, and the bots stop the moment a site shows a login, a check or a
warning - they are never told to get around one. That lowers the risk; it does
not remove it. Keep the LinkedIn cap low and watch the first runs.

---

## Checking that everything works

```bash
pnpm typecheck     # TypeScript, strict
pnpm lint
pnpm test          # unit tests: settings, prompts, caps, approval gates, safety guard
```

Database rules (roles, approval gates, caps, kill switch, and that two workers
never claim the same run). Needs any throwaway Postgres database:

```bash
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/fgv_test pnpm db:test
```

End-to-end smoke test (log in, open Home, open a bot, queue a run, see the run
page, viewer cannot change anything, Stop all). With a throwaway Postgres and
no accounts:

```bash
LOCAL_DATABASE_URL=postgresql://user:pass@localhost:5432/fgv_e2e pnpm e2e:local
```

Or against your real project (start the web app first; the test user must be
an owner or operator):

```bash
E2E_BASE_URL=http://localhost:3000 \
E2E_SUPABASE_URL=https://abcdefgh.supabase.co \
E2E_SUPABASE_SERVICE_ROLE_KEY=sb_secret_... \
E2E_EMAIL=you@example.com pnpm e2e
```

`e2e/local-supabase/` is a small test stand-in for Supabase's API. It is used
only by the test above and is never part of the running app.

## Changing the bots

Bots are data, not code. Each one is a row in the `bots` table: a prompt, a
settings form, a schedule, a daily cap and an approval mode.

- Change settings, schedule, caps, approval mode: on the bot's page.
- Change a prompt: bot's page > **Advanced** (owners only).
- Change the defaults for a fresh install, or add a bot: edit
  `packages/shared/src/bots/catalog.ts`, run `pnpm seed:build`, then run
  `supabase/seed.sql` in the SQL Editor. Existing bots keep their settings.

## Where things are

```
apps/web            the web app (Next.js)
apps/worker         the worker (Claude Agent SDK + Playwright)
packages/shared     bot definitions, settings schemas, safety rules, shared logic
supabase            database migration, seed and tests
e2e                 end-to-end smoke test
docs/VERIFIED.md    what was checked against the official docs, and what changed
```

## If something goes wrong

| What you see                                 | What to do                                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "Almost there" page                          | The Supabase keys are missing from `apps/web/.env.local` (or Vercel). Step 1.                                                        |
| The login email never arrives                | Check spam. Supabase's built-in email is limited to a few per hour; for regular use add your own SMTP under Authentication > Emails. |
| "That login link has expired"                | Links work once. Ask for a new one, or type the 6-digit code instead.                                                                |
| A run stays "Queued"                         | No worker is online, or the only free worker has no browser, or it is paused. Check the Workers page.                                |
| "All bots are stopped" banner                | Someone pressed Stop all. Press **Resume**.                                                                                          |
| "Daily spend cap reached"                    | Raise the cap in Settings, or wait until tomorrow (America/Sao_Paulo).                                                               |
| A browser bot says a site wants a login      | Run `pnpm worker:login` on that computer and sign in again.                                                                          |
| A worker shows Offline                       | On that computer: `pm2 status`, then `pm2 logs fgv-worker`.                                                                          |
| Chat says no computer is online              | Start a worker. The chat is answered by the worker computers.                                                                        |
| "Claude is not available: ... usage limit"   | Your Claude plan's limit is used up for now. It resets by itself.                                                                    |
| "Claude is not available: ... not signed in" | Run `claude` on that computer and log in again.                                                                                      |

## Costs

Supabase and Vercel free tiers are enough for the demo. Claude runs on your
subscription through the worker computers, so there is no per-use bill; your
plan's usage limits apply instead. The cost numbers in the app are estimates
(see Step 3). If you ever switch a worker to an API key, that worker's usage
is billed per use by Anthropic, so set a monthly limit in the Anthropic Console.
