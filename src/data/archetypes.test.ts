import { describe, it, expect } from 'vitest'
import { isWalkableFloor, WALKABLE_FLOOR_MAX_H, ARCHETYPE_MAP } from './archetypes'

/**
 * `isWalkableFloor` decides which pieces a first-person walker steps OVER (flat
 * floor coverings) versus collides with. Getting this wrong is exactly the
 * "invisible wall at a rug's edge" bug, so the catalog's rugs are pinned here.
 */
describe('isWalkableFloor — flat floor coverings are walkable', () => {
  const rugs = Object.keys(ARCHETYPE_MAP).filter((id) => ARCHETYPE_MAP[id].model === 'rug')

  it('the catalog actually has rug archetypes to guard', () => {
    expect(rugs.length).toBeGreaterThan(0)
  })

  it('every rug/carpet is walkable', () => {
    for (const id of rugs) {
      expect(isWalkableFloor(id, ARCHETYPE_MAP[id].h)).toBe(true)
      // and walkable even if the live height is omitted (archetype fallback)
      expect(isWalkableFloor(id)).toBe(true)
    }
  })

  it('real floor furniture is NOT walkable (stays a collider)', () => {
    for (const id of ['sofa-chesterfield', 'decor-lamp']) {
      expect(isWalkableFloor(id, ARCHETYPE_MAP[id].h)).toBe(false)
    }
  })

  it('wall- and surface-mounted pieces are never floor coverings', () => {
    // even though a table lamp footprint is small, it is not a floor covering
    expect(isWalkableFloor('decor-lamp-table', ARCHETYPE_MAP['decor-lamp-table'].h)).toBe(false)
    expect(isWalkableFloor('decor-tv', ARCHETYPE_MAP['decor-tv'].h)).toBe(false)
  })

  it('judges by the live height when supplied (resized piece)', () => {
    // an unknown id that is flat -> walkable; the same id tall -> not
    expect(isWalkableFloor('mystery', WALKABLE_FLOOR_MAX_H)).toBe(true)
    expect(isWalkableFloor('mystery', WALKABLE_FLOOR_MAX_H + 0.1)).toBe(false)
  })

  it('a rug stays walkable even if mis-sized above the height gate (model fallback)', () => {
    expect(isWalkableFloor('decor-rug', 40)).toBe(true)
  })
})
