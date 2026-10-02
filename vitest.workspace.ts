// Vitest workspace — the single source of truth for every JS/TS test suite in the
// repo that runs offline (the one exception, server/, is explained at the bottom).
// Running `npm test` (= `vitest run`) at the root executes all of the
// projects below in one pass, so CI and the pre-push hook gate the full set,
// not just the root suite (previously only 283 of 522+ tests were gated).
//
// Each project keeps its own vitest.config.ts, so `npm test` inside a
// workspace directory still works standalone. All suites are node-environment
// pure-logic tests and resolve their deps (three, zustand, react, …) from the
// root node_modules — one `npm ci` at the root is enough to run everything.
//
// Python tests (detection-pipeline/tests) are NOT vitest and are run
// separately: `npm run test:py` (see scripts/test-python.mjs). `npm run
// test:all` = both.
//
// Adding a new workspace with tests? Add its config here or it will not be
// gated by CI.
export default [
  './vitest.config.ts', // root: src/**, shared/lib/**, scripts/**
  './camera-flythrough/vitest.config.ts',
  './lighting/vitest.config.ts',
  './multi-room/vitest.config.ts',
  './persistence/vitest.config.ts',
  './rendering/vitest.config.ts',
  './texturing/vitest.config.ts',
  // `server/vitest.config.js` (68 tests) is deliberately NOT listed. Unlike every
  // suite above it is not self-contained: test/global-setup.js creates and drops a
  // real `roomio_test` Postgres database, and its deps (supertest, express, pg) live
  // in server/node_modules, not the root ones. Adding it here would make the root
  // `npm test` fail for anyone who has not installed Postgres and run
  // `npm ci --prefix server` — and the root suite must stay runnable on nothing but
  // a root `npm ci`. It is still gated: CI runs it in the separate `server-test` job
  // with a Postgres service container (.github/workflows/ci.yml). Locally:
  // `npm test --prefix server`.
]
