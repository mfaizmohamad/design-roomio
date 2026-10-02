import { describe, it, expect } from 'vitest'
import { PERSONAS, PERSONA_MAP, toRoomDesign } from './personas'
import { ARCHETYPE_MAP } from './archetypes'
import { FLOOR_MAP } from './materials'
import { hasNecessityGap, evaluate } from '../suggestions/engine'

describe('persona preset catalog', () => {
  it('has exactly 10 presets', () => {
    expect(PERSONAS.length).toBe(10)
  })

  it('keeps the three life-stage personas (bachelor, couple, family)', () => {
    const life = PERSONAS.filter((p) => p.persona_type === 'life_stage').map((p) => p.genre_id)
    expect(life).toEqual(expect.arrayContaining(['bachelor', 'couple', 'family']))
  })

  it('includes the headline acceptance genres', () => {
    expect(PERSONA_MAP['anime_otaku']).toBeDefined()
    expect(PERSONA_MAP['family']).toBeDefined()
  })

  it('genre_ids are unique', () => {
    const ids = PERSONAS.map((p) => p.genre_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('every preset is buildable from the existing corpus', () => {
  for (const p of PERSONAS) {
    it(`${p.genre_id}: every placed item is a real archetype id`, () => {
      for (const item of p.placed_items) {
        expect(ARCHETYPE_MAP[item.archetype_id], `missing ${item.archetype_id}`).toBeDefined()
      }
    })

    it(`${p.genre_id}: floor id resolves`, () => {
      expect(FLOOR_MAP[p.materials.floor]).toBeDefined()
    })

    it(`${p.genre_id}: wall color is a hex`, () => {
      expect(p.materials.wall_color).toMatch(/^#?[0-9a-fA-F]{6}$/)
    })
  }
})

describe('every preset records pin provenance (P-3)', () => {
  for (const p of PERSONAS) {
    it(`${p.genre_id}: has at least 3 pinterest_sources`, () => {
      expect(p.pinterest_sources.length).toBeGreaterThanOrEqual(3)
      for (const url of p.pinterest_sources) expect(url).toMatch(/^https?:\/\//)
    })
  }
})

describe('every preset loads into a furnished, editable room (P-2)', () => {
  for (const p of PERSONAS) {
    it(`${p.genre_id}: toRoomDesign yields furniture + materials + genre`, () => {
      const d = toRoomDesign(p)
      expect(d.furniture.length).toBeGreaterThan(4)
      expect(d.personaGenre).toBe(p.genre_id)
      expect(d.roomType).toBe(p.room_type)
      expect(d.corners.length).toBeGreaterThanOrEqual(4)
      // items sit inside the footprint
      const w = p.room.width_cm
      const l = p.room.length_cm
      for (const f of d.furniture) {
        expect(f.x).toBeGreaterThanOrEqual(0)
        expect(f.x).toBeLessThanOrEqual(w)
        expect(f.z).toBeGreaterThanOrEqual(0)
        expect(f.z).toBeLessThanOrEqual(l)
      }
    })
  }
})

describe('every preset passes the suggestion engine with NO necessity gaps (P-5)', () => {
  for (const p of PERSONAS) {
    it(`${p.genre_id}: no necessity-tier suggestion fires on load`, () => {
      const d = toRoomDesign(p)
      const necessity = evaluate(d).filter((s) => s.tier === 'necessity')
      expect(necessity, `unexpected necessity gaps: ${necessity.map((s) => s.rule_id).join(', ')}`).toEqual([])
      expect(hasNecessityGap(d)).toBe(false)
    })
  }
})
