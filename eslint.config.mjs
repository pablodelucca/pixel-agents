import sharedConfig from '@minion-stack/lint-config/eslint.config.js';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import typescriptEslint from 'typescript-eslint';

import pixelAgentsPlugin from './eslint-rules/pixel-agents-rules.mjs';

export default [
  // Shared @minion-stack preset: js.configs.recommended + tseslint.configs.recommended + ecma/source-type + baseline rules
  ...sharedConfig,
  {
    files: ['**/*.ts'],
  },
  {
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
      'simple-import-sort': simpleImportSort,
      'pixel-agents': pixelAgentsPlugin,
    },

    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },

    rules: {
      // Preserved local rules from pre-adoption eslint.config.mjs
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
      ],

      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      'simple-import-sort/imports': 'warn',
      'simple-import-sort/exports': 'warn',
      'pixel-agents/no-inline-colors': 'warn',
    },
  },
  {
    files: ['src/constants.ts'],
    rules: {
      'pixel-agents/no-inline-colors': 'off',
    },
  },
  // eslint-config-prettier LAST — disables stylistic rules that conflict with Prettier
  eslintConfigPrettier,
];
