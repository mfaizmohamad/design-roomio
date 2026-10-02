// test/db-admin.js — maintenance-connection helpers for throwaway test databases.
//
// Shared by global-setup.js (which provisions the one suite-wide database) and
// by migrate.test.js (which needs its own short-lived scratch databases to prove
// a migration applies to an EMPTY one). Deliberately one module rather than two
// copies: the safety rail below is the only thing standing between a typo and
// `DROP DATABASE roomio`, and a rail that exists twice gets relaxed in one copy.

import pg from 'pg'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://localhost/roomio_test'

/**
 * Hard safety rail for every name that reaches a DROP/CREATE DATABASE statement.
 *
 * Those two statements cannot take bound parameters, so the name is interpolated
 * — which is exactly why it is validated first, and validated to something far
 * narrower than "valid identifier": it must be plain lowercase/digits/underscore
 * AND end in `_test`, so no reachable input can ever name the real `roomio`
 * database.
 *
 * @param {string} name
 * @returns {string} the same name, once proven safe.
 * @throws if the name could name anything but a throwaway test database.
 */
export function assertThrowawayDbName(name) {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`unsafe test database name: ${JSON.stringify(name)}`)
  }
  if (!name.endsWith('_test')) {
    throw new Error(
      `refusing to manage database "${name}" — test database names must end in "_test" ` +
        `(set TEST_DATABASE_URL accordingly)`
    )
  }
  return name
}

/** Database name from the test URL, validated hard so we can only ever drop a *_test db. */
export function testDbName() {
  return assertThrowawayDbName(new URL(TEST_DATABASE_URL).pathname.replace(/^\//, ''))
}

/** Maintenance connection string: PG_ADMIN_URL, or the test URL pointed at db `postgres`. */
export function adminUrl() {
  if (process.env.PG_ADMIN_URL) return process.env.PG_ADMIN_URL
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = '/postgres'
  return url.toString()
}

/**
 * Connection string for another throwaway database on the same server, carrying
 * the credentials and port from TEST_DATABASE_URL (CI supplies both).
 * @param {string} name Must satisfy `assertThrowawayDbName`.
 */
export function databaseUrl(name) {
  const url = new URL(TEST_DATABASE_URL)
  url.pathname = `/${assertThrowawayDbName(name)}`
  return url.toString()
}

/** Run `fn` against a maintenance connection, always closing it. */
export async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: adminUrl() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Drop (if present) and recreate an empty throwaway database. */
export async function recreateDatabase(name) {
  const safe = assertThrowawayDbName(name)
  await withAdmin(async (client) => {
    // WITH (FORCE) (PG 13+) kicks any stragglers from a previous aborted run.
    await client.query(`DROP DATABASE IF EXISTS ${safe} WITH (FORCE)`)
    await client.query(`CREATE DATABASE ${safe}`)
  })
}

/** Drop a throwaway database if it exists. */
export async function dropDatabase(name) {
  const safe = assertThrowawayDbName(name)
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${safe} WITH (FORCE)`)
  })
}
