/**
 * Agent H — procedural "photo" generator for the demo harness + deterministic headless
 * verify. Produces a LIT, textured RGBAImage that stands in for a user's furniture photo, so
 * the full pipeline (crop → seamless → de-light → PBR) can run with no external asset. Uses a
 * seeded PRNG so output is stable per seed (mirrors src/three/textures.ts's deterministic style).
 */
import { type RGBAImage, makeImage, clampInt } from './image'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A directional lighting gradient baked across the image (what de-light must remove). */
function bakeLighting(x: number, y: number, w: number, h: number): number {
  const gx = x / (w - 1)
  const gy = y / (h - 1)
  return 0.7 + 0.5 * gx - 0.15 * gy // ~0.55 .. 1.2 multiplier
}

export interface SynthOptions {
  width?: number
  height?: number
  seed?: number
}

/** A woven fabric swatch (fine cross-hatch weave) under a lighting gradient. */
export function syntheticFabricPhoto(base: [number, number, number] = [150, 95, 80], opts: SynthOptions = {}): RGBAImage {
  const w = opts.width ?? 256
  const h = opts.height ?? 200
  const rnd = mulberry32(opts.seed ?? 1)
  const img = makeImage(w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // weave: two offset thread directions + a little noise
      const weave = (Math.sin(x * 0.9) + Math.sin(y * 0.9)) * 6 + (rnd() - 0.5) * 10
      const L = bakeLighting(x, y, w, h)
      const i = (y * w + x) * 4
      d[i] = clampInt((base[0] + weave) * L, 0, 255)
      d[i + 1] = clampInt((base[1] + weave) * L, 0, 255)
      d[i + 2] = clampInt((base[2] + weave) * L, 0, 255)
      d[i + 3] = 255
    }
  }
  return img
}

/** A wood plank swatch (directional grain) under a lighting gradient. */
export function syntheticWoodPhoto(base: [number, number, number] = [150, 110, 70], opts: SynthOptions = {}): RGBAImage {
  const w = opts.width ?? 256
  const h = opts.height ?? 200
  const rnd = mulberry32(opts.seed ?? 7)
  const img = makeImage(w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // grain runs along x; stronger, lower-frequency than fabric weave
      const grain = Math.sin(y * 0.55 + Math.sin(x * 0.05) * 2) * 22 + (rnd() - 0.5) * 8
      const L = bakeLighting(x, y, w, h)
      const i = (y * w + x) * 4
      d[i] = clampInt((base[0] + grain) * L, 0, 255)
      d[i + 1] = clampInt((base[1] + grain * 0.8) * L, 0, 255)
      d[i + 2] = clampInt((base[2] + grain * 0.5) * L, 0, 255)
      d[i + 3] = 255
    }
  }
  return img
}
