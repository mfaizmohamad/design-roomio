import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, ApiError, backendAvailable, setUnauthorizedHandler } from './api'

// ---------------------------------------------------------------------------
// The client's fetch wrapper must fold EVERY failure mode into a typed
// ApiError — server down (network refuse), HTML error pages from the proxy,
// malformed JSON — and must notify the session-expiry handler on non-auth
// 401s (CODE-04). These are exactly the paths users hit in the wild.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn()

function respond(status: number, body: string, contentType = 'application/json') {
  fetchMock.mockResolvedValueOnce(
    new Response(body, { status, headers: { 'Content-Type': contentType } }),
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

describe('api.request error handling', () => {
  it('returns parsed JSON on success', async () => {
    respond(200, JSON.stringify({ ok: true, id: 'd1' }))
    await expect(api.get('/designs/d1')).resolves.toEqual({ ok: true, id: 'd1' })
  })

  it('throws ApiError carrying the server message on a JSON error body', async () => {
    respond(500, JSON.stringify({ error: 'db exploded' }))
    const err = await api.get('/designs').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).message).toBe('db exploded')
  })

  it('throws ApiError (never SyntaxError) when the error body is HTML — e.g. a proxy 502 page', async () => {
    respond(502, '<html><body>Bad Gateway</body></html>', 'text/html')
    const err = await api.get('/designs').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(SyntaxError)
    expect((err as ApiError).status).toBe(502)
    expect((err as ApiError).message).toBe('HTTP 502')
  })

  it('throws ApiError when a 2xx response body is not valid JSON', async () => {
    respond(200, 'this is not json')
    const err = await api.get('/health').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toMatch(/unexpected response/i)
  })

  it('throws ApiError with status 0 when the network request itself fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await api.get('/designs').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })
})

describe('central 401 (session expiry) detection', () => {
  it('notifies the unauthorized handler on a 401 from a non-auth endpoint', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    respond(401, JSON.stringify({ error: 'unauthorized' }))
    const err = await api.get('/designs').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('/designs')
  })

  it('does NOT notify the handler for auth endpoints (anonymous /auth/me, bad login)', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    respond(401, JSON.stringify({ error: 'unauthorized' }))
    await api.get('/auth/me').catch(() => null)
    respond(401, JSON.stringify({ error: 'invalid email or password' }))
    await api.post('/auth/login', { email: 'x', password: 'y' }).catch(() => null)
    expect(handler).not.toHaveBeenCalled()
  })

  it('does NOT notify the handler for non-401 failures', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    respond(500, JSON.stringify({ error: 'boom' }))
    await api.get('/designs').catch(() => null)
    expect(handler).not.toHaveBeenCalled()
  })

  it('a throwing handler never masks the original ApiError', async () => {
    setUnauthorizedHandler(() => {
      throw new Error('handler bug')
    })
    respond(401, JSON.stringify({ error: 'unauthorized' }))
    const err = await api.del('/designs/d1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  })
})

describe('backendAvailable', () => {
  // A status-only response (304/301/302 legally carry no body in the fetch spec,
  // so the Response ctor rejects one) — used for the reachability probe tests.
  function respondStatus(status: number) {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
  }

  it('is false when the server is unreachable (connection refused)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(backendAvailable()).resolves.toBe(false)
  })

  it('is true when /health answers 200', async () => {
    respond(200, JSON.stringify({ ok: true }))
    await expect(backendAvailable()).resolves.toBe(true)
  })

  // api-reload-auth: a plain browser reload revalidates the cached /api/health
  // (Express set an ETag) and the server answers 304 Not Modified. A 304 means
  // the backend is reachable — treating it as down dropped logged-in users into
  // guest mode, hiding their cloud designs until a hard reload.
  it('is true when /health answers 304 Not Modified (reload revalidation)', async () => {
    respondStatus(304)
    await expect(backendAvailable()).resolves.toBe(true)
  })

  it('is true on a 301/302 redirect in front of the API', async () => {
    respondStatus(301)
    await expect(backendAvailable()).resolves.toBe(true)
    respondStatus(302)
    await expect(backendAvailable()).resolves.toBe(true)
  })

  it('is false when the backend is up but broken (500)', async () => {
    respond(500, JSON.stringify({ error: 'db down' }))
    await expect(backendAvailable()).resolves.toBe(false)
  })

  it('is false on a 4xx (misrouted / gateway error)', async () => {
    respondStatus(404)
    await expect(backendAvailable()).resolves.toBe(false)
  })

  it('probes with cache: no-store so the request never triggers its own 304', async () => {
    respond(200, JSON.stringify({ ok: true }))
    await backendAvailable()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/health')
    expect(init).toMatchObject({ cache: 'no-store' })
  })
})
