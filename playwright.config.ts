import { defineConfig, devices } from '@playwright/test';
import {
  ANON_KEY as LOCAL_ANON,
  SERVICE_KEY as LOCAL_SERVICE,
} from './e2e/local-supabase/keys.mjs';

/**
 * End-to-end smoke test.
 *
 * Two ways to run it:
 *  1. `pnpm e2e:local` - no accounts needed. Uses a throwaway Postgres database
 *     and the test stand-in for Supabase in e2e/local-supabase.
 *  2. `pnpm e2e` against a real project: start the web app yourself, then set
 *     E2E_BASE_URL, E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY.
 */
const local = process.env.E2E_LOCAL === '1';
const webPort = Number(process.env.E2E_WEB_PORT ?? 3100);
const supabasePort = Number(process.env.LOCAL_SUPABASE_PORT ?? 54321);
const supabaseUrl = local ? `http://127.0.0.1:${supabasePort}` : process.env.E2E_SUPABASE_URL;

process.env.E2E_SUPABASE_URL = supabaseUrl ?? '';
if (local) process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = LOCAL_SERVICE;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${webPort}`,
    trace: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    // John mostly works from his phone, so the smoke test runs at phone size
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: local
    ? [
        {
          command: 'node e2e/local-supabase/server.mjs',
          url: `http://127.0.0.1:${supabasePort}/health`,
          reuseExistingServer: true,
          timeout: 30_000,
        },
        {
          command: `pnpm --filter @fgv/web exec next dev --port ${webPort} --hostname 127.0.0.1`,
          url: `http://127.0.0.1:${webPort}/login`,
          reuseExistingServer: true,
          timeout: 180_000,
          env: {
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_ANON,
            SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE,
          },
        },
      ]
    : undefined,
});
