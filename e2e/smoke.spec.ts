import { expect, test, type Page } from '@playwright/test';

/**
 * E2E smoke (spec section 13): log in with a test user, open Home, open a bot,
 * queue a run, see the run page. Runs at 375 px wide, the size of John's phone.
 *
 * The extra checks further down cover the Phase 3 acceptance list. They change
 * data, so they only run against the local test database (E2E_LOCAL=1).
 */
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? '';
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? '';
const local = process.env.E2E_LOCAL === '1';
const OWNER = process.env.E2E_EMAIL ?? 'e2e-owner@example.com';
const VIEWER = 'e2e-viewer@example.com';

test.use({ viewport: { width: 375, height: 812 } });
test.describe.configure({ mode: 'serial' });

/** Asks Supabase (as an admin) for the one-time code a login email would carry. */
async function loginCode(email: string): Promise<string> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  expect(response.ok, 'the admin API returned a login code').toBe(true);
  const body = (await response.json()) as {
    email_otp?: string;
    properties?: { email_otp?: string };
  };
  const code = body.email_otp ?? body.properties?.email_otp;
  expect(code, 'login code').toBeTruthy();
  return code!;
}

async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send me a login link' }).click();
  await expect(page.getByTestId('login-sent')).toBeVisible();
  await page.getByLabel('Or type the code from the email').fill(await loginCode(email));
  await page.getByRole('button', { name: 'Log in with code' }).click();
  await expect(page.getByRole('link', { name: 'FGV Control Panel' })).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal scroll on ${page.url()}`).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  test.skip(!supabaseUrl || !serviceKey, 'Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY');
});

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'FGV Control Panel' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('log in, open Home, open a bot, queue a run, see the run page', async ({ page }) => {
  await logIn(page, OWNER);

  // Home: the eight bot cards, grouped by channel
  await expect(page.getByTestId('bot-card')).toHaveCount(8);
  for (const channel of ['Demo', 'Jobs', 'Candidates', 'LinkedIn', 'Leads', 'Marketplaces']) {
    await expect(page.getByRole('heading', { name: channel, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('metric')).toHaveCount(4);
  await expectNoSidewaysScroll(page);

  // open a bot
  await page.getByRole('link', { name: 'Settings for Find positions in the market' }).click();
  await expect(page).toHaveURL(/\/bots\/market-positions$/);
  await expect(page.getByRole('heading', { name: 'Find positions in the market' })).toBeVisible();
  await expect(page.getByLabel('Role')).toHaveValue(/.+/);
  await expectNoSidewaysScroll(page);

  // queue a run
  await page.getByTestId('run-now').click();
  await expect(page.getByTestId('run-form')).toBeVisible();
  await page.getByTestId('run-form').getByLabel('Role').fill('Head of Marketing');
  await page.getByTestId('run-confirm').click();

  // the run page
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('run-page')).toBeVisible();
  await expect(page.getByTestId('status-pill')).toHaveAttribute('data-status', 'queued');
  await expect(page.getByTestId('live-log')).toContainText('Waiting for the first message');
  await expectNoSidewaysScroll(page);
});

test.describe('Phase 3 acceptance (local test database only)', () => {
  test.skip(!local, 'These checks change data, so they only run with E2E_LOCAL=1');

  test('a changed setting persists', async ({ page }) => {
    await logIn(page, OWNER);
    await page.goto('/bots/market-positions');
    await page.getByLabel('Role').fill('SEO Manager');
    await page.locator('[data-field="workplace"]').getByRole('radio', { name: 'Remote' }).click();
    await page.getByTestId('save-settings').click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Role')).toHaveValue('SEO Manager');
    await expect(
      page.locator('[data-field="workplace"]').getByRole('radio', { name: 'Remote' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('every page fits a 375 px screen', async ({ page }) => {
    await logIn(page, OWNER);
    for (const path of ['/', '/approvals', '/results', '/workers', '/settings', '/more']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  });

  test('buttons, links and inputs are at least 44 px tall on every page', async ({ page }) => {
    await logIn(page, OWNER);
    const { data: run } = await (async () => {
      await page.goto('/bots/market-positions');
      const href = await page.locator('a[href^="/runs/"]').first().getAttribute('href');
      return { data: href };
    })();
    const paths = [
      '/',
      '/bots/market-positions',
      '/approvals',
      '/results',
      '/workers',
      '/settings',
      '/more',
    ];
    if (run) paths.push(run);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
      const small = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'button, a[href], [role="switch"], select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"])',
          ),
        ]
          // the framework's own dev-mode badge is not part of the app
          .filter((element) => element.offsetParent !== null && !element.closest('nextjs-portal'))
          .map((element) => ({
            text: (element.getAttribute('aria-label') ?? element.textContent ?? '')
              .trim()
              .slice(0, 40),
            height: Math.round(element.getBoundingClientRect().height),
          }))
          .filter((entry) => entry.height > 0 && entry.height < 44),
      );
      expect(small, `tap targets smaller than 44 px on ${path}`).toEqual([]);
    }
  });

  test('Stop all sets the banner, Resume clears it', async ({ page }) => {
    await logIn(page, OWNER);
    await page.getByTestId('stop-all').click();
    await expect(page.getByText('Stop every running bot?')).toBeVisible();
    await page.getByTestId('stop-all-confirm').click();
    await expect(page.getByTestId('kill-banner')).toContainText('All bots are stopped');

    // the queued run from the smoke test was cancelled, and nothing new can start
    await expect(page.getByTestId('run-now').first()).toBeDisabled();

    await page.getByTestId('resume-all').click();
    await expect(page.getByTestId('kill-banner')).toHaveCount(0);
    await expect(page.getByTestId('run-now').first()).toBeEnabled();
  });

  test('CSV export downloads the results', async ({ page }) => {
    await logIn(page, OWNER);
    await page.goto('/results');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-csv').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^fgv-results-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('people manage their own computers, and only theirs', async ({ page }) => {
    // two computers register themselves (as the worker program would)
    const now = new Date().toISOString();
    const made = await fetch(`${supabaseUrl}/rest/v1/workers`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        prefer: 'return=representation',
      },
      body: JSON.stringify([
        { name: 'e2e-laptop', has_browser: true, has_desktop: false, last_heartbeat: now },
        { name: 'e2e-desktop', has_browser: true, has_desktop: true, last_heartbeat: now },
      ]),
    });
    expect(made.ok).toBe(true);

    // the viewer logs in once so they exist, then the owner gives them the laptop
    await logIn(page, VIEWER);
    await page.context().clearCookies();
    await logIn(page, OWNER);
    await page.goto('/workers');
    const laptop = page.getByTestId('worker-card').filter({ hasText: 'e2e-laptop' });
    await expect(page.getByTestId('worker-card').filter({ hasText: 'e2e-desktop' })).toContainText(
      'Full desktop',
    );
    await expect(laptop).toContainText('Browser only');
    await laptop.getByLabel('Who e2e-laptop belongs to').selectOption({ label: 'e2e-viewer' });
    await expect(laptop.getByText('e2e-viewer').first()).toBeVisible();

    // the viewer sees it under "Your computers" and can pause it, but not the other one
    await page.context().clearCookies();
    await logIn(page, VIEWER);
    await page.goto('/workers');
    await expect(page.getByRole('heading', { name: 'Your computers' })).toBeVisible();
    const mine = page.getByTestId('worker-card').filter({ hasText: 'e2e-laptop' });
    await mine.getByRole('switch', { name: 'Pause e2e-laptop' }).click();
    await expect(mine.getByText('Paused')).toBeVisible();
    const other = page.getByTestId('worker-card').filter({ hasText: 'e2e-desktop' });
    await expect(other.getByRole('switch')).toHaveCount(0);
    await expect(other.getByLabel('Who e2e-desktop belongs to')).toHaveCount(0);
  });

  test('the chat says so when no computer is online to answer', async ({ page }) => {
    // every computer went quiet
    await fetch(`${supabaseUrl}/rest/v1/workers?name=like.e2e-*`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ last_heartbeat: '2020-01-01T00:00:00Z' }),
    });
    await logIn(page, OWNER);
    await page.getByTestId('open-chat').click();
    await page.getByTestId('chat-input').fill('What is running right now?');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-error')).toContainText('No worker computer is online');
    // the message is handed back so nothing typed is lost
    await expect(page.getByTestId('chat-input')).toHaveValue('What is running right now?');
  });

  test('a viewer cannot change anything', async ({ page }) => {
    await logIn(page, VIEWER);
    // no Stop all, Run now is disabled, schedule switches are disabled
    await expect(page.getByTestId('stop-all')).toHaveCount(0);
    await expect(page.getByTestId('run-now').first()).toBeDisabled();
    await expect(page.getByTestId('schedule-switch').first()).toBeDisabled();

    // the settings page is read-only
    await page.goto('/bots/market-positions');
    await expect(
      page.getByText('You can look at these settings but not change them'),
    ).toBeVisible();
    await expect(page.getByTestId('save-settings')).toBeDisabled();

    // and the server refuses even a hand-made request
    const response = await page.request.post('/api/runs', { data: { slug: 'market-positions' } });
    expect(response.status()).toBe(403);
    const stop = await page.request.post('/api/runs/00000000-0000-0000-0000-000000000000/stop');
    expect(stop.status()).toBe(403);
  });
});
