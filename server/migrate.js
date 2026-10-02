// migrate.js
// -----------------------------------------------------------------------------
// Schema migration runner. Replaces the old `initDb()` DDL-on-boot bootstrap.
//
// Why not a library: the schema is three tables. A runner that reads numbered
// .sql files, applies the unapplied ones in order inside a transaction each, and
// records them in `schema_migrations` is ~120 lines and adds no dependency to a
// package whose whole point is to be a small attack surface.
//
// Three properties the old `CREATE TABLE IF NOT EXISTS` boot path could not give
// us, each of which is a real incident the moment there is user data:
//
//   1. It cannot express a change to an EXISTING table. `IF NOT EXISTS` on a
//      table that already exists is a no-op, so ADD COLUMN / SET NOT NULL /
//      type changes silently do nothing and the code ships expecting them.
//   2. Every app instance ran it CONCURRENTLY on deploy. Two backends issuing
//      `CREATE TABLE IF NOT EXISTS` at the same instant deadlock or raise a
//      duplicate-object error on the loser. Here a session-level advisory lock
//      serialises runners, so N instances are the same as one.
//   3. It required the APPLICATION's role to hold DDL privileges forever, which
//      turns any SQL injection anywhere in the API into a DROP TABLE. Migrations
//      are now a deploy step that can run as a separate, higher-privilege role
//      (MIGRATION_DATABASE_URL) while the app connects with DML only.
//
// Usage:
//   npm run migrate            # in server/, as a deploy step BEFORE the new app starts
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import pg from 'pg'

import { sslConfig } from './pgssl.js'

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url))

// Numbered, zero-padded, lowercase: `001_initial_schema.sql`. Enforced rather
// than assumed — an unparseable name would otherwise be applied in whatever
// order readdir() happened to return, which is not a property we can rely on.
const MIGRATION_FILE_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/

// Arbitrary but FIXED key for pg_advisory_lock. Every runner against a given
// database must use the same number or the lock protects nothing; never change
// it. (Derived from "roomio-migrate"; the value itself carries no meaning.)
const MIGRATION_LOCK_ID = 6_120_874_019_553

/**
 * Read and validate every migration file, in the order they must be applied.
 *
 * @returns {Array<{ version: string, filename: string, sql: string, checksum: string }>}
 * @throws if a filename does not match `NNN_name.sql`, or if two files share a
 *         version number (which would make the apply order ambiguous).
 */
export function loadMigrations() {
  const filenames = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))

  const byNumber = new Map()
  const migrations = filenames.map((filename) => {
    const match = MIGRATION_FILE_RE.exec(filename)
    if (!match) {
      throw new Error(
        `migration "${filename}" must be named NNN_lowercase_name.sql (e.g. 002_add_designs_archived.sql)`
      )
    }
    const version = match[1]
    const number = Number(version)
    const clash = byNumber.get(number)
    if (clash) {
      throw new Error(
        `migrations "${clash}" and "${filename}" share version ${number} — apply order is ambiguous`
      )
    }
    byNumber.set(number, filename)

    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
    return {
      version,
      number,
      filename,
      sql,
      // Content hash, stored alongside the applied row. Editing a migration that
      // has already run is the classic way for two environments to end up with
      // different schemas while both report "up to date"; this makes it loud.
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  })

  // Sort NUMERICALLY, not lexicographically: once there are four-digit
  // migrations, string order puts "1000" before "999".
  return migrations.sort((a, b) => a.number - b.number)
}

/**
 * Versions that exist on disk but have not been recorded as applied.
 *
 * Used by the app on boot to refuse to serve against a stale schema — the app
 * never runs DDL, so without this check a deploy that forgot `npm run migrate`
 * starts happily and then 500s on every request that touches a new column.
 *
 * @param {(text: string, params?: Array) => Promise<import('pg').QueryResult>} runQuery
 * @returns {Promise<string[]>} Pending versions, oldest first. Empty when current.
 */
export async function pendingMigrations(runQuery) {
  const migrations = loadMigrations()

  // to_regclass() reads the catalog and needs no privilege on the table itself,
  // so this works for an application role that has been granted nothing yet —
  // and returns NULL instead of throwing when the table is absent.
  const { rows } = await runQuery(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present`
  )
  if (!rows[0]?.present) return migrations.map((m) => m.version)

  const { rows: applied } = await runQuery(`SELECT version FROM schema_migrations`)
  const seen = new Set(applied.map((row) => row.version))
  return migrations.filter((m) => !seen.has(m.version)).map((m) => m.version)
}

/**
 * Apply every pending migration, in order, against `connectionString`.
 *
 * Idempotent: migrations already recorded in `schema_migrations` are skipped, so
 * re-running is a no-op. Safe to run from several instances at once.
 *
 * @param {{ connectionString?: string, log?: (msg: string) => void }} [options]
 * @returns {Promise<{ applied: string[], skipped: string[] }>} versions applied
 *          by THIS run, and versions that were already present.
 * @throws if a migration fails (that migration is rolled back and later ones are
 *         not attempted), or if an already-applied migration's file has changed.
 */
export async function migrate({ connectionString, log = () => {} } = {}) {
  const migrations = loadMigrations()

  const client = new pg.Client({ connectionString, ssl: sslConfig() })
  await client.connect()
  try {
    // Serialise concurrent runners BEFORE any DDL. Deploying N instances used to
    // mean N simultaneous bootstraps; a session-level advisory lock makes the
    // losers wait and then find nothing left to do. It is released explicitly
    // below and, belt and braces, by the backend when the session ends.
    await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_LOCK_ID])
    try {
      // The only DDL the runner itself owns. `IF NOT EXISTS` is safe here
      // because this table's definition is frozen by definition — it is what
      // tracks whether anything else may change.
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version    TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          checksum   TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)

      const { rows } = await client.query(`SELECT version, name, checksum FROM schema_migrations`)
      const appliedChecksums = new Map(rows.map((row) => [row.version, row.checksum]))

      const applied = []
      const skipped = []

      for (const migration of migrations) {
        const previous = appliedChecksums.get(migration.version)
        if (previous !== undefined) {
          if (previous !== migration.checksum) {
            throw new Error(
              `migration ${migration.filename} was already applied but its contents have changed ` +
                `(recorded sha256 ${previous.slice(0, 12)}…, on disk ${migration.checksum.slice(0, 12)}…). ` +
                `Never edit an applied migration — add a new one.`
            )
          }
          skipped.push(migration.version)
          continue
        }

        // One transaction per migration, with the bookkeeping row INSIDE it.
        // Postgres DDL is transactional, so a half-applied migration is
        // impossible: either the schema change and its schema_migrations row
        // both land, or neither does and the next run retries it cleanly.
        await client.query(`BEGIN`)
        try {
          await client.query(migration.sql)
          await client.query(
            `INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
            [migration.version, migration.filename, migration.checksum]
          )
          await client.query(`COMMIT`)
        } catch (err) {
          await client.query(`ROLLBACK`)
          throw new Error(`migration ${migration.filename} failed: ${err.message}`, { cause: err })
        }

        applied.push(migration.version)
        log(`applied ${migration.filename}`)
      }

      return { applied, skipped }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_ID])
    }
  } finally {
    await client.end()
  }
}

/** Database name only — never log the connection string itself, it holds the password. */
function describeTarget(connectionString) {
  try {
    return new URL(connectionString).pathname.replace(/^\//, '') || '(default)'
  } catch {
    return '(unparseable connection string)'
  }
}

// --- CLI ---------------------------------------------------------------------
// `npm run migrate`. Deliberately a SEPARATE entry point from index.js: the app
// process must never hold DDL privileges, so this connects as
// MIGRATION_DATABASE_URL when one is configured and only falls back to the
// application's own URL for local development.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedDirectly) {
  const connectionString =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://localhost/roomio'

  migrate({ connectionString, log: (msg) => console.log(`[roomio] ${msg}`) })
    .then(({ applied }) => {
      const target = describeTarget(connectionString)
      console.log(
        applied.length
          ? `[roomio] ${applied.length} migration(s) applied to "${target}"`
          : `[roomio] "${target}" is already up to date`
      )
      process.exit(0)
    })
    .catch((err) => {
      // Non-zero exit is what stops a deploy pipeline from starting the new app
      // against a schema that did not migrate.
      console.error(`[roomio] migration failed: ${err.message}`)
      process.exit(1)
    })
}
