import { describe, it, expect } from 'vitest'
import { ROOM_TYPES } from '../types'
import {
  ROOM_TYPE_INFO,
  essentialsFor,
  guidanceFor,
  missingAssetsFor,
  resolveEssentialArchetype,
  PLACEHOLDER_ARCHETYPE,
} from './roomTypes'
import { allAssetGaps } from './assetRequests'
import catalog from '../../../src/data/archetypes.catalog.json'

// The set of real catalog ids Agent A owns (single source of truth).
const CATALOG_IDS = new Set(
  (Array.isArray(catalog) ? catalog : (catalog as { archetypes?: { id: string }[] }).archetypes ?? []).map(
    (a: { id: string }) => a.id,
  ),
)

describe('C2 — room typing + per-type essentials', () => {
  it('covers all 8 room types with purpose, essentials, guidance', () => {
    for (const t of ROOM_TYPES) {
      const info = ROOM_TYPE_INFO[t]
      expect(info.purpose.length).toBeGreaterThan(0)
      expect(info.essentials.length).toBeGreaterThan(0)
      expect(info.guidance.length).toBeGreaterThan(0)
    }
  })

  it('every non-null essential archetype is a REAL id in Agent A’s catalog', () => {
    expect(CATALOG_IDS.size).toBeGreaterThanOrEqual(91) // extensible corpus (now incl. kitchen/bath fixtures)
    for (const t of ROOM_TYPES) {
      for (const e of essentialsFor(t)) {
        if (e.archetype !== null) {
          expect(CATALOG_IDS.has(e.archetype), `${t} essential "${e.label}" → ${e.archetype}`).toBe(true)
        }
      }
    }
  })

  it('un-modeled essentials resolve to the Placeholder Box (don’t block)', () => {
    // hallway circulation is intentionally empty (still null) — exercises the fallback
    const circ = ROOM_TYPE_INFO.hallway.essentials.find((e) => e.archetype === null)!
    expect(circ).toBeDefined()
    expect(resolveEssentialArchetype(circ)).toBe(PLACEHOLDER_ARCHETYPE)
    expect(CATALOG_IDS.has(PLACEHOLDER_ARCHETYPE)).toBe(true)
  })

  it('kitchen offers work-triangle + island guidance', () => {
    const g = guidanceFor('kitchen').join(' ')
    expect(g).toMatch(/work triangle/i)
    expect(g).toMatch(/island/i)
    expect(g).toMatch(/42 in|107 cm/i) // aisle / island clearance
  })

  it('bathroom offers clearance + privacy guidance', () => {
    const g = guidanceFor('bathroom').join(' ')
    expect(g).toMatch(/clearance/i)
    expect(g).toMatch(/privacy|pocket door|hinged/i)
  })

  it('kitchen + bathroom are now fully modeled (no asset gaps)', () => {
    expect(missingAssetsFor('kitchen')).toHaveLength(0)
    expect(missingAssetsFor('bathroom')).toHaveLength(0)
    expect(missingAssetsFor('living')).toHaveLength(0)
    const gapTypes = allAssetGaps().map((g) => g.type)
    expect(gapTypes).not.toContain('kitchen')
    expect(gapTypes).not.toContain('bathroom')
  })
})
