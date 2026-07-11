// Flat ESLint config (ESLint 9) — replaces the legacy `.eslintrc.json`.
//
// This is a Node.js + TypeScript backend. The previous config extended
// `airbnb` and loaded the React/JSX/hooks plugins, which were frontend
// leftovers with no place in a server codebase; they have been dropped.
//
// Rule levels intentionally mirror the previous setup (mostly `warn`) so the
// migration does not change which code is flagged as an *error*. Tightening
// typescript-eslint rules toward `strictTypeChecked` is a deliberate follow-up.
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const unusedImports = require('eslint-plugin-unused-imports');

module.exports = tseslint.config(
  // Not linted: build output, coverage, vendored/generated assets, and plain
  // JS. This is a TypeScript project; the remaining `.js` files are config,
  // mocks and test fixtures that don't need linting.
  {
    ignores: [
      'dist/**',
      'built/**',
      'coverage/**',
      'node_modules/**',
      'docs/**',
      'python/**',
      'cdk.out/**',
      '**/*.js'
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname
      }
    },
    plugins: {
      'unused-imports': unusedImports
    },
    rules: {
      // --- ported from the previous .eslintrc.json (.ts override) ---
      '@typescript-eslint/no-floating-promises': 'warn',
      'no-undef': 'off',
      'no-underscore-dangle': 'off',
      camelcase: 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-require-imports': 'warn',
      'no-console': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn',
      'prefer-const': 'warn',
      'object-shorthand': ['warn', 'always'],
      'prefer-template': 'warn',
      'no-throw-literal': 'warn',
      'no-param-reassign': 'warn',
      'no-else-return': ['warn', { allowElseIf: false }],
      '@typescript-eslint/no-shadow': 'warn',
      'no-duplicate-imports': 'warn',

      // --- typescript-eslint recommended rules the existing code relies on ---
      // Kept as warnings (not build-breaking errors) to preserve the prior lint
      // tolerance across the codebase; tighten these incrementally.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-namespace': 'off',

      // Pre-existing violations of newly-adopted recommended rules. The legacy
      // config didn't enable these, so they were never errors; kept as warnings
      // so the migration flags them without breaking the build. Clean up later.
      'no-constant-binary-expression': 'warn',
      'no-extra-boolean-cast': 'warn',
      'no-empty': 'warn',
      'no-prototype-builtins': 'warn',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-this-alias': 'warn'
    }
  },

  {
    // Tests: relax rules that don't apply to Jest specs / fixtures.
    files: ['**/*.test.ts', '__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'unused-imports/no-unused-vars': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-param-reassign': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  {
    // The logger is the one place raw console output is intentional.
    files: ['services/logger.ts'],
    rules: { 'no-console': 'off' }
  }
);
