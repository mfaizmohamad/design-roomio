import { describe, it, expect } from 'vitest'
import { createDefaultRoomLights, applyWarmth } from './defaults'
import { roomLightingSatisfaction } from './contract'

const room = { id: 'r_living', centerM: [0, 0] as [number, number], wallHeightM: 2.7 }

describe('default room lights — never a dark box, and layered', () => {
  it('gives every room an ambient fill + a task ceiling light', () => {
    const lights = createDefaultRoomLights(room)
    expect(lights.length).toBeGreaterThanOrEqual(2)
    expect(lights.some((l) => l.layer === 'ambient')).toBe(true)
    expect(lights.some((l) => l.layer === 'task' && l.type === 'ceiling')).toBe(true)
    expect(lights.every((l) => l.isDefault)).toBe(true)
  })

  it('passes A\'s layered-lighting rule out of the box (hasLight + isLayered)', () => {
    const sat = roomLightingSatisfaction(createDefaultRoomLights(room))
    expect(sat.hasLight).toBe(true)
    expect(sat.isLayered).toBe(true)
  })

  it('hangs the ceiling light near the ceiling, at room center', () => {
    const ceil = createDefaultRoomLights(room).find((l) => l.type === 'ceiling')!
    expect(ceil.pos![0]).toBeCloseTo(0)
    expect(ceil.pos![2]).toBeCloseTo(0)
    expect(ceil.pos![1]).toBeGreaterThan(2.4)
    expect(ceil.pos![1]).toBeLessThanOrEqual(2.7)
  })

  it('room lights do not cast shadows by default (sun is primary caster)', () => {
    expect(createDefaultRoomLights(room).every((l) => !l.castShadow)).toBe(true)
  })

  it('withAccent adds a third layer -> fully layered', () => {
    const lights = createDefaultRoomLights({ ...room, withAccent: true, halfSpanM: 2 })
    const sat = roomLightingSatisfaction(lights)
    expect(sat.isFullyLayered).toBe(true)
    expect(sat.layers).toEqual({ ambient: 1, task: 1, accent: 1 })
  })

  it('warm default ceiling is cozier (red-leaning) than a cool swap', () => {
    const warm = createDefaultRoomLights(room).find((l) => l.type === 'ceiling')!
    const cool = applyWarmth(createDefaultRoomLights(room), 'cool').find((l) => l.type === 'ceiling')!
    const rb = (h: string) => parseInt(h.slice(1, 3), 16) - parseInt(h.slice(5, 7), 16)
    expect(rb(warm.color)).toBeGreaterThan(rb(cool.color))
  })
})

describe('roomLightingSatisfaction — A\'s rule predicate', () => {
  it('empty room: no light, not layered', () => {
    expect(roomLightingSatisfaction([])).toMatchObject({ hasLight: false, isLayered: false })
  })

  it('single overhead (task only, no ambient): has light but NOT layered', () => {
    const sat = roomLightingSatisfaction([
      { id: 'x', type: 'ceiling', layer: 'task', color: '#fff', intensity: 1 },
    ])
    expect(sat.hasLight).toBe(true)
    expect(sat.isLayered).toBe(false)
  })

  it('ignores disabled / zero-intensity lights', () => {
    const sat = roomLightingSatisfaction([
      { id: 'a', type: 'hemisphere', layer: 'ambient', color: '#fff', intensity: 0 },
      { id: 'b', type: 'ceiling', layer: 'task', color: '#fff', intensity: 1, enabled: false },
    ])
    expect(sat.hasLight).toBe(false)
  })
})
