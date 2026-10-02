// ESLint flat config — the repo's first linter (roomio-zhs.1).
//
// Scope is deliberately the four hand-written source roots: src/, shared/lib/,
// scripts/ and server/. The six build islands (camera-flythrough/, lighting/,
// multi-room/, persistence/, rendering/, texturing/) and source/ are NOT linted
// yet; adopting rules across ~60k lines in one pass produces a diff nobody can
// review. `npm run lint` names the four roots explicitly rather than linting
// `.`, so a new top-level directory cannot silently enter or dodge the gate.
//
// Ruleset philosophy: this config is a CORRECTNESS gate, not a style gate.
// Formatting is Prettier's job (prettier.config.mjs) and eslint-config-prettier
// is applied last to guarantee the two can never disagree — a lint error you
// can only fix by un-formatting the file is how teams learn to run `--no-verify`.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

/**
 * The rules roomio-zhs.1 exists for. Each one maps to a defect this repo
 * actually shipped or a control CLAUDE.md §2 declares non-negotiable, so they
 * are errors everywhere — including plain .js/.mjs — and never warnings:
 *
 * - react/no-danger: a `dangerouslySetInnerHTML` sink lived in Flythrough.tsx
 *   for months. It was not exploitable only because the interpolated strings
 *   happened to be literals; one room or listing name would have made it XSS.
 *   CLAUDE.md §2 bans reintroducing it — this is the automated half of that ban.
 * - no-eval / no-implied-eval: the other two string-to-code sinks §2 names.
 *   `no-implied-eval` is what catches `setTimeout('…')`, which reads innocent.
 * - @typescript-eslint/no-floating-promises: an un-awaited promise in an async
 *   Express handler or a node script loses the rejection entirely — the process
 *   logs nothing and the request hangs or 200s on a failed write.
 */
const CORRECTNESS_ERRORS = {
  'react/no-danger': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
}

export default tseslint.config(
  {
    // Build output, vendored trees and generated artefacts. `**/dist` matters:
    // every island writes one and CLAUDE.md §7 forbids importing from them, so
    // they must never be linted either.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/*.d.ts',
      'verify-out/**',
      'detection-pipeline/**',
    ],
  },

  // --- Baseline for every linted file -----------------------------------------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}', 'shared/lib/**/*.ts', 'scripts/**/*.mjs', 'server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Type-aware linting is switched on for ONE reason: no-floating-promises
        // cannot work without a program. tsconfig.eslint.json (not tsconfig.json)
        // supplies it — see the comment in that file for why they are separate.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Registered globally, not just on .tsx: react/no-danger also fires on
    // React.createElement(..., { dangerouslySetInnerHTML }), which can appear in
    // a plain .ts helper that never looks like a component.
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      ...CORRECTNESS_ERRORS,

      // `any` is CLAUDE.md §3's named anti-pattern ("model the type, or use
      // `unknown` plus a narrowing check"). Warn, not error: the existing
      // occurrences are pre-existing debt and turning them into errors here
      // would either block the gate or force drive-by casts, which is worse.
      '@typescript-eslint/no-explicit-any': 'warn',

      // tsc has noUnusedLocals/noUnusedParameters explicitly false (the reason
      // dead code accumulates invisibly — roomio-zhs.1's description). ESLint
      // takes over the job, with the repo's existing `_`-prefix escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-unused-vars': 'off',
    },
  },

  // --- Browser / React code ----------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Only the two classic hook rules. eslint-plugin-react-hooks v7's
      // `recommended-latest` additionally turns on the React Compiler rule set
      // (purity, immutability, set-state-in-effect, …), which reports hundreds
      // of findings against R3F-heavy code written before those rules existed.
      // Adopting them is its own ticket, not a side effect of adding a linter.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Fast Refresh silently degrades to a full reload when a module exports
      // anything besides components; `allowConstantExport` keeps the common
      // `export const FOO = …` next to a component from being flagged.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // --- Node code: scripts/ and server/ -----------------------------------------
  {
    files: ['scripts/**/*.mjs', 'server/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: {
      // These are CLIs and a server: stdout/stderr IS their interface.
      'no-console': 'off',
      // Plain JS has no annotations, so the TS-flavoured unused-vars rule reads
      // as noise here; the core rule with the same `_` escape hatch is enough.
      // `_next` in server/app.js matters: Express only recognises an error
      // handler by its FOUR-argument arity, so the unused 4th param is
      // load-bearing and must not be "cleaned up".
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // --- Browser globals inside puppeteer driver scripts -------------------------
  {
    // scripts/ are puppeteer drivers: the bodies of `page.evaluate(() => …)` are
    // serialised and executed IN THE BROWSER, where `document` and `window` are
    // real. ESLint cannot scope globals to a callback, so without this 54 correct
    // lines report as `no-undef` — and the usual response is to switch no-undef
    // off entirely, losing the genuine-typo detection that is its whole point.
    // Deliberately NOT applied to server/**: `document` there is a real bug.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // --- Test files ---------------------------------------------------------------
  {
    files: ['**/*.test.{ts,tsx,js,mjs}', '**/test/**/*.{js,mjs,ts}', 'scripts/lib/harness.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
    rules: {
      // Tests deliberately reach into internals and build throwaway fixtures.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // MUST stay last: switches off every rule that could contradict Prettier.
  prettier,
)
