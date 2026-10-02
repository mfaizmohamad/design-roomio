import { describe, it, expect, beforeAll } from 'vitest'
import { architecturalMaps, surfaceMaps, offsetMaps, _cacheSizes, type SurfaceMaps } from './furnitureTextures'
import { getFloorTexture } from './textures'
import { FLOOR_TEXTURES } from '../data/materials'

// The map builders need a DOM canvas. THREE.CanvasTexture only STORES the canvas
// as `.image` (it never rasterises here), and our generators write pixels via
// ImageData only — so a minimal stub canvas/2d-context is enough to exercise the
// real caching + texture-sharing logic without jsdom or a GPU.
beforeAll(() => {
  const ctx = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  }
  ;(globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`canvas stub: unexpected <${tag}>`)
      return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:,' }
    },
  }
})

const MARBLE = { tint: '#bcbdb6', accent: '#8f9188', gloss: 0.9 } as const

describe('architecturalMaps caching + texture sharing (VRAM bounded)', () => {
  it('returns the SAME cached map-set for identical (kind, params)', () => {
    const a = architecturalMaps('marble', MARBLE)!
    const b = architecturalMaps('marble', MARBLE)!
    expect(a).not.toBeNull()
    expect(a).toBe(b) // identity → no re-allocation, no extra GPU upload
    expect(a.map).toBe(b.map)
    expect(a.normalMap).toBe(b.normalMap)
    expect(a.roughnessMap).toBe(b.roughnessMap)
  })

  it('emits albedo + +Y normal + roughness with the ratified colour spaces', () => {
    const m = architecturalMaps('tile', { tint: '#e8e6e1', accent: '#cfccc4', gloss: 0.3 })!
    expect(m.map.colorSpace).toBe('srgb') // albedo = sRGB
    // data maps stay linear (NoColorSpace = '' , the three default)
    expect(m.normalMap.colorSpace).toBe('')
    expect(m.roughnessMap.colorSpace).toBe('')
    expect(m.map.image.width).toBeGreaterThan(0)
    expect(m.map.image.width).toBeLessThanOrEqual(2048)
  })

  it('gloss is quantised so near-identical gloss collapses to one cache entry', () => {
    const a = architecturalMaps('marble', { ...MARBLE, gloss: 0.901 })!
    const b = architecturalMaps('marble', { ...MARBLE, gloss: 0.904 })!
    expect(a).toBe(b)
  })

  it('distinct finishes get distinct entries; re-requesting does NOT grow the cache', () => {
    const before = _cacheSizes().arch
    // Build every catalogued floor finish once…
    for (const f of FLOOR_TEXTURES) getFloorTexture(f.id)
    const afterFirst = _cacheSizes().arch
    expect(afterFirst).toBeGreaterThan(before)
    // …then simulate 50 ROOMS each re-requesting every finish. The cache must not grow.
    for (let room = 0; room < 50; room++) {
      for (const f of FLOOR_TEXTURES) getFloorTexture(f.id)
    }
    expect(_cacheSizes().arch).toBe(afterFirst)
  })

  it('getFloorTexture returns identical texture objects across rooms (texture count is constant)', () => {
    const sources = new Set<unknown>()
    for (let room = 0; room < 25; room++) {
      const built = getFloorTexture('glossy-marble')
      // every room shares the very same GPU-backed texture objects
      expect(built.texture).toBe(getFloorTexture('glossy-marble').texture)
      sources.add(built.texture.source)
      sources.add(built.normalMap!.source)
      sources.add(built.roughnessMap!.source)
    }
    expect(sources.size).toBe(3) // exactly {albedo, normal, roughness} — never × room count
  })
})

describe('offsetMaps (clad-wall continuity) shares ONE upload across parts', () => {
  it('clones share the base Source (repeat/offset are not in three\'s texture cache key)', () => {
    const base = architecturalMaps('marble', MARBLE)!
    const partA = offsetMaps('clad:x', base, 2, 1, 0, 0)
    const partB = offsetMaps('clad:x', base, 2, 1, 0.5, 0)
    // different registrations → different sampler wrappers…
    expect(partA.map).not.toBe(partB.map)
    // …but the SAME underlying Source as the base (→ one GPU texture for all parts)
    expect(partA.map.source).toBe(base.map.source)
    expect(partB.map.source).toBe(base.map.source)
    expect(partA.normalMap.source).toBe(base.normalMap.source)
  })

  it('identical registrations across parts/rooms collapse to one cached wrapper', () => {
    const base = architecturalMaps('marble', MARBLE)!
    const a = offsetMaps('clad:y', base, 3, 2, 0.25, 0.1)
    const b = offsetMaps('clad:y', base, 3, 2, 0.25, 0.1)
    expect(a).toBe(b)
  })
})

describe('furniture surfaceMaps still shares its base source per family', () => {
  it('two world-space repeats of a family reuse the one base upload', () => {
    const a = surfaceMaps('fabric', 4, 4) as SurfaceMaps
    const b = surfaceMaps('fabric', 6, 6) as SurfaceMaps
    expect(a.map).not.toBe(b.map) // different repeat wrapper
    expect(a.map.source).toBe(b.map.source) // same base GPU source
  })
})
