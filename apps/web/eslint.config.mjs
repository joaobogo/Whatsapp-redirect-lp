import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { baseRules } from '../../eslint.base.mjs';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  { rules: baseRules },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
