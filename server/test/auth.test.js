// test/auth.test.js — signup/login/logout/me lifecycle, session-cookie security
// flags (httpOnly, SameSite, env-driven Secure), password hashing at rest, and
// expired-session behavior + purge.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'

import { query } from '../db.js'
import { purgeExpiredSessions } from '../auth.js'
import {
  closeDb,
  freshDb,
  sessionCookie,
  signedUpAgent,
  testApp,
  uniqueEmail,
} from './helpers.js'

let app

beforeAll(async () => {
  await freshDb()
  app = testApp()
})

afterAll(async () => {
  await closeDb()
})

describe('smoke', () => {
  it('GET /api/health responds ok without auth', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('unknown /api routes return JSON 404, never HTML', async () => {
    const res = await request(app).get('/api/definitely-not-a-route')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })
})

describe('signup', () => {
  it('creates a user, returns the public shape, and never leaks the password hash', async () => {
    const email = uniqueEmail('signup')
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'hunter22', name: 'Priya' })

    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({
      id: expect.any(String),
      email,
      name: 'Priya',
    })
    expect(JSON.stringify(res.body)).not.toContain('password')
  })

  it('stores a bcrypt hash, not the plaintext password', async () => {
    const email = uniqueEmail('hash')
    await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'plaintext-secret', name: null })

    const { rows } = await query(`SELECT password_hash FROM users WHERE email = $1`, [email])
    expect(rows).toHaveLength(1)
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/)
    expect(rows[0].password_hash).not.toContain('plaintext-secret')
  })

  it('rejects a duplicate email with 409', async () => {
    const { email } = await signedUpAgent(app, { tag: 'dupe' })
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'another-pass', name: 'Imposter' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'email already registered' })
  })

  it('rejects invalid emails and short passwords with 400', async () => {
    const badEmail = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'not-an-email', password: 'long-enough' })
    expect(badEmail.status).toBe(400)

    const shortPw = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('shortpw'), password: '12345' })
    expect(shortPw.status).toBe(400)
  })
})

describe('session cookie flags', () => {
  it('sets an httpOnly, SameSite=Lax, Path=/ cookie with a Max-Age (and no Secure in dev)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: uniqueEmail('cookie'), password: 'cookie-pass' })

    const cookie = sessionCookie(res)
    expect(cookie).toMatch(/;\s*HttpOnly/i)
    expect(cookie).toMatch(/;\s*SameSite=Lax/i)
    expect(cookie).toMatch(/;\s*Path=\//i)
    expect(cookie).toMatch(/;\s*Max-Age=2592000/i) // 30 days
    expect(cookie).not.toMatch(/;\s*Secure/i) // NODE_ENV=test → plain-http dev cookie
  })

  it('adds the Secure attribute when NODE_ENV=production', async () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: uniqueEmail('prod'), password: 'prod-pass' })
      expect(sessionCookie(res)).toMatch(/;\s*Secure/i)
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('honors the COOKIE_SECURE override in both directions', async () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = 'false'
    try {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: uniqueEmail('override-off'), password: 'override-pass' })
      expect(sessionCookie(res)).not.toMatch(/;\s*Secure/i)
    } finally {
      process.env.NODE_ENV = prevEnv
      delete process.env.COOKIE_SECURE
    }

    process.env.COOKIE_SECURE = 'true'
    try {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: uniqueEmail('override-on'), password: 'override-pass' })
      expect(sessionCookie(res)).toMatch(/;\s*Secure/i)
    } finally {
      delete process.env.COOKIE_SECURE
    }
  })
})

describe('login', () => {
  it('logs in with correct credentials and issues a fresh session cookie', async () => {
    const { email, password, user } = await signedUpAgent(app, { tag: 'login' })
    const res = await request(app).post('/api/auth/login').send({ email, password })
    expect(res.status).toBe(200)
    expect(res.body.user).toEqual(user)
    expect(sessionCookie(res)).toMatch(/^roomio_sid=/)
  })

  it('is case/whitespace tolerant on the email', async () => {
    const { email, password } = await signedUpAgent(app, { tag: 'case' })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `  ${email.toUpperCase()}  `, password })
    expect(res.status).toBe(200)
  })

  it('rejects a wrong password with 401', async () => {
    const { email } = await signedUpAgent(app, { tag: 'wrongpw' })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'totally-wrong' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid credentials' })
  })

  it('uses the same 401 body for unknown emails (no account enumeration)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'whatever-pass' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'invalid credentials' })
  })

  it('rejects missing fields with 400', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'x@y.zz' })
    expect(res.status).toBe(400)
  })
})

describe('me + logout', () => {
  it('GET /api/auth/me returns the user for a live session', async () => {
    const { agent, user } = await signedUpAgent(app, { tag: 'me' })
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ user })
  })

  it('GET /api/auth/me is 401 without a cookie or with a bogus sid', async () => {
    const bare = await request(app).get('/api/auth/me')
    expect(bare.status).toBe(401)
    expect(bare.body).toEqual({ error: 'unauthorized' })

    const bogus = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'roomio_sid=not-a-real-session')
    expect(bogus.status).toBe(401)
  })

  it('logout deletes the session row, clears the cookie, and kills access', async () => {
    const { agent, user } = await signedUpAgent(app, { tag: 'logout' })

    const out = await agent.post('/api/auth/logout')
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ ok: true })
    // Clearing cookie: empty value, epoch expiry, same httpOnly/SameSite attrs.
    const cleared = sessionCookie(out)
    expect(cleared).toMatch(/^roomio_sid=;/)
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i)

    const { rows } = await query(`SELECT sid FROM sessions WHERE user_id = $1`, [user.id])
    expect(rows).toHaveLength(0)

    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(401)
  })
})

describe('session expiry + purge', () => {
  it('an expired session no longer authenticates', async () => {
    const { agent, user } = await signedUpAgent(app, { tag: 'expired' })
    await query(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
      [user.id]
    )
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('purgeExpiredSessions deletes only expired rows and keeps live sessions working', async () => {
    const alive = await signedUpAgent(app, { tag: 'alive' })
    const dead = await signedUpAgent(app, { tag: 'dead' })
    await query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE user_id = $1`,
      [dead.user.id]
    )

    const before = await query(`SELECT count(*)::int AS n FROM sessions WHERE expires_at <= now()`)
    expect(before.rows[0].n).toBeGreaterThanOrEqual(1)

    const purged = await purgeExpiredSessions()
    expect(purged).toBe(before.rows[0].n)

    const after = await query(`SELECT count(*)::int AS n FROM sessions WHERE expires_at <= now()`)
    expect(after.rows[0].n).toBe(0)

    // Rows for the dead user are gone; the live session still authenticates.
    const deadRows = await query(`SELECT sid FROM sessions WHERE user_id = $1`, [dead.user.id])
    expect(deadRows.rows).toHaveLength(0)
    const me = await alive.agent.get('/api/auth/me')
    expect(me.status).toBe(200)
  })
})
