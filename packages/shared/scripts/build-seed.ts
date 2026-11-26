// Writes supabase/seed.sql from the bot catalog. Run with: pnpm seed:build
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSeedSql } from '../src/seed';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../../supabase/seed.sql');
writeFileSync(target, buildSeedSql(), 'utf8');
console.log('Wrote ' + target);
