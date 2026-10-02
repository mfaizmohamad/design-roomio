import { describe, it, expect } from 'vitest'
import { DesignRepository } from './repository'
import { InMemoryAdapter, LocalStorageAdapter, FlakyAdapter } from './adapter'
import { createDesign } from '../envelope/factory'
import type { House } from '../scene/slices'

function house(name = 'My home'): House {
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
          id: 'r1',
          name,
          unit: 'ft',
          shape: 'rect',
          corners: [
            { x: 0, z: 0 },
            { x: 400, z: 0 },
            { x: 400, z: 360 },
            { x: 0, z: 360 },
          ],
          wallHeight: 270,
          wallThickness: 12,
          openings: [],
          materials: { wallColor: '#fff', floorTexture: 'oak' },
          furniture: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ],
    connectors: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('DesignRepository', () => {
  it('saves, lists (newest first), loads, and removes', async () => {
    const repo = new DesignRepository(new InMemoryAdapter())
    const a = createDesign({ house: house('A'), name: 'A', now: 100 })
    const b = createDesign({ house: house('B'), name: 'B', now: 200 })
    await repo.save(a)
    await repo.save(b)

    const list = await repo.list()
    expect(list.map((s) => s.name)).toEqual(['B', 'A']) // newest updatedAt first
    expect(list[0].roomCount).toBe(1)

    const loaded = await repo.load(a.design_id)
    expect(loaded?.name).toBe('A')

    await repo.remove(a.design_id)
    expect(await repo.has(a.design_id)).toBe(false)
    expect((await repo.list()).map((s) => s.name)).toEqual(['B'])
  })

  it('list() skips corrupt entries instead of throwing', async () => {
    const adapter = new InMemoryAdapter()
    await adapter.setItem('roomio.design.bad', '{not json')
    const repo = new DesignRepository(adapter)
    await repo.save(createDesign({ house: house('ok'), name: 'ok', now: 1 }))
    const list = await repo.list()
    expect(list.map((s) => s.name)).toEqual(['ok'])
  })
})

describe('LocalStorageAdapter fallback', () => {
  it('degrades to in-memory and keeps data when localStorage is absent', async () => {
    // node test env: localStorage is undefined → adapter starts in 'memory' mode
    const adapter = new LocalStorageAdapter()
    expect(adapter.kind).toBe('memory')
    await adapter.setItem('roomio.design.x', 'payload')
    expect(await adapter.getItem('roomio.design.x')).toBe('payload') // NOT dropped
  })
})

describe('FlakyAdapter (save-failure simulation)', () => {
  it('rejects setItem the configured number of times, then succeeds', async () => {
    const flaky = new FlakyAdapter(2)
    await expect(flaky.setItem('k', 'v')).rejects.toThrow()
    await expect(flaky.setItem('k', 'v')).rejects.toThrow()
    await expect(flaky.setItem('k', 'v')).resolves.toBeUndefined()
    expect(await flaky.getItem('k')).toBe('v')
  })
})
