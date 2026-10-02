// Thin fetch wrapper around the auth/designs backend (proxied at /api).
// Cookies (session) ride along via credentials: 'include'.
//
// Every failure mode surfaces as a typed ApiError (never a raw SyntaxError /
// TypeError): network refused → status 0; non-JSON error body (e.g. the Vite
// proxy's HTML 502 page) → ApiError with the HTTP status; malformed JSON on a
// 2xx → ApiError too. A 401 from any non-auth endpoint additionally notifies
// the session-expiry handler (registered by auth.ts) so the app can route the
// user back to a login screen instead of failing forever.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type UnauthorizedHandler = (path: string) => void

let onUnauthorized: UnauthorizedHandler | null = null

/**
 * Register the handler invoked when a NON-auth endpoint answers 401 —
 * i.e. the session expired (or was revoked) after boot. auth.ts registers
 * this once at module load; tests may swap it.
 */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn
}

async function requestWithMeta<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ data: T; headers: Headers }> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // Network-level failure (server down, DNS, CORS) — no response at all.
    throw new ApiError(0, 'Could not reach the server')
  }

  const text = await res.text()
  let data: unknown = null
  let parseFailed = false
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // Non-JSON body (proxy error page, HTML 502…). Fold into ApiError below.
      parseFailed = true
    }
  }

  if (!res.ok) {
    // Session expired mid-session? Auth endpoints legitimately return 401
    // (bad password, anonymous /auth/me) — only non-auth 401s mean expiry.
    if (res.status === 401 && !path.startsWith('/auth/')) {
      try {
        onUnauthorized?.(path)
      } catch {
        /* the notification must never mask the original failure */
      }
    }
    const msg = (data as { error?: string } | null)?.error || `HTTP ${res.status}`
    throw new ApiError(res.status, msg)
  }

  if (parseFailed) {
    throw new ApiError(res.status, 'The server returned an unexpected response')
  }
  return { data: data as T, headers: res.headers }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await requestWithMeta<T>(method, path, body)).data
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  /** Metadata is needed for revision tokens without altering legacy JSON. */
  getWithMeta: <T>(path: string) => requestWithMeta<T>('GET', path),
  postWithMeta: <T>(path: string, body: unknown, headers: Record<string, string>) =>
    requestWithMeta<T>('POST', path, body, headers),
}

/**
 * Is the backend reachable? Used to decide server vs local-only mode.
 *
 * "Reachable" means the probe got an HTTP response back at all with a non-error
 * status (200–399), NOT strictly a 200 with a JSON body. This matters on a
 * plain browser reload: the browser revalidates the cached /api/health response
 * (Express hands it an ETag) and the server answers 304 Not Modified. A 304
 * means "unchanged AND reachable" — the backend is clearly up. Treating it as
 * down silently dropped a LOGGED-IN user into guest/offline mode, hiding their
 * cloud designs until a hard reload (api-reload-auth).
 *
 * We probe with a raw fetch (bypassing request()'s strict 2xx-or-throw + JSON
 * parse) and `cache: 'no-store'` so this specific request never fires a
 * conditional revalidation of its own — it deterministically returns 200. A
 * genuinely-down backend still fails correctly: a refused connection rejects
 * fetch (→ false) and a 5xx lands outside 200–399 (→ false).
 */
export async function backendAvailable(): Promise<boolean> {
  let res: Response
  try {
    res = await fetch('/api/health', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    })
  } catch {
    // Network-level failure (server down, DNS, CORS) — no response at all.
    return false
  }
  // Any reachable, non-error status counts as up: 200 OK, 304 Not Modified,
  // even a 301/302 redirect in front of the API. 4xx/5xx mean the server is
  // there but broken/misrouted → treat as unavailable so we stay in local mode.
  return res.status >= 200 && res.status < 400
}
