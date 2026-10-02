import { describe, it, expect } from 'vitest'
import { InMemoryAdapter } from './adapter'
import { DesignRepository } from './repository'
import { importLegacyDesigns, LEGACY_KEY } from './legacy'
import type { RoomDesign } from '../scene/slices'

function bareRoom(id: string, name: string): RoomDesign {
  return {
    id,
    name,
    unit: 'ft',
    shape: 'rect',
    corners: [{ x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 360 }, { x: 0, z: 360 }],
    wallHeight: 270,
    wallThickness: 12,
    openings: [],
    materials: { wallColor: '#e9e6df', floorTexture: 'oak' },
    furniture: [],
    createdAt: 1,
    updatedAt: 2,
  }
}

describe('legacy import (old single-room saves still load)', () => {
  it('wraps A’s localStorage design-map into the new library, once, non-destructively', async () => {
    const adapter = new InMemoryAdapter()
    const legacy = { 'room-a': bareRoom('room-a', 'Old Bedroom'), 'room-b': bareRoom('room-b', 'Old Studio') }
    await adapter.setItem(LEGACY_KEY, JSON.stringify(legacy))
    const repo = new DesignRepository(adapter)

    const n = await importLegacyDesigns(repo, adapter)
    expect(n).toBe(2)

    const names = (await repo.list()).map((s) => s.name).sort()
    expect(names).toEqual(['Old Bedroom', 'Old Studio'])
    // each loaded as a one-room house
    const list = await repo.list()
    expect(list[0].roomCount).toBe(1)

    // non-destructive: the original key is untouched
    expect(await adapter.getItem(LEGACY_KEY)).not.toBeNull()

    // idempotent: a second run imports nothing
    expect(await importLegacyDesigns(repo, adapter)).toBe(0)
  })

  it('is a no-op when there is no legacy data', async () => {
    const adapter = new InMemoryAdapter()
    const repo = new DesignRepository(adapter)
    expect(await importLegacyDesigns(repo, adapter)).toBe(0)
  })
})
