import { describe, it, expect } from 'vitest'
import {
  SLOTS,
  DEFAULT_TILING,
  DEFAULT_COLOR_SPACE,
  PBR_CONVENTIONS,
  isAssetRef,
  type AppliedTexture,
} from './contract'

describe('texture contract', () => {
  it('default slot is body and the taxonomy is stable', () => {
    expect(SLOTS[0]).toBe('body')
    expect(SLOTS).toContain('wood')
    expect(SLOTS).toContain('metal')
    expect(SLOTS).toContain('glass')
  })

  it('default tiling is a sane world-space density + zero rotation', () => {
    expect(DEFAULT_TILING.repeat_cm).toBeGreaterThan(0)
    expect(DEFAULT_TILING.rotation_deg).toBe(0)
  })

  it('color space: albedo is sRGB, data maps are linear (PBR correctness)', () => {
    expect(DEFAULT_COLOR_SPACE.albedo).toBe('srgb')
    expect(DEFAULT_COLOR_SPACE.roughness).toBe('linear')
    expect(DEFAULT_COLOR_SPACE.normal).toBe('linear')
    // mirror is consistent with the published convention
    expect(PBR_CONVENTIONS.colorSpace.albedo).toBe('srgb')
    expect(PBR_CONVENTIONS.colorSpace.normal).toBe('linear')
  })

  it('normal convention is +Y (OpenGL) tangent-space', () => {
    expect(PBR_CONVENTIONS.normal.orientation).toMatch(/\+Y/)
    expect(PBR_CONVENTIONS.normal.type).toMatch(/TangentSpace/)
  })

  it('asset refs are content-hash references, never bytes', () => {
    expect(isAssetRef('sha256:' + 'a'.repeat(64))).toBe(true)
    expect(isAssetRef('sha256:tooshort')).toBe(false)
    expect(isAssetRef('data:image/png;base64,AAAA')).toBe(false) // bytes are NOT a ref
    expect(isAssetRef(42)).toBe(false)
  })

  it('an AppliedTexture is reference-only and small (no embedded bytes)', () => {
    const t: AppliedTexture = {
      asset_id: 'sha256:' + 'b'.repeat(64),
      slot: 'body',
      maps: {
        albedo: 'sha256:' + '1'.repeat(64),
        roughness: 'sha256:' + '2'.repeat(64),
        normal: 'sha256:' + '3'.repeat(64),
      },
      tiling: { ...DEFAULT_TILING },
    }
    expect(isAssetRef(t.asset_id)).toBe(true)
    expect(isAssetRef(t.maps.albedo)).toBe(true)
    // every map value is a short ref, not a giant data-url
    for (const v of Object.values(t.maps)) expect(v.length).toBeLessThan(80)
  })
})
