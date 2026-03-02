import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow explicit `any` when wrapping external tool output (per CLAUDE.md convention)
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow unused vars prefixed with underscore
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Enforce returning awaited promises in try/catch (safety for exec.ts pattern)
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],

      // Allow floating promises only when explicitly voided
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],

      // Consistent type imports
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'tests/', '*.config.*', '*.js', '*.mjs'],
  },
);
