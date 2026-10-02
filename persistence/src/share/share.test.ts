import { describe, it, expect } from 'vitest'
import {
  toShowcasePayload,
  encodeShowcasePayload,
  decodeShowcasePayload,
} from './showcasePayload'
import { withAccess, buildShowcaseUrl, resolveShowcaseHref, readShowcaseHash, accessSentence, showcaseUrlSizeAdvice } from './link'
import { createDesign } from '../envelope/factory'
import type { House } from '../scene/slices'

function house(): House {
  return {
    schema_version: '1.0',
    house_id: 'h1',
    name: 'Loft',
    rooms: [
      {
        room_id: 'r1',
        type: 'living',
        footprint: { shape: 'rectangular', x: 0, z: 0, rotation: 0, w: 480, l: 400 },
        interior: {
          id: 'r1', name: 'Living', unit: 'cm', shape: 'rect',
          corners: [{ x: 0, z: 0 }, { x: 480, z: 0 }, { x: 480, z: 400 }, { x: 0, z: 400 }],
          wallHeight: 270, wallThickness: 12, openings: [],
          materials: { wallColor: '#fff', floorTexture: 'oak' },
          furniture: [{ id: 'f1', archetype: 'sofa-3', category: 'sofa', name: 'Sofa', x: 240, z: 340, rotation: 0, w: 220, d: 95, h: 85, color: '#5b6b73' }],
          createdAt: 1, updatedAt: 1,
        },
      },
    ],
    connectors: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('showcase payload — the security boundary', () => {
  it('round-trips encode → decode preserving the scene', () => {
    const d = createDesign({ house: house(), name: 'Loft', now: 1 })
    const p = toShowcasePayload(d)
    const restored = decodeShowcasePayload(encodeShowcasePayload(p))
    expect(restored).not.toBeNull()
    expect(restored!.name).toBe('Loft')
    expect(restored!.scene.house.rooms[0].interior.furniture[0].archetype).toBe('sofa-3')
  })

  it('STRIPS everything but {name, scene} — no design_id, share tokens, or history leak', () => {
    const d = createDesign({ house: house(), name: 'Loft', now: 1 })
    d.share = { access: 'view', view_link_id: 'secret-token', edit_link_id: 'edit-secret' }
    d.history = [{ rev: 1, at: 1, kind: 'manual', scene: d.scene, thumbnail: null }]
    const p = toShowcasePayload(d) as unknown as Record<string, unknown>
    // only the safe keys exist
    expect(Object.keys(p).sort()).toEqual(['name', 'scene', 'v'])
    expect(JSON.stringify(p)).not.toContain('secret-token')
    expect(JSON.stringify(p)).not.toContain('edit-secret')
    expect(JSON.stringify(p)).not.toContain(d.design_id)
  })

  it('payload is a deep copy — mutating it cannot affect the live design', () => {
    const d = createDesign({ house: house(), name: 'Loft', now: 1 })
    const p = toShowcasePayload(d)
    p.scene.house.rooms[0].interior.name = 'HACKED'
    expect(d.scene.house.rooms[0].interior.name).toBe('Living')
  })

  it('decode returns null for junk / tampered strings (never throws)', () => {
    expect(decodeShowcasePayload('')).toBeNull()
    expect(decodeShowcasePayload('not-base64!!!')).toBeNull()
    expect(decodeShowcasePayload(encodeShowcasePayload({ v: 1, name: 'x' } as never))).toBeNull() // missing scene
  })
})

describe('share-link helpers', () => {
  it('withAccess defaults safe + mints a view token on first share', () => {
    const fresh = { access: 'private' as const, view_link_id: null, edit_link_id: null }
    const viewed = withAccess(fresh, 'view')
    expect(viewed.access).toBe('view')
    expect(typeof viewed.view_link_id).toBe('string')
    expect(viewed.edit_link_id).toBeNull() // edit token only when edit chosen
    const edited = withAccess(viewed, 'edit')
    expect(typeof edited.edit_link_id).toBe('string')
  })

  it('buildShowcaseUrl points at showcase.html with the payload in the fragment', () => {
    const d = createDesign({ house: house(), name: 'Loft', now: 1 })
    const url = buildShowcaseUrl(d, 'https://app.roomio.test/index.html')
    expect(url.startsWith('https://app.roomio.test/showcase.html#s=')).toBe(true)
    // the encoded payload in the fragment decodes back to the design
    const enc = readShowcaseHash(new URL(url).hash)
    const restored = decodeShowcasePayload(enc!)
    expect(restored!.name).toBe('Loft')
  })

  it('resolveShowcaseHref swaps the last path segment + strips query/hash', () => {
    expect(resolveShowcaseHref('https://x.test/app/index.html?q=1#h')).toBe('https://x.test/app/showcase.html')
    expect(resolveShowcaseHref('https://x.test/')).toBe('https://x.test/showcase.html')
  })

  it('accessSentence is plain-language', () => {
    expect(accessSentence('view')).toMatch(/view/i)
    expect(accessSentence('private')).toMatch(/private/i)
  })

  it('warns (never silently truncates) when a self-contained link gets large', () => {
    expect(showcaseUrlSizeAdvice('x'.repeat(100)).level).toBe('ok')
    expect(showcaseUrlSizeAdvice('x'.repeat(9000)).level).toBe('soft')
    const hard = showcaseUrlSizeAdvice('x'.repeat(20000))
    expect(hard.level).toBe('hard')
    expect(hard.message).toMatch(/\.roomio/i) // steers to the reliable export
  })
})

describe('showcase rejects a zero-room (crafted/empty) payload → graceful invalid state', () => {
  it('decodes to null instead of yielding an unrenderable empty house', () => {
    const encoded = encodeShowcasePayload({ v: 1, name: 'x', scene: { house: { rooms: [] } } } as never)
    expect(decodeShowcasePayload(encoded)).toBeNull()
  })
})
