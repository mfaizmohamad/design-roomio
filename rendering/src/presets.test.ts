import { describe, it, expect } from 'vitest'
import { presetFor, DEFAULT_RENDER_SETTINGS, withOverrides } from './presets'
import type { RenderQuality } from './types'

const TIERS: RenderQuality[] = ['high', 'medium', 'low']

describe('quality presets', () => {
  it('every tier keeps the cheap realism FOUNDATION (IBL + Neutral tone mapping) — never dropped', () => {
    for (const q of TIERS) {
      const s = presetFor(q)
      // Neutral (Khronos PBR-Neutral) is the shared default: hue-preserving highlight roll-off.
      expect(s.toneMapping.mode).toBe('Neutral')
      expect(s.ibl.intensity).toBeGreaterThan(0)
      expect(s.materials.envMapIntensity).toBeGreaterThan(0)
    }
  })

  it('"low" drops the GPU-heavy post passes (AO off, no MSAA) to hold framerate', () => {
    const low = presetFor('low')
    expect(low.post.ao.enabled).toBe(false)
    expect(low.post.multisampling).toBe(0)
  })

  it('post cost is monotonic high >= medium >= low (multisampling)', () => {
    const h = presetFor('high').post.multisampling
    const m = presetFor('medium').post.multisampling
    const l = presetFor('low').post.multisampling
    expect(h).toBeGreaterThanOrEqual(m)
    expect(m).toBeGreaterThanOrEqual(l)
  })

  it('AO is on for high+medium, off for low', () => {
    expect(presetFor('high').post.ao.enabled).toBe(true)
    expect(presetFor('medium').post.ao.enabled).toBe(true)
    expect(presetFor('low').post.ao.enabled).toBe(false)
  })

  it('quality field matches the requested tier', () => {
    for (const q of TIERS) expect(presetFor(q).quality).toBe(q)
  })

  it('presetFor returns a fresh object each call (no shared mutable state)', () => {
    const a = presetFor('high')
    const b = presetFor('high')
    expect(a).not.toBe(b)
    a.toneMapping.exposure = 99
    expect(b.toneMapping.exposure).not.toBe(99)
  })

  it('default settings == the high preset', () => {
    expect(DEFAULT_RENDER_SETTINGS).toEqual(presetFor('high'))
  })

  it('heroRender is opt-in (disabled) by default — never the interactive default', () => {
    for (const q of TIERS) expect(presetFor(q).heroRender.enabled).toBe(false)
  })
})

describe('withOverrides — forward-compatible partial merge', () => {
  it('returns a clone when no override given', () => {
    const base = presetFor('high')
    const out = withOverrides(base, null)
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
  })

  it('overrides a scalar without touching siblings', () => {
    const base = presetFor('high')
    const out = withOverrides(base, { quality: 'low' })
    expect(out.quality).toBe('low')
    // sibling sub-objects preserved
    expect(out.toneMapping.mode).toBe('Neutral')
  })

  it('deep-merges a nested sub-object (post.bloom.strength) without clobbering its neighbours', () => {
    const base = presetFor('high')
    const out = withOverrides(base, { post: { bloom: { strength: 1.5 } } as never })
    expect(out.post.bloom.strength).toBe(1.5)
    // other bloom fields + ao survive
    expect(out.post.bloom.threshold).toBe(base.post.bloom.threshold)
    expect(out.post.ao.enabled).toBe(base.post.ao.enabled)
    expect(out.post.multisampling).toBe(base.post.multisampling)
  })

  it('tunes tone-mapping exposure (the E co-tune knob) in isolation', () => {
    const base = presetFor('high')
    const out = withOverrides(base, { toneMapping: { exposure: 1.4 } as never })
    expect(out.toneMapping.exposure).toBe(1.4)
    expect(out.toneMapping.mode).toBe('Neutral')
  })

  it('does not mutate the base', () => {
    const base = presetFor('high')
    const snapshot = structuredClone(base)
    withOverrides(base, { toneMapping: { exposure: 2 } as never })
    expect(base).toEqual(snapshot)
  })
})
