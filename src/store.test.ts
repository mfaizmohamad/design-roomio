import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, newDesign } from './store'
import { ARCHETYPE_MAP } from './data/archetypes'
import { bbox } from './geometry/walls'
import { MAX_WALL_CM } from './units'
import type { FurnitureItem, RoomDesign, Vec2 } from './types'

let n = 0
function place(archetype: string, x: number, z: number, extra: Partial<FurnitureItem> = {}): FurnitureItem {
  const a = ARCHETYPE_MAP[archetype]
  return {
    id: `${archetype}-${n++}`,
    archetype: a.id,
    category: a.category,
    name: a.name,
    x,
    z,
    rotation: 0,
    w: a.w,
    d: a.d,
    h: a.h,
    color: a.color,
    ...extra,
  }
}

function designWith(furniture: FurnitureItem[]): RoomDesign {
  return { ...newDesign('rect'), furniture }
}

describe('mounted pieces follow their host when it moves', () => {
  beforeEach(() => {
    // big rectangular room so moves aren't clamped by walls
    useStore.setState({ interacting: false })
  })

  it('a table lamp travels with the side table it sits on (translation)', () => {
    const table = place('table-side', 300, 300)
    const lamp = place('decor-lamp-table', 300, 300) // sits on the table
    useStore.getState().loadDesign(designWith([table, lamp]))

    useStore.getState().updateFurniture(table.id, { x: 360, z: 340 })
    const after = useStore.getState().design.furniture
    const movedLamp = after.find((f) => f.id === lamp.id)!
    expect(movedLamp.x).toBeCloseTo(360, 5)
    expect(movedLamp.z).toBeCloseTo(340, 5)
  })

  it('a locked lamp still follows its table (lock binds it to the surface)', () => {
    const table = place('table-side', 200, 200)
    const lamp = place('decor-lamp-table', 200, 200, { locked: true })
    useStore.getState().loadDesign(designWith([table, lamp]))

    useStore.getState().updateFurniture(table.id, { x: 250 })
    const movedLamp = useStore.getState().design.furniture.find((f) => f.id === lamp.id)!
    expect(movedLamp.x).toBeCloseTo(250, 5)
  })

  it('a TV rotates around its console when the console is rotated', () => {
    const console = place('storage-media', 300, 100)
    // TV offset 40cm to the right of the console center, resting on it
    const tv = place('decor-tv', 340, 100)
    useStore.getState().loadDesign(designWith([console, tv]))

    useStore.getState().updateFurniture(console.id, { rotation: Math.PI / 2 })
    const movedTv = useStore.getState().design.furniture.find((f) => f.id === tv.id)!
    // a +90° Y-rotation maps the +x offset (40,0) to (0,-40) under the app's
    // footprint convention → TV ends up 40cm toward -z of the console center.
    expect(movedTv.x).toBeCloseTo(300, 3)
    expect(movedTv.z).toBeCloseTo(60, 3)
    expect(movedTv.rotation).toBeCloseTo(Math.PI / 2, 5)
  })

  it('a free-standing item is NOT dragged by an unrelated move', () => {
    const table = place('table-side', 100, 100)
    const farLamp = place('decor-lamp-table', 480, 360) // not on the table
    useStore.getState().loadDesign(designWith([table, farLamp]))

    useStore.getState().updateFurniture(table.id, { x: 140 })
    const lamp = useStore.getState().design.furniture.find((f) => f.id === farLamp.id)!
    expect(lamp.x).toBeCloseTo(480, 5)
    expect(lamp.z).toBeCloseTo(360, 5)
  })
})

describe('setCorners — whole-footprint resize (used by the plan-view room resize)', () => {
  const rect = (w: number, l: number): Vec2[] => [
    { x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: l }, { x: 0, z: l },
  ]

  it('replaces the footprint, re-derives walls, and is undoable', () => {
    useStore.getState().loadDesign(newDesign('rect'))
    useStore.getState().setCorners(rect(700, 500))
    const bb = bbox(useStore.getState().design.corners)
    expect([bb.w, bb.d]).toEqual([700, 500])
    expect(useStore.getState().walls).toHaveLength(4) // walls re-derived from the new corners
    useStore.getState().undo()
    // undo restores the previous footprint (default rect is not 700×500)
    const restored = bbox(useStore.getState().design.corners)
    expect(restored.w === 700 && restored.d === 500).toBe(false)
  })

  it('rejects a degenerate (near-zero-area) polygon', () => {
    useStore.getState().loadDesign(newDesign('rect'))
    const before = useStore.getState().design.corners
    useStore.getState().setCorners(rect(2, 2)) // area 4 cm² « the 1000 guard
    expect(useStore.getState().design.corners).toBe(before) // unchanged
  })

  it('rejects an over-large footprint (bbox beyond the framable max)', () => {
    useStore.getState().loadDesign({ ...newDesign('rect'), corners: rect(600, 400) })
    const before = useStore.getState().design.corners
    useStore.getState().setCorners(rect(50000, 400)) // 500 m wide » MAX_WALL_CM
    expect(useStore.getState().design.corners).toBe(before) // unchanged
  })
})

// ---------------------------------------------------------------------------
// setWallLength — WIZ-02 / CODE-09: a typed wall length can never blank the view
// ---------------------------------------------------------------------------

describe('setWallLength — clamps to the framable range', () => {
  const rect = (w: number, l: number): Vec2[] => [
    { x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: l }, { x: 0, z: l },
  ]

  it('clamps an absurd length (999999) so the footprint stays within the max', () => {
    useStore.getState().loadDesign({ ...newDesign('rect'), corners: rect(600, 400) })
    const wallId = useStore.getState().walls[0].id // bottom edge, length 600 along x
    useStore.getState().setWallLength(wallId, 999999)
    const bb = bbox(useStore.getState().design.corners)
    expect(bb.w).toBeLessThanOrEqual(MAX_WALL_CM)
    expect(bb.d).toBeLessThanOrEqual(MAX_WALL_CM)
    expect(bb.w).toBe(MAX_WALL_CM) // grew up to the ceiling, not past it
  })

  it('applies a sane wall length normally', () => {
    useStore.getState().loadDesign({ ...newDesign('rect'), corners: rect(600, 400) })
    const wallId = useStore.getState().walls[0].id
    useStore.getState().setWallLength(wallId, 500)
    const after = useStore.getState().walls.find((w) => w.id === wallId)!.length
    expect(after).toBeCloseTo(500, 0)
  })

  it('never corrupts the footprint with NaN when fed a NaN length', () => {
    useStore.getState().loadDesign({ ...newDesign('rect'), corners: rect(600, 400) })
    const wallId = useStore.getState().walls[0].id
    useStore.getState().setWallLength(wallId, NaN)
    const c = useStore.getState().design.corners
    expect(c.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true)
  })
})
