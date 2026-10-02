import { describe, it, expect } from 'vitest'
import { makeSnapshot, pushHistory, capHistory, shouldAutoSnapshot, restoreFrom, MAX_HISTORY, AUTO_SNAPSHOT_GAP_MS } from './history'
import { createDesign } from './factory'
import type { House } from '../scene/slices'

function house(name = 'h'): House {
  return {
    schema_version: '1.0',
    house_id: 'h1',
    name,
    rooms: [
      {
        room_id: 'r1',
        type: 'bedroom',
        footprint: { shape: 'rectangular', x: 0, z: 0, rotation: 0, w: 400, l: 360 },
        interior: {
          id: 'r1', name, unit: 'cm', shape: 'rect',
          corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 360 }, { x: 0, z: 360 }],
          wallHeight: 270, wallThickness: 12, openings: [], materials: { wallColor: '#fff', floorTexture: 'oak' },
          furniture: [], createdAt: 1, updatedAt: 1,
        },
      },
    ],
    connectors: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('version history', () => {
  it('pushes snapshots and restores scene from a rev', () => {
    let d = createDesign({ house: house('v1'), now: 1 })
    d = { ...d, rev: 1 }
    d = pushHistory(d, makeSnapshot(d, 'manual', 100, 'first'))
    // edit the live scene
    d = { ...d, rev: 2, scene: { ...d.scene, house: house('v2') } }
    d = pushHistory(d, makeSnapshot(d, 'manual', 200))
    expect(d.history).toHaveLength(2)

    const restored = restoreFrom(d, 1)
    expect(restored).not.toBeNull()
    expect(restored!.scene.house.name).toBe('v1') // rolled back to rev 1's scene
    expect(restored!.history).toHaveLength(2) // history preserved, not destroyed
  })

  it('restore is a deep copy (mutating restored scene does not touch the snapshot)', () => {
    let d = createDesign({ house: house('orig'), now: 1 })
    d = pushHistory({ ...d, rev: 1 }, makeSnapshot({ ...d, rev: 1 }, 'manual', 100))
    const restored = restoreFrom(d, 1)!
    restored.scene.house.rooms[0].interior.name = 'mutated'
    expect(d.history![0].scene.house.rooms[0].interior.name).toBe('orig')
  })

  it('throttles automatic snapshots by the gap', () => {
    let d = createDesign({ house: house(), now: 0 })
    d = { ...d, rev: 1 }
    expect(shouldAutoSnapshot(d, 1000)).toBe(true) // none yet
    d = pushHistory(d, makeSnapshot(d, 'auto', 1000))
    expect(shouldAutoSnapshot(d, 1000 + AUTO_SNAPSHOT_GAP_MS - 1)).toBe(false)
    expect(shouldAutoSnapshot(d, 1000 + AUTO_SNAPSHOT_GAP_MS)).toBe(true)
  })

  it('caps history, preferentially dropping oldest autos over manual checkpoints', () => {
    const base = createDesign({ house: house(), now: 1 })
    const snaps = []
    // 10 autos then 10 manuals → 20 total, cap 15, should keep all 10 manuals + 5 newest autos
    for (let i = 0; i < 10; i++) snaps.push(makeSnapshot({ ...base, rev: i + 1 }, 'auto', i))
    for (let i = 0; i < 10; i++) snaps.push(makeSnapshot({ ...base, rev: 100 + i }, 'manual', 100 + i, `m${i}`))
    const capped = capHistory(snaps)
    expect(capped.length).toBe(MAX_HISTORY)
    expect(capped.filter((s) => s.kind === 'manual')).toHaveLength(10)
    expect(capped.filter((s) => s.kind === 'auto')).toHaveLength(5)
  })
})
