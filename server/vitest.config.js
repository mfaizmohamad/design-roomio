// vitest.config.js — server test suite configuration.
//
// The suite runs against an ISOLATED throwaway Postgres database (default
// `roomio_test`, created and dropped by test/global-setup.js) so it can never
// touch real `roomio` data, and it binds no fixed port — supertest drives the
// app on ephemeral ports. `npm test` in server/ therefore needs nothing but a
// reachable local Postgres.
//
// Env knobs (both optional, used by CI's service container):
//   TEST_DATABASE_URL — connection string for the throwaway test db
//                       (its database name MUST end in `_test`)
//   PG_ADMIN_URL      — maintenance connection used to create/drop the test db
import { defineConfig } from 'vitest/config'

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://localhost/roomio_test'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globalSetup: './test/global-setup.js',
    // All files share one test database; run them one at a time so TRUNCATE-based
    // isolation in one file can't race another file's requests.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      // db.js reads DATABASE_URL at import time; point every worker at the
      // throwaway database, never at the real `roomio` one.
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
      // Production hashes at cost 12 (~300ms each); the suite signs up dozens of
      // users, so drop the cost here. This tunes SPEED ONLY — every other
      // property under test (hash at rest, verification, cookie flags) is
      // identical at cost 4. Never set this outside tests.
      BCRYPT_ROUNDS: '4',
    },
  },
})
