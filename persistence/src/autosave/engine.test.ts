import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AutosaveController } from './engine'
import type { SaveStatus } from './status'

/** A controllable save fn: records calls, fails the next N saves on demand. */
function makeSaver() {
  const calls: string[] = []
  let failsRemaining = 0
  return {
    calls,
    /** Make the next `n` saves throw; subsequent ones succeed. */
    failNext(n: number) {
      failsRemaining = n
    },
    /** Stop failing immediately. */
    recover() {
      failsRemaining = 0
    },
    save: async (v: string) => {
      calls.push(v)
      if (failsRemaining > 0) {
        failsRemaining--
        throw new Error('boom')
      }
    },
  }
}

let statuses: SaveStatus[]
beforeEach(() => {
  vi.useFakeTimers()
  statuses = []
})
afterEach(() => {
  vi.useRealTimers()
})

function controller(saver: { save: (v: string) => Promise<void> }, debounceMs = 1500) {
  return new AutosaveController<string>({
    save: saver.save,
    debounceMs,
    backoffMs: [1000, 2000],
    onStatus: (s) => statuses.push({ ...s }),
    now: () => 1_000_000,
  })
}

describe('AutosaveController — debounce', () => {
  it('coalesces a burst of edits into a single save after the quiet period', async () => {
    const saver = makeSaver()
    const c = controller(saver)
    c.markDirty('a')
    c.markDirty('ab')
    c.markDirty('abc')
    expect(saver.calls).toHaveLength(0) // nothing yet — still debouncing
    await vi.advanceTimersByTimeAsync(1500)
    expect(saver.calls).toEqual(['abc']) // one save, newest value
    expect(c.status.phase).toBe('saved')
    expect(c.status.savedAt).toBe(1_000_000)
    expect(c.hasUnsaved()).toBe(false)
  })

  it('does not save before the debounce window elapses', async () => {
    const saver = makeSaver()
    const c = controller(saver)
    c.markDirty('x')
    await vi.advanceTimersByTimeAsync(1499)
    expect(saver.calls).toHaveLength(0)
    expect(c.status.phase).toBe('dirty')
  })
})

describe('AutosaveController — manual save', () => {
  it('saveNow() flushes immediately, bypassing the debounce', async () => {
    const saver = makeSaver()
    const c = controller(saver)
    c.markDirty('hello')
    await c.saveNow()
    expect(saver.calls).toEqual(['hello'])
    expect(c.status.phase).toBe('saved')
  })
})

describe('AutosaveController — coalescing mid-flight', () => {
  it('re-saves the newest value when an edit arrives during an in-flight save', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const calls: string[] = []
    const c = controller({
      save: async (v: string) => {
        calls.push(v)
        if (calls.length === 1) await gate // hold the first save open
      },
    })
    c.markDirty('v1')
    await vi.advanceTimersByTimeAsync(1500) // first save starts, awaiting gate
    expect(calls).toEqual(['v1'])
    expect(c.status.phase).toBe('saving')
    c.markDirty('v2') // edit during flight
    release() // let the first save finish
    await vi.advanceTimersByTimeAsync(0)
    await vi.runAllTimersAsync()
    expect(calls).toEqual(['v1', 'v2']) // newest persisted too
    expect(c.status.phase).toBe('saved')
  })
})

describe('AutosaveController — retry, never drop', () => {
  it('on failure: shows error+retrying, keeps data, retries with backoff until success', async () => {
    const saver = makeSaver()
    saver.failNext(2) // first two saves throw, third succeeds
    const c = controller(saver)
    c.markDirty('keep-me')
    await vi.advanceTimersByTimeAsync(1500) // attempt 1 → fail
    expect(c.status.phase).toBe('error')
    expect(c.status.retrying).toBe(true)
    expect(c.status.attempt).toBe(1)
    expect(c.hasUnsaved()).toBe(true) // data NOT dropped

    await vi.advanceTimersByTimeAsync(1000) // backoff[0] → attempt 2 → fail
    expect(c.status.attempt).toBe(2)
    expect(c.hasUnsaved()).toBe(true)

    await vi.advanceTimersByTimeAsync(2000) // backoff[1] → attempt 3 → succeed
    expect(c.status.phase).toBe('saved')
    expect(c.hasUnsaved()).toBe(false)
    expect(saver.calls).toEqual(['keep-me', 'keep-me', 'keep-me'])
  })

  it('a fresh edit during retry supersedes the retry (saves the newer value)', async () => {
    const saver = makeSaver()
    saver.failNext(1)
    const c = controller(saver)
    c.markDirty('old')
    await vi.advanceTimersByTimeAsync(1500) // fail
    expect(c.status.phase).toBe('error')
    c.markDirty('new') // supersede
    saver.recover()
    await vi.advanceTimersByTimeAsync(1500) // debounce → save 'new'
    expect(c.status.phase).toBe('saved')
    expect(saver.calls[saver.calls.length - 1]).toBe('new')
  })
})
