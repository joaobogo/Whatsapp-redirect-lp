import type { ApprovalMode, BotModel, Channel, ItemKind } from '../types';
import type { FieldSpec } from './settings';

/**
 * The eight bots from section 7 of the build spec.
 *
 * Bots are data: this file is turned into supabase/seed.sql by
 * `pnpm seed:build`, and the database rows are what the app and the workers
 * read at run time. Editing a prompt here does nothing until the seed is
 * rebuilt and applied (or the prompt is edited in Settings > Advanced).
 */
export interface BotDefinition {
  slug: string;
  name: string;
  channel: Channel;
  description: string;
  fields: FieldSpec[];
  promptTemplate: string;
  scheduleCron: string | null;
  dailyCap: number;
  approvalMode: ApprovalMode;
  model: BotModel;
  requiresBrowser: boolean;
  maxTurns: number;
  maxMinutes: number;
}

/** What a bot may do beyond drafting. Looked up by slug; unknown bots get the safe default. */
export interface BotCapabilities {
  /** Built-in web tools the bot may use. */
  webSearch: boolean;
  webFetch: boolean;
  /** Items created by other bots that this bot may read and update. */
  worksOn: { kinds: ItemKind[] } | null;
  /** The status this bot sets when it contacts someone or submits something. */
  contactStatus: 'sent' | 'applied' | null;
  /** Whether the applicant profile is added to the prompt. */
  usesProfile: boolean;
}

const SAFE_CAPABILITIES: BotCapabilities = {
  webSearch: true,
  webFetch: true,
  worksOn: null,
  contactStatus: null,
  usesProfile: false,
};

export const BOT_CAPABILITIES: Record<string, BotCapabilities> = {
  'market-positions': { ...SAFE_CAPABILITIES },
  'job-scout': { ...SAFE_CAPABILITIES },
  'job-apply': {
    webSearch: false,
    webFetch: true,
    worksOn: { kinds: ['job'] },
    contactStatus: 'applied',
    usesProfile: true,
  },
  'candidate-finder': { ...SAFE_CAPABILITIES, webSearch: false },
  'linkedin-outreach': {
    webSearch: false,
    webFetch: false,
    worksOn: { kinds: ['candidate', 'message_draft', 'lead'] },
    contactStatus: 'sent',
    usesProfile: false,
  },
  'network-drafts': { ...SAFE_CAPABILITIES, webSearch: false },
  'hiring-post-leads': { ...SAFE_CAPABILITIES },
  'marketplace-proposals': { ...SAFE_CAPABILITIES, webSearch: false },
};

export function capabilitiesFor(slug: string): BotCapabilities {
  return BOT_CAPABILITIES[slug] ?? SAFE_CAPABILITIES;
}

const ROLE_FAMILIES = [
  'Marketing',
  'Growth',
  'SEO/AEO/GEO',
  'Demand gen',
  'Paid media',
  'Content',
  'SDR/BDR',
  'Account executive',
  'Customer success',
  'Partnerships',
  'Operations',
  'Chief of staff',
  'Recruiting',
];

const CONTRACT_TYPES = [
  'Contractor/PJ',
  'Freelance',
  'Part-time',
  'Full-time international (not CLT)',
];

const EXCLUDE_IF = [
  'Requires video/Loom',
  'Requires Spanish',
  'CLT only',
  'US work authorization only',
  'Paid to apply',
];

const APPLY_SOURCES = [
  'Workable',
  'Greenhouse',
  'Lever',
  'Ashby',
  'Teamtailor',
  'Get on Board',
  'Wellfound',
  'Indeed',
  'LinkedIn Easy Apply',
];

const NETWORK_INDUSTRIES = [
  'B2B SaaS',
  'AI',
  'consulting',
  'accounting',
  'law',
  'agencies',
  'hospitality',
  'real estate',
];

const MARKETPLACE_SERVICES = [
  'SEO',
  'AEO/GEO',
  'Web design',
  'Paid media',
  'Content',
  'Outbound',
  'Fractional CMO',
];

export const BOT_CATALOG: BotDefinition[] = [
  // 7.1 ---------------------------------------------------------------------
  {
    slug: 'market-positions',
    name: 'Find positions in the market',
    channel: 'Demo',
    description: 'Finds real, currently open positions for a role and region.',
    fields: [
      {
        kind: 'text',
        key: 'role',
        label: 'Role',
        default: 'Enterprise Sales Director',
        required: true,
        placeholder: 'e.g. Head of Marketing',
      },
      {
        kind: 'select',
        key: 'region',
        label: 'Region',
        options: [
          'Worldwide',
          'United States',
          'United Kingdom',
          'Netherlands',
          'European Union',
          'UAE',
          'Brazil',
          'LATAM',
          'Canada',
        ],
        default: 'United Kingdom',
      },
      {
        kind: 'select',
        key: 'workplace',
        label: 'Workplace',
        options: ['Remote', 'Hybrid', 'On-site', 'Any'],
        default: 'Any',
      },
      {
        kind: 'select',
        key: 'seniority',
        label: 'Seniority',
        options: ['Any', 'Mid', 'Senior', 'Director+'],
        default: 'Any',
      },
      { kind: 'number', key: 'count', label: 'How many', min: 5, max: 100, step: 5, default: 20 },
      {
        kind: 'select',
        key: 'posted_within_days',
        label: 'Posted within (days)',
        options: ['1', '3', '7', '14', '30'],
        default: '14',
      },
    ],
    promptTemplate: `TASK - Find positions in the market
Find {{settings.count}} real positions that are open right now.

Search for
- Role: {{settings.role}}
- Region: {{settings.region}}
- Workplace: {{settings.workplace}}
- Seniority: {{settings.seniority}}
- Posted within the last {{settings.posted_within_days}} days

Method
1. Query public job APIs and boards first, with WebFetch:
   - Workable public search API: https://jobs.workable.com/api/v1/jobs?query=..&location=..&workplace=..
   - Greenhouse boards API: https://boards-api.greenhouse.io/v1/boards/<company>/jobs
   - Lever postings API: https://api.lever.co/v0/postings/<company>?mode=json
   - company career pages
   Use WebSearch to discover companies and boards that are hiring for this role.
2. Verify each posting is still open by fetching its page. Never list a posting you have
   not opened. Skip postings that are closed, expired or older than the date limit.
3. Remove duplicates by URL.
4. Save each verified posting with save_item: kind=job, status=found, title, company,
   location, pay (as stated on the page, or leave it empty), url, and
   notes = "Posted <date> - source: <board>".
5. Call log every few results, for example "Searching Workable..." and "Found 7 so far".

Stop when you have saved {{settings.count}} positions or you have run out of real results.
Fewer real positions is better than any invented one.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'draft_only',
    model: 'fast',
    requiresBrowser: false,
    maxTurns: 120,
    maxMinutes: 45,
  },

  // 7.2 ---------------------------------------------------------------------
  {
    slug: 'job-scout',
    name: 'Job scout',
    channel: 'Jobs',
    description: 'Fills the queue of roles for John to apply to.',
    fields: [
      {
        kind: 'multi',
        key: 'role_families',
        label: 'Role families',
        options: ROLE_FAMILIES,
        default: ROLE_FAMILIES,
      },
      {
        kind: 'multi',
        key: 'locations',
        label: 'Locations',
        options: [
          'Worldwide remote',
          'LATAM remote',
          'Brazil remote',
          'Europe remote',
          'US remote',
        ],
        default: ['Worldwide remote', 'LATAM remote', 'Brazil remote'],
      },
      {
        kind: 'multi',
        key: 'contract_types',
        label: 'Contract types',
        options: CONTRACT_TYPES,
        default: CONTRACT_TYPES,
      },
      {
        kind: 'number',
        key: 'pay_floor_usd_month',
        label: 'Minimum pay',
        min: 500,
        max: 10000,
        step: 100,
        default: 1500,
        unit: 'USD / month',
      },
      {
        kind: 'number',
        key: 'count',
        label: 'How many',
        min: 10,
        max: 200,
        step: 10,
        default: 100,
      },
      {
        kind: 'tags',
        key: 'exclude_companies',
        label: 'Skip these companies',
        default: ['Jobgether'],
        placeholder: 'Type a company and press Enter',
      },
      {
        kind: 'multi',
        key: 'exclude_if',
        label: 'Skip a role when it',
        options: EXCLUDE_IF,
        default: EXCLUDE_IF,
      },
    ],
    promptTemplate: `TASK - Job scout
Fill the queue of roles for John to apply to. Find up to {{settings.count}} roles.

Look for
- Role families: {{settings.role_families}}
- Locations: {{settings.locations}}
- Contract types: {{settings.contract_types}}
- Pay floor: USD {{settings.pay_floor_usd_month}} per month (keep roles that do not state pay)

Skip
- Companies: {{settings.exclude_companies}}
- Any role that matches one of: {{settings.exclude_if}}

Method
1. Use WebSearch and WebFetch on public job boards and their APIs (Workable, Greenhouse,
   Lever, Ashby, Teamtailor, Get on Board, Wellfound, remote job boards, career pages).
2. Open every posting before saving it. Only keep postings that are open today.
3. Save each role with save_item: kind=job, status=ready, title, company, location, pay
   (as stated, or empty), url, fit_reason (one sentence on why it suits a senior marketing
   and growth generalist), notes = "Posted <date> - source: <board> - contract: <type>".
   save_item removes duplicates against everything already in the queue.
4. Call log every ten roles.

Do not apply to anything. Do not open login pages.`,
    scheduleCron: '0 */4 * * *',
    dailyCap: 20,
    approvalMode: 'draft_only',
    model: 'fast',
    requiresBrowser: false,
    maxTurns: 150,
    maxMinutes: 45,
  },

  // 7.3 ---------------------------------------------------------------------
  {
    slug: 'job-apply',
    name: 'Job applier',
    channel: 'Jobs',
    description: 'Applies to the roles in the queue, oldest first, inside the daily cap.',
    fields: [
      {
        kind: 'number',
        key: 'max_applications',
        label: 'Applications this run',
        min: 1,
        max: 100,
        default: 25,
      },
      {
        kind: 'multi',
        key: 'sources_allowed',
        label: 'Sites it may apply on',
        options: APPLY_SOURCES,
        default: APPLY_SOURCES,
      },
      {
        kind: 'range',
        key: 'salary_senior_usd',
        label: 'Salary to state for senior roles',
        min: 1000,
        max: 20000,
        step: 100,
        default: [4000, 5000],
        unit: 'USD / month',
      },
      {
        kind: 'range',
        key: 'salary_junior_usd',
        label: 'Salary to state for junior roles',
        min: 500,
        max: 20000,
        step: 100,
        default: [2000, 3000],
        unit: 'USD / month',
      },
      {
        kind: 'select',
        key: 'cover_note_style',
        label: 'Cover note style',
        options: ['Short and factual', 'Warm'],
        default: 'Short and factual',
      },
    ],
    promptTemplate: `TASK - Job applier
Apply to roles in the queue, oldest first. At most {{settings.max_applications}} this run.

Before you start
- Call check_cap. If remaining is 0, stop and say so.
- Call get_items with kind=job to get the roles you may apply to. Work only on those.
- Only apply on these sites: {{settings.sources_allowed}}. Any other site: set the item to
  skipped with the reason "site not allowed".
- LinkedIn Easy Apply: at most 50 per day. The tool refuses more.

For each role, in order
1. Lock it: update_item with id and lock=true. If the answer is locked=false another
   computer has it - move to the next role.
2. Open the URL. If the posting is closed, set status=closed and continue.
3. Fill the form from the applicant profile below, and only from it.
4. Upload the CV file from the profile (cv_path). After the CV parser runs, re-check name,
   email, phone and location and correct them.
5. Salary questions: senior roles USD {{settings.salary_senior_usd}} per month (min, max);
   junior roles USD {{settings.salary_junior_usd}} per month (min, max).
6. Write a 3-5 sentence note tailored to the role. Style: {{settings.cover_note_style}}.
   Use facts from the profile only.
7. Submit, and confirm you can see the success message. Then update_item status=applied.
   If update_item refuses, stop applying and report why.

Set status=needs_human, with the exact question in notes, when the form asks for: salary
history, quota attainment, real deal or case essays, references, IDs, a login or password,
an emailed code, or a CAPTCHA.
Set status=skipped, with the reason in notes, for: video, audio or Loom answers,
assessments, CLT-only roles, a language John does not speak. Closed posting: status=closed.

Call check_cap again after every five applications. Log one line per role.

APPLICANT PROFILE (the only source of facts about John)
{{profile}}`,
    scheduleCron: null,
    dailyCap: 60,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: true,
    maxTurns: 400,
    maxMinutes: 120,
  },

  // 7.4 ---------------------------------------------------------------------
  {
    slug: 'candidate-finder',
    name: 'Candidate finder',
    channel: 'Candidates',
    description: "Sources candidates for a client role from John's LinkedIn connections.",
    fields: [
      {
        kind: 'text',
        key: 'role_title',
        label: 'Role to fill',
        default: '',
        required: true,
        placeholder: 'e.g. Enterprise Sales Director',
      },
      {
        kind: 'url',
        key: 'job_url',
        label: 'Link to the job',
        default: '',
        required: true,
        placeholder: 'https://...',
      },
      {
        kind: 'tags',
        key: 'locations',
        label: 'Locations',
        default: [],
        placeholder: 'Country or city, then Enter',
      },
      {
        kind: 'select',
        key: 'network',
        label: 'Network',
        options: ['1st degree only'],
        default: '1st degree only',
        locked: true,
        help: 'Locked to 1st-degree connections for now.',
      },
      {
        kind: 'number',
        key: 'min_score',
        label: 'Minimum fit score',
        min: 50,
        max: 100,
        step: 5,
        default: 70,
      },
      { kind: 'number', key: 'count', label: 'How many', min: 1, max: 30, default: 10 },
      {
        kind: 'multi',
        key: 'seniority',
        label: 'Seniority',
        options: ['Any', 'Junior', 'Mid', 'Senior', 'Director+'],
        default: ['Any'],
      },
      {
        kind: 'tags',
        key: 'industries_bonus',
        label: 'Bonus for experience in',
        default: ['staffing', 'RPO', 'HR tech', 'SaaS', 'BPO'],
        placeholder: 'Industry, then Enter',
      },
    ],
    promptTemplate: `TASK - Candidate finder (TaaSFlow)
Find {{settings.count}} people in John's LinkedIn network who could fill a client role.

Role: {{settings.role_title}}
Job page: {{settings.job_url}}
Locations: {{settings.locations}}
Network: {{settings.network}}
Seniority: {{settings.seniority}}
Minimum fit score: {{settings.min_score}}
Bonus for experience in: {{settings.industries_bonus}}

Method
1. Read the job page first so you know what the client needs.
2. In the browser, use LinkedIn people search filtered to 1st-degree connections and the
   locations above. You are already signed in. If LinkedIn shows a login page, a
   verification step or a CAPTCHA, stop and say so.
3. Open profiles at a human pace: wait 8-20 seconds between profiles, and open at most 40
   profiles in this run.
4. Skip anyone who already has a message thread with John.
5. Score each person 0-100 against the job page. Keep those at or above the minimum.
6. For each keeper write a personalised message of 400-600 characters that mentions one or
   two specific facts from their profile, names the client role, asks whether they are open
   to it or know someone who is, and includes the job link. Never reuse phrasing between
   messages in this run.
7. Save each keeper with save_item: kind=candidate, status=needs_approval, person, title
   (their current role), company, location, url (their profile), score, fit_reason, draft.

You never connect with or message anyone. Sending is a separate bot that only sends what
John approved.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: true,
    maxTurns: 300,
    maxMinutes: 90,
  },

  // 7.5 ---------------------------------------------------------------------
  {
    slug: 'linkedin-outreach',
    name: 'LinkedIn outreach sender',
    channel: 'LinkedIn',
    description: 'Sends the LinkedIn messages you approved, one at a time.',
    fields: [
      {
        kind: 'number',
        key: 'max_messages',
        label: 'Messages this run',
        min: 1,
        max: 20,
        default: 20,
      },
      {
        kind: 'number',
        key: 'spacing_minutes',
        label: 'Minutes between messages',
        min: 2,
        max: 10,
        default: 3,
      },
      {
        kind: 'toggle',
        key: 'only_first_time',
        label: 'First-time conversations only',
        default: true,
        locked: true,
        help: 'Locked on. The bot never writes into an existing thread.',
      },
      {
        kind: 'select',
        key: 'priority',
        label: 'Send first',
        options: ['Candidates first', 'Oldest first'],
        default: 'Candidates first',
      },
    ],
    promptTemplate: `TASK - LinkedIn outreach sender
Send approved LinkedIn messages, one at a time. At most {{settings.max_messages}} this run.
Order: {{settings.priority}}.

Before you start
- Call check_cap. If remaining is 0, stop and say so. The limit is
  {{caps.linkedin_daily_cap}} LinkedIn messages per day across all bots.
- Call get_items with status=approved. Send only those items, and only items that have a draft.

For each item
1. Open the person's LinkedIn profile (the item url) and open the message window.
2. Check that the thread is empty (a first-time conversation). If there is any earlier
   message, do not write: update_item status=needs_human, notes="thread exists".
3. Type the draft exactly as written, keeping the line breaks. Do not add or change words.
4. Send it. Check that the message now shows in the thread.
5. update_item status=sent. If the tool refuses (cap reached, too soon, not approved), stop
   sending and report why.
6. Wait at least {{settings.spacing_minutes}} minutes before the next message, plus a random
   extra of up to a minute. Use browser_wait_for with time, in steps of 60 seconds or less.

If LinkedIn shows a login page, a verification step, a CAPTCHA or a warning about unusual
activity, stop immediately and say so. Never send connection requests. Never write to
anyone who is not in the approved list.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: true,
    maxTurns: 300,
    maxMinutes: 120,
  },

  // 7.6 ---------------------------------------------------------------------
  {
    slug: 'network-drafts',
    name: 'Network message drafter',
    channel: 'LinkedIn',
    description: 'Drafts first-time messages to connections who match the OmniFlow ICP.',
    fields: [
      {
        kind: 'multi',
        key: 'markets',
        label: 'Markets (first one has priority)',
        options: ['UAE', 'UK', 'US', 'Canada'],
        default: ['UAE', 'UK', 'US', 'Canada'],
      },
      {
        kind: 'tags',
        key: 'titles',
        label: 'Titles',
        default: ['founder', 'CEO', 'managing partner', 'owner'],
        placeholder: 'Title, then Enter',
      },
      {
        kind: 'multi',
        key: 'industries',
        label: 'Industries',
        options: NETWORK_INDUSTRIES,
        default: NETWORK_INDUSTRIES,
      },
      { kind: 'number', key: 'count', label: 'How many', min: 5, max: 20, default: 10 },
      {
        kind: 'select',
        key: 'angle',
        label: 'Angle',
        options: ['AI-search visibility', 'Referral swap for agencies', 'Auto by industry'],
        default: 'Auto by industry',
      },
    ],
    promptTemplate: `TASK - Network message drafter
Draft {{settings.count}} first-time LinkedIn messages to John's 1st-degree connections who
match the OmniFlow ideal customer.

Markets, in priority order: {{settings.markets}}
Titles: {{settings.titles}}
Industries: {{settings.industries}}
Angle: {{settings.angle}}

Method
1. In the browser, use LinkedIn people search filtered to 1st-degree connections, the
   markets and the titles above. You are already signed in. If LinkedIn shows a login page,
   a verification step or a CAPTCHA, stop and say so.
2. Open profiles at a human pace (8-20 seconds apart, at most 40 profiles).
3. Skip anyone who already has a message thread with John.
4. Write one message per person: 250-350 characters, no links, only facts you can see on
   their profile, ending with a genuine question. "Auto by industry" means: agencies get the
   referral-swap angle, everyone else gets the AI-search visibility angle.
5. Save each with save_item: kind=message_draft, status=needs_approval, person, title,
   company, location, url (their profile), fit_reason, draft.

You never connect with or message anyone.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: true,
    maxTurns: 300,
    maxMinutes: 90,
  },

  // 7.7 ---------------------------------------------------------------------
  {
    slug: 'hiring-post-leads',
    name: 'Hiring-post leads',
    channel: 'Leads',
    description: 'Finds small companies hiring marketing leaders and drafts an OmniFlow pitch.',
    fields: [
      {
        kind: 'multi',
        key: 'countries',
        label: 'Countries',
        options: ['US', 'UK', 'UAE', 'Canada'],
        default: ['US', 'UK', 'UAE', 'Canada'],
      },
      {
        kind: 'multi',
        key: 'company_size',
        label: 'Company size (employees)',
        options: ['1-50', '51-200'],
        default: ['1-50', '51-200'],
      },
      {
        kind: 'tags',
        key: 'roles',
        label: 'Roles they are hiring',
        default: ['Head of Marketing', 'Head of Growth', 'CMO'],
        placeholder: 'Role, then Enter',
      },
      { kind: 'number', key: 'count', label: 'How many', min: 5, max: 50, step: 5, default: 15 },
      {
        kind: 'select',
        key: 'channel',
        label: 'Write the pitch as',
        options: ['LinkedIn connection note', 'Email'],
        default: 'LinkedIn connection note',
      },
    ],
    promptTemplate: `TASK - Hiring-post leads
Find {{settings.count}} companies that are advertising a marketing leadership role, find the
decision maker, and draft a pitch for OmniFlow as a faster alternative to the hire.

Countries: {{settings.countries}}
Company size (employees): {{settings.company_size}}
Roles they are hiring: {{settings.roles}}
Pitch format: {{settings.channel}}

Method
1. Use WebSearch and WebFetch on public job boards to find open postings for these roles at
   companies of this size. Open each posting to confirm it is live.
2. Find the decision maker (founder, CEO or the hiring manager named in the posting) from
   public pages. Use only what the pages say.
3. Write the pitch as John himself, not as the company. LinkedIn connection notes stay under
   300 characters. Emails stay under 150 words. No spam words, no invented numbers.
4. Save each with save_item: kind=lead, status=needs_approval, company, person, title (the
   role they are hiring), location, url (the posting), fit_reason, draft.

You do not send anything.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: false,
    maxTurns: 150,
    maxMinutes: 45,
  },

  // 7.8 ---------------------------------------------------------------------
  {
    slug: 'marketplace-proposals',
    name: 'Marketplace proposals',
    channel: 'Marketplaces',
    description: 'Finds new projects on free marketplaces and drafts proposals without submitting.',
    fields: [
      {
        kind: 'multi',
        key: 'platforms',
        label: 'Platforms',
        options: ['Upwork', 'Workana', '99Freelas', 'Freelancer', 'Guru', 'PeoplePerHour'],
        default: ['Workana', '99Freelas'],
      },
      {
        kind: 'multi',
        key: 'services',
        label: 'Services',
        options: MARKETPLACE_SERVICES,
        default: MARKETPLACE_SERVICES,
      },
      {
        kind: 'number',
        key: 'min_budget_usd',
        label: 'Minimum budget',
        min: 0,
        max: 10000,
        step: 50,
        default: 300,
        unit: 'USD',
      },
      { kind: 'number', key: 'count', label: 'How many', min: 1, max: 20, default: 10 },
    ],
    promptTemplate: `TASK - Marketplace proposals
Find {{settings.count}} new projects and draft a proposal for each. Do not submit anything.

Platforms: {{settings.platforms}}
Services: {{settings.services}}
Minimum budget: USD {{settings.min_budget_usd}}

Method
1. In the browser, open each platform's project search. You are already signed in. If a
   platform shows a login page, a verification step or a CAPTCHA, skip that platform and say so.
2. Pick recent projects that match the services and the budget.
3. Write the proposal in the buyer's language (Portuguese, Spanish or English), as John
   himself, specific to the project, with no invented results.
4. Where the platform lets you save a draft without submitting, type it there and leave it
   unsent. Never press the submit or send button.
5. Never buy credits or connects and never pay for anything. If a project needs paid
   credits to bid, save it with status=needs_human and the price in notes.
6. Save each with save_item: kind=proposal, status=needs_approval, title, company (the
   buyer or platform), url (the project), pay (the budget as stated), fit_reason, draft.`,
    scheduleCron: null,
    dailyCap: 20,
    approvalMode: 'approve_each',
    model: 'opus',
    requiresBrowser: true,
    maxTurns: 300,
    maxMinutes: 90,
  },
];

export function findBotDefinition(slug: string): BotDefinition | undefined {
  return BOT_CATALOG.find((bot) => bot.slug === slug);
}

/** Order of the channel groups on the dashboard. */
export const CHANNEL_ORDER: readonly string[] = [
  'Demo',
  'Jobs',
  'Candidates',
  'LinkedIn',
  'Leads',
  'Marketplaces',
];
