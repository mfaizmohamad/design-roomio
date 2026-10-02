// test/ratelimit.test.js — brute-force protection on the credential endpoints
// and the upload throttle on /api/detect. Each test builds its own app so the
// in-memory limiter buckets start empty and tiny budgets don't leak between
// tests.

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { closeDb, freshDb, signedUpAgent, testApp, TINY_PNG, uniqueEmail } from './helpers.js'

let tmpRoot
/** Detect uploads must land in a temp dir, never the real shared/requests. */
const detectDirs = () => ({
  requestsDir: path.join(tmpRoot, 'requests'),
  resultsDir: path.join(tmpRoot, 'results'),
})

beforeAll(async () => {
  await freshDb()
  tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'roomio-ratelimit-'))
})

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
  await closeDb()
})

describe('auth rate limiting', () => {
  it('429s a login brute-force after the failed-attempt budget is spent', async () => {
    const app = testApp({ authRateLimit: { windowMs: 60_000, limit: 3 } })
    const { email } = await signedUpAgent(app, { tag: 'brute' })

    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: `guess-${i}` })
      expect(res.status).toBe(401) // still within budget: normal invalid-creds answer
    }

    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'guess-4' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'too many attempts, try again later' })
  })

  it('successful requests do not consume the budget (skipSuccessfulRequests)', async () => {
    const app = testApp({ authRateLimit: { windowMs: 60_000, limit: 3 } })
    // A successful signup + successful login first...
    const { email, password } = await signedUpAgent(app, { tag: 'goodflow' })
    const ok = await request(app).post('/api/auth/login').send({ email, password })
    expect(ok.status).toBe(200)

    // ...still leaves the full failure budget: 3 failures pass, the 4th blocks.
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong' })
      expect(res.status).toBe(401)
    }
    expect(
      (await request(app).post('/api/auth/login').send({ email, password: 'wrong' })).status
    ).toBe(429)
  })

  it('signup shares the same failure budget as login (one credential-endpoint bucket per IP)', async () => {
    const app = testApp({ authRateLimit: { windowMs: 60_000, limit: 2 } })

    // Burn the budget with failed logins...
    for (let i = 0; i < 2; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: uniqueEmail('burn'), password: 'nope-nope' })
    }

    // ...and signup is throttled too.
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('late'), password: 'valid-password' })
    expect(res.status).toBe(429)
  })

  it('does not throttle unrelated routes', async () => {
    const app = testApp({ authRateLimit: { windowMs: 60_000, limit: 1 } })
    await request(app).post('/api/auth/login').send({ email: uniqueEmail('x'), password: 'no' })
    await request(app).post('/api/auth/login').send({ email: uniqueEmail('x'), password: 'no' })

    // Auth endpoints are now blocked, but /api/health is untouched.
    const health = await request(app).get('/api/health')
    expect(health.status).toBe(200)
  })
})

describe('detect rate limiting', () => {
  it('429s rapid-fire uploads past the per-window budget', async () => {
    const app = testApp({ ...detectDirs(), detectRateLimit: { windowMs: 60_000, limit: 2 } })
    const png = { imageBase64: TINY_PNG.toString('base64') }

    expect((await request(app).post('/api/detect').send(png)).status).toBe(200)
    expect((await request(app).post('/api/detect').send(png)).status).toBe(200)

    const blocked = await request(app).post('/api/detect').send(png)
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({ error: 'too many uploads, try again later' })
  })

  it('never throttles the GET poll route', async () => {
    const app = testApp({ ...detectDirs(), detectRateLimit: { windowMs: 60_000, limit: 1 } })
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/api/detect/some-request-id')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ status: 'pending' })
    }
  })
})
