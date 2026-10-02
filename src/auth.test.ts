import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuth, getGuestPreference, setGuestPreference } from './auth'

// ---------------------------------------------------------------------------
// WIZ-03 — a returning guest must not be re-gated at the login wall. The
// "Continue as guest" choice is persisted in localStorage and honoured on boot
// (when the backend is reachable but there's no active session). An explicit
// login/logout forgets it so the real auth path is never hijacked.
// ---------------------------------------------------------------------------

const GUEST_KEY = 'roomio.guest.v1'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string) { this.store.set(k, String(v)) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
  get length() { return this.store.size }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
}

const fetchMock = vi.fn()

/** Route responses by URL substring. */
function routeFetch(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url)
    for (const [frag, make] of Object.entries(routes)) {
      if (u.includes(frag)) return make()
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  })
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  useAuth.setState({ status: 'loading', user: null, error: null, busy: false, promptAuth: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('guest preference persistence', () => {
  it('starts unset and round-trips through localStorage', () => {
    expect(getGuestPreference()).toBe(false)
    setGuestPreference(true)
    expect(localStorage.getItem(GUEST_KEY)).toBe('1')
    expect(getGuestPreference()).toBe(true)
    setGuestPreference(false)
    expect(localStorage.getItem(GUEST_KEY)).toBeNull()
    expect(getGuestPreference()).toBe(false)
  })

  it('tolerates a missing localStorage (SSR / private mode)', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(() => setGuestPreference(true)).not.toThrow()
    expect(getGuestPreference()).toBe(false)
  })

  it('continueAsGuest remembers the choice; logout forgets it', async () => {
    useAuth.getState().continueAsGuest()
    expect(useAuth.getState().status).toBe('offline')
    expect(getGuestPreference()).toBe(true)

    routeFetch({ '/auth/logout': () => json(200, { ok: true }) })
    await useAuth.getState().logout()
    expect(useAuth.getState().status).toBe('anon')
    expect(getGuestPreference()).toBe(false)
  })

  it('a successful login forgets any prior guest preference', async () => {
    setGuestPreference(true)
    routeFetch({ '/auth/login': () => json(200, { user: { id: 'u1', email: 'a@b.com' } }) })
    const ok = await useAuth.getState().login('a@b.com', 'secret')
    expect(ok).toBe(true)
    expect(useAuth.getState().status).toBe('authed')
    expect(getGuestPreference()).toBe(false)
  })
})

describe('init() honours the remembered guest choice', () => {
  it('backend up + no session + guest remembered → skip the wall (offline)', async () => {
    setGuestPreference(true)
    routeFetch({ '/health': () => json(200, { ok: true }), '/auth/me': () => json(401, { error: 'unauthorized' }) })
    await useAuth.getState().init()
    expect(useAuth.getState().status).toBe('offline')
  })

  it('backend up + no session + NO guest preference → login wall (anon)', async () => {
    routeFetch({ '/health': () => json(200, { ok: true }), '/auth/me': () => json(401, { error: 'unauthorized' }) })
    await useAuth.getState().init()
    expect(useAuth.getState().status).toBe('anon')
  })

  it('backend up + valid session → authed regardless of guest flag', async () => {
    setGuestPreference(true)
    routeFetch({ '/health': () => json(200, { ok: true }), '/auth/me': () => json(200, { user: { id: 'u1', email: 'a@b.com' } }) })
    await useAuth.getState().init()
    expect(useAuth.getState().status).toBe('authed')
  })

  it('backend unreachable → offline (local-only) even without a guest flag', async () => {
    routeFetch({ '/health': () => json(500, { error: 'down' }) })
    await useAuth.getState().init()
    expect(useAuth.getState().status).toBe('offline')
  })
})

describe('requestSignIn (guests can still reach the wall)', () => {
  it('sets promptAuth so the app can show the login wall on demand', () => {
    useAuth.getState().continueAsGuest()
    expect(useAuth.getState().promptAuth).toBe(false)
    useAuth.getState().requestSignIn()
    expect(useAuth.getState().promptAuth).toBe(true)
    // choosing guest again dismisses the wall
    useAuth.getState().continueAsGuest()
    expect(useAuth.getState().promptAuth).toBe(false)
  })
})
