import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSession, makeSession } from './session'
import { InMemoryAdapter, type StorageAdapter } from '../storage/adapter'
import { sampleBedroom } from '../demo/sampleScene'
import type { RoomioDesign } from '../envelope/types'

// Rebind the singleton to a fresh in-memory backend before each test.
beforeEach(() => {
  useSession.setState(makeSession(new InMemoryAdapter()))
})

// Tests that exercise the debounced autosave use vi.useFakeTimers() so timer
// settling is deterministic (no wall-clock sleeps → no CI flake).
afterEach(() => {
  vi.useRealTimers()
})

const S = () => useSession.getState()

/** Adapter whose setItem can be held open, to simulate a slow/in-flight save. */
class GatedAdapter implements StorageAdapter {
  readonly kind = 'gated'
  private inner = new InMemoryAdapter()
  private gate: Promise<void> | null = null
  private release: (() => void) | null = null
  open() {
    this.gate = new Promise((r) => (this.release = r))
  }
  unblock() {
    this.release?.()
    this.gate = null
    this.release = null
  }
  async getItem(k: string) {
    return this.inner.getItem(k)
  }
  async setItem(k: string, v: string) {
    if (this.gate) await this.gate
    return this.inner.setItem(k, v)
  }
  async removeItem(k: string) {
    return this.inner.removeItem(k)
  }
  async keys(prefix: string) {
    return this.inner.keys(prefix)
  }
}

/** Use rooms[0].interior.name as a scene marker we can set + assert. */
const marker = (d: RoomioDesign | null) => d?.scene.house.rooms[0]?.interior.name
const setMarker = (m: string) => (d: RoomioDesign): RoomioDesign => ({
  ...d,
  scene: {
    ...d.scene,
    house: {
      ...d.scene.house,
      rooms: d.scene.house.rooms.map((r, i) =>
        i === 0 ? { ...r, interior: { ...r.interior, name: m } } : r,
      ),
    },
  },
})

describe('session — library management', () => {
  it('creates a design, then duplicates it as an independent private copy', async () => {
    const d = await S().newDesign(sampleBedroom(), null, 'Original')
    await S().closeToLibrary()
    expect(S().summaries.map((s) => s.name)).toContain('Original')

    const copyId = await S().duplicate(d.design_id)
    expect(copyId).not.toBeNull()
    await S().refreshLibrary()
    const names = S().summaries.map((s) => s.name)
    expect(names).toContain('Original')
    expect(names).toContain('Original (copy)')

    const copy = await S().repo.load(copyId!)
    expect(copy!.share.access).toBe('private') // never inherits share links
    expect(copy!.design_id).not.toBe(d.design_id)
  })

  it('renames a design by id', async () => {
    const d = await S().newDesign(sampleBedroom(), null, 'Before')
    await S().closeToLibrary()
    await S().renameDesign(d.design_id, 'After')
    const reloaded = await S().repo.load(d.design_id)
    expect(reloaded!.name).toBe('After')
  })

  it('delete is UNDOable — the design returns intact', async () => {
    const d = await S().newDesign(sampleBedroom(), null, 'Fragile')
    await S().closeToLibrary()
    await S().deleteDesign(d.design_id)
    expect(await S().repo.has(d.design_id)).toBe(false)
    expect(S().lastDeleted.map((x) => x.design_id)).toContain(d.design_id)

    await S().undoDelete()
    expect(await S().repo.has(d.design_id)).toBe(true)
    const back = await S().repo.load(d.design_id)
    expect(back!.name).toBe('Fragile')
    expect(S().lastDeleted).toEqual([])
  })

  it('deleting two designs before undo keeps BOTH recoverable (regression: stack, not 1 slot)', async () => {
    const a = await S().newDesign(sampleBedroom(), null, 'Alpha')
    await S().closeToLibrary()
    const b = await S().newDesign(sampleBedroom(), null, 'Beta')
    await S().closeToLibrary()

    await S().deleteDesign(a.design_id)
    await S().deleteDesign(b.design_id) // would overwrite a single slot
    expect(await S().repo.has(a.design_id)).toBe(false)
    expect(await S().repo.has(b.design_id)).toBe(false)

    await S().undoDelete() // LIFO → restores Beta
    expect(await S().repo.has(b.design_id)).toBe(true)
    await S().undoDelete() // → restores Alpha (NOT lost)
    expect(await S().repo.has(a.design_id)).toBe(true)
  })

  it('deleting the currently-open design returns to the library', async () => {
    const d = await S().newDesign(sampleBedroom(), null, 'Open one')
    expect(S().current?.design_id).toBe(d.design_id)
    await S().deleteDesign(d.design_id)
    expect(S().current).toBeNull()
  })

  it('a pending edit cannot resurrect a deleted open design (regression: tombstone + cancel)', async () => {
    const d = await S().newDesign(sampleBedroom(), null, 'Doomed')
    vi.useFakeTimers()
    // make an optimistic edit → arms a debounced autosave (pending), but don't flush
    S().mutate(setMarker('edited'))
    expect(S().autosave.hasUnsaved()).toBe(true)
    // delete the open design before the save settles
    await S().deleteDesign(d.design_id)
    // deterministically fire the debounce + any retry timers and in-flight work
    await vi.runAllTimersAsync()
    await S().autosave.saveNow().catch(() => {})
    await vi.runAllTimersAsync()
    expect(await S().repo.has(d.design_id)).toBe(false) // stays deleted
  })
})

describe('session — edit during in-flight save is never clobbered (regression: critical #2)', () => {
  it('keeps + persists the newer edit when it lands while an older save is in flight', async () => {
    const gated = new GatedAdapter()
    useSession.setState(makeSession(gated))
    const d = await S().newDesign(sampleBedroom(), null, 'Start')

    vi.useFakeTimers()
    gated.open() // hold the next save open
    S().mutate(setMarker('A'))
    const saving = S().saveNow() // flush starts saving scene A, awaits the gate
    S().mutate(setMarker('B')) // NEWER edit arrives mid-flight (optimistic)
    expect(marker(S().current)).toBe('B') // shown immediately
    gated.unblock()
    await saving

    // onSaved for A must NOT snap the visible scene back to A.
    expect(marker(S().current)).toBe('B')

    // The newer scene B must actually reach storage (coalesced re-save). The
    // re-save chain is microtask-only, and fake timers let us settle the still-
    // armed debounce deterministically — no wall-clock polling.
    await vi.runAllTimersAsync()
    const stored = await S().repo.load(d.design_id)
    expect(marker(stored)).toBe('B')
    expect(S().current?.scene.house.rooms[0].interior.name).toBe('B')
  })
})
