import { describe, it, expect } from 'vitest'
import { elevationCm, restsOnSurface, isCeilingHung } from './mount'
import { mountOf } from '../data/archetypes'
import type { FurnitureItem } from '../types'
import { ARCHETYPE_MAP } from '../data/archetypes'

let n = 0
function place(archetype: string, x = 100, z = 100): FurnitureItem {
  const a = ARCHETYPE_MAP[archetype]
  return {
    id: `f-${n++}`,
    archetype: a.id,
    category: a.category,
    name: a.name,
    x,
    z,
    rotation: 0,
    w: a.w,
    d: a.d,
    h: a.h,
    color: a.color,
  }
}

describe('mount classification', () => {
  it('TVs, mirror and wall shelf are wall-mounted; table lamp is surface; rest are floor', () => {
    expect(mountOf('decor-tv')).toBe('wall')
    expect(mountOf('decor-tv-large')).toBe('wall')
    expect(mountOf('decor-mirror')).toBe('wall')
    expect(mountOf('storage-wall-shelf')).toBe('wall')
    expect(mountOf('decor-lamp-table')).toBe('surface')
    expect(mountOf('sofa-3')).toBe('floor')
    expect(mountOf('decor-lamp')).toBe('floor') // floor lamp stays on the floor
  })
})

describe('elevation / stacking', () => {
  it('floor items sit at 0', () => {
    expect(elevationCm(place('sofa-3'), [])).toBe(0)
  })

  it('a wall TV with nothing beneath mounts at TV height (~center 107cm)', () => {
    const tv = place('decor-tv', 100, 100)
    const e = elevationCm(tv, [tv])
    expect(e).toBeGreaterThan(40)
    expect(Math.round(e + tv.h / 2)).toBe(107) // center lands at the standard 107cm
  })

  it('a TV placed over a media console rests on top of it', () => {
    const console = place('storage-media', 200, 50)
    const tv = place('decor-tv', 200, 50)
    expect(restsOnSurface(tv, [console, tv])).toBe(true)
    expect(elevationCm(tv, [console, tv])).toBe(console.h)
  })

  it('a table lamp rests on the side table beneath it (else on the floor)', () => {
    const table = place('table-side', 300, 300)
    const lamp = place('decor-lamp-table', 300, 300)
    expect(elevationCm(lamp, [table, lamp])).toBe(table.h)
    expect(elevationCm(lamp, [lamp])).toBe(0)
  })

  it('does not try to stack onto a tall wardrobe', () => {
    const wardrobe = place('storage-wardrobe', 100, 100) // ~201cm tall
    const tv = place('decor-tv', 100, 100)
    // too tall to be a surface → TV mounts at wall height, not on the wardrobe
    expect(restsOnSurface(tv, [wardrobe, tv])).toBe(false)
  })
})

// Sky Duplex pieces: the gallery and chandelier hang at FIXED heights. Without the
// fixed-height exemption, a chandelier over mid-room seating (or a gallery whose
// deep deck puts its centre >70cm off the wall) fell to the floor.
describe('double-height (duplex) pieces', () => {
  const corners = [
    { x: 0, z: 0 },
    { x: 700, z: 0 },
    { x: 700, z: 900 },
    { x: 0, z: 900 },
  ]

  it('a mid-room chandelier hangs at 245cm, never on the floor', () => {
    const c = place('decor-chandelier', 350, 450)
    expect(elevationCm(c, [c], corners)).toBe(245)
  })

  it('a chandelier over a coffee table still hangs, it does not stack on the table', () => {
    const t = place('table-coffee', 350, 450)
    const c = place('decor-chandelier', 350, 450)
    expect(elevationCm(c, [t, c], corners)).toBe(245)
  })

  it('the mezzanine hangs at upper-floor height even with its centre 85cm off the wall', () => {
    const m = place('decor-mezzanine', 350, 85)
    expect(elevationCm(m, [m], corners)).toBe(280)
  })

  it('the default floating stair tops out flush with the default gallery deck', () => {
    // deck top = 280 base + ~28cm slab + 2cm boards (see buildMezzanine)
    expect(ARCHETYPE_MAP['stair-floating'].h).toBe(310)
    expect(mountOf('stair-floating')).toBe('floor')
  })

  it('only ceiling-hung models count as ceiling-hung', () => {
    expect(isCeilingHung('decor-chandelier')).toBe(true)
    expect(isCeilingHung('decor-ceiling-fan')).toBe(true)
    expect(isCeilingHung('decor-mezzanine')).toBe(false)
    expect(isCeilingHung('decor-tv')).toBe(false)
    expect(isCeilingHung('no-such-id')).toBe(false)
  })
})
