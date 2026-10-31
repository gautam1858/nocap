import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Shipped code must never be able to reach the network. The no-network test
// enforces this on the AST; these rules surface the same mistake in the editor.
const networkModules = [
  'dgram',
  'dns',
  'http',
  'http2',
  'https',
  'inspector',
  'net',
  'tls',
  'undici',
];

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Every file, JavaScript included, is type-checked by tsc, which resolves globals properly.
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: networkModules.flatMap((name) => [
            { name, message: 'nocap is local-only; network modules are not allowed.' },
            {
              name: `node:${name}`,
              message: 'nocap is local-only; network modules are not allowed.',
            },
          ]),
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'navigator'].map((name) => ({
          name,
          message: 'nocap is local-only; network APIs are not allowed.',
        })),
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
