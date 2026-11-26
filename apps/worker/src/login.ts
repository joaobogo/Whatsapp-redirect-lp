// pnpm worker:login
// Opens this worker's own Chrome profile in a normal window so you can sign in
// to the sites the browser bots use. The session is saved in BROWSER_PROFILE_DIR
// and stays there. The bots never type passwords: you do it here, once.
import { openProfileForLogin } from './browser';
import { WORKER_ROOT } from './config';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(WORKER_ROOT, '.env'), quiet: true });

const SITES = [
  'https://www.linkedin.com/login',
  'https://secure.indeed.com/auth',
  'https://jobs.workable.com/',
  'https://mail.google.com/',
];

const configured = process.env.BROWSER_PROFILE_DIR || './profiles/main';
const profileDir = path.isAbsolute(configured) ? configured : path.resolve(WORKER_ROOT, configured);

console.log("Opening Chrome with the bots' own profile.");
console.log('1. Sign in to LinkedIn, Indeed, Workable and Gmail in the tabs that open.');
console.log(
  '2. Sign in to any other site a bot should use (Upwork, Workana, 99Freelas, Greenhouse...).',
);
console.log('3. Close the Chrome window when you are done. Your sessions are saved.');
console.log(`Profile folder: ${profileDir}`);

openProfileForLogin(profileDir, SITES)
  .then(() => {
    console.log('Saved. You can start the worker now.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Chrome could not be opened.');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Is Google Chrome installed? Run: npx playwright install chrome');
    console.error(
      'Is the worker running? Stop it first: only one program can use the profile at a time.',
    );
    process.exit(1);
  });
