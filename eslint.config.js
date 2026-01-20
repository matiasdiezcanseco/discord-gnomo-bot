import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // Ignore patterns (replacing .eslintignore)
  {
    ignores: ['node_modules/**', 'dist/**', 'src-old/**'],
  },
  // Base JavaScript rules
  js.configs.recommended,
  // TypeScript rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  // Prettier integration (must be last)
  eslintConfigPrettier,
];
