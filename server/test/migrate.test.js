// test/migrate.test.js — the schema migration runner.
//
// These pin the three properties that made it worth replacing the old
// `initDb()` DDL-on-boot bootstrap, all of which are invisible from the product
// and would otherwise be "simplified away":
//
//   1. A fresh, empty database ends up with EXACTLY the schema initDb produced.
//   2. Re-running is a no-op — same rows, same applied_at, nothing re-executed.
//   3. A database created by the OLD boot path is adopted, not broken. This is
//      the one that decides whether an existing deployment survives the change.
//
// Each case runs against its own scratch database so nothing here can disturb
// the suite-wide `roomio_test` database the other files share.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

import { loadMigrations, migrate, pendingMigrations } from '../migrate.js'
import { databaseUrl, dropDatabase, recreateDatabase } from './db-admin.js'

/**
 * The schema the REMOVED `initDb()` created, frozen verbatim.
 *
 * Do not "keep this in sync" with migrations/001 — it is a historical artifact.
 * Its whole job is to reproduce a database as it exists on a machine that last
 * ran the old boot path, so the adoption test is testing something real.
 */
const LEGACY_INIT_DB_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE TABLE IF NOT EXISTS designs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT,
    shape      TEXT,
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS designs_user_id_idx ON designs (user_id);
  CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
`

/** Scratch databases created by this file, dropped in afterAll even on failure. */
const scratchDbs = []

/** Create an empty scratch database and return its connection string. */
async function scratchDatabase() {
  // Must end in `_test`: db-admin.js refuses to create or drop anything else.
  const name = `roomio_mig_${randomUUID().replace(/-/g, '').slice(0, 12)}_test`
  await recreateDatabase(name)
  scratchDbs.push(name)
  return { name, connectionString: databaseUrl(name) }
}

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Everything about the three tables that a schema change could alter: column
 * types/nullability/defaults, index definitions, and the FK delete rules.
 *
 * Comparing two fingerprints is how "byte-identical in effect" is asserted
 * without hand-copying an expected blob that would rot on the first real change.
 */
async function schemaFingerprint(client) {
  const columns = await client.query(`
    SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'designs')
     ORDER BY table_name, column_name
  `)
  const indexes = await client.query(`
    SELECT tablename, indexname, indexdef
      FROM pg_indexes
     WHERE schemaname = 'public' AND tablename IN ('users', 'sessions', 'designs')
     ORDER BY indexname
  `)
  const constraints = await client.query(`
    SELECT c.conname, c.contype, c.confdeltype, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname IN ('users', 'sessions', 'designs')
     ORDER BY c.conname
  `)
  return {
    columns: columns.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
  }
}

afterAll(async () => {
  for (const name of scratchDbs) await dropDatabase(name)
})

describe('migration files', () => {
  it('are numbered, ordered, and start with the initial schema', () => {
    const migrations = loadMigrations()
    expect(migrations.length).toBeGreaterThan(0)
    expect(migrations[0].filename).toBe('001_initial_schema.sql')

    // Strictly increasing: two files with the same number have an ambiguous
    // apply order, which is the bug the loader's duplicate check prevents.
    const numbers = migrations.map((m) => m.number)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})

describe('applying migrations to an empty database', () => {
  let connectionString

  beforeAll(async () => {
    ;({ connectionString } = await scratchDatabase())
  })

  it('creates the legacy and developer workspace tables', async () => {
    const { applied, skipped } = await migrate({ connectionString })
    expect(applied).toEqual(loadMigrations().map((m) => m.version))
    expect(skipped).toEqual([])

    await withClient(connectionString, async (client) => {
      const { rows: tables } = await client.query(`
        SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' ORDER BY table_name
      `)
      expect(tables.map((r) => r.table_name)).toEqual([
        'designs',
        'developer_asset_versions',
        'developer_assets',
        'developer_enquiries',
        'developer_enquiry_outbox',
        'developer_project_homes',
        'developer_projects',
        'developer_release_approvals',
        'developer_release_events',
        'developer_releases',
        'developer_source_packages',
        'developer_source_reviews',
        'developer_unit_types',
        'developer_units',
        'organization_memberships',
        'organizations',
        'schema_migrations',
        'sessions',
        'users',
      ])

      const { rows: indexes } = await client.query(`
        SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND indexname IN ('designs_user_id_idx', 'sessions_user_id_idx')
         ORDER BY indexname
      `)
      expect(indexes.map((r) => r.indexname)).toEqual([
        'designs_user_id_idx',
        'sessions_user_id_idx',
      ])
    })
  })

  it('records every applied migration with its checksum', async () => {
    await withClient(connectionString, async (client) => {
      const { rows } = await client.query(
        `SELECT version, name, checksum FROM schema_migrations ORDER BY version`
      )
      expect(rows).toEqual(
        loadMigrations().map((m) => ({
          version: m.version,
          name: m.filename,
          checksum: m.checksum,
        }))
      )
    })
  })

  it('reports nothing pending afterwards, so the app will boot', async () => {
    await withClient(connectionString, async (client) => {
      const pending = await pendingMigrations((text, params) => client.query(text, params))
      expect(pending).toEqual([])
    })
  })

  it('is a no-op when re-run — nothing is applied or re-executed', async () => {
    const before = await withClient(connectionString, (client) =>
      client.query(`SELECT version, applied_at FROM schema_migrations ORDER BY version`)
    )

    const second = await migrate({ connectionString })
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(loadMigrations().map((m) => m.version))

    const after = await withClient(connectionString, (client) =>
      client.query(`SELECT version, applied_at FROM schema_migrations ORDER BY version`)
    )
    // applied_at unchanged proves the rows were skipped, not rewritten — an
    // upsert-style runner would look idempotent here while re-running the DDL.
    expect(after.rows).toEqual(before.rows)
  })

  it('refuses to run when an already-applied migration file has changed', async () => {
    await withClient(connectionString, (client) =>
      client.query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '001'`)
    )

    await expect(migrate({ connectionString })).rejects.toThrow(/contents have changed/)

    // Leave the scratch database consistent for any later assertion.
    await withClient(connectionString, (client) =>
      client.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = '001'`, [
        loadMigrations()[0].checksum,
      ])
    )
  })
})

describe('adopting a database created by the old initDb() boot path', () => {
  it('applies cleanly and adds only the revision schema to legacy tables', async () => {
    const legacy = await scratchDatabase()
    await withClient(legacy.connectionString, (client) => client.query(LEGACY_INIT_DB_SQL))

    const before = await withClient(legacy.connectionString, schemaFingerprint)

    // The adoption run: tables already exist, no schema_migrations row does.
    // Without `IF NOT EXISTS` in 001 this throws "relation users already exists"
    // and every existing deployment breaks on first migrate.
    const { applied } = await migrate({ connectionString: legacy.connectionString })
    expect(applied).toEqual(loadMigrations().map((m) => m.version))

    const after = await withClient(legacy.connectionString, schemaFingerprint)
    expect(after.columns.filter((c) => c.column_name !== 'revision')).toEqual(before.columns)
    expect(after.indexes).toEqual(before.indexes)
    // PostgreSQL 18 also records a named NOT NULL constraint for the new
    // revision column. Neither addition changes a historical column.
    expect(after.constraints.filter((c) =>
      c.conname !== 'designs_revision_positive' && c.conname !== 'designs_revision_not_null'
    )).toEqual(before.constraints)
    expect(after.columns.find((c) => c.column_name === 'revision')).toMatchObject({
      table_name: 'designs', is_nullable: 'NO', column_default: '1',
    })
  })

  it('produces the same schema as migrating a fresh database', async () => {
    const fresh = await scratchDatabase()
    await migrate({ connectionString: fresh.connectionString })

    const legacy = await scratchDatabase()
    await withClient(legacy.connectionString, (client) => client.query(LEGACY_INIT_DB_SQL))
    await migrate({ connectionString: legacy.connectionString })

    const fromMigrations = await withClient(fresh.connectionString, schemaFingerprint)
    const fromLegacy = await withClient(legacy.connectionString, schemaFingerprint)
    expect(fromMigrations).toEqual(fromLegacy)
  })
})

describe('concurrent runners', () => {
  it('serialise on the advisory lock instead of racing the DDL', async () => {
    const { connectionString } = await scratchDatabase()

    // Every instance used to run the bootstrap at once on deploy; two
    // simultaneous CREATE TABLE IF NOT EXISTS statements deadlock or raise a
    // duplicate-object error on the loser. Both of these must simply succeed.
    const results = await Promise.all([
      migrate({ connectionString }),
      migrate({ connectionString }),
    ])

    const appliedCounts = results.map((r) => r.applied.length).sort()
    expect(appliedCounts).toEqual([0, loadMigrations().length])

    await withClient(connectionString, async (client) => {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM schema_migrations`)
      expect(rows[0].n).toBe(loadMigrations().length)
    })
  })
})
