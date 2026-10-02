import { describe, it, expect } from 'vitest'
import {
  srgbToLinear, linearToSrgb, rgbToLab, labToRgb, deltaE, chromaOf, hexToRgb, rgbToHex,
  whiteBalanceLinear, bandLab, dominantColor, classifyFloorGroup,
} from './finish-infer.mjs'

describe('colour math', () => {
  it('sRGB↔linear are inverse at the endpoints', () => {
    expect(linearToSrgb(srgbToLinear(0))).toBe(0)
    expect(linearToSrgb(srgbToLinear(255))).toBe(255)
    expect(linearToSrgb(srgbToLinear(128))).toBeCloseTo(128, -1)
  })
  it('rgb↔lab round-trips within a couple of levels', () => {
    for (const c of [[199, 154, 98], [235, 233, 230], [63, 127, 176], [40, 40, 40]]) {
      const back = labToRgb(rgbToLab(...c))
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - c[i])).toBeLessThanOrEqual(3)
    }
  })
  it('hex helpers round-trip', () => {
    expect(rgbToHex(...hexToRgb('#c79a62'))).toBe('#c79a62')
  })
  it('deltaE is 0 for identical, positive otherwise; chroma is 0 for grey', () => {
    const g = rgbToLab(128, 128, 128)
    expect(deltaE(g, g)).toBe(0)
    expect(deltaE(rgbToLab(0, 0, 0), rgbToLab(255, 255, 255))).toBeGreaterThan(50)
    expect(chromaOf(g)).toBeLessThan(2)
    expect(chromaOf(rgbToLab(63, 127, 176))).toBeGreaterThan(15)
  })
})

// A tiny synthetic grid helper: fill w*h RGBA with one colour, optionally a patch.
function grid(w, h, [r, g, b], patch) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255 }
  if (patch) {
    const { x0, y0, x1, y1, rgb } = patch
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]
    }
  }
  return { w, h, data }
}

describe('whiteBalanceLinear — intrinsic-albedo read', () => {
  it('neutralises a warm-lit white surface (does NOT leave it beige)', () => {
    // A warm-cast off-white wall (more red than blue) filling the frame.
    const g = grid(40, 40, [235, 220, 200])
    const { lin } = whiteBalanceLinear(g.data, g.w, g.h)
    const labs = bandLab(lin, g.w, g.h, 0, 1, 0, 1)
    const mean = labs.reduce((m, l) => [m[0] + l[0], m[1] + l[1], m[2] + l[2]], [0, 0, 0]).map((v) => v / labs.length)
    // After WB the chroma should be much lower than the raw warm cast (~beige).
    const rawChroma = chromaOf(rgbToLab(235, 220, 200))
    expect(chromaOf(mean)).toBeLessThan(rawChroma)
    expect(chromaOf(mean)).toBeLessThan(8) // reads near-neutral, not beige
  })
})

describe('dominantColor — histogram mode, robust to a coloured patch', () => {
  it('locks onto the majority surface, not a smaller saturated object', () => {
    // Mostly light-grey floor with a small saturated red patch (a rug corner).
    const g = grid(60, 60, [200, 198, 194], { x0: 0, y0: 40, x1: 18, y1: 60, rgb: [200, 30, 30] })
    const { lin } = whiteBalanceLinear(g.data, g.w, g.h)
    const labs = bandLab(lin, g.w, g.h, 0, 1, 0, 1)
    const dom = dominantColor(labs, { rejectDarkL: 26, maxChroma: 38 })
    expect(dom).not.toBeNull()
    expect(chromaOf(dom.lab)).toBeLessThan(10) // picked the neutral floor, not the red
    expect(dom.lab[0]).toBeGreaterThan(60) // and it's light
  })
  it('returns null for too-few samples', () => {
    expect(dominantColor([[50, 0, 0]], {})).toBeNull()
  })
})

describe('classifyFloorGroup — wood vs stone', () => {
  it('warm chromatic tones → wood; neutral tones → stone', () => {
    expect(classifyFloorGroup(rgbToLab(199, 154, 98)).group).toBe('wood') // oak
    expect(classifyFloorGroup(rgbToLab(124, 85, 54)).group).toBe('wood') // walnut
    expect(classifyFloorGroup(rgbToLab(235, 233, 230)).group).toBe('stone') // white tile
    expect(classifyFloorGroup(rgbToLab(150, 148, 143)).group).toBe('stone') // concrete
    expect(classifyFloorGroup(rgbToLab(63, 127, 176)).group).toBe('stone') // blue tile
  })
  it('decisiveness is in (0,1]', () => {
    for (const c of [[199, 154, 98], [235, 233, 230], [150, 148, 143]]) {
      const d = classifyFloorGroup(rgbToLab(...c)).decisiveness
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})
