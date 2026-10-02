// db.js
// -----------------------------------------------------------------------------
// PostgreSQL connection pool for the Roomio backend. The pool is shared across
// the whole process.
//
// This module issues NO DDL. The schema lives in server/migrations/*.sql and is
// applied by `npm run migrate` as an explicit deploy step (see migrate.js). The
// old `initDb()` bootstrap that ran CREATE TABLE IF NOT EXISTS here on every
// boot is gone on purpose: it could not express a change to an existing table,
// every instance raced it on deploy, and it forced the application's database
// role to hold DDL privileges forever — which makes one SQL injection anywhere
// in the API a schema-drop. The app role now needs DML only.
// -----------------------------------------------------------------------------

import pg from 'pg'

import { sslConfig } from './pgssl.js'

const { Pool } = pg

// Connection string. Defaults to the local trust/peer-auth `roomio` database;
// override with DATABASE_URL in any other environment.
const connectionString =
  process.env.DATABASE_URL || 'postgresql://localhost/roomio'

// A single shared pool for the lifetime of the process. pg manages a small set
// of physical connections under the hood and hands them out per query.
export const pool = new Pool({
  connectionString,
  ssl: sslConfig(),
  // Bound the pool so a traffic spike queues in node instead of exhausting the
  // database's own connection limit (managed Postgres tiers cap this low).
  max: Number.parseInt(process.env.PG_POOL_MAX ?? '', 10) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

// An idle client erroring (database restarted, network blip) emits on the pool.
// Unhandled, that is an uncaught exception and the process dies.
pool.on('error', (err) => {
  console.error('[roomio] idle postgres client error:', err)
})

/**
 * Thin query helper so callers don't have to reach into the pool directly.
 * @param {string} text  Parameterized SQL ($1, $2, ...).
 * @param {Array} [params] Bound parameter values.
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  return pool.query(text, params)
}
