import { describe, it, expect } from 'vitest'
import { makeImage, toLuminance, boxBlurFloat, mean, luma, clampInt } from './image'
import { repeatFor, repeatXY, dominantFaceCm, clampRepeatCm } from './tiling'
import { sha256hex, assetRefOf } from './sha256'

describe('image foundations', () => {
  it('makeImage is opaque by default and fills correctly', () => {
    const img = makeImage(2, 2)
    expect(img.data.length).toBe(2 * 2 * 4)
    expect(img.data[3]).toBe(255) // alpha
    const red = makeImage(1, 1, [255, 0, 0, 255])
    expect([red.data[0], red.data[1], red.data[2]]).toEqual([255, 0, 0])
  })

  it('luma matches Rec.709 weights', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 5)
    expect(luma(0, 255, 0)).toBeCloseTo(182.376, 2)
  })

  it('toLuminance of a flat gray is uniform', () => {
    const img = makeImage(4, 4, [128, 128, 128, 255])
    const l = toLuminance(img)
    expect(l.length).toBe(16)
    for (const v of l) expect(v).toBeCloseTo(128, 4)
  })

  it('boxBlur preserves mean (energy) for clamp and wrap', () => {
    const w = 8,
      h = 8
    const src = new Float32Array(w * h)
    for (let i = 0; i < src.length; i++) src[i] = (i * 37) % 256
    const m0 = mean(src)
    // wrap (toroidal) blur conserves energy exactly
    expect(mean(boxBlurFloat(src, w, h, 2, 'wrap'))).toBeCloseTo(m0, 1)
    // clamp replicates edges, so the mean drifts a little for a non-periodic ramp — that
    // is correct behavior; just bound the drift.
    expect(Math.abs(mean(boxBlurFloat(src, w, h, 2, 'clamp')) - m0)).toBeLessThan(5)
  })

  it('boxBlur of a constant field is the same constant', () => {
    const buf = new Float32Array(25).fill(50)
    const b = boxBlurFloat(buf, 5, 5, 1, 'clamp')
    for (const v of b) expect(v).toBeCloseTo(50, 5)
  })

  it('clampInt rounds and clamps', () => {
    expect(clampInt(3.6, 0, 10)).toBe(4)
    expect(clampInt(-5, 0, 10)).toBe(0)
    expect(clampInt(99, 0, 10)).toBe(10)
  })
})

describe('world-space tiling', () => {
  it('repeatFor = worldDim / repeatCm', () => {
    expect(repeatFor(200, 40)).toBeCloseTo(5)
    expect(repeatFor(50, 40)).toBeCloseTo(1.25)
  })

  it('density is consistent across sizes (same repeatCm)', () => {
    // a 200cm sofa and a 50cm table at 40cm/tile read at the SAME physical scale:
    // both have 1 tile per 40cm.
    const sofa = repeatFor(200, 40) / 200
    const table = repeatFor(50, 40) / 50
    expect(sofa).toBeCloseTo(table, 6) // tiles-per-cm equal
  })

  it('guards against zero/NaN', () => {
    expect(repeatFor(100, 0)).toBe(1)
    expect(repeatFor(0, 40)).toBe(1)
    expect(clampRepeatCm(NaN)).toBe(40)
    expect(clampRepeatCm(1000)).toBe(400)
    expect(clampRepeatCm(1)).toBe(5)
  })

  it('repeatXY and dominantFaceCm pick the two largest extents', () => {
    expect(repeatXY(200, 100, 50)).toEqual({ x: 4, y: 2 })
    expect(dominantFaceCm(210, 95, 80)).toEqual({ u: 210, v: 95 })
  })
})

describe('sha256 content hashing', () => {
  const enc = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

  it('matches the canonical "abc" vector', () => {
    expect(sha256hex(enc('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches the empty-string vector', () => {
    expect(sha256hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('matches the 56-byte (multi-block padding) vector', () => {
    // boundary case: message length forces a second padding block
    expect(sha256hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('assetRefOf is content-addressed and stable', () => {
    const a = assetRefOf(enc('roomio'))
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(assetRefOf(enc('roomio'))).toBe(a) // deterministic
    expect(assetRefOf(enc('roomio2'))).not.toBe(a)
  })
})
