import { describe, it, expect } from 'vitest'
import { migrateToEnvelope } from './migrate'
import { exportRoomio, importRoomio } from './serialize'
import { createDesign, duplicateDesign } from './factory'
import type { House, RoomDesign } from '../scene/slices'

// ── fixtures ──

function interior(id = 'room-1', name = 'Bedroom'): RoomDesign {
  return {
    id,
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
    materials: { wallColor: '#e9e6df', floorTexture: 'oak' },
    furniture: [
      {
        id: 'f1',
        archetype: 'bed-queen',
        category: 'bed',
        name: 'Queen Bed',
        x: 200,
        z: 180,
        rotation: 0,
        w: 165,
        d: 212,
        h: 50,
        color: '#cccccc',
      },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

function house(name = 'My home'): House {
  return {
    schema_version: '1.0',
    house_id: 'house-1',
    name,
    rooms: [
      {
        room_id: 'room-1',
        type: 'bedroom',
        footprint: { shape: 'rectangular', x: 0, z: 0, rotation: 0, w: 400, l: 360 },
        interior: interior(),
      },
    ],
    connectors: [],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('migrateToEnvelope — backward compatibility', () => {
  it('loads a bare single-room RoomDesign (today’s save) as a one-room house', () => {
    const env = migrateToEnvelope(interior())
    expect(env).not.toBeNull()
    expect(env!.schema_version).toBe('1.0')
    expect(env!.scene.house.rooms).toHaveLength(1)
    expect(env!.scene.house.rooms[0].interior.id).toBe('room-1')
    expect(env!.scene.house.connectors).toEqual([])
    expect(env!.scene.lighting).toBeNull()
    expect(env!.share.access).toBe('private')
  })

  it('loads a bare House (multi-room save)', () => {
    const env = migrateToEnvelope(house())
    expect(env).not.toBeNull()
    expect(env!.scene.house.rooms).toHaveLength(1)
    expect(env!.name).toBe('My home')
  })

  it('loads Agent A’s localStorage design-map and wraps the newest', () => {
    const map = {
      'room-old': interior('room-old', 'Old'),
      'room-new': { ...interior('room-new', 'New'), updatedAt: 9999 },
    }
    const env = migrateToEnvelope(map)
    expect(env).not.toBeNull()
    expect(env!.scene.house.rooms[0].interior.id).toBe('room-new')
  })

  it('returns null for unrecognizable junk', () => {
    expect(migrateToEnvelope(null)).toBeNull()
    expect(migrateToEnvelope(42)).toBeNull()
    expect(migrateToEnvelope({ nonsense: true })).toBeNull()
  })
})

describe('envelope round-trip', () => {
  it('survives export -> import byte-equivalently', () => {
    const env = createDesign({ house: house(), name: 'My design', now: 5000 })
    const restored = importRoomio(exportRoomio(env))
    expect(restored).not.toBeNull()
    expect(restored).toEqual(env)
  })

  it('preserves lighting (Agent E slice) as an opaque pass-through', () => {
    const lighting = {
      version: '1.0',
      timeOfDay: 0.42,
      northOffsetDeg: 90,
      sun: { enabled: true, maxElevationDeg: 55 },
      rooms: { 'room-1': { lights: [{ id: 'ceil_1', layer: 'task' }] } },
      // an unknown future field must survive
      futureField: { nested: [1, 2, 3] },
    }
    const env = createDesign({ house: house(), lighting, now: 5000 })
    const restored = importRoomio(exportRoomio(env))
    expect(restored!.scene.lighting).toEqual(lighting)
  })

  it('preserves unknown top-level fields AND the source version from a newer Roomio (forward-compat)', () => {
    const env = createDesign({ house: house(), now: 5000 }) as unknown as Record<string, unknown>
    env.schema_version = '2.0' // a future format
    env.experimental_flag = 'keep me'
    env.settings_v2 = { theme: 'dark' }
    const restored = importRoomio(JSON.stringify(env)) as unknown as Record<string, unknown>
    expect(restored).not.toBeNull()
    // unknown fields survive the round-trip (contract: additive + forward-compatible)
    expect(restored.experimental_flag).toBe('keep me')
    expect(restored.settings_v2).toEqual({ theme: 'dark' })
    // version is NOT silently downgraded to 1.0
    expect(restored.schema_version).toBe('2.0')
  })

  it('history reload uses the runtime cap + preserves manual checkpoints (no recency-only drop)', () => {
    const base = createDesign({ house: house(), now: 1 }) as unknown as Record<string, unknown>
    const hist: unknown[] = []
    // a manual checkpoint at the OLDEST position, then 25 autos (well over the cap)
    hist.push({ rev: 1, at: 1, kind: 'manual', label: 'golden', scene: { house: house('golden') }, thumbnail: null })
    for (let i = 0; i < 25; i++) hist.push({ rev: i + 2, at: i + 2, kind: 'auto', scene: { house: house() }, thumbnail: null })
    base.history = hist
    const restored = importRoomio(JSON.stringify(base))
    expect(restored).not.toBeNull()
    const h = restored!.history!
    expect(h.length).toBeLessThanOrEqual(15) // runtime MAX_HISTORY, not 20
    // the oldest manual checkpoint must survive a recency cut
    expect(h.some((s) => s.kind === 'manual' && s.label === 'golden')).toBe(true)
  })
})

describe('duplicate', () => {
  it('creates an independent, private copy with a new id', () => {
    const a = createDesign({ house: house(), name: 'Living', now: 1 })
    a.share = { access: 'view', view_link_id: 'tok', edit_link_id: null }
    const b = duplicateDesign(a, 2)
    expect(b.design_id).not.toBe(a.design_id)
    expect(b.name).toBe('Living (copy)')
    expect(b.share.access).toBe('private')
    expect(b.share.view_link_id).toBeNull()
    // deep clone: mutating the copy must not touch the original
    b.scene.house.rooms[0].interior.name = 'Mutated'
    expect(a.scene.house.rooms[0].interior.name).toBe('Bedroom')
  })
})
