// @ts-check
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { layerConfigs } from './eslint/layers.js';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build-report/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.beads/',
      '.claude/',
      'assets/',
      'site/',
      // Throwaway spikes (mw-e00.13 engine, mw-e11.1 AI architecture): not game code, each typechecked
      // and tested by its own config (spikes/README.md, spikes/ai-architecture/README.md).
      'spikes/',
      'tests/toolchain/fixtures/',
      'tests/lint-fixtures/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  ...layerConfigs(eslintComments),
  prettier,
);
