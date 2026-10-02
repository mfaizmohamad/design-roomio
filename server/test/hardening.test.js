// test/hardening.test.js — the security controls added for the public launch:
// response security headers, the cross-origin (CSRF) guard on state-changing
// routes, password bounds at signup, and the per-user design quota.
//
// These are the behaviours most likely to be "simplified away" by a later
// refactor precisely because nothing in the product visibly depends on them, so
// each one is pinned by a test that fails loudly if the control disappears.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { closeDb, freshDb, signedUpAgent, testApp, uniqueEmail } from './helpers.js'

let app

beforeAll(async () => {
  await freshDb()
  app = testApp()
})

afterAll(async () => {
  await closeDb()
})

describe('security headers', () => {
  it('locks down API responses with a no-load CSP and denies framing', async () => {
    const res = await request(app).get('/api/health')

    expect(res.status).toBe(200)
    // An API that only ever emits JSON never needs to load a subresource.
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    // MIME sniffing turns a JSON echo of user input into a scriptable response.
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
  })

  it('does not advertise the server technology', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('omits HSTS outside production, so local http dev is never pinned to https', async () => {
    const res = await request(app).get('/api/health')
    expect(res.headers['strict-transport-security']).toBeUndefined()
  })

  it('sends HSTS when built in production mode', async () => {
    const prodApp = testApp({ isProduction: true })
    const res = await request(prodApp).get('/api/health')
    expect(res.headers['strict-transport-security']).toContain('max-age=15552000')
  })
})

describe('cross-origin (CSRF) guard', () => {
  it('refuses a state-changing request from a foreign origin', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'someone@example.test', password: 'irrelevant' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'cross-origin request refused' })
  })

  it('refuses an unparseable Origin rather than falling through', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'not-a-url')
      .send({ email: 'someone@example.test', password: 'irrelevant' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'bad origin' })
  })

  it('allows a same-origin request (Origin host matches Host)', async () => {
    // Bind ONE server so the Host stays put: `request(app)` starts a fresh
    // ephemeral listener per call, so a host read from an earlier response would
    // no longer match by the time the next request goes out.
    const server = app.listen(0)
    try {
      const { port } = server.address()
      const origin = `http://127.0.0.1:${port}`
      const agent = request.agent(server)

      const signup = await agent
        .post('/api/auth/signup')
        .set('Origin', origin)
        .send({ email: uniqueEmail('sameorigin'), password: 'hunter22ab' })

      expect(signup.status).toBe(200)

      const res = await agent.post('/api/auth/logout').set('Origin', origin).send({})
      expect(res.status).toBe(200)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('leaves GETs alone — they carry no state change', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example')
    expect(res.status).toBe(200)
  })

  it('honours an explicit ALLOWED_ORIGINS entry for a split-origin deployment', async () => {
    const splitApp = testApp({ allowedOrigins: new Set(['https://roomio.example']) })
    const res = await request(splitApp)
      .post('/api/auth/login')
      .set('Origin', 'https://roomio.example')
      .send({ email: 'nobody@example.test', password: 'wrong-but-parsed' })

    // Reaches the handler (401 invalid credentials) instead of being cut off at 403.
    expect(res.status).toBe(401)
  })
})

describe('password bounds at signup', () => {
  it('rejects a password shorter than the 8-character floor', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('short'), password: 'hunter2' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least 8/)
  })

  it('rejects a password past bcrypt’s 72-byte limit instead of silently truncating it', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('long'), password: 'a'.repeat(73) })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at most 72 bytes/)
  })

  it('counts BYTES, not characters, so multi-byte passwords cannot slip past', async () => {
    // 25 x 3-byte characters = 75 bytes but only 25 JS characters.
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('utf8'), password: 'न'.repeat(25) })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at most 72 bytes/)
  })

  it('accepts a password exactly at the 72-byte boundary', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('boundary'), password: 'a'.repeat(72) })

    expect(res.status).toBe(200)
  })
})

describe('per-user design quota', () => {
  it('refuses a NEW design once the ceiling is reached', async () => {
    const quotaApp = testApp({ maxDesignsPerUser: 2 })
    const { agent } = await signedUpAgent(quotaApp, { tag: 'quota' })

    for (const id of ['d1', 'd2']) {
      const ok = await agent.post('/api/designs').send({ id, name: id, shape: 'rect' })
      expect(ok.status).toBe(200)
    }

    const over = await agent.post('/api/designs').send({ id: 'd3', name: 'd3', shape: 'rect' })
    expect(over.status).toBe(409)
    expect(over.body.error).toMatch(/design limit reached/)
  })

  it('still lets an at-quota user re-save work already in front of them', async () => {
    const quotaApp = testApp({ maxDesignsPerUser: 1 })
    const { agent } = await signedUpAgent(quotaApp, { tag: 'resave' })

    expect((await agent.post('/api/designs').send({ id: 'only', name: 'v1', shape: 'rect' })).status).toBe(200)

    // At quota, but this is an UPDATE of an owned row — refusing it would lose work.
    const again = await agent.post('/api/designs').send({ id: 'only', name: 'v2', shape: 'rect' })
    expect(again.status).toBe(200)

    const read = await agent.get('/api/designs/only')
    expect(read.body.name).toBe('v2')
  })

  it('scopes the quota per user, not globally', async () => {
    const quotaApp = testApp({ maxDesignsPerUser: 1 })
    const a = await signedUpAgent(quotaApp, { tag: 'quota-a' })
    const b = await signedUpAgent(quotaApp, { tag: 'quota-b' })

    expect((await a.agent.post('/api/designs').send({ id: 'a1', shape: 'rect' })).status).toBe(200)
    // b is a different user and has used none of their own allowance.
    expect((await b.agent.post('/api/designs').send({ id: 'b1', shape: 'rect' })).status).toBe(200)
  })
})
