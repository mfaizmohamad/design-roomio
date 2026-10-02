// app.js
// -----------------------------------------------------------------------------
// Builds the Roomio backend Express app: JSON + cookie parsing, rate limiting,
// the auth / designs / detect routes, and the JSON error handler.
//
// Exposed as a factory (createApp) so tests can build isolated instances with
// injected settings — temp detect directories, tiny rate-limit budgets, a
// hookable `query` function — and drive them through supertest on ephemeral
// ports. index.js is the only place that binds a real port.
//
// Routes are same-origin from the browser's perspective: the Vite dev server on
// :5180 proxies /api/* here (default :5181), so cookies "just work" with
// SameSite=Lax and no CORS needed. See README for the full API.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'

import { query as dbQuery } from './db.js'
import { organizationRoutes } from './organizations.js'
import { projectHomeRoutes } from './projectHomes.js'
import { privateAssetRoutes } from './privateAssets.js'
import { releaseRoutes, publicReleaseRoutes } from './releases.js'
import { workspaceReadRoutes } from './workspaceRead.js'
import { publicEnquiryRoutes, enquiryStaffRoutes } from './enquiries.js'
import { sourcePackageRoutes } from './sourcePackages.js'
import { validateWholeHome } from './designValidation.js'
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE,
} from './auth.js'

// ESM has no __dirname; derive it from import.meta.url. repoRoot is one level up
// from server/ — used to locate shared/requests and shared/results.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')

// --- Small helpers ------------------------------------------------------------

/**
 * Wrap an async route handler so any thrown/rejected error is forwarded to the
 * global error handler instead of crashing the process or hanging the request.
 */
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

// Pragmatic email check: non-empty local part, an @, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Password bounds. 8 is the floor most guidance now agrees on; 72 bytes is
// bcrypt's hard input limit (see the signup handler).
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_BYTES = 72

/** Convert a Postgres timestamp value to epoch milliseconds (Number). */
const toEpochMs = (ts) => Number(new Date(ts))

/** Shape a user row for API responses (never leak password_hash). */
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name })

/** Read a positive-integer env var, falling back when unset/invalid. */
const intEnv = (name, fallback) => {
  const v = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

/**
 * How many reverse proxies sit in front of us. Behind a PaaS load balancer
 * (Render/Fly/Railway/…) every request arrives from the proxy, so without this
 * express-rate-limit keys EVERY caller into one bucket: one abuser 429s the
 * whole site, and express-rate-limit v7+ additionally refuses to start with
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. Must stay 0 (off) for direct-to-node local
 * dev — trusting X-Forwarded-For with no proxy in front lets any client forge
 * its own IP and walk straight through the rate limiter.
 */
const trustProxyEnv = () => {
  const raw = (process.env.TRUST_PROXY ?? '').trim()
  if (raw === '') return 0
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : raw
}

/** Comma-separated origin allowlist (e.g. "https://roomio.app,https://www.roomio.app"). */
const originAllowlist = () =>
  new Set(
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  )

// Only simple, filesystem-safe ids — defends the detect GET against path traversal.
const ID_RE = /^[A-Za-z0-9_-]+$/

/** Strip an optional "data:image/...;base64," prefix and return the raw base64. */
const stripDataUrlPrefix = (s) =>
  s.replace(/^data:[^;,]*;base64,/, '').replace(/^data:[^,]*,/, '')

/**
 * Sniff a request image's true extension from its magic bytes (defaults to .jpg).
 * The browser's data URL claims JPEG even for iPhone HEIC, so name the request file
 * by its real content — the watcher + pipeline then see the actual format.
 */
const sniffImageExt = (buf) => {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png'
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return '.bmp'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp'
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12).toLowerCase()
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return '.heic'
  }
  return '.jpg'
}

// --- App factory ---------------------------------------------------------------

/**
 * Build the Roomio Express app.
 *
 * @param {object} [options]
 * @param {Function} [options.query]        SQL query function (defaults to the
 *   shared pg pool). Tests inject a wrapper to interpose between statements —
 *   e.g. to reproduce the design-upsert ownership race deterministically.
 * @param {string} [options.requestsDir]    Where detect uploads land
 *   (default <repo>/shared/requests).
 * @param {string} [options.resultsDir]     Where the Python watcher writes results
 *   (default <repo>/shared/results).
 * @param {object} [options.authRateLimit]  { windowMs, limit } for login+signup.
 * @param {object} [options.detectRateLimit]{ windowMs, limit } for detect POSTs.
 * @param {number} [options.maxDetectBytes]     Decoded-image byte cap (413 above).
 * @param {number} [options.maxPendingDetects]  Queue cap: detect requests that have
 *   no result file yet (429 once full).
 * @returns {import('express').Express}
 */
export function createApp(options = {}) {
  const {
    query = dbQuery,
    requestsDir = path.join(repoRoot, 'shared', 'requests'),
    resultsDir = path.join(repoRoot, 'shared', 'results'),
    authRateLimit = {},
    detectRateLimit = {},
    maxDetectBytes = intEnv('DETECT_MAX_BYTES', 10 * 1024 * 1024),
    maxPendingDetects = intEnv('DETECT_MAX_PENDING', 32),
    maxDesignsPerUser = intEnv('MAX_DESIGNS_PER_USER', 200),
    trustProxy = trustProxyEnv(),
    allowedOrigins = originAllowlist(),
    isProduction = process.env.NODE_ENV === 'production',
  } = options

  const app = express()

  // Reverse-proxy awareness. MUST be set before the rate limiters are used, or
  // every request behind a load balancer shares one bucket (see trustProxyEnv).
  app.set('trust proxy', trustProxy)

  // Security headers. The backend serves ONLY JSON under /api, so the strictest
  // possible CSP applies: a JSON response never needs to load a script, style,
  // image or frame, and `frame-ancestors 'none'` keeps API responses out of any
  // attacker-controlled iframe. If this process ever also serves the built SPA,
  // this policy must be widened for that route tree — not deleted.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
      },
      // API responses are never embedded cross-origin by a document; the default
      // COEP/CORP pair would only complicate the SPA's fetches for no gain here.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
      // HSTS only means anything over TLS, and sending it from plain-http local
      // dev would pin localhost to https in the developer's browser.
      hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    })
  )

  // Room photos arrive as base64 data URLs that blow past the 2mb default, so the
  // /api/detect POST gets its own larger JSON parser. It MUST be registered BEFORE
  // the global 2mb parser: body-parser skips a request whose body is already parsed,
  // so /api/detect gets 15mb while every other route keeps the tighter 2mb cap.
  // (Registered after, the global parser would reject a >2mb photo before this ran.)
  app.use('/api/detect', express.json({ limit: '15mb' }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  // --- Rate limiting -----------------------------------------------------------

  // Brute-force guard for the credential endpoints (gen-02). Keyed per IP, counts
  // only FAILED attempts (skipSuccessfulRequests) so ordinary signup→login flows
  // never burn budget; a wrong-password loop hits 429 long before it can walk a
  // password list. bcrypt slows each attempt; this caps how many attempts exist.
  const authLimiter = rateLimit({
    windowMs: authRateLimit.windowMs ?? intEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    limit: authRateLimit.limit ?? intEnv('AUTH_RATE_LIMIT_MAX', 20),
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: 'too many attempts, try again later' }),
  })

  // Blanket per-IP ceiling across the whole API. The per-route limiters below stay
  // (they are far tighter on the expensive endpoints); this one only stops a single
  // IP from hammering the cheap authenticated routes — /api/designs reads and
  // writes, /api/detect/:id polling — hard enough to saturate the DB or event loop.
  const globalLimiter = rateLimit({
    windowMs: intEnv('GLOBAL_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    limit: intEnv('GLOBAL_RATE_LIMIT_MAX', 600),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'too many requests' }),
  })
  app.use('/api', globalLimiter)

  // --- CSRF defence in depth ------------------------------------------------------
  //
  // The session cookie is SameSite=Lax, which already stops a cross-site form or
  // fetch from carrying it on a POST/DELETE. This is the second lock: a browser
  // sends `Origin` on every state-changing request, so a cross-origin write can be
  // rejected outright rather than relying on one cookie attribute (and on every
  // user's browser honouring it).
  //
  // Same-origin requests pass automatically — Origin's host matches the Host header
  // — so no configuration is needed for the normal deployment. ALLOWED_ORIGINS only
  // has to be set when the SPA is served from a DIFFERENT origin than the API.
  // A missing Origin (curl, server-to-server, same-origin GET) is not blocked: it
  // carries no ambient-authority risk, because a browser always sends one.
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  app.use('/api', (req, res, next) => {
    if (!MUTATING.has(req.method)) return next()

    const origin = req.get('origin')
    if (!origin) return next()

    let originHost
    try {
      originHost = new URL(origin).host
    } catch {
      return res.status(403).json({ error: 'bad origin' })
    }

    if (originHost === req.get('host') || allowedOrigins.has(origin)) return next()
    return res.status(403).json({ error: 'cross-origin request refused' })
  })

  // Upload throttle for the unauthenticated detect endpoint (gen-04): every POST
  // can write up to maxDetectBytes to disk, so cap the rate per IP. The GET poll
  // route is intentionally NOT limited — the client polls it every few seconds.
  const detectLimiter = rateLimit({
    windowMs: detectRateLimit.windowMs ?? intEnv('DETECT_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    limit: detectRateLimit.limit ?? intEnv('DETECT_RATE_LIMIT_MAX', 12),
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: 'too many uploads, try again later' }),
  })

  // --- Health ------------------------------------------------------------------

  // Unauthenticated smoke-test endpoint.
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  // --- Auth ----------------------------------------------------------------------

  // POST /api/auth/signup — create a user + session, set the cookie.
  app.post(
    '/api/auth/signup',
    authLimiter,
    wrap(async (req, res) => {
      const { email, password, name } = req.body || {}

      // Validate inputs.
      if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'invalid email' })
      }
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return res
          .status(400)
          .json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` })
      }
      // bcrypt hashes only the first 72 BYTES of its input and silently ignores the
      // rest, so without this cap two different long passwords can share a hash and
      // the extra length is security theatre. Reject instead of truncating, so the
      // password the user typed is always the password that protects the account.
      if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
        return res
          .status(400)
          .json({ error: `password must be at most ${MAX_PASSWORD_BYTES} bytes` })
      }

      const normalizedEmail = email.trim().toLowerCase()
      const displayName = typeof name === 'string' && name.trim() ? name.trim() : null

      // Reject duplicate emails up front for a friendly 409.
      const existing = await query(`SELECT id FROM users WHERE email = $1`, [
        normalizedEmail,
      ])
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'email already registered' })
      }

      const id = randomUUID()
      const passwordHash = await hashPassword(password)

      // Insert the user. ON CONFLICT guards against a race between the check above
      // and this insert (two concurrent signups with the same email).
      const inserted = await query(
        `INSERT INTO users (id, email, password_hash, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name`,
        [id, normalizedEmail, passwordHash, displayName]
      )
      if (inserted.rows.length === 0) {
        return res.status(409).json({ error: 'email already registered' })
      }

      const user = inserted.rows[0]
      await createSession(res, user.id)
      res.json({ user: publicUser(user) })
    })
  )

  // POST /api/auth/login — verify credentials, create a session, set the cookie.
  app.post(
    '/api/auth/login',
    authLimiter,
    wrap(async (req, res) => {
      const { email, password } = req.body || {}

      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'email and password required' })
      }

      const normalizedEmail = email.trim().toLowerCase()
      const { rows } = await query(
        `SELECT id, email, name, password_hash FROM users WHERE email = $1`,
        [normalizedEmail]
      )
      const user = rows[0]

      // Use the same 401 for "no such user" and "bad password" so we don't leak
      // which emails are registered.
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return res.status(401).json({ error: 'invalid credentials' })
      }

      await createSession(res, user.id)
      res.json({ user: publicUser(user) })
    })
  )

  // POST /api/auth/logout — destroy the session row and clear the cookie.
  app.post(
    '/api/auth/logout',
    wrap(async (req, res) => {
      const sid = req.cookies?.[SESSION_COOKIE]
      await destroySession(sid)
      clearSessionCookie(res)
      res.json({ ok: true })
    })
  )

  // GET /api/auth/me — return the current user, or 401 if not authed.
  app.get(
    '/api/auth/me',
    requireAuth,
    wrap(async (req, res) => {
      res.json({ user: publicUser(req.user) })
    })
  )

  // --- Designs -------------------------------------------------------------------

  // Developer workspaces use their own tenant-scoped routes. Personal designs
  // stay on /api/designs until a user explicitly imports them into a project.
  app.use('/api/orgs', organizationRoutes(query))
  app.use('/api/orgs', projectHomeRoutes(query))
  app.use('/api/orgs', privateAssetRoutes(query))
  app.use('/api/orgs', releaseRoutes(query))
  app.use('/api/orgs', workspaceReadRoutes(query))
  app.use('/api/orgs', sourcePackageRoutes(query))
  app.use('/api/orgs', enquiryStaffRoutes(query))
  app.use('/api/releases', publicReleaseRoutes(query))
  app.use('/api/releases', publicEnquiryRoutes(query))

  // GET /api/designs — list this user's designs, newest first (summary shape).
  app.get(
    '/api/designs',
    requireAuth,
    wrap(async (req, res) => {
      const { rows } = await query(
        `SELECT id, name, shape, updated_at, created_at
           FROM designs
          WHERE user_id = $1
          ORDER BY updated_at DESC`,
        [req.user.id]
      )
      res.json(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          shape: r.shape,
          updatedAt: toEpochMs(r.updated_at),
          createdAt: toEpochMs(r.created_at),
        }))
      )
    })
  )

  // GET /api/designs/:id — return the full stored RoomDesign JSON if owned.
  app.get(
    '/api/designs/:id',
    requireAuth,
    wrap(async (req, res) => {
      const { rows } = await query(
        `SELECT data, revision FROM designs WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      )
      if (rows.length === 0) {
        return res.status(404).json({ error: 'not found' })
      }
      // The token travels outside JSON so old clients still receive their exact
      // stored payload; the new editor uses it to avoid overwriting another tab.
      res.set('X-Design-Revision', String(rows[0].revision))
      res.json(rows[0].data)
    })
  )

  // POST /api/designs — upsert a full RoomDesign owned by the current user.
  app.post(
    '/api/designs',
    requireAuth,
    wrap(async (req, res) => {
      const design = req.body
      if (!design || typeof design !== 'object' || typeof design.id !== 'string') {
        return res.status(400).json({ error: 'design with string id required' })
      }
      if (Buffer.byteLength(JSON.stringify(design)) > 1_500_000) {
        return res.status(413).json({ error: 'design too large' })
      }
      if (design.house !== undefined) {
        const issue = validateWholeHome(design)
        if (issue) return res.status(400).json({ error: issue })
      }
      const revisionHeader = req.get('X-Design-Revision')
      // Versioned homes require a precondition even when an old client posts
      // them; otherwise a headerless save could erase an entire changed floor.
      if (design.house !== undefined && revisionHeader === undefined) {
        return res.status(428).json({ error: 'design revision required' })
      }
      if (revisionHeader !== undefined && !/^(0|[1-9][0-9]*)$/.test(revisionHeader)) {
        return res.status(400).json({ error: 'invalid design revision' })
      }
      const expectedRevision = revisionHeader === undefined ? null : Number(revisionHeader)
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision > 2_147_483_646)) {
        return res.status(400).json({ error: 'invalid design revision' })
      }

      // Guard ownership: if a row with this id already exists under a *different*
      // user, refuse rather than overwrite someone else's design.
      const owner = await query(`SELECT user_id, data ? 'house' AS has_house FROM designs WHERE id = $1`, [
        design.id,
      ])
      if (owner.rows.length > 0 && owner.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ error: 'forbidden' })
      }
      if (owner.rows[0]?.has_house && revisionHeader === undefined) {
        return res.status(428).json({ error: 'design revision required' })
      }
      if (owner.rows.length === 0 && expectedRevision !== null && expectedRevision > 0) {
        return res.status(409).json({ error: 'design changed in another session; reload before saving' })
      }

      // Per-user storage ceiling. Each design is an up-to-1.5MB JSONB blob and a
      // client picks its own ids, so without a cap one account can insert new
      // designs until the database fills. Only NEW rows count against it —
      // re-saving an existing design must never be refused, or a user who hits
      // the ceiling could no longer save the work already in front of them.
      if (owner.rows.length === 0) {
        const { rows: countRows } = await query(
          `SELECT count(*)::int AS n FROM designs WHERE user_id = $1`,
          [req.user.id]
        )
        if (countRows[0].n >= maxDesignsPerUser) {
          return res.status(409).json({
            error: `design limit reached (${maxDesignsPerUser}) — delete a design to save a new one`,
          })
        }
      }

      const name = typeof design.name === 'string' ? design.name : null
      const shape = typeof design.shape === 'string' ? design.shape : null

      let result
      if (expectedRevision === 0) {
        // A create token must never update an existing row, including one
        // inserted between the owner pre-check and this statement.
        result = await query(
          `INSERT INTO designs (id, user_id, name, shape, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO NOTHING RETURNING revision`,
          [design.id, req.user.id, name, shape, design]
        )
      } else if (expectedRevision !== null) {
        // UPDATE only: if another tab deleted this row, a stale save cannot
        // quietly resurrect it as a new document.
        result = await query(
          `UPDATE designs SET name = $3, shape = $4, data = $5,
                  revision = revision + 1, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND revision = $6
            RETURNING revision`,
          [design.id, req.user.id, name, shape, design, expectedRevision]
        )
      } else {
        // Legacy room clients have no revision header; preserve their upsert
        // behavior but still re-check ownership on a concurrent insert.
        result = await query(
          `INSERT INTO designs (id, user_id, name, shape, data, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE
             SET name = EXCLUDED.name, shape = EXCLUDED.shape,
                 data = EXCLUDED.data, revision = designs.revision + 1,
                 updated_at = now()
           WHERE designs.user_id = $2 AND NOT (designs.data ? 'house')
           RETURNING revision`,
          [design.id, req.user.id, name, shape, design]
        )
      }

      // rowCount 0 means a revision, ownership or create-only precondition lost
      // a race. Never claim success when no bytes were written.
      if (result.rowCount === 0) {
        const current = await query(`SELECT user_id, data ? 'house' AS has_house FROM designs WHERE id = $1`, [design.id])
        if (current.rows[0]?.user_id === req.user.id && current.rows[0].has_house && revisionHeader === undefined) {
          return res.status(428).json({ error: 'design revision required' })
        }
        if (current.rows.length === 0 || current.rows[0].user_id === req.user.id) {
          return res.status(409).json({ error: 'design changed in another session; reload before saving' })
        }
        return res.status(403).json({ error: 'forbidden' })
      }

      res.set('X-Design-Revision', String(result.rows[0].revision))
      res.json({ ok: true, id: design.id })
    })
  )

  // DELETE /api/designs/:id — delete the design if owned by the current user.
  app.delete(
    '/api/designs/:id',
    requireAuth,
    wrap(async (req, res) => {
      await query(`DELETE FROM designs WHERE id = $1 AND user_id = $2`, [
        req.params.id,
        req.user.id,
      ])
      // Idempotent: deleting a missing/unowned design still returns ok.
      res.json({ ok: true })
    })
  )

  // --- Detection (scan a room photo) ---------------------------------------------
  //
  // Suggestion-only furniture detection. Agent A POSTs a room photo; we drop the
  // bytes + a sidecar request file into shared/requests/ for Agent B's Python
  // watcher to pick up. The watcher writes shared/results/<id>.result.json, which
  // the client polls for via GET. These routes are intentionally unauthenticated,
  // so the POST is defended in depth: per-IP rate limit, a decoded-byte cap, and
  // a pending-queue ceiling so one caller can't fill the disk (gen-04).

  /** Count queued detect requests that have no result file yet. */
  const countPendingDetects = async () => {
    let names
    try {
      names = await readdir(requestsDir)
    } catch {
      return 0 // directory not created yet — nothing pending
    }
    const suffix = '.request.json'
    const ids = names.filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length))
    let pending = 0
    for (const id of ids) {
      try {
        await access(path.join(resultsDir, `${id}.result.json`))
      } catch {
        pending++
      }
    }
    return pending
  }

  // POST /api/detect — accept a room photo, queue it for detection, return its id.
  app.post(
    '/api/detect',
    detectLimiter,
    wrap(async (req, res) => {
      const { imageBase64 } = req.body || {}
      if (typeof imageBase64 !== 'string' || imageBase64.trim() === '') {
        return res.status(400).json({ error: 'imageBase64 required' })
      }

      const raw = stripDataUrlPrefix(imageBase64.trim())
      let bytes
      try {
        bytes = Buffer.from(raw, 'base64')
      } catch {
        return res.status(400).json({ error: 'invalid base64 image' })
      }
      if (bytes.length === 0) {
        return res.status(400).json({ error: 'invalid base64 image' })
      }
      if (bytes.length > maxDetectBytes) {
        return res.status(413).json({ error: 'image too large' })
      }

      // Queue ceiling: refuse new uploads while too many requests await results,
      // so an unauthenticated caller can't accumulate unbounded files on disk.
      if ((await countPendingDetects()) >= maxPendingDetects) {
        return res.status(429).json({ error: 'detection queue full, try again later' })
      }

      const ext = sniffImageExt(bytes)
      const id = randomUUID()
      const imageRel = `shared/requests/${id}${ext}`
      const imagePath = path.join(requestsDir, `${id}${ext}`)
      const sidecarPath = path.join(requestsDir, `${id}.request.json`)

      await mkdir(requestsDir, { recursive: true })

      // Write via tmp + rename so the watcher never observes a half-written file.
      const imageTmp = `${imagePath}.tmp`
      await writeFile(imageTmp, bytes)
      await rename(imageTmp, imagePath)

      const sidecarTmp = `${sidecarPath}.tmp`
      await writeFile(
        sidecarTmp,
        JSON.stringify({ request_id: id, image_path: imageRel }),
      )
      await rename(sidecarTmp, sidecarPath)

      res.json({ request_id: id })
    })
  )

  // GET /api/detect/:id — poll for a detection result. Pending until the watcher
  // writes the result file; returns the result JSON verbatim once it exists.
  app.get(
    '/api/detect/:id',
    wrap(async (req, res) => {
      const { id } = req.params
      if (!ID_RE.test(id)) {
        return res.status(400).json({ error: 'invalid id' })
      }

      const resultPath = path.join(resultsDir, `${id}.result.json`)
      let text
      try {
        text = await readFile(resultPath, 'utf8')
      } catch {
        // No result file yet — detection still in progress (or never queued).
        return res.json({ status: 'pending' })
      }

      try {
        return res.json(JSON.parse(text))
      } catch {
        // File may be mid-write (watcher not using tmp+rename) — treat as pending.
        return res.json({ status: 'pending' })
      }
    })
  )

  // --- Fallbacks & error handling --------------------------------------------------

  // Unknown /api route -> JSON 404 (so the SPA proxy never gets HTML for API calls).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  // Global error handler: any error thrown in a wrapped handler lands here and
  // becomes a JSON 500 instead of crashing the process. The unused 4th argument
  // is load-bearing: Express identifies an error handler by ARITY, so dropping
  // `_next` silently demotes this to an ordinary middleware and every thrown
  // error goes back to crashing the process.
  app.use((err, _req, res, _next) => {
    console.error('[roomio] unhandled error:', err)
    if (res.headersSent) return
    res.status(500).json({ error: 'internal server error' })
  })

  return app
}
