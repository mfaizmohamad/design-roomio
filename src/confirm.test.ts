import { describe, it, expect, beforeEach } from 'vitest'
import { useConfirm, confirmDialog } from './confirm'

// WIZ-04 / CODE-16 — the in-app confirm dialog is a promise-based replacement
// for native confirm(). These cover the store contract the UI relies on.

beforeEach(() => {
  useConfirm.setState({ current: null })
})

describe('confirmDialog', () => {
  it('opens a request and resolves true when confirmed', async () => {
    const p = confirmDialog({ title: 'Delete?' })
    expect(useConfirm.getState().current?.title).toBe('Delete?')
    useConfirm.getState().resolve(true)
    await expect(p).resolves.toBe(true)
    expect(useConfirm.getState().current).toBeNull()
  })

  it('resolves false when cancelled', async () => {
    const p = confirmDialog({ title: 'Delete?' })
    useConfirm.getState().resolve(false)
    await expect(p).resolves.toBe(false)
  })

  it('never stacks: a second request cancels the first', async () => {
    const first = confirmDialog({ title: 'First' })
    const second = confirmDialog({ title: 'Second' })
    await expect(first).resolves.toBe(false)
    expect(useConfirm.getState().current?.title).toBe('Second')
    useConfirm.getState().resolve(true)
    await expect(second).resolves.toBe(true)
  })
})
