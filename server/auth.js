// auth.js
// -----------------------------------------------------------------------------
// Authentication primitives for the Roomio backend:
//   - password hashing/verification (bcryptjs; cost from BCRYPT_ROUNDS, default 12)
//   - session lifecycle (create / lookup / destroy) backed by the `sessions`
//     table, expressed as an httpOnly cookie named `roomio_sid`
//   - the requireAuth middleware that gates the protected routes
//
// Sessions live for 30 days. The cookie is SameSite=Lax and httpOnly so it
// survives the Vite dev proxy (same-origin from the browser's point of view)
// while staying invisible to client JS. `secure` is env-driven: on under
// NODE_ENV=production (session ids must never cross plaintext HTTP in prod),
// off for plain-http local dev, with COOKIE_SECURE=true/false as an explicit
// override in either direction.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

import { query } from './db.js'

// Cookie name and lifetime shared by everything below.
export const SESSION_COOKIE = 'roomio_sid'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000 // for cookie Max-Age

/**
 * Should the session cookie carry the Secure attribute? Defaults to true in
 * production and false elsewhere (local dev runs over plain http); the
 * COOKIE_SECURE env var force-overrides either way (e.g. `false` for a
 * production-mode smoke test on http, `true` when dev sits behind TLS).
 */
function cookieSecure() {
  const override = process.env.COOKIE_SECURE
  if (override === 'true' || override === '1') return true
  if (override === 'false' || override === '0') return false
  return process.env.NODE_ENV === 'production'
}

/**
 * Cookie options used consistently when setting and clearing the session
 * cookie. Computed per call (not a module constant) so the `secure` flag
 * always reflects the current environment.
 */
export function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
  }
}

// --- Passwords --------------------------------------------------------------

/**
 * bcrypt work factor. 10 was the original value; 12 is the current common floor
 * and costs ~4x more per guess for an attacker who has stolen the hashes. Kept
 * env-tunable (BCRYPT_ROUNDS) so the cost can be raised again without a code
 * change, and lowered in test runs where 12 rounds x N logins dominates runtime.
 */
const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '', 10) || 12

/** Hash a plaintext password with bcrypt. */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

/** Verify a plaintext password against a stored bcrypt hash. */
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}

// --- Sessions ---------------------------------------------------------------

/**
 * Create a session row for `userId` and write the session cookie onto `res`.
 * @returns {Promise<string>} the new session id.
 */
export async function createSession(res, userId) {
  const sid = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

  await query(
    `INSERT INTO sessions (sid, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sid, userId, expiresAt]
  )

  res.cookie(SESSION_COOKIE, sid, {
    ...cookieOpts(),
    maxAge: SESSION_TTL_SECONDS * 1000, // express expects ms
  })

  return sid
}

/**
 * Look up a non-expired session by id and return the associated user
 * (id, email, name) or null. Joins sessions -> users so a single round trip
 * gives us everything requireAuth needs.
 */
export async function lookupSession(sid) {
  if (!sid) return null

  const { rows } = await query(
    `SELECT u.id, u.email, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.sid = $1
        AND s.expires_at > now()`,
    [sid]
  )

  return rows[0] || null
}

/** Delete a session row by id. Safe to call with an unknown/expired sid. */
export async function destroySession(sid) {
  if (!sid) return
  await query(`DELETE FROM sessions WHERE sid = $1`, [sid])
}

/** Clear the session cookie on the response (used by logout). */
export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOpts())
}

/**
 * Delete every expired session row. Expired sessions are already invisible to
 * lookupSession (it filters on expires_at), but without this the table grows
 * forever — index.js runs it on boot and on an interval.
 * @returns {Promise<number>} number of rows deleted.
 */
export async function purgeExpiredSessions() {
  const { rowCount } = await query(
    `DELETE FROM sessions WHERE expires_at <= now()`
  )
  return rowCount
}

// --- Middleware -------------------------------------------------------------

/**
 * Express middleware that requires a valid session. On success it attaches
 * `req.user = { id, email, name }` and calls next(). Otherwise it responds
 * 401 { error: 'unauthorized' }. Any thrown error bubbles to the global
 * error handler (-> 500 JSON), so handlers never crash the process.
 */
export async function requireAuth(req, res, next) {
  try {
    const sid = req.cookies?.[SESSION_COOKIE]
    const user = await lookupSession(sid)
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    req.user = user
    next()
  } catch (err) {
    next(err)
  }
}
