import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listDesigns, loadDesign, saveDesign, deleteDesign, DesignDataError } from './repository'
import { ApiError } from './api'
import { useAuth } from './auth'
import { useToasts } from './toast'
import type { RoomDesign } from './types'
import { makeDefaultLightingState } from '../lighting/src/types'

// ---------------------------------------------------------------------------
// Repository error contract (CODE-03/04/06/08):
//   • cloud failures PROPAGATE (no more fake-empty lists / silent nulls)
//   • cloud payloads get the same validation localStorage reads get
//   • a mid-session 401 flips auth to 'anon' via the central handler
// ---------------------------------------------------------------------------

const fetchMock = vi.fn()

function respond(status: number, body: unknown, revision = 1) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Design-Revision': String(revision) },
    }),
  )
}

const validDesign: RoomDesign = {
  id: 'd1',
  name: 'Living room',
  unit: 'ft',
  shape: 'rect',
  corners: [
    { x: 0, z: 0 },
    { x: 400, z: 0 },
    { x: 400, z: 300 },
    { x: 0, z: 300 },
  ],
  wallHeight: 270,
  wallThickness: 12,
  openings: [],
  materials: { wallColor: '#f4f1ea', floorTexture: 'oak' },
  furniture: [],
  view: { cam: [3, 2.5, 4], target: [0, 0.7, 0] },
  createdAt: 1000,
  updatedAt: 2000,
}

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
  get length(): number {
    return this.store.size
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
  useAuth.setState({ status: 'authed', user: { id: 'u1', email: 'u1@example.com' }, error: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useToasts.getState().clear()
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('listDesigns (cloud)', () => {
  it('propagates an ApiError when the server fails — never a fake empty list', async () => {
    respond(500, { error: 'boom' })
    const err = await listDesigns().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })

  it('propagates a network failure as ApiError status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const err = await listDesigns().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })

  it('normalizes rows with null name/shape (server only enforces a string id)', async () => {
    respond(200, [
      { id: 'bad-1', name: null, shape: null, updatedAt: 5, createdAt: 5 },
      { id: 'ok-1', name: 'Bedroom', shape: 'l', updatedAt: 9, createdAt: 1 },
      { name: 'no id at all' },
      'garbage',
    ])
    const rows = await listDesigns()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'bad-1', name: 'Untitled room', shape: 'rect' })
    expect(rows[1]).toMatchObject({ id: 'ok-1', name: 'Bedroom', shape: 'l' })
  })
})

describe('loadDesign (cloud) — validation parity with localStorage (CODE-06)', () => {
  it('restores a whole-house payload through the same cloud endpoint', async () => {
    const house = {
      version: 1, activeId: 'd1', homeId: null, levels: [],
      rooms: [{ id: 'd1', type: 'living', design: validDesign }],
      lighting: { ...makeDefaultLightingState(), fillScale: 1 },
      viewMode: 'house', levelFilter: 'all',
    }
    respond(200, { ...validDesign, house })
    const d = await loadDesign('d1')
    expect(d?.house?.rooms[0].design.view).toEqual(validDesign.view)
    expect(d?.house?.viewMode).toBe('house')
  })

  it('returns the coerced design, preserving the saved camera view', async () => {
    respond(200, validDesign)
    const d = await loadDesign('d1')
    expect(d).not.toBeNull()
    expect(d!.corners).toEqual(validDesign.corners)
    expect(d!.view).toEqual(validDesign.view)
    expect(d!.materials).toEqual(validDesign.materials)
  })

  it('returns null for a 404 (design genuinely absent)', async () => {
    respond(404, { error: 'not found' })
    await expect(loadDesign('missing')).resolves.toBeNull()
  })

  it('throws DesignDataError for a stored payload with no corners/materials', async () => {
    respond(200, { id: 'bad-1' })
    await expect(loadDesign('bad-1')).rejects.toBeInstanceOf(DesignDataError)
  })

  it('throws DesignDataError when corners contain non-finite values', async () => {
    respond(200, {
      ...validDesign,
      corners: [{ x: NaN, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }],
    })
    await expect(loadDesign('d1')).rejects.toBeInstanceOf(DesignDataError)
  })

  it('drops a malformed saved view instead of rejecting the whole design', async () => {
    respond(200, { ...validDesign, view: { cam: 'nope', target: [0, 0, 0] } })
    const d = await loadDesign('d1')
    expect(d).not.toBeNull()
    expect(d!.view).toBeUndefined()
  })

  it('propagates transport failures (5xx) instead of returning null', async () => {
    respond(500, { error: 'boom' })
    const err = await loadDesign('d1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
  })
})

describe('cloud revision saves', () => {
  it('sends create revision 0, then the loaded revision, and keeps a stale save unsaved', async () => {
    const design = { ...validDesign, id: 'revision-save' }
    respond(200, { ok: true, id: design.id }, 1)
    await saveDesign(design)
    expect(fetchMock.mock.calls[0][1].headers['X-Design-Revision']).toBe('0')

    respond(200, design, 4)
    await loadDesign(design.id)
    respond(409, { error: 'design changed in another session' })
    await expect(saveDesign({ ...design, name: 'My unsaved edit' })).rejects.toMatchObject({ status: 409 })
    expect(fetchMock.mock.calls[2][1].headers['X-Design-Revision']).toBe('4')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).name).toBe('My unsaved edit')

    // Failed saves must not advance the local token or the next retry could
    // overwrite the other tab's newer row without reopening it first.
    respond(409, { error: 'design changed in another session' })
    await expect(saveDesign(design)).rejects.toMatchObject({ status: 409 })
    expect(fetchMock.mock.calls[3][1].headers['X-Design-Revision']).toBe('4')
  })
})

describe('session expiry mid-session (CODE-04)', () => {
  it('a 401 on save flips auth to anon with a re-login message, and still throws', async () => {
    respond(401, { error: 'unauthorized' })
    const err = await saveDesign(validDesign).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    const auth = useAuth.getState()
    expect(auth.status).toBe('anon')
    expect(auth.user).toBeNull()
    expect(auth.error).toMatch(/session has expired/i)
    // and the user gets a visible toast pointing at re-login
    expect(useToasts.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('a 401 on delete flips auth to anon as well', async () => {
    respond(401, { error: 'unauthorized' })
    await deleteDesign('d1').catch(() => null)
    expect(useAuth.getState().status).toBe('anon')
  })
})

describe('guest/local fallback', () => {
  it('uses localStorage without touching the network when not authed', async () => {
    useAuth.setState({ status: 'anon', user: null })
    await saveDesign(validDesign)
    const rows = await listDesigns()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('d1')
    const d = await loadDesign('d1')
    expect(d!.corners).toEqual(validDesign.corners)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
