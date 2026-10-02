import { describe, it, expect } from 'vitest'
import { PRESETS, PRESET_MAP, presetCorners } from './presets'
import { signedArea } from './walls'
import type { ShapeId } from '../types'

const ALL_SHAPE_IDS: ShapeId[] = ['rect', 'l', 't', 'u', 'cut', 'beveled']

describe('PRESETS', () => {
  it('defines exactly the 6 known shapes', () => {
    expect(PRESETS).toHaveLength(6)
    const ids = PRESETS.map((p) => p.id).sort()
    expect(ids).toEqual([...ALL_SHAPE_IDS].sort())
  })

  it('every preset polygon has at least 4 corners', () => {
    for (const preset of PRESETS) {
      expect(
        preset.corners().length,
        `preset "${preset.id}" should have >= 4 corners`,
      ).toBeGreaterThanOrEqual(4)
    }
  })

  it('every preset polygon has nonzero signed area', () => {
    for (const preset of PRESETS) {
      expect(
        signedArea(preset.corners()),
        `preset "${preset.id}" should have nonzero area`,
      ).not.toBe(0)
    }
  })

  it('each preset has a label and an icon path', () => {
    for (const preset of PRESETS) {
      expect(typeof preset.label).toBe('string')
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.icon.startsWith('M')).toBe(true)
    }
  })
})

describe('presetCorners — expected corner counts', () => {
  it('rect has 4 corners', () => {
    expect(presetCorners('rect')).toHaveLength(4)
  })

  it('l has 6 corners', () => {
    expect(presetCorners('l')).toHaveLength(6)
  })

  it('t has 8 corners', () => {
    expect(presetCorners('t')).toHaveLength(8)
  })

  it('u has 8 corners', () => {
    expect(presetCorners('u')).toHaveLength(8)
  })

  it('cut has 5 corners', () => {
    expect(presetCorners('cut')).toHaveLength(5)
  })

  it('beveled has 8 corners', () => {
    expect(presetCorners('beveled')).toHaveLength(8)
  })

  it('returns fresh arrays (not shared references) on each call', () => {
    const a = presetCorners('rect')
    const b = presetCorners('rect')
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('PRESET_MAP', () => {
  it('has a key for every ShapeId, each pointing at the matching preset', () => {
    for (const id of ALL_SHAPE_IDS) {
      expect(PRESET_MAP[id]).toBeDefined()
      expect(PRESET_MAP[id].id).toBe(id)
    }
  })

  it('covers exactly the ShapeId set (no extra keys)', () => {
    expect(Object.keys(PRESET_MAP).sort()).toEqual([...ALL_SHAPE_IDS].sort())
  })
})
