import * as THREE from 'three'
import { FLOOR_MAP, type FloorTexture } from '../data/materials'
import { architecturalMaps, type SurfaceKind } from './furnitureTextures'

// Procedural floor finishes — no external image assets. Each floor id resolves
// to a PBR finish family (SurfaceKind) and is synthesised into a full map-set:
//   { texture(=albedo, sRGB), normalMap(+Y), roughnessMap(spatially-varying) }
// The map-set is cached (module-level, by finish params) inside furnitureTextures,
// so two rooms with the same floor share ONE GPU upload. `areaCm` is the world
// size one texture tile covers; the floor mesh sets its UVs = worldCm / areaCm so
// the physical scale stays real (the maps keep repeat = 1 and tile via those UVs).

function seedOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface Built {
  /** albedo (sRGB) — kept as `texture` for backwards-compat with existing sites */
  texture: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture | null
  roughnessMap: THREE.CanvasTexture | null
  normalScale: THREE.Vector2 | null
  /** world-cm covered by one texture tile (floor mesh UV = worldCm / areaCm) */
  areaCm: number
}

// Finish family for a floor def: explicit `surface`, else derived from kind/flags.
function surfaceOf(def: FloorTexture): SurfaceKind {
  if (def.surface) return def.surface
  if (def.kind === 'wood') return 'wood'
  if (def.kind === 'concrete') return 'stone'
  if (def.veined) return 'marble'
  return 'tile'
}

// Gloss (0 matte → 1 mirror) inverted from the material's target roughness so the
// generated roughness map lands on the same value the flat scalar used to.
function glossOf(def: FloorTexture): number {
  const r = def.roughness ?? 0.82
  return Math.max(0, Math.min(1, (0.9 - r) / 0.82))
}

// Tiling: pick a world size per tile + the grid/plank count, per finish family.
function tilingOf(def: FloorTexture, kind: SurfaceKind): { areaCm: number; tiles: number } {
  if (kind === 'wood' || kind === 'laminate') {
    const areaCm = def.cell * 14
    return { areaCm, tiles: Math.max(3, Math.round(areaCm / 20)) } // ~20cm plank rows
  }
  if (kind === 'stone') return { areaCm: 500, tiles: 1 }
  if (kind === 'marble') return { areaCm: def.cell * 4, tiles: 1 } // continuous slab
  if (kind === 'ceramic') return { areaCm: def.cell * 3, tiles: 3 } // large-format
  return { areaCm: def.cell * 4, tiles: 4 } // tile grid
}

function patternOf(def: FloorTexture): 'plain' | 'checker' | 'speckle' {
  if (def.speckled) return 'speckle'
  if (def.id === 'check-tile') return 'checker'
  return 'plain'
}

const cache = new Map<string, Built>()

function build(def: FloorTexture): Built {
  const kind = surfaceOf(def)
  const { areaCm, tiles } = tilingOf(def, kind)
  const maps = architecturalMaps(kind, {
    tint: def.base,
    accent: def.accent,
    gloss: glossOf(def),
    tiles,
    pattern: patternOf(def),
    seed: seedOf(def.id),
  })
  if (!maps) {
    // SSR / no-DOM: a bare placeholder texture keeps callers type-safe.
    const tex = new THREE.Texture()
    return { texture: tex as unknown as THREE.CanvasTexture, normalMap: null, roughnessMap: null, normalScale: null, areaCm }
  }
  return {
    texture: maps.map,
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
    normalScale: maps.normalScale,
    areaCm,
  }
}

export function getFloorTexture(id: string): Built {
  const cached = cache.get(id)
  if (cached) return cached
  const def = FLOOR_MAP[id] ?? FLOOR_MAP['natural-oak']
  const built = build(def)
  cache.set(id, built)
  return built
}

const thumbCache = new Map<string, string>()

/** Data-URL thumbnail of a floor texture for the swatch picker. */
export function getFloorThumb(id: string): string {
  const cached = thumbCache.get(id)
  if (cached) return cached
  const { texture } = getFloorTexture(id)
  const img = texture.image as HTMLCanvasElement | undefined
  const url = img && typeof img.toDataURL === 'function' ? img.toDataURL('image/png') : ''
  thumbCache.set(id, url)
  return url
}
