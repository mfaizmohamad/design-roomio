import { describe, it, expect, beforeEach } from 'vitest'
import {
  listDesigns,
  saveDesign,
  loadDesign,
  deleteDesign,
  exportDesignJSON,
  importDesignJSON,
} from './persistence'
import type { RoomDesign } from './types'

// ---------------------------------------------------------------------------
// In-memory localStorage stub (jsdom is not installed). Backed by a Map so the
// persistence module's localStorage.getItem/setItem/removeItem all work.
// ---------------------------------------------------------------------------

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null
  }
  get length(): number {
    return this.store.size
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDesign(over: Partial<RoomDesign> = {}): RoomDesign {
  return {
    id: 'design-1',
    name: 'My Living Room',
    unit: 'ft',
    shape: 'l',
    corners: [
      { x: 0, z: 0 },
      { x: 360, z: 0 },
      { x: 360, z: 180 },
      { x: 600, z: 180 },
      { x: 600, z: 400 },
      { x: 0, z: 400 },
    ],
    wallHeight: 270,
    wallThickness: 12,
    openings: [
      {
        id: 'op-1',
        kind: 'door',
        style: 'single',
        wallId: 'w0',
        t: 0.5,
        width: 90,
        height: 210,
        sill: 0,
      },
      {
        id: 'op-2',
        kind: 'window',
        style: 'windowSingle',
        wallId: 'w4',
        t: 0.4,
        width: 120,
        height: 120,
        sill: 90,
      },
    ],
    materials: { wallColor: '#eeeeee', floorTexture: 'oak' },
    furniture: [
      {
        id: 'f-1',
        archetype: 'sofa-3seat',
        category: 'sofa',
        name: 'Sofa',
        x: 200,
        z: 300,
        rotation: Math.PI / 2,
        w: 220,
        d: 90,
        h: 80,
        color: '#445566',
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// save → list → load round-trip
// ---------------------------------------------------------------------------

describe('saveDesign / listDesigns / loadDesign', () => {
  it('round-trips a full scene graph including furniture and openings', () => {
    const design = makeDesign()
    saveDesign(design)

    const loaded = loadDesign(design.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(design.id)
    expect(loaded!.name).toBe(design.name)
    expect(loaded!.shape).toBe(design.shape)
    expect(loaded!.corners).toEqual(design.corners)
    expect(loaded!.openings).toEqual(design.openings)
    expect(loaded!.furniture).toEqual(design.furniture)
    expect(loaded!.materials).toEqual(design.materials)
    expect(loaded!.wallHeight).toBe(design.wallHeight)
    expect(loaded!.wallThickness).toBe(design.wallThickness)
  })

  it('stamps updatedAt = now on save', () => {
    const before = Date.now()
    saveDesign(makeDesign({ updatedAt: 1 }))
    const loaded = loadDesign('design-1')!
    expect(loaded.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('listDesigns returns lightweight summaries newest-first', () => {
    saveDesign(makeDesign({ id: 'a', name: 'A', updatedAt: 1 }))
    saveDesign(makeDesign({ id: 'b', name: 'B', updatedAt: 1 }))

    // Force a known ordering by re-saving 'a' last so it has the newest stamp.
    saveDesign(loadDesign('a')!)

    const summaries = listDesigns()
    expect(summaries).toHaveLength(2)
    expect(summaries[0].id).toBe('a')
    // Summaries carry only the lightweight fields.
    expect(Object.keys(summaries[0]).sort()).toEqual(
      ['createdAt', 'id', 'name', 'shape', 'updatedAt'].sort(),
    )
  })

  it('loadDesign returns null for a missing id', () => {
    expect(loadDesign('does-not-exist')).toBeNull()
  })

  it('listDesigns is empty when nothing is stored', () => {
    expect(listDesigns()).toEqual([])
  })

  it('reports a browser storage failure instead of claiming a duplex was saved', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded') },
    }
    expect(() => saveDesign(makeDesign())).toThrow('quota exceeded')
  })
})

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('deleteDesign', () => {
  it('removes a saved design', () => {
    saveDesign(makeDesign({ id: 'x' }))
    expect(loadDesign('x')).not.toBeNull()
    deleteDesign('x')
    expect(loadDesign('x')).toBeNull()
    expect(listDesigns()).toEqual([])
  })

  it('is a no-op for an unknown id', () => {
    saveDesign(makeDesign({ id: 'keep' }))
    deleteDesign('nope')
    expect(loadDesign('keep')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// export / import round-trip + coercion
// ---------------------------------------------------------------------------

describe('exportDesignJSON / importDesignJSON', () => {
  it('rejects a damaged whole-house record instead of opening its one-room shell', () => {
    const damaged = { ...makeDesign(), house: { version: 1, rooms: [], activeId: 'lost' } }
    expect(importDesignJSON(JSON.stringify(damaged))).toBeNull()
  })
  it('round-trips through JSON', () => {
    const design = makeDesign()
    const json = exportDesignJSON(design)
    const back = importDesignJSON(json)
    expect(back).not.toBeNull()
    expect(back!.corners).toEqual(design.corners)
    expect(back!.furniture).toEqual(design.furniture)
    expect(back!.openings).toEqual(design.openings)
    expect(back!.materials).toEqual(design.materials)
  })

  it('exportDesignJSON produces pretty (indented) JSON', () => {
    const json = exportDesignJSON(makeDesign())
    expect(json).toContain('\n')
    expect(json).toContain('  ') // 2-space indent
    // It must be valid JSON.
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('returns null for malformed JSON', () => {
    expect(importDesignJSON('{ not json')).toBeNull()
    expect(importDesignJSON('')).toBeNull()
    expect(importDesignJSON('null')).toBeNull()
    expect(importDesignJSON('[]')).toBeNull()
    expect(importDesignJSON('42')).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    // missing materials
    const noMat = JSON.stringify({
      id: 'd',
      shape: 'rect',
      corners: [
        { x: 0, z: 0 },
        { x: 1, z: 0 },
        { x: 1, z: 1 },
      ],
    })
    expect(importDesignJSON(noMat)).toBeNull()

    // too few corners
    const fewCorners = JSON.stringify({
      id: 'd',
      shape: 'rect',
      corners: [{ x: 0, z: 0 }],
      materials: { wallColor: '#fff', floorTexture: 'oak' },
    })
    expect(importDesignJSON(fewCorners)).toBeNull()
  })

  it('coerces missing openings/furniture arrays to []', () => {
    const minimal = JSON.stringify({
      id: 'd',
      shape: 'rect',
      corners: [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
        { x: 0, z: 100 },
      ],
      materials: { wallColor: '#fff', floorTexture: 'oak' },
      // no openings, no furniture
    })
    const d = importDesignJSON(minimal)
    expect(d).not.toBeNull()
    expect(d!.openings).toEqual([])
    expect(d!.furniture).toEqual([])
    // sensible scalar defaults applied
    expect(d!.name).toBe('Untitled room')
    expect(d!.unit).toBe('ft')
    expect(d!.wallHeight).toBe(270)
    expect(d!.wallThickness).toBe(12)
  })

  it('coerces invalid (non-array) openings/furniture to []', () => {
    const bad = JSON.stringify({
      id: 'd',
      shape: 'rect',
      corners: [
        { x: 0, z: 0 },
        { x: 100, z: 0 },
        { x: 100, z: 100 },
        { x: 0, z: 100 },
      ],
      materials: { wallColor: '#fff', floorTexture: 'oak' },
      openings: 'nope',
      furniture: { not: 'an array' },
    })
    const d = importDesignJSON(bad)
    expect(d).not.toBeNull()
    expect(d!.openings).toEqual([])
    expect(d!.furniture).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// additive optional fields (view / ceiling / roomType / wallTexture …) —
// these must survive coercion so cloud loads (which now run through the same
// coerceDesign, CODE-06) don't silently strip a saved camera view etc.
// ---------------------------------------------------------------------------

describe('coerceDesign — additive optional fields', () => {
  const base = () => ({
    id: 'd',
    shape: 'rect',
    corners: [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ],
    materials: { wallColor: '#fff', floorTexture: 'oak' },
  })

  it('preserves a valid saved camera view', () => {
    const d = importDesignJSON(
      JSON.stringify({ ...base(), view: { cam: [1, 2, 3], target: [0, 0.7, 0] } }),
    )
    expect(d!.view).toEqual({ cam: [1, 2, 3], target: [0, 0.7, 0] })
  })

  it('drops a malformed view without rejecting the whole design', () => {
    const d = importDesignJSON(
      JSON.stringify({ ...base(), view: { cam: [1, 2], target: 'nope' } }),
    )
    expect(d).not.toBeNull()
    expect(d!.view).toBeUndefined()
  })

  it('preserves ceiling, roomType, personaGenre, autoDoorways, wallTexture', () => {
    const d = importDesignJSON(
      JSON.stringify({
        ...base(),
        materials: { wallColor: '#fff', floorTexture: 'oak', wallTexture: 'marble' },
        ceiling: { color: '#eee', texture: 'wood-planks', downlight: true },
        roomType: 'bedroom',
        personaGenre: 'scandi',
        autoDoorways: false,
      }),
    )
    expect(d!.materials.wallTexture).toBe('marble')
    expect(d!.ceiling).toEqual({ color: '#eee', texture: 'wood-planks', downlight: true })
    expect(d!.roomType).toBe('bedroom')
    expect(d!.personaGenre).toBe('scandi')
    expect(d!.autoDoorways).toBe(false)
  })

  it('drops an unknown roomType', () => {
    const d = importDesignJSON(JSON.stringify({ ...base(), roomType: 'dungeon' }))
    expect(d!.roomType).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// WIZ-01: the guest (localStorage) save → reload → load round-trip must
// preserve EVERY field the design model carries — camera view, roomType,
// personaGenre, ceiling and wallTexture were reported dropped. Both storage
// backends now funnel through coerceDesign, so this locks that field parity
// for the guest path specifically.
// ---------------------------------------------------------------------------

describe('WIZ-01 — guest save/load round-trips all additive fields', () => {
  function fullDesign(): RoomDesign {
    return makeDesign({
      id: 'guest-full',
      view: { cam: [3.2, 1.8, 4.1], target: [0, 0.7, 0] },
      roomType: 'bedroom',
      personaGenre: 'scandi',
      ceiling: { color: '#efeae2', texture: 'wood-planks', downlight: true },
      materials: { wallColor: '#e8e4de', floorTexture: 'oak', wallTexture: 'marble' },
    })
  }

  it('preserves view / roomType / personaGenre / ceiling / wallTexture', () => {
    const design = fullDesign()
    saveDesign(design)
    const loaded = loadDesign(design.id)!

    expect(loaded).not.toBeNull()
    expect(loaded.view).toEqual(design.view)
    expect(loaded.roomType).toBe(design.roomType)
    expect(loaded.personaGenre).toBe(design.personaGenre)
    expect(loaded.ceiling).toEqual(design.ceiling)
    expect(loaded.materials.wallTexture).toBe('marble')
  })

  it('round-trips the whole design equal (modulo the save-stamped updatedAt)', () => {
    const design = fullDesign()
    saveDesign(design)
    const loaded = loadDesign(design.id)!
    // updatedAt is intentionally re-stamped on save; everything else must match.
    const { updatedAt: _a, ...rest } = design
    const { updatedAt: _b, ...loadedRest } = loaded
    expect(loadedRest).toEqual(rest)
  })
})
