import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { ALLOWED_BROWSER_TOOLS } from './guard';

const require = createRequire(import.meta.url);

export const PLAYWRIGHT_SERVER = 'playwright';
export { ALLOWED_BROWSER_TOOLS };

/**
 * Playwright MCP, started as a child process for one run.
 *
 * It uses a dedicated Chrome profile on this worker (not the user's everyday
 * Chrome). John signs in to LinkedIn, Indeed, Workable etc. once with
 * `pnpm worker:login`, and the session stays in BROWSER_PROFILE_DIR.
 * A profile can be open in one browser at a time, so a worker runs one
 * browser bot at a time (enforced in index.ts).
 */
export function playwrightServerConfig(
  profileDir: string,
  outputDir: string,
): McpStdioServerConfig {
  mkdirSync(profileDir, { recursive: true });
  // the package only exports its manifest, so find cli.js next to it
  const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  return {
    type: 'stdio',
    command: process.execPath,
    args: [
      cli,
      '--browser',
      'chrome',
      // headed (the default): the window is visible, so John can watch what a bot is doing
      '--user-data-dir',
      profileDir,
      '--output-dir',
      outputDir,
      // text snapshots only: no screenshots or page HTML end up in the logs
      '--image-responses',
      'omit',
    ],
    // a "wait 60 seconds" call must be allowed to finish
    timeout: 120_000,
    alwaysLoad: true,
  };
}

interface PersistentContext {
  pages(): { goto(url: string): Promise<unknown> }[];
  newPage(): Promise<{ goto(url: string): Promise<unknown> }>;
  on(event: 'close', listener: () => void): void;
  close(): Promise<void>;
}

/**
 * Opens the worker's Chrome profile in a normal window so a person can sign
 * in. Uses the Playwright that ships with @playwright/mcp, so the profile is
 * opened by exactly the same browser build the bots use.
 */
export async function openProfileForLogin(profileDir: string, urls: string[]): Promise<void> {
  mkdirSync(profileDir, { recursive: true });
  const fromMcp = createRequire(require.resolve('@playwright/mcp/package.json'));
  const playwright = fromMcp('playwright') as {
    chromium: {
      launchPersistentContext(
        dir: string,
        options: { channel: string; headless: boolean; viewport: null },
      ): Promise<PersistentContext>;
    };
  };
  const context = await playwright.chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  });
  const first = context.pages()[0] ?? (await context.newPage());
  for (const [index, url] of urls.entries()) {
    const page = index === 0 ? first : await context.newPage();
    await page.goto(url).catch(() => undefined);
  }
  await new Promise<void>((resolve) => context.on('close', resolve));
}
