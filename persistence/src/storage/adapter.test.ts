import { describe, it, expect, afterEach } from 'vitest'
import { LocalStorageAdapter } from './adapter'

/** Minimal controllable localStorage stub (Map-backed) with a quota toggle. */
class FakeLocalStorage {
  store = new Map<string, string>()
  failSet = false
  get length() {
    return this.store.size
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null
  }
  setItem(k: string, v: string): void {
    if (this.failSet) throw new Error('QuotaExceededError')
    this.store.set(k, v)
  }
  removeItem(k: string): void {
    this.store.delete(k)
  }
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('LocalStorageAdapter — mid-session degrade preserves the library (regression: critical #1)', () => {
  it('keeps ALL prior localStorage designs readable after a quota failure flips it to memory', async () => {
    const fake = new FakeLocalStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = fake

    const adapter = new LocalStorageAdapter()
    expect(adapter.kind).toBe('local') // probe succeeded

    // Three designs already durably on "disk".
    await adapter.setItem('roomio.design.a', 'A')
    await adapter.setItem('roomio.design.b', 'B')
    await adapter.setItem('roomio.design.c', 'C')

    // Quota fills mid-session: the next write throws → adapter degrades to memory.
    fake.failSet = true
    await adapter.setItem('roomio.design.d', 'D') // must not throw, must not drop

    expect(adapter.kind).toBe('memory')
    // CRITICAL: every prior design is still visible + loadable (not orphaned).
    const keys = await adapter.keys('roomio.design.')
    expect(keys.sort()).toEqual([
      'roomio.design.a',
      'roomio.design.b',
      'roomio.design.c',
      'roomio.design.d',
    ])
    expect(await adapter.getItem('roomio.design.a')).toBe('A')
    expect(await adapter.getItem('roomio.design.b')).toBe('B')
    expect(await adapter.getItem('roomio.design.c')).toBe('C')
    expect(await adapter.getItem('roomio.design.d')).toBe('D') // the in-flight write survived too
  })

  it('degrade is idempotent: a second failure does not re-copy stale disk over fresh memory writes', async () => {
    const fake = new FakeLocalStorage()
    ;(globalThis as { localStorage?: unknown }).localStorage = fake
    const adapter = new LocalStorageAdapter()
    await adapter.setItem('roomio.design.x', 'v1')

    fake.failSet = true
    await adapter.setItem('roomio.design.x', 'v2') // degrade #1: seeds v1, then writes v2 → v2
    expect(await adapter.getItem('roomio.design.x')).toBe('v2')

    await adapter.setItem('roomio.design.x', 'v3') // already memory; just writes v3
    expect(await adapter.getItem('roomio.design.x')).toBe('v3') // not clobbered back to stale v1
  })
})
