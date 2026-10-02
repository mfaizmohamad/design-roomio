import { describe, it, expect } from 'vitest'
import { makeImage, toLuminance, mean, luma, type RGBAImage } from './image'
import {
  normalizeBbox,
  bboxToPixels,
  cropRect,
  selectCleanPatch,
  extractSurfacePatch,
} from './crop'
import { offsetWrap, makeSeamless, wrapSeamScore } from './tile'
import { delight, illuminationSpread } from './delight'
import { roughnessMap, normalMap, inferSurfaceKind, derivePbr } from './pbr'

// ---- synthetic image helpers ----
function setPx(img: RGBAImage, x: number, y: number, r: number, g: number, b: number) {
  const i = (y * img.width + x) * 4
  img.data[i] = r
  img.data[i + 1] = g
  img.data[i + 2] = b
  img.data[i + 3] = 255
}
/** horizontal brightness ramp (constant hue), gray lo..hi */
function ramp(w: number, h: number, lo = 0, hi = 255): RGBAImage {
  const img = makeImage(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(lo + ((hi - lo) * x) / (w - 1))
      setPx(img, x, y, v, v, v)
    }
  return img
}
/** flat gray + a faint deterministic fine-detail checker (texture, not lighting) */
function texturedFlat(w: number, h: number, base = 130, amp = 8): RGBAImage {
  const img = makeImage(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = base + (((x + y) & 1) ? amp : -amp)
      setPx(img, x, y, v, v, v)
    }
  return img
}

describe('crop / bbox math (T1)', () => {
  it('normalizeBbox divides by the RESULT (downscaled) dims', () => {
    expect(normalizeBbox([25, 25, 50, 50], 100, 100)).toEqual({ fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 })
  })

  it('bboxToPixels rescales fractions onto the original full-res image', () => {
    const r = bboxToPixels({ fx: 0.25, fy: 0.25, fw: 0.5, fh: 0.5 }, 200, 200)
    expect(r).toEqual({ x: 50, y: 50, w: 100, h: 100 })
  })

  it('bboxToPixels clamps a rect that runs off the edge (B bbox can touch borders)', () => {
    const r = bboxToPixels({ fx: 0.9, fy: 0.9, fw: 0.5, fh: 0.5 }, 100, 100)
    expect(r.x).toBe(90)
    expect(r.w).toBe(10) // clamped to remaining width, never negative/zero
    expect(r.h).toBe(10)
  })

  it('cropRect extracts the right sub-image', () => {
    const img = ramp(10, 10, 0, 255)
    const c = cropRect(img, { x: 2, y: 0, w: 4, h: 4 })
    expect(c.width).toBe(4)
    expect(c.height).toBe(4)
    // first column of crop == column 2 of source
    expect(c.data[0]).toBe(img.data[(0 * 10 + 2) * 4])
  })

  it('selectCleanPatch avoids a dark shadow/silhouette band and lands on the lit surface', () => {
    // object: left 32px is a deep-shadow band; the rest is a lit textured surface
    const obj = texturedFlat(128, 96, 140, 10)
    for (let y = 0; y < 96; y++) for (let x = 0; x < 32; x++) setPx(obj, x, y, 18, 18, 18)
    const sel = selectCleanPatch(obj, 48)
    const patch = cropRect(obj, sel.rect)
    const m = mean(toLuminance(patch))
    expect(m).toBeGreaterThan(100) // chose the bright region, not the shadow band
    expect(sel.rect.x).toBeGreaterThanOrEqual(24) // window does not sit inside the dark band
  })

  it('extractSurfacePatch composes normalize→crop→select deterministically', () => {
    const original = texturedFlat(200, 200, 150, 6)
    const out = extractSurfacePatch(original, [25, 25, 50, 50], 100, 100, 40)
    expect(out.objectRect).toEqual({ x: 50, y: 50, w: 100, h: 100 })
    expect(out.patch.width).toBe(40)
    expect(out.patch.height).toBe(40)
  })
})

describe('seamless tiling (T2a)', () => {
  it('offsetWrap is a pure toroidal shift', () => {
    const img = ramp(8, 1, 0, 255)
    const o = offsetWrap(img, 4, 0)
    // o(x) = img((x-4) mod 8)
    expect(o.data[0]).toBe(img.data[((0 - 4 + 8) % 8) * 4])
    expect(o.data[4 * 4]).toBe(img.data[0])
  })

  it('makeSeamless drastically reduces the wrap-seam vs the raw crop', () => {
    const img = ramp(64, 64, 0, 255) // big left↔right border mismatch when tiled
    const raw = wrapSeamScore(img)
    const seamless = wrapSeamScore(makeSeamless(img))
    expect(raw).toBeGreaterThan(100)
    expect(seamless).toBeLessThan(raw * 0.25)
  })

  it('a flat image stays flat (and seamless)', () => {
    const flat = makeImage(32, 32, [120, 120, 120, 255])
    const s = makeSeamless(flat)
    expect(wrapSeamScore(s)).toBeCloseTo(0, 5)
    for (let i = 0; i < s.data.length; i += 4) expect(s.data[i]).toBe(120)
  })
})

describe('de-light (T2b)', () => {
  it('flattens a baked illumination gradient while preserving mean tone', () => {
    const img = ramp(64, 64, 60, 200) // simulates a shadow→highlight gradient (non-tiling)
    // a raw, non-seamless crop is de-lit with edge='clamp'; in the real pipeline de-light
    // runs AFTER makeSeamless with edge='wrap' (covered by the end-to-end test below).
    const before = illuminationSpread(img, undefined, 'clamp')
    const delit = delight(img, { edge: 'clamp' })
    const after = illuminationSpread(delit, undefined, 'clamp')
    expect(after).toBeLessThan(before * 0.4) // lighting flattened
    // overall tone preserved (de-light is not a brightness change)
    expect(Math.abs(mean(toLuminance(delit)) - mean(toLuminance(img)))).toBeLessThan(2)
  })

  it('preserves mean tone even on a HIGH-contrast gradient (mean-rescale fix)', () => {
    // pre-fix this darkened 7–10%; the global mean-rescale keeps it within rounding.
    const img = ramp(64, 64, 20, 240)
    const m0 = mean(toLuminance(img))
    for (const edge of ['clamp', 'wrap'] as const) {
      expect(Math.abs(mean(toLuminance(delight(img, { edge }))) - m0)).toBeLessThan(2)
    }
  })

  it('preserves chroma on a saturated shadowed pixel (no warm→yellow cast)', () => {
    // dark surround → the terracotta pixel sits in shadow (gain > 1); a per-channel multiply
    // would clip R at 255 and swing hue toward yellow. The additive-luma form keeps chroma.
    const img = makeImage(32, 32, [40, 40, 40, 255])
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) setPx(img, x, y, 200, 200, 200) // raises mean
    setPx(img, 24, 16, 180, 70, 40) // terracotta in the dark region
    const delit = delight(img, { edge: 'clamp' })
    const i = (16 * 32 + 24) * 4
    const r = delit.data[i], g = delit.data[i + 1], b = delit.data[i + 2]
    expect(Math.abs((g - b) - (70 - 40))).toBeLessThanOrEqual(4) // G-B chroma gap preserved (~30)
    expect(r).toBeGreaterThan(g) // channel order (warm hue) preserved
    expect(g).toBeGreaterThan(b)
    expect(luma(r, g, b)).toBeGreaterThan(luma(180, 70, 40)) // actually de-shadowed (brighter)
  })

  it('a uniformly-lit flat patch is left essentially unchanged', () => {
    const flat = makeImage(48, 48, [128, 110, 90, 255])
    const delit = delight(flat, { edge: 'wrap' })
    for (let i = 0; i < flat.data.length; i += 4) {
      expect(Math.abs(delit.data[i] - flat.data[i])).toBeLessThanOrEqual(2)
    }
  })
})

describe('PBR derivation (T2c)', () => {
  it('flat input yields the neutral normal (128,128,255)', () => {
    const flat = makeImage(16, 16, [100, 100, 100, 255])
    const n = normalMap(flat)
    const i = (8 * 16 + 8) * 4
    expect(n.data[i]).toBe(128)
    expect(n.data[i + 1]).toBe(128)
    expect(n.data[i + 2]).toBe(255)
  })

  it('normal map encodes a bump (a bright ridge perturbs x/y away from neutral)', () => {
    const img = makeImage(32, 32, [120, 120, 120, 255])
    for (let y = 0; y < 32; y++) setPx(img, 16, y, 230, 230, 230) // bright vertical ridge
    const n = normalMap(img, { strength: 3 })
    // just left of the ridge, the x-component should leave neutral (128)
    const il = (10 * 32 + 15) * 4
    expect(n.data[il]).not.toBe(128)
  })

  it('green channel encodes +Y (OpenGL): a downward-brightening ramp tilts +Y (regression lock)', () => {
    // locks the verified normal orientation for the flipY=true (CanvasTexture) upload path.
    const w = 8, h = 32
    const img = makeImage(w, h)
    for (let y = 0; y < h; y++) {
      const v = 40 + Math.round((y / (h - 1)) * 180) // brighter toward +y (downward)
      for (let x = 0; x < w; x++) setPx(img, x, y, v, v, v)
    }
    const n = normalMap(img, { strength: 3 })
    const i = (16 * w + 4) * 4 // interior pixel (wrap edges don't interfere)
    expect(n.data[i]).toBe(128) // R: no horizontal gradient → neutral X
    expect(n.data[i + 1]).toBeGreaterThan(128) // G: +Y because luma increases downward
  })

  it('roughness map is grayscale and inside the requested material band', () => {
    const tex = texturedFlat(32, 32, 130, 12)
    const rFab = roughnessMap(tex, { kind: 'fabric' })
    const rWood = roughnessMap(tex, { kind: 'wood' })
    for (let i = 0; i < rFab.data.length; i += 4) {
      expect(rFab.data[i]).toBe(rFab.data[i + 1]) // gray
      expect(rFab.data[i]).toBe(rFab.data[i + 2])
      expect(rFab.data[i]).toBeGreaterThanOrEqual(Math.round(0.8 * 255) - 1)
      expect(rFab.data[i]).toBeLessThanOrEqual(Math.round(0.95 * 255) + 1)
    }
    // wood band is glossier (lower roughness => lower value) than fabric
    expect(mean(toLuminance(rWood))).toBeLessThan(mean(toLuminance(rFab)))
  })

  it('inferSurfaceKind: low-contrast→fabric, high-contrast grain→wood', () => {
    const fabricLike = texturedFlat(48, 48, 140, 4) // gentle weave
    expect(inferSurfaceKind(fabricLike)).toBe('fabric')
    // strong directional grain
    const woody = makeImage(48, 48)
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const v = 110 + (y % 6 < 3 ? 70 : -40)
      setPx(woody, x, y, v, v, v)
    }
    expect(inferSurfaceKind(woody)).toBe('wood')
  })

  it('derivePbr returns three same-size maps + a resolved kind', () => {
    const albedo = texturedFlat(40, 40, 150, 8)
    const maps = derivePbr(albedo)
    expect(maps.albedo.width).toBe(40)
    expect(maps.roughness.width).toBe(40)
    expect(maps.normal.height).toBe(40)
    expect(['fabric', 'wood', 'metal']).toContain(maps.kind)
  })
})

describe('end-to-end T1→T2 (photo crop → tiling de-lit PBR material)', () => {
  it('produces a seamless, de-lit albedo + roughness + normal from a lit photo crop', () => {
    // a "sofa fabric" photo region: textured surface under a left→right lighting gradient
    const original = makeImage(240, 200)
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 240; x++) {
        const light = 80 + Math.round((120 * x) / 239) // baked gradient
        const weave = ((x >> 1) + (y >> 1)) & 1 ? 10 : -10
        setPx(original, x, y, light + weave, light + weave - 6, light + weave - 14)
      }
    // crop the object (bbox in a 120x100 downscaled space → maps to full 240x200)
    const { patch } = extractSurfacePatch(original, [20, 20, 80, 60], 120, 100, 64)
    const seamless = makeSeamless(patch)
    const albedo = delight(seamless, { edge: 'wrap' })
    const maps = derivePbr(albedo)

    expect(wrapSeamScore(seamless)).toBeLessThan(wrapSeamScore(patch))
    expect(illuminationSpread(albedo)).toBeLessThan(illuminationSpread(seamless))
    expect(maps.albedo.width).toBe(64)
    expect(maps.roughness.width).toBe(64)
    expect(maps.normal.width).toBe(64)
  })
})
