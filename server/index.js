// index.js
// -----------------------------------------------------------------------------
// Roomio backend entry point. The Express app itself lives in app.js (as a
// factory, so tests can build isolated instances); this file is the only place
// that touches the real network: it verifies the schema is migrated, builds the
// app, starts listening, and schedules the expired-session purge.
//
// It does NOT create or alter the schema. That is `npm run migrate`, run as a
// deploy step before this process starts, so the role this process connects
// with never needs DDL privileges.
// -----------------------------------------------------------------------------

import { createApp } from './app.js'
import { pool, query } from './db.js'
import { pendingMigrations } from './migrate.js'
import { purgeExpiredSessions } from './auth.js'

const PORT = process.env.PORT || 5181

// Expired sessions are filtered on read, but the rows themselves used to
// accumulate forever. Purge on boot and then periodically (default: hourly).
const PURGE_INTERVAL_MS = Number.parseInt(
  process.env.SESSION_PURGE_INTERVAL_MS ?? '',
  10
) || 60 * 60 * 1000

const purgeSafely = async () => {
  try {
    const purged = await purgeExpiredSessions()
    if (purged > 0) console.log(`[roomio] purged ${purged} expired session(s)`)
  } catch (err) {
    console.error('[roomio] session purge failed:', err)
  }
}

/**
 * Refuse to boot against a database whose schema is behind the code.
 *
 * This is a READ-ONLY check (catalog lookup + one SELECT), not a migration — the
 * old boot-time bootstrap is exactly what this ticket removed. It exists because
 * without it a deploy that forgot `npm run migrate` starts cleanly and then
 * fails on every request touching a column that was never added, which surfaces
 * as a flood of 500s instead of one legible startup error.
 */
const assertSchemaMigrated = async () => {
  const pending = await pendingMigrations(query)
  if (pending.length > 0) {
    throw new Error(
      `database schema is ${pending.length} migration(s) behind (pending: ${pending.join(', ')}) — ` +
        `run \`npm run migrate\` in server/ before starting the app`
    )
  }
}

// Verify the schema, then start listening. Fail loudly if the DB is unreachable
// so we don't serve a half-initialized server.
assertSchemaMigrated()
  .then(async () => {
    await purgeSafely()
    // unref() so the timer never keeps a shutting-down process alive.
    setInterval(purgeSafely, PURGE_INTERVAL_MS).unref()

    const app = createApp()
    const server = app.listen(PORT, () => {
      console.log(`[roomio] server listening on http://localhost:${PORT}`)
    })

    // Graceful shutdown. A container platform sends SIGTERM and then SIGKILLs a
    // few seconds later; without this, in-flight requests are severed mid-response
    // on every deploy and the pg pool's sockets are never closed. Stop accepting
    // new connections, let open requests finish, drain the pool, then exit.
    let shuttingDown = false
    const shutdown = async (signal) => {
      if (shuttingDown) return
      shuttingDown = true
      console.log(`[roomio] ${signal} received — draining…`)

      // Hard ceiling: if a request hangs, exit anyway rather than wait for SIGKILL.
      const forceExit = setTimeout(() => {
        console.error('[roomio] drain timed out — exiting')
        process.exit(1)
      }, Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '', 10) || 10_000)
      forceExit.unref()

      server.close(async () => {
        try {
          await pool.end()
        } catch (err) {
          console.error('[roomio] pool drain failed:', err)
        }
        console.log('[roomio] shutdown complete')
        process.exit(0)
      })
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  })
  .catch((err) => {
    // Log the whole error, not just the message: this catch covers both the
    // legible "run npm run migrate" case and an unreachable database, and the
    // stack is the only diagnostic for the second one.
    console.error('[roomio] failed to start:', err)
    process.exit(1)
  })
