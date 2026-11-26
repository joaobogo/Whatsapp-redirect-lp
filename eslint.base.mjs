// Shared ESLint rules for every workspace package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export const baseRules = {
  // The build spec forbids `any` unless the reason is written next to it.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
};

export default tseslint.config(
  { ignores: ['dist/**', '.next/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { rules: baseRules },
);
