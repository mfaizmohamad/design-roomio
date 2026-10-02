import { describe, it, expect, beforeEach } from 'vitest'
import { furnitureLocked, showEditingHints } from './contract'
import { useLighting } from './store'

describe('Light Mode — furniture lock + hint visibility (E7 contract)', () => {
  it('furnitureLocked: locked when Light Mode is on, regardless of the item flag', () => {
    expect(furnitureLocked({ locked: false }, true)).toBe(true)
    expect(furnitureLocked({ locked: true }, true)).toBe(true)
    expect(furnitureLocked(undefined, true)).toBe(true)
  })

  it('furnitureLocked: off Light Mode -> follows the item\'s own locked flag (default state)', () => {
    expect(furnitureLocked({ locked: false }, false)).toBe(false)
    expect(furnitureLocked({}, false)).toBe(false)
    expect(furnitureLocked({ locked: true }, false)).toBe(true) // user-pinned stays pinned
  })

  it('showEditingHints: hidden in Light Mode, shown otherwise', () => {
    expect(showEditingHints(true)).toBe(false)
    expect(showEditingHints(false)).toBe(true)
  })
})

describe('Light Mode — store', () => {
  beforeEach(() => useLighting.setState({ lightMode: false, barVisible: false }))

  it('defaults off (furniture editable by default)', () => {
    expect(useLighting.getState().lightMode).toBe(false)
  })

  it('toggles on/off and reveals the time bar on enter', () => {
    useLighting.getState().toggleLightMode()
    expect(useLighting.getState().lightMode).toBe(true)
    expect(useLighting.getState().barVisible).toBe(true) // lighting UI surfaced
    useLighting.getState().toggleLightMode()
    expect(useLighting.getState().lightMode).toBe(false)
  })

  it('setLightMode is explicit and does not mutate furniture state (none here to mutate)', () => {
    useLighting.getState().setLightMode(true)
    expect(useLighting.getState().lightMode).toBe(true)
  })
})
