import { describe, it, expect } from 'vitest'
import { evaluate, hasNecessityGap, placementWarnings, RULES } from './engine'
import type { RoomDesign, FurnitureItem, RoomType } from '../types'
import { ARCHETYPE_MAP } from '../data/archetypes'
import { toRoomDesign } from '../data/personas'
import { PERSONA_MAP } from '../data/personas'
import { LISTING_FLATS } from '../data/listingFlats'

let n = 0
function place(archetype: string, x = 100, z = 100): FurnitureItem {
  const a = ARCHETYPE_MAP[archetype]
  if (!a) throw new Error(`unknown archetype ${archetype}`)
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

function room(furniture: FurnitureItem[], roomType: RoomType = 'living', genre?: string): RoomDesign {
  return {
    id: 'r',
    name: 'test',
    unit: 'cm',
    shape: 'rect',
    corners: [
      { x: 0, z: 0 },
      { x: 500, z: 0 },
      { x: 500, z: 400 },
      { x: 0, z: 400 },
    ],
    wallHeight: 270,
    wallThickness: 12,
    openings: [],
    materials: { wallColor: '#f4f1ea', floorTexture: 'natural-oak' },
    furniture,
    roomType,
    personaGenre: genre,
    createdAt: 0,
    updatedAt: 0,
  }
}

const ruleIds = (d: RoomDesign) => evaluate(d).map((s) => s.rule_id)

describe('necessity rules (R1-R3)', () => {
  it('R2 + R3: an empty living room has no seating and no light', () => {
    const ids = ruleIds(room([]))
    expect(ids).toContain('R2')
    expect(ids).toContain('R3')
  })

  it('R1: a bedroom with no bed suggests a bed', () => {
    const ids = ruleIds(room([place('decor-lamp')], 'bedroom'))
    expect(ids).toContain('R1')
  })

  it('R1 does NOT fire in a living room (no bed needed)', () => {
    const ids = ruleIds(room([place('sofa-3'), place('decor-lamp')], 'living'))
    expect(ids).not.toContain('R1')
  })

  it('R3 fires whenever there is no light, regardless of room type', () => {
    expect(ruleIds(room([place('sofa-3')], 'living'))).toContain('R3')
    expect(ruleIds(room([place('bed-queen')], 'bedroom'))).toContain('R3')
  })
})

describe('polish rules', () => {
  it('R4: seating present but no rug → polish suggestion', () => {
    const ids = ruleIds(room([place('sofa-3'), place('decor-lamp'), place('decor-lamp-table')]))
    expect(ids).toContain('R4')
  })

  it('R4 does NOT fire once a rug is present', () => {
    const ids = ruleIds(
      room([place('sofa-3'), place('decor-rug-large'), place('decor-lamp'), place('decor-lamp-table')]),
    )
    expect(ids).not.toContain('R4')
  })

  it('R5: exactly one light → suggest layering a second', () => {
    const ids = ruleIds(room([place('sofa-3'), place('decor-lamp'), place('decor-rug-large')]))
    expect(ids).toContain('R5')
  })

  it('R12: a bed with no nightstand → suggest one', () => {
    const ids = ruleIds(room([place('bed-queen'), place('decor-lamp')], 'bedroom'))
    expect(ids).toContain('R12')
  })
})

describe('prioritization: necessity ranks above polish', () => {
  it('necessity suggestions sort before polish suggestions', () => {
    // seating but no light (R3 necessity) + no rug (R4 polish)
    const sugg = evaluate(room([place('sofa-3')]))
    const firstPolish = sugg.findIndex((s) => s.tier === 'polish')
    const lastNecessity = sugg.map((s) => s.tier).lastIndexOf('necessity')
    expect(lastNecessity).toBeLessThan(firstPolish)
  })
})

describe('genre-aware rules', () => {
  it('gamer room with no desk fires the genre necessity rule', () => {
    const ids = ruleIds(room([place('chair-gaming'), place('decor-lamp')], 'office', 'gamer'))
    expect(ids).toContain('G-gamer-desk')
  })

  it('genre rules do NOT fire outside their genre', () => {
    const ids = ruleIds(room([place('sofa-3'), place('decor-lamp')], 'living'))
    expect(ids).not.toContain('G-gamer-desk')
    expect(ids).not.toContain('G-anime-shelf')
  })

  it('anime room with no display shelf fires G-anime-shelf', () => {
    const ids = ruleIds(room([place('bed-platform'), place('decor-lamp')], 'bedroom', 'anime_otaku'))
    expect(ids).toContain('G-anime-shelf')
  })
})

describe('placement warnings (wall pieces)', () => {
  it('a TV floating mid-room with nothing beneath it warns', () => {
    const tv = place('decor-tv', 250, 200) // center of a 500x400 room
    const warns = placementWarnings(room([tv]))
    expect(warns.some((w) => w.itemId === tv.id)).toBe(true)
  })

  it('a TV against the back wall does not warn', () => {
    const tv = place('decor-tv', 250, 20)
    expect(placementWarnings(room([tv]))).toEqual([])
  })

  it('a TV resting on a console mid-room does NOT warn', () => {
    const console = place('storage-media', 250, 200)
    const tv = place('decor-tv', 250, 200)
    expect(placementWarnings(room([console, tv]))).toEqual([])
  })

  it('a chandelier mid-room does NOT warn — it hangs from the ceiling', () => {
    expect(placementWarnings(room([place('decor-chandelier', 250, 200)]))).toEqual([])
  })

  it('a mezzanine is measured from its back edge: flush against the wall does NOT warn', () => {
    const m = place('decor-mezzanine', 250, 80) // d=160 → back edge on z=0
    expect(placementWarnings(room([m]))).toEqual([])
  })

  it('a mezzanine whose back edge is off every wall still warns', () => {
    const m = place('decor-mezzanine', 250, 200) // back edge 120cm from the nearest wall
    expect(placementWarnings(room([m])).some((w) => w.itemId === m.id)).toBe(true)
  })

  it('a chandelier alone satisfies the light necessity (R3)', () => {
    const ids = ruleIds(room([place('sofa-3'), place('decor-chandelier', 250, 200)]))
    expect(ids).not.toContain('R3')
  })
})

// LST-05: a listing replica is a faithful reproduction of a REAL flat, not a
// design-in-progress. Loading one used to red-flag it with necessity gaps
// ("No bed", "Nowhere to sit", "No light source") — the flagship replicas
// looked broken. A replica-flagged design must produce ZERO necessity flags &
// no placement warnings, while a normal (non-replica) room still does.
describe('listing-replica scenes are curated real flats, not designs-in-progress (LST-05)', () => {
  // Mirror houseSession.toDesignRoomType: only bedroom/living/office reach the
  // engine's RoomType; service rooms (kitchen/bath/hallway/balcony) map to
  // undefined and the engine treats them as 'living'.
  const designRoomType = (t: string): RoomType | undefined =>
    t === 'bedroom' || t === 'living' || t === 'office' ? (t as RoomType) : undefined

  // Rebuild a replica room's RoomDesign the way loadListingFlat does — rect
  // corners, mapped roomType, its authored furniture — with a toggleable flag.
  const replicaRoom = (fr: { type: string; w: number; l: number; furniture: { a: string; x: number; z: number }[] }, isReplica: boolean): RoomDesign => ({
    ...room(fr.furniture.map((f) => place(f.a, f.x, f.z))),
    corners: [
      { x: 0, z: 0 },
      { x: fr.w, z: 0 },
      { x: fr.w, z: fr.l },
      { x: 0, z: fr.l },
    ],
    roomType: designRoomType(fr.type),
    isReplica,
  })

  const allRooms = Object.values(LISTING_FLATS).flatMap((f) =>
    f.rooms.map((r) => ({ flat: f.title, ...r })),
  )

  it('every replica room across all listing flats produces ZERO necessity flags + no placement warnings', () => {
    for (const r of allRooms) {
      const d = replicaRoom(r, true)
      const nec = evaluate(d).filter((s) => s.tier === 'necessity')
      expect(nec, `${r.flat} / ${r.name} still flags: ${nec.map((s) => s.rule_id).join(',')}`).toEqual([])
      expect(hasNecessityGap(d)).toBe(false)
      expect(placementWarnings(d)).toEqual([])
    }
  })

  it('over-suppression guard: those SAME rooms DO trip necessity when NOT a replica', () => {
    // Proves the suppression does real work — the replica data genuinely trips
    // R1/R2/R3 (this is why they looked broken), so the test is not vacuous.
    const total = allRooms.reduce(
      (n, r) => n + evaluate(replicaRoom(r, false)).filter((s) => s.tier === 'necessity').length,
      0,
    )
    expect(total).toBeGreaterThan(0)
  })

  it('replica scenes still surface gentle POLISH tips (not fully muted)', () => {
    // Malad hall is furnished (sofa + TV) but has no rug → polish R4 stays.
    const hall = LISTING_FLATS['4551037518554295'].rooms.find((r) => r.name === 'Hall')!
    const polish = evaluate(replicaRoom(hall, true)).filter((s) => s.tier === 'polish')
    expect(polish.length).toBeGreaterThan(0)
  })

  it('the replica flag is what suppresses: flip it on the SAME unfurnished bedroom', () => {
    const bare = { ...room([], 'bedroom'), isReplica: false }
    const necBare = evaluate(bare).filter((s) => s.tier === 'necessity').map((s) => s.rule_id)
    expect(necBare).toEqual(expect.arrayContaining(['R1', 'R3'])) // no bed, no light
    const asReplica = { ...bare, isReplica: true }
    expect(evaluate(asReplica).filter((s) => s.tier === 'necessity')).toEqual([])
  })

  it('a truly-empty NON-replica room still flags necessity (guard against over-suppression)', () => {
    const living = room([]) // not a replica
    const livingNec = evaluate(living).map((s) => s.rule_id)
    expect(livingNec).toContain('R2') // nowhere to sit
    expect(livingNec).toContain('R3') // no light
    expect(evaluate(room([], 'bedroom')).map((s) => s.rule_id)).toContain('R1') // no bed
  })
})

describe('all suggestions carry a valid one-tap Add (or are advisory-only)', () => {
  it('every suggest_archetype is a real corpus id or empty', () => {
    for (const r of RULES) {
      if (r.suggest_archetype) expect(ARCHETYPE_MAP[r.suggest_archetype]).toBeDefined()
    }
  })
})

describe('acceptance scenarios (brief §8)', () => {
  it('Anime/Otaku: delete the rug → a polish suggestion appears, no necessity gap', () => {
    const base = toRoomDesign(PERSONA_MAP['anime_otaku'])
    const noRug = { ...base, furniture: base.furniture.filter((f) => ARCHETYPE_MAP[f.archetype].model !== 'rug') }
    const sugg = evaluate(noRug)
    expect(sugg.some((s) => s.rule_id === 'R4' && s.tier === 'polish')).toBe(true)
    expect(hasNecessityGap(noRug)).toBe(false)
  })

  it('Anime/Otaku: delete all lighting → a higher-priority necessity suggestion appears', () => {
    const base = toRoomDesign(PERSONA_MAP['anime_otaku'])
    const noLight = { ...base, furniture: base.furniture.filter((f) => ARCHETYPE_MAP[f.archetype].model !== 'lamp') }
    const sugg = evaluate(noLight)
    expect(sugg.some((s) => s.rule_id === 'R3' && s.tier === 'necessity')).toBe(true)
    // necessity ranks first
    expect(sugg[0].tier).toBe('necessity')
  })

  it('all 10 presets load with NO placement warnings (wall pieces are on walls / consoles)', () => {
    for (const id of Object.keys(PERSONA_MAP)) {
      const d = toRoomDesign(PERSONA_MAP[id])
      expect(placementWarnings(d), `${id} has placement warnings`).toEqual([])
    }
  })

  it('Family with Kids: delete the rug → polish; delete lights → necessity', () => {
    const base = toRoomDesign(PERSONA_MAP['family'])
    const noRug = { ...base, furniture: base.furniture.filter((f) => ARCHETYPE_MAP[f.archetype].model !== 'rug') }
    expect(evaluate(noRug).some((s) => s.rule_id === 'R4')).toBe(true)
    const noLight = { ...base, furniture: base.furniture.filter((f) => ARCHETYPE_MAP[f.archetype].model !== 'lamp') }
    expect(evaluate(noLight).some((s) => s.rule_id === 'R3' && s.tier === 'necessity')).toBe(true)
  })
})
