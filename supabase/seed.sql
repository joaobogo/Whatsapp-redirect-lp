-- GENERATED FILE - do not edit by hand.
-- Source: packages/shared/src/bots/catalog.ts. Rebuild with: pnpm seed:build
-- Safe to run again: existing bots keep their settings, schedule, caps and prompt.

-- global settings (spec section 5)
insert into public.app_settings (key, value) values ($txt$kill_switch$txt$, $json$false$json$::jsonb) on conflict (key) do nothing;
insert into public.app_settings (key, value) values ($txt$daily_spend_cap_usd$txt$, $json$30$json$::jsonb) on conflict (key) do nothing;
insert into public.app_settings (key, value) values ($txt$linkedin_daily_cap$txt$, $json$20$json$::jsonb) on conflict (key) do nothing;
insert into public.app_settings (key, value) values ($txt$default_model$txt$, $json$"opus"$json$::jsonb) on conflict (key) do nothing;
insert into public.app_settings (key, value) values ($txt$time_zone$txt$, $json$"America/Sao_Paulo"$json$::jsonb) on conflict (key) do nothing;

-- the eight bots (spec section 7)
insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$market-positions$txt$, $txt$Find positions in the market$txt$, $txt$Demo$txt$,
  $txt$Finds real, currently open positions for a role and region.$txt$,
  $txt$TASK - Find positions in the market
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
Fewer real positions is better than any invented one.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"role":{"default":"Enterprise Sales Director","title":"Role","x-ui":{"kind":"text","key":"role","label":"Role","default":"Enterprise Sales Director","required":true,"placeholder":"e.g. Head of Marketing"},"type":"string","maxLength":300},"region":{"default":"United Kingdom","title":"Region","x-ui":{"kind":"select","key":"region","label":"Region","options":["Worldwide","United States","United Kingdom","Netherlands","European Union","UAE","Brazil","LATAM","Canada"],"default":"United Kingdom"},"type":"string","enum":["Worldwide","United States","United Kingdom","Netherlands","European Union","UAE","Brazil","LATAM","Canada"]},"workplace":{"default":"Any","title":"Workplace","x-ui":{"kind":"select","key":"workplace","label":"Workplace","options":["Remote","Hybrid","On-site","Any"],"default":"Any"},"type":"string","enum":["Remote","Hybrid","On-site","Any"]},"seniority":{"default":"Any","title":"Seniority","x-ui":{"kind":"select","key":"seniority","label":"Seniority","options":["Any","Mid","Senior","Director+"],"default":"Any"},"type":"string","enum":["Any","Mid","Senior","Director+"]},"count":{"default":20,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":5,"max":100,"step":5,"default":20},"type":"number","minimum":5,"maximum":100},"posted_within_days":{"default":"14","title":"Posted within (days)","x-ui":{"kind":"select","key":"posted_within_days","label":"Posted within (days)","options":["1","3","7","14","30"],"default":"14"},"type":"string","enum":["1","3","7","14","30"]}}}$json$::jsonb,
  $json${"role":"Enterprise Sales Director","region":"United Kingdom","workplace":"Any","seniority":"Any","count":20,"posted_within_days":"14"}$json$::jsonb,
  false, null, 20, 'draft_only', 'fast', false, 120, 45
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$job-scout$txt$, $txt$Job scout$txt$, $txt$Jobs$txt$,
  $txt$Fills the queue of roles for John to apply to.$txt$,
  $txt$TASK - Job scout
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

Do not apply to anything. Do not open login pages.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"role_families":{"default":["Marketing","Growth","SEO/AEO/GEO","Demand gen","Paid media","Content","SDR/BDR","Account executive","Customer success","Partnerships","Operations","Chief of staff","Recruiting"],"title":"Role families","x-ui":{"kind":"multi","key":"role_families","label":"Role families","options":["Marketing","Growth","SEO/AEO/GEO","Demand gen","Paid media","Content","SDR/BDR","Account executive","Customer success","Partnerships","Operations","Chief of staff","Recruiting"],"default":["Marketing","Growth","SEO/AEO/GEO","Demand gen","Paid media","Content","SDR/BDR","Account executive","Customer success","Partnerships","Operations","Chief of staff","Recruiting"]},"type":"array","items":{"type":"string","enum":["Marketing","Growth","SEO/AEO/GEO","Demand gen","Paid media","Content","SDR/BDR","Account executive","Customer success","Partnerships","Operations","Chief of staff","Recruiting"]}},"locations":{"default":["Worldwide remote","LATAM remote","Brazil remote"],"title":"Locations","x-ui":{"kind":"multi","key":"locations","label":"Locations","options":["Worldwide remote","LATAM remote","Brazil remote","Europe remote","US remote"],"default":["Worldwide remote","LATAM remote","Brazil remote"]},"type":"array","items":{"type":"string","enum":["Worldwide remote","LATAM remote","Brazil remote","Europe remote","US remote"]}},"contract_types":{"default":["Contractor/PJ","Freelance","Part-time","Full-time international (not CLT)"],"title":"Contract types","x-ui":{"kind":"multi","key":"contract_types","label":"Contract types","options":["Contractor/PJ","Freelance","Part-time","Full-time international (not CLT)"],"default":["Contractor/PJ","Freelance","Part-time","Full-time international (not CLT)"]},"type":"array","items":{"type":"string","enum":["Contractor/PJ","Freelance","Part-time","Full-time international (not CLT)"]}},"pay_floor_usd_month":{"default":1500,"title":"Minimum pay","x-ui":{"kind":"number","key":"pay_floor_usd_month","label":"Minimum pay","min":500,"max":10000,"step":100,"default":1500,"unit":"USD / month"},"type":"number","minimum":500,"maximum":10000},"count":{"default":100,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":10,"max":200,"step":10,"default":100},"type":"number","minimum":10,"maximum":200},"exclude_companies":{"default":["Jobgether"],"title":"Skip these companies","x-ui":{"kind":"tags","key":"exclude_companies","label":"Skip these companies","default":["Jobgether"],"placeholder":"Type a company and press Enter"},"maxItems":50,"type":"array","items":{"type":"string","maxLength":80}},"exclude_if":{"default":["Requires video/Loom","Requires Spanish","CLT only","US work authorization only","Paid to apply"],"title":"Skip a role when it","x-ui":{"kind":"multi","key":"exclude_if","label":"Skip a role when it","options":["Requires video/Loom","Requires Spanish","CLT only","US work authorization only","Paid to apply"],"default":["Requires video/Loom","Requires Spanish","CLT only","US work authorization only","Paid to apply"]},"type":"array","items":{"type":"string","enum":["Requires video/Loom","Requires Spanish","CLT only","US work authorization only","Paid to apply"]}}}}$json$::jsonb,
  $json${"role_families":["Marketing","Growth","SEO/AEO/GEO","Demand gen","Paid media","Content","SDR/BDR","Account executive","Customer success","Partnerships","Operations","Chief of staff","Recruiting"],"locations":["Worldwide remote","LATAM remote","Brazil remote"],"contract_types":["Contractor/PJ","Freelance","Part-time","Full-time international (not CLT)"],"pay_floor_usd_month":1500,"count":100,"exclude_companies":["Jobgether"],"exclude_if":["Requires video/Loom","Requires Spanish","CLT only","US work authorization only","Paid to apply"]}$json$::jsonb,
  false, $txt$0 */4 * * *$txt$, 20, 'draft_only', 'fast', false, 150, 45
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$job-apply$txt$, $txt$Job applier$txt$, $txt$Jobs$txt$,
  $txt$Applies to the roles in the queue, oldest first, inside the daily cap.$txt$,
  $txt$TASK - Job applier
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
{{profile}}$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"max_applications":{"default":25,"title":"Applications this run","x-ui":{"kind":"number","key":"max_applications","label":"Applications this run","min":1,"max":100,"default":25},"type":"number","minimum":1,"maximum":100},"sources_allowed":{"default":["Workable","Greenhouse","Lever","Ashby","Teamtailor","Get on Board","Wellfound","Indeed","LinkedIn Easy Apply"],"title":"Sites it may apply on","x-ui":{"kind":"multi","key":"sources_allowed","label":"Sites it may apply on","options":["Workable","Greenhouse","Lever","Ashby","Teamtailor","Get on Board","Wellfound","Indeed","LinkedIn Easy Apply"],"default":["Workable","Greenhouse","Lever","Ashby","Teamtailor","Get on Board","Wellfound","Indeed","LinkedIn Easy Apply"]},"type":"array","items":{"type":"string","enum":["Workable","Greenhouse","Lever","Ashby","Teamtailor","Get on Board","Wellfound","Indeed","LinkedIn Easy Apply"]}},"salary_senior_usd":{"default":[4000,5000],"title":"Salary to state for senior roles","x-ui":{"kind":"range","key":"salary_senior_usd","label":"Salary to state for senior roles","min":1000,"max":20000,"step":100,"default":[4000,5000],"unit":"USD / month"},"minItems":2,"maxItems":2,"type":"array","items":{"type":"number","minimum":1000,"maximum":20000}},"salary_junior_usd":{"default":[2000,3000],"title":"Salary to state for junior roles","x-ui":{"kind":"range","key":"salary_junior_usd","label":"Salary to state for junior roles","min":500,"max":20000,"step":100,"default":[2000,3000],"unit":"USD / month"},"minItems":2,"maxItems":2,"type":"array","items":{"type":"number","minimum":500,"maximum":20000}},"cover_note_style":{"default":"Short and factual","title":"Cover note style","x-ui":{"kind":"select","key":"cover_note_style","label":"Cover note style","options":["Short and factual","Warm"],"default":"Short and factual"},"type":"string","enum":["Short and factual","Warm"]}}}$json$::jsonb,
  $json${"max_applications":25,"sources_allowed":["Workable","Greenhouse","Lever","Ashby","Teamtailor","Get on Board","Wellfound","Indeed","LinkedIn Easy Apply"],"salary_senior_usd":[4000,5000],"salary_junior_usd":[2000,3000],"cover_note_style":"Short and factual"}$json$::jsonb,
  false, null, 60, 'approve_each', 'opus', true, 400, 120
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$candidate-finder$txt$, $txt$Candidate finder$txt$, $txt$Candidates$txt$,
  $txt$Sources candidates for a client role from John's LinkedIn connections.$txt$,
  $txt$TASK - Candidate finder (TaaSFlow)
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
John approved.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"role_title":{"default":"","title":"Role to fill","x-ui":{"kind":"text","key":"role_title","label":"Role to fill","default":"","required":true,"placeholder":"e.g. Enterprise Sales Director"},"type":"string","maxLength":300},"job_url":{"default":"","title":"Link to the job","x-ui":{"kind":"url","key":"job_url","label":"Link to the job","default":"","required":true,"placeholder":"https://..."},"type":"string","maxLength":2000},"locations":{"default":[],"title":"Locations","x-ui":{"kind":"tags","key":"locations","label":"Locations","default":[],"placeholder":"Country or city, then Enter"},"maxItems":50,"type":"array","items":{"type":"string","maxLength":80}},"network":{"default":"1st degree only","title":"Network","x-ui":{"kind":"select","key":"network","label":"Network","options":["1st degree only"],"default":"1st degree only","locked":true,"help":"Locked to 1st-degree connections for now."},"type":"string","enum":["1st degree only"]},"min_score":{"default":70,"title":"Minimum fit score","x-ui":{"kind":"number","key":"min_score","label":"Minimum fit score","min":50,"max":100,"step":5,"default":70},"type":"number","minimum":50,"maximum":100},"count":{"default":10,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":1,"max":30,"default":10},"type":"number","minimum":1,"maximum":30},"seniority":{"default":["Any"],"title":"Seniority","x-ui":{"kind":"multi","key":"seniority","label":"Seniority","options":["Any","Junior","Mid","Senior","Director+"],"default":["Any"]},"type":"array","items":{"type":"string","enum":["Any","Junior","Mid","Senior","Director+"]}},"industries_bonus":{"default":["staffing","RPO","HR tech","SaaS","BPO"],"title":"Bonus for experience in","x-ui":{"kind":"tags","key":"industries_bonus","label":"Bonus for experience in","default":["staffing","RPO","HR tech","SaaS","BPO"],"placeholder":"Industry, then Enter"},"maxItems":50,"type":"array","items":{"type":"string","maxLength":80}}}}$json$::jsonb,
  $json${"role_title":"","job_url":"","locations":[],"network":"1st degree only","min_score":70,"count":10,"seniority":["Any"],"industries_bonus":["staffing","RPO","HR tech","SaaS","BPO"]}$json$::jsonb,
  false, null, 20, 'approve_each', 'opus', true, 300, 90
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$linkedin-outreach$txt$, $txt$LinkedIn outreach sender$txt$, $txt$LinkedIn$txt$,
  $txt$Sends the LinkedIn messages you approved, one at a time.$txt$,
  $txt$TASK - LinkedIn outreach sender
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
anyone who is not in the approved list.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"max_messages":{"default":20,"title":"Messages this run","x-ui":{"kind":"number","key":"max_messages","label":"Messages this run","min":1,"max":20,"default":20},"type":"number","minimum":1,"maximum":20},"spacing_minutes":{"default":3,"title":"Minutes between messages","x-ui":{"kind":"number","key":"spacing_minutes","label":"Minutes between messages","min":2,"max":10,"default":3},"type":"number","minimum":2,"maximum":10},"only_first_time":{"default":true,"title":"First-time conversations only","x-ui":{"kind":"toggle","key":"only_first_time","label":"First-time conversations only","default":true,"locked":true,"help":"Locked on. The bot never writes into an existing thread."},"type":"boolean"},"priority":{"default":"Candidates first","title":"Send first","x-ui":{"kind":"select","key":"priority","label":"Send first","options":["Candidates first","Oldest first"],"default":"Candidates first"},"type":"string","enum":["Candidates first","Oldest first"]}}}$json$::jsonb,
  $json${"max_messages":20,"spacing_minutes":3,"only_first_time":true,"priority":"Candidates first"}$json$::jsonb,
  false, null, 20, 'approve_each', 'opus', true, 300, 120
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$network-drafts$txt$, $txt$Network message drafter$txt$, $txt$LinkedIn$txt$,
  $txt$Drafts first-time messages to connections who match the OmniFlow ICP.$txt$,
  $txt$TASK - Network message drafter
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

You never connect with or message anyone.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"markets":{"default":["UAE","UK","US","Canada"],"title":"Markets (first one has priority)","x-ui":{"kind":"multi","key":"markets","label":"Markets (first one has priority)","options":["UAE","UK","US","Canada"],"default":["UAE","UK","US","Canada"]},"type":"array","items":{"type":"string","enum":["UAE","UK","US","Canada"]}},"titles":{"default":["founder","CEO","managing partner","owner"],"title":"Titles","x-ui":{"kind":"tags","key":"titles","label":"Titles","default":["founder","CEO","managing partner","owner"],"placeholder":"Title, then Enter"},"maxItems":50,"type":"array","items":{"type":"string","maxLength":80}},"industries":{"default":["B2B SaaS","AI","consulting","accounting","law","agencies","hospitality","real estate"],"title":"Industries","x-ui":{"kind":"multi","key":"industries","label":"Industries","options":["B2B SaaS","AI","consulting","accounting","law","agencies","hospitality","real estate"],"default":["B2B SaaS","AI","consulting","accounting","law","agencies","hospitality","real estate"]},"type":"array","items":{"type":"string","enum":["B2B SaaS","AI","consulting","accounting","law","agencies","hospitality","real estate"]}},"count":{"default":10,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":5,"max":20,"default":10},"type":"number","minimum":5,"maximum":20},"angle":{"default":"Auto by industry","title":"Angle","x-ui":{"kind":"select","key":"angle","label":"Angle","options":["AI-search visibility","Referral swap for agencies","Auto by industry"],"default":"Auto by industry"},"type":"string","enum":["AI-search visibility","Referral swap for agencies","Auto by industry"]}}}$json$::jsonb,
  $json${"markets":["UAE","UK","US","Canada"],"titles":["founder","CEO","managing partner","owner"],"industries":["B2B SaaS","AI","consulting","accounting","law","agencies","hospitality","real estate"],"count":10,"angle":"Auto by industry"}$json$::jsonb,
  false, null, 20, 'approve_each', 'opus', true, 300, 90
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$hiring-post-leads$txt$, $txt$Hiring-post leads$txt$, $txt$Leads$txt$,
  $txt$Finds small companies hiring marketing leaders and drafts an OmniFlow pitch.$txt$,
  $txt$TASK - Hiring-post leads
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

You do not send anything.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"countries":{"default":["US","UK","UAE","Canada"],"title":"Countries","x-ui":{"kind":"multi","key":"countries","label":"Countries","options":["US","UK","UAE","Canada"],"default":["US","UK","UAE","Canada"]},"type":"array","items":{"type":"string","enum":["US","UK","UAE","Canada"]}},"company_size":{"default":["1-50","51-200"],"title":"Company size (employees)","x-ui":{"kind":"multi","key":"company_size","label":"Company size (employees)","options":["1-50","51-200"],"default":["1-50","51-200"]},"type":"array","items":{"type":"string","enum":["1-50","51-200"]}},"roles":{"default":["Head of Marketing","Head of Growth","CMO"],"title":"Roles they are hiring","x-ui":{"kind":"tags","key":"roles","label":"Roles they are hiring","default":["Head of Marketing","Head of Growth","CMO"],"placeholder":"Role, then Enter"},"maxItems":50,"type":"array","items":{"type":"string","maxLength":80}},"count":{"default":15,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":5,"max":50,"step":5,"default":15},"type":"number","minimum":5,"maximum":50},"channel":{"default":"LinkedIn connection note","title":"Write the pitch as","x-ui":{"kind":"select","key":"channel","label":"Write the pitch as","options":["LinkedIn connection note","Email"],"default":"LinkedIn connection note"},"type":"string","enum":["LinkedIn connection note","Email"]}}}$json$::jsonb,
  $json${"countries":["US","UK","UAE","Canada"],"company_size":["1-50","51-200"],"roles":["Head of Marketing","Head of Growth","CMO"],"count":15,"channel":"LinkedIn connection note"}$json$::jsonb,
  false, null, 20, 'approve_each', 'opus', false, 150, 45
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;

insert into public.bots (slug, name, channel, description, prompt_template, settings_schema, settings, enabled, schedule_cron, daily_cap, approval_mode, model, requires_browser, max_turns, max_minutes)
values (
  $txt$marketplace-proposals$txt$, $txt$Marketplace proposals$txt$, $txt$Marketplaces$txt$,
  $txt$Finds new projects on free marketplaces and drafts proposals without submitting.$txt$,
  $txt$TASK - Marketplace proposals
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
   buyer or platform), url (the project), pay (the budget as stated), fit_reason, draft.$txt$,
  $json${"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"platforms":{"default":["Workana","99Freelas"],"title":"Platforms","x-ui":{"kind":"multi","key":"platforms","label":"Platforms","options":["Upwork","Workana","99Freelas","Freelancer","Guru","PeoplePerHour"],"default":["Workana","99Freelas"]},"type":"array","items":{"type":"string","enum":["Upwork","Workana","99Freelas","Freelancer","Guru","PeoplePerHour"]}},"services":{"default":["SEO","AEO/GEO","Web design","Paid media","Content","Outbound","Fractional CMO"],"title":"Services","x-ui":{"kind":"multi","key":"services","label":"Services","options":["SEO","AEO/GEO","Web design","Paid media","Content","Outbound","Fractional CMO"],"default":["SEO","AEO/GEO","Web design","Paid media","Content","Outbound","Fractional CMO"]},"type":"array","items":{"type":"string","enum":["SEO","AEO/GEO","Web design","Paid media","Content","Outbound","Fractional CMO"]}},"min_budget_usd":{"default":300,"title":"Minimum budget","x-ui":{"kind":"number","key":"min_budget_usd","label":"Minimum budget","min":0,"max":10000,"step":50,"default":300,"unit":"USD"},"type":"number","minimum":0,"maximum":10000},"count":{"default":10,"title":"How many","x-ui":{"kind":"number","key":"count","label":"How many","min":1,"max":20,"default":10},"type":"number","minimum":1,"maximum":20}}}$json$::jsonb,
  $json${"platforms":["Workana","99Freelas"],"services":["SEO","AEO/GEO","Web design","Paid media","Content","Outbound","Fractional CMO"],"min_budget_usd":300,"count":10}$json$::jsonb,
  false, null, 20, 'approve_each', 'opus', true, 300, 90
)
on conflict (slug) do update set
  name = excluded.name, channel = excluded.channel, description = excluded.description,
  settings_schema = excluded.settings_schema, requires_browser = excluded.requires_browser;
