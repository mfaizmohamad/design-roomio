import { describe, it, expect } from 'vitest'
import {
  resolveFinish,
  getInferredFinish,
  inferredListingIds,
  INFERENCE_CONFIDENCE_MIN,
} from './inferredScenes'
import { applyInferredFinish } from './flatTemplates'
import { FLOOR_MAP } from './materials'
import inferredDoc from './inferredScenes.json'
import type { RoomType } from '../../multi-room/src/index'

const HEX = /^#[0-9a-f]{6}$/

// ─────────────────── loader: validate + confidence-gate + fallback ───────────────────
describe('resolveFinish — validation + confidence gate + graceful fallback', () => {
  const above = INFERENCE_CONFIDENCE_MIN + 0.2
  const below = INFERENCE_CONFIDENCE_MIN - 0.2

  it('keeps high-confidence, VALID floor + wall', () => {
    const f = resolveFinish({ floor: { textureId: 'marble-tile', confidence: above }, wall: { hex: '#ECE7DD', confidence: above } })
    expect(f).toEqual({ floorTexture: 'marble-tile', wallColor: '#ece7dd' })
  })

  it('DROPS fields below the confidence threshold (→ template fallback)', () => {
    expect(resolveFinish({ floor: { textureId: 'grey-tile', confidence: below }, wall: { hex: '#ffffff', confidence: below } })).toBeNull()
    // mixed: only the confident field survives
    expect(resolveFinish({ floor: { textureId: 'grey-tile', confidence: above }, wall: { hex: '#ffffff', confidence: below } }))
      .toEqual({ floorTexture: 'grey-tile' })
  })

  it('exactly-at-threshold passes (>=)', () => {
    expect(resolveFinish({ floor: { textureId: 'walnut', confidence: INFERENCE_CONFIDENCE_MIN } }))
      .toEqual({ floorTexture: 'walnut' })
  })

  it('REJECTS an unknown floor texture id (not in FLOOR_TEXTURES)', () => {
    expect(resolveFinish({ floor: { textureId: 'not-a-real-floor', confidence: 0.99 } })).toBeNull()
  })

  it('REJECTS a malformed wall hex', () => {
    expect(resolveFinish({ wall: { hex: 'beige', confidence: 0.99 } })).toBeNull()
    expect(resolveFinish({ wall: { hex: '#12', confidence: 0.99 } })).toBeNull()
  })

  it('REJECTS a non-numeric / missing confidence', () => {
    expect(resolveFinish({ floor: { textureId: 'grey-tile', confidence: 'high' } })).toBeNull()
    expect(resolveFinish({ floor: { textureId: 'grey-tile' } })).toBeNull()
  })

  it('returns null for missing / garbage records', () => {
    for (const bad of [null, undefined, 42, 'x', {}, { floor: null }, { floor: {} }, []]) {
      expect(resolveFinish(bad as unknown)).toBeNull()
    }
  })

  it('honours a caller-supplied threshold', () => {
    const rec = { floor: { textureId: 'grey-tile', confidence: 0.6 } }
    expect(resolveFinish(rec, 0.5)).toEqual({ floorTexture: 'grey-tile' })
    expect(resolveFinish(rec, 0.7)).toBeNull()
  })
})

describe('getInferredFinish — bundled data', () => {
  it('returns null for a listing with no inference', () => {
    expect(getInferredFinish('does-not-exist')).toBeNull()
    expect(getInferredFinish('')).toBeNull()
  })

  it('every exposed finish is valid (real texture id + well-formed hex)', () => {
    const ids = inferredListingIds()
    expect(ids.length).toBeGreaterThan(0) // the batch ran over the real photos
    for (const id of ids) {
      const f = getInferredFinish(id)!
      expect(f).toBeTruthy()
      if (f.floorTexture) expect(FLOOR_MAP[f.floorTexture], `floor '${f.floorTexture}' for ${id}`).toBeTruthy()
      if (f.wallColor) expect(f.wallColor).toMatch(HEX)
      expect(f.floorTexture || f.wallColor).toBeTruthy() // never an empty finish
    }
  })
})

// ─────────────────── committed JSON integrity (the persisted artifact) ───────────────────
describe('inferredScenes.json — committed artifact is schema-valid + labelled', () => {
  const doc = inferredDoc as unknown as {
    kind?: string; disclaimer?: string; confidenceMin?: number
    listings?: Record<string, { floor?: { textureId?: string; confidence?: number }; wall?: { hex?: string; confidence?: number } }>
  }

  it('is labelled an AI approximation and carries a confidence floor', () => {
    expect(doc.kind).toBe('roomio.inferred-scenes')
    expect((doc.disclaimer ?? '').toLowerCase()).toContain('approximation')
    expect(typeof doc.confidenceMin).toBe('number')
  })

  it('every listing record uses real texture ids, well-formed hexes, numeric confidences', () => {
    const listings = doc.listings ?? {}
    expect(Object.keys(listings).length).toBeGreaterThan(0)
    for (const [id, rec] of Object.entries(listings)) {
      if (rec.floor) {
        expect(FLOOR_MAP[rec.floor.textureId as string], `floor id for ${id}`).toBeTruthy()
        expect(typeof rec.floor.confidence).toBe('number')
      }
      if (rec.wall) {
        expect(rec.wall.hex, `wall hex for ${id}`).toMatch(/^#[0-9a-fA-F]{6}$/)
        expect(typeof rec.wall.confidence).toBe('number')
      }
    }
  })
})

// ─────────────────── overlay: applyInferredFinish (finish on top of template) ───────────────────
describe('applyInferredFinish — overlay only where it is a safe win', () => {
  const base = { wall: '#d6c6a8', floor: 'natural-oak' }
  const finish = { floorTexture: 'grey-tile', wallColor: '#eeeeee' }

  it('overrides floor + wall for a living room (wood-defaulting dry room)', () => {
    expect(applyInferredFinish('living', base, finish)).toEqual({ wall: '#eeeeee', floor: 'grey-tile' })
  })

  it('does NOT change a bathroom floor (wet room keeps its functional tile)', () => {
    const bath = { wall: '#bcd0d6', floor: 'blue-tile' }
    expect(applyInferredFinish('bathroom', bath, finish).floor).toBe('blue-tile')
  })

  it('does NOT change a kitchen floor, but leaves wet-room wall untouched too', () => {
    const kit = { wall: '#f4f1ea', floor: 'sand-tile' }
    expect(applyInferredFinish('kitchen', kit, finish)).toEqual(kit)
  })

  it('applies wall (but not floor) to a foyer', () => {
    const foyer = { wall: '#f4f1ea', floor: 'marble-tile' }
    expect(applyInferredFinish('foyer', foyer, finish)).toEqual({ wall: '#eeeeee', floor: 'marble-tile' })
  })

  it('is a NO-OP when finish is null/undefined or fields absent (template fallback)', () => {
    expect(applyInferredFinish('living', base, null)).toEqual(base)
    expect(applyInferredFinish('living', base, undefined)).toEqual(base)
    expect(applyInferredFinish('living', base, {})).toEqual(base)
    expect(applyInferredFinish('living', base, { wallColor: '#eeeeee' })).toEqual({ wall: '#eeeeee', floor: 'natural-oak' })
  })

  it('never emits a bogus id — the overlaid floor is a real FLOOR_TEXTURES id', () => {
    const types: RoomType[] = ['living', 'bedroom', 'dining', 'office']
    for (const t of types) {
      const out = applyInferredFinish(t, base, finish)
      expect(FLOOR_MAP[out.floor]).toBeTruthy()
    }
  })
})
