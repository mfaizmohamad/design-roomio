// test/global-setup.js — create/migrate/drop the throwaway test database.
//
// Runs in the vitest main process before/after all test workers. Connects to a
// maintenance database (PG_ADMIN_URL, default the local `postgres` db) and
// recreates the test database from scratch so every run starts clean and the
// real `roomio` database is never touched.
//
// The schema then comes from server/migrations/*.sql via the real runner — the
// same code path a deploy uses. It used to come from `initDb()` called inside
// each test's `freshDb()`, which meant the suite could pass against a schema the
// migrations no longer produced.

import { migrate } from '../migrate.js'
import {
  TEST_DATABASE_URL,
  dropDatabase,
  recreateDatabase,
  testDbName,
} from './db-admin.js'

export async function setup() {
  await recreateDatabase(testDbName())
  await migrate({ connectionString: TEST_DATABASE_URL })
}

export async function teardown() {
  await dropDatabase(testDbName())
}
