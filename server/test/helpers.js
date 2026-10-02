// test/helpers.js — shared plumbing for the server test suite.

import { randomUUID } from 'node:crypto'
import request from 'supertest'

import { createApp } from '../app.js'
import { pool, query } from '../db.js'

// Hard safety rail: these helpers TRUNCATE tables, so refuse to run against
// anything but the throwaway *_test database wired up by vitest.config.js.
if (!/_test(\?|$)/.test(process.env.DATABASE_URL || '')) {
  throw new Error(
    `server tests must run against a *_test database, got DATABASE_URL=` +
      `${JSON.stringify(process.env.DATABASE_URL)} — run them via \`npm test\` in server/`
  )
}

/**
 * Start a test file from empty tables.
 *
 * The SCHEMA is not created here any more — test/global-setup.js migrates the
 * throwaway database once, with the same runner a deploy uses, so the suite
 * cannot pass against a schema the migrations do not produce. Kept as a named
 * step (rather than inlining `resetDb`) because every test file calls it and it
 * is the hook for anything else a file needs before its first request.
 */
export async function freshDb() {
  await resetDb()
}

/** Empty every table between tests/files while keeping the schema. */
export async function resetDb() {
  await query(`TRUNCATE designs, sessions, users CASCADE`)
}

/** Close the shared pg pool so the worker can exit cleanly. */
export async function closeDb() {
  await pool.end()
}

/**
 * Build an app for tests. Rate limits default to effectively-off so ordinary
 * tests never trip them; rate-limit tests pass tiny budgets explicitly.
 */
export function testApp(overrides = {}) {
  return createApp({
    authRateLimit: { windowMs: 60 * 60 * 1000, limit: 10_000 },
    detectRateLimit: { windowMs: 60 * 60 * 1000, limit: 10_000 },
    ...overrides,
  })
}

let seq = 0
/** Unique-per-run email so tests never collide on the users.email constraint. */
export const uniqueEmail = (tag = 'user') => `${tag}-${randomUUID().slice(0, 8)}-${seq++}@example.test`

/**
 * Sign up a fresh user through the real endpoint and return a cookie-carrying
 * supertest agent plus the created user/credentials.
 */
export async function signedUpAgent(app, { tag = 'user', name = 'Test User' } = {}) {
  const agent = request.agent(app)
  const email = uniqueEmail(tag)
  const password = `pw-${randomUUID().slice(0, 12)}`
  const res = await agent.post('/api/auth/signup').send({ email, password, name })
  if (res.status !== 200) {
    throw new Error(`test signup failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return { agent, email, password, user: res.body.user }
}

/** Grab the roomio_sid Set-Cookie header value from a response (or throw). */
export function sessionCookie(res) {
  const cookies = res.headers['set-cookie'] || []
  const sid = cookies.find((c) => c.startsWith('roomio_sid='))
  if (!sid) throw new Error(`no roomio_sid Set-Cookie in ${JSON.stringify(cookies)}`)
  return sid
}

/** A tiny but real 1x1 PNG (valid magic bytes) for detect-upload tests. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB' +
    'pfZFQAAAAABJRU5ErkJggg==',
  'base64'
)

/** Minimal JPEG header bytes — enough for the magic-byte sniffer. */
export const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
