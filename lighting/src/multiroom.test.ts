import { describe, it, expect } from 'vitest'
import { makeDefaultLightingState } from './types'
import { createDefaultRoomLighting, type RoomLightInput } from './defaults'
import { roomLightingSatisfaction } from './contract'
import { sceneShadowCasterCount, scenePositionedLightCount, isPerformanceHealthy } from './perf'

function houseWith(n: number) {
  const state = makeDefaultLightingState()
  for (let i = 0; i < n; i++) {
    const input: RoomLightInput = { id: `r_${i}`, centerM: [i * 5, 0], wallHeightM: 2.7 }
    state.rooms[input.id] = createDefaultRoomLighting(input)
  }
  return state
}

describe('multi-room lighting (E6)', () => {
  it('lights every room per-room (each room is lit + layered)', () => {
    const state = houseWith(6)
    for (const room of Object.values(state.rooms)) {
      const sat = roomLightingSatisfaction(room.lights)
      expect(sat.hasLight).toBe(true)
      expect(sat.isLayered).toBe(true)
    }
  })

  it('shadow casters stay capped as rooms scale (sun is the only caster)', () => {
    for (const n of [1, 3, 10, 30]) {
      const state = houseWith(n)
      // exactly ONE shadow caster (the sun) no matter how many rooms
      expect(sceneShadowCasterCount(state)).toBe(1)
      expect(isPerformanceHealthy(state)).toBe(true)
    }
  })

  it('positioned light count scales linearly with rooms (one task light each), ambient is global', () => {
    const state = houseWith(8)
    // 8 ceiling task lights (ambient hemisphere lights are not "positioned" + rendered once globally)
    expect(scenePositionedLightCount(state)).toBe(8)
  })

  it('disabling the sun drops shadow casters to zero (rooms still lit)', () => {
    const state = houseWith(4)
    state.sun.enabled = false
    expect(sceneShadowCasterCount(state)).toBe(0)
    for (const room of Object.values(state.rooms)) {
      expect(roomLightingSatisfaction(room.lights).hasLight).toBe(true)
    }
  })

  it('an opt-in shadow-casting room light is counted (and stays within the cap)', () => {
    const state = houseWith(2)
    state.rooms.r_0.lights[1].castShadow = true // promote one ceiling light to a caster
    expect(sceneShadowCasterCount(state)).toBe(2) // sun + 1
    expect(isPerformanceHealthy(state)).toBe(true)
  })
})
