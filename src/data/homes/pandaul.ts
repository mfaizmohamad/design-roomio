// Pandaul independent house · ground floor (1382.84 sq ft · AutoCAD plan, 2026-10-02).
//
// Traced from a photo of the CAD ground-floor plan, room sizes from its printed
// labels (ft → cm). Outer frame 26' × 51'-6"; the plan's walls are absorbed into
// the grid so neighbours butt (same convention as the other homes):
//   x: 0 · 152 (wash | lobby) · 305 (left rooms | corridor/hall/entry) · 412
//      (corridor | bedroom 2, entry | bedroom 4) · 504 (lobby | kitchen) · 565
//      (passage | puja) · 717
//   z: 0 · 366 (bedrooms 1–2 end) · 610 (wash/lobby/kitchen end) · 976 (bedroom
//      3 end) · 1066 (hall end) · 1220 (kitchen 2 / passage / puja end) · 1482
//      (stair end) · 1586
//
// DOORS ARE GAPS. On this plan a door is where a room's outline has no wall line
// for a door's width — there are no swing arcs. Every door below was placed by
// finding that gap on the zoomed plan (docs/home-authoring-pipeline.md §2):
//   bedroom 1 → bottom wall, right end (lobby) · bedroom 2 → left wall, bottom
//   end (corridor) · bedroom 3 → right wall, bottom end (hall) · bedroom 4 →
//   TOP wall, left end (8'-6" passage) · wash → right wall, top end · kitchen 1
//   → left wall, top end · kitchen 2 → right wall, TOP end (hall) · stair → its
//   whole east side is open (a single stair-edge line, not a wall) · corridor →
//   open at the top to the rear setback.
//
// Circulation as drawn — the plan is the source of truth:
//  - main door at the bottom → the 3'-6" ENTRY passage, with the stair open on
//    its left and bedroom 4's solid side wall on its right, then up into the
//    8'-6" passage — bedroom 4's door is in the passage's floor-side (south)
//    wall — and on into the hall. Kitchen 2 opens off the hall's south-west.
//  - the puja is an alcove open to the HALL (north); its west wall, against the
//    passage, is solid.
//  - the hall flows north into the 11'-6" lobby (no wall between them), which
//    serves bedroom 1, the wash, kitchen 1 and the 3'-6" corridor up to bedroom 2
//    and the rear door.
//  - bedroom 3 is entered from the hall.
// Single storey: the stair is drawn (it serves a future upper floor) but there is
// no upper level to author, so it rises to this storey's ceiling.
// The hall is 13'-6" × 15' here vs the plan's 13'-1" × 14' label — the top row
// (two 10' bedrooms + the 3'-6" corridor) fixes the frame width, and the hall
// runs down to z 1066 so kitchen 2's top-end door gap lands on the hall as
// drawn. The hall and the 8'-6" passage are one open space on the plan; the
// split between them is ours, so it goes where the doors need it. That leaves
// the puja 5' × 5' (label 5' × 6').

import type { MultiLevelHome } from './types'
import type { ReplicaRoom } from '../listingFlats'
import { Q, DARK_FRAME, WOOD_FRAME } from './types'

const WALL = '#f0ebe1'
const WOOD_LEAF = '#8a6a4e'
const TEAK = '#7a5a40'
const GRANITE = '#1f2022'

const ground: ReplicaRoom[] = [
  {
    // top-left 10'×12': windows on the rear and west walls. Door = the gap at
    // the RIGHT end of its bottom wall, onto the lobby
    name: 'Bedroom 1',
    type: 'bedroom',
    w: 305, l: 366, x: 152.5, z: 183,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.44, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'window', style: 'windowDouble', wallId: 'w3', t: 0.48, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.1803, width: 95, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
    ],
    furniture: [
      // bed head on the west wall, as drawn
      { a: 'bed-queen', x: 115, z: 160, rot: Q, color: '#e6e1d8' },
      { a: 'storage-wardrobe', x: 275, z: 150, rot: -Q, color: TEAK },
    ],
  },
  {
    // 3'-6" corridor between the two rear bedrooms. No wall line across its
    // top on the plan: it is OPEN to the 3' rear setback
    name: 'Corridor',
    type: 'hallway',
    w: 107, l: 366, x: 358.5, z: 183,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 100, height: 215, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.8579, width: 95, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 100, height: 215, sill: 0 },
    ],
    furniture: [],
  },
  {
    // top-right 10'×12': windows on the rear and east walls. Door = the gap at
    // the BOTTOM end of its left wall, onto the corridor
    name: 'Bedroom 2',
    type: 'bedroom',
    w: 305, l: 366, x: 564.5, z: 183,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.54, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'window', style: 'windowDouble', wallId: 'w1', t: 0.52, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.1421, width: 95, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
    ],
    furniture: [
      // bed head on the east wall, as drawn
      { a: 'bed-queen', x: 190, z: 160, rot: -Q, color: '#ddd5c8' },
      { a: 'storage-wardrobe', x: 32, z: 130, rot: Q, color: TEAK },
    ],
  },
  {
    // 5'×8' wash: WC top-left, vent on the west wall. Door = the gap at the TOP
    // end of its right wall, onto the lobby
    name: 'Wash',
    type: 'bathroom',
    w: 152, l: 244, x: 76, z: 488,
    floor: 'grey-tile',
    wall: '#dcd8d0',
    wallTexture: 'white-tile',
    openings: [
      { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.8, width: 60, height: 60, sill: 160, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.2172, width: 80, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
    ],
    furniture: [
      { a: 'bath-toilet', x: 40, z: 40, rot: 0 },
      { a: 'bath-shower', x: 100, z: 195, rot: 0 },
    ],
  },
  {
    // the 11'-6" lobby: open south into the hall, wash basin outside the wash
    name: 'Lobby',
    type: 'hallway',
    w: 352, l: 244, x: 328, z: 488,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.2784, width: 95, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5866, width: 100, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.7828, width: 80, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.2213, width: 90, height: 215, sill: 0, bare: true },
      // the plan draws no wall between the lobby and the hall
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.28125, width: 180, height: 230, sill: 0 },
    ],
    furniture: [{ a: 'bath-vanity', x: 70, z: 219, rot: Math.PI, color: '#e8e4dc' }],
  },
  {
    // 7'×8' kitchen 1: counter down the east wall under the window, hob on the
    // south wall ("oo" on the plan)
    name: 'Kitchen',
    type: 'kitchen',
    w: 213, l: 244, x: 610.5, z: 488,
    floor: 'speckle-tile',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowGrille', wallId: 'w1', t: 0.25, width: 90, height: 110, sill: 105, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.7787, width: 90, height: 215, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      { a: 'kitchen-counter', x: 183, z: 95, rot: -Q, w: 150, color: GRANITE },
      { a: 'kitchen-sink', x: 160, z: 214, rot: Math.PI, color: GRANITE },
      { a: 'kitchen-stove', x: 70, z: 211, rot: Math.PI },
    ],
  },
  {
    // west 10'×12': window on the west wall. Door = the gap at the BOTTOM end of
    // its right wall, onto the hall
    name: 'Bedroom 3',
    type: 'bedroom',
    w: 305, l: 366, x: 152.5, z: 793,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w3', t: 0.46, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.8607, width: 95, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
    ],
    furniture: [
      { a: 'bed-queen', x: 115, z: 180, rot: Q, color: '#e2dacb' },
      { a: 'storage-wardrobe', x: 200, z: 32, rot: 0, color: TEAK },
    ],
  },
  {
    // 13'-6"×15' hall: L-sofa along the east wall with a round table, plant by it
    name: 'Hall',
    type: 'living',
    w: 412, l: 456, x: 511, z: 838,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.2427, width: 180, height: 230, sill: 0, bare: true },
      // west side: bedroom 3's door, then kitchen 2's at the hall's bottom end
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.3092, width: 95, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.0987, width: 90, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.7209, width: 200, height: 230, sill: 0 },
      // the puja alcove opens off the hall — the plan draws no wall across its top
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.1845, width: 130, height: 220, sill: 0, bare: true },
    ],
    furniture: [
      { a: 'sofa-3', x: 364, z: 170, rot: -Q, color: '#8c6d55' },
      { a: 'chair-accent', x: 300, z: 300, rot: Math.PI, color: '#8c6d55' },
      { a: 'table-coffee', x: 270, z: 170, rot: Q, color: '#6e4f37' },
      { a: 'decor-rug', x: 280, z: 170, rot: 0, color: '#c9b79c', w: 180, d: 240 },
      { a: 'storage-tv', x: 21, z: 170, rot: Q, color: TEAK },
      { a: 'decor-tv', x: 12, z: 170, rot: Q },
      { a: 'decor-plant', x: 385, z: 290, rot: 0 },
      { a: 'decor-ceiling-fan', x: 206, z: 228, rot: 0 },
    ],
  },
  {
    // west 10'×8' kitchen 2. Doorway = the gap at the TOP end of its right
    // wall, onto the hall (not the passage). An OPEN doorway, no leaf: kitchens
    // and halls carry no doors (pipeline doc, THE OPEN-DOORWAY RULE). Platform down the west wall, hob on the
    // south wall as drawn, everything kept clear of the door's swing
    name: 'Kitchen 2',
    type: 'kitchen',
    w: 305, l: 244, x: 152.5, z: 1098,
    floor: 'speckle-tile',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowGrille', wallId: 'w3', t: 0.63, width: 100, height: 110, sill: 105, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.1844, width: 90, height: 215, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      { a: 'kitchen-counter', x: 30, z: 130, rot: Q, w: 160, color: GRANITE },
      { a: 'kitchen-sink', x: 120, z: 30, rot: 0, color: GRANITE },
      { a: 'kitchen-stove', x: 150, z: 211, rot: Math.PI },
      { a: 'kitchen-fridge', x: 255, z: 205, rot: Math.PI, color: '#4a4c4f' },
    ],
  },
  {
    // the 8'-6" passage: hall above, entry and BEDROOM 4's door below, kitchen 2's
    // solid wall west. Its east side is the puja's SOLID back wall — the puja is
    // entered from the hall, not here
    name: 'Passage',
    type: 'hallway',
    w: 260, l: 154, x: 435, z: 1143,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.4423, width: 200, height: 230, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.7942, width: 100, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.3769, width: 95, height: 205, sill: 0, bare: true },
    ],
    furniture: [],
  },
  {
    // 5'×6' puja alcove. Read from the plan: OPEN to the hall along its top
    // (north), a solid wall on the passage (west) side, the mandir platform
    // (pink line) along the south wall, a window east. An earlier trace put a
    // door on the passage side and walled it off from the hall — the opposite.
    name: 'Puja',
    type: 'hallway',
    w: 152, l: 154, x: 641, z: 1143,
    floor: 'glossy-marble',
    wall: '#f3e7cf',
    openings: [
      { kind: 'window', style: 'windowSingle', wallId: 'w1', t: 0.5, width: 60, height: 90, sill: 110, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 130, height: 220, sill: 0, frameColor: WOOD_FRAME },
    ],
    // mandir shelf on the south wall, facing the hall
    furniture: [{ a: 'storage-shelving', x: 76, z: 136, rot: Math.PI, color: '#a07a50' }],
  },
  {
    // 10'×8'-7" stair, entered from the entry passage ("UP" at its east end).
    // stair-u climbs on its LOCAL −x flight (flight A) and returns on +x; at
    // rot Q local −x maps to world +z, so the FIRST step is the south half of
    // the stair's east face. The doorway sits opposite that half (z 143–243 of
    // 262) with the stair pulled 50cm off the door wall so there is floor to
    // stand on. An earlier trace put the door on the north half: it opened onto
    // the TOP of the return flight with 12cm of floor — not the foot of the stair.
    // The plan draws its east side as a single stair-edge line, not a wall: the
    // whole side is OPEN to the entry passage.
    name: 'Stair',
    type: 'hallway',
    w: 305, l: 262, x: 152.5, z: 1351,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.4, width: 90, height: 100, sill: 120, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 250, height: 230, sill: 0 },
    ],
    // rot Q ⇒ the stair's entry end faces +x, i.e. the entry passage
    furniture: [{ a: 'stair-u', x: 130, z: 131, rot: Q, w: 240, d: 250, h: 270, color: '#b08f6e' }],
  },
  {
    // the 3'-6" entry from the front: main door at the bottom, the stair open to
    // the west, bedroom 4's SOLID side wall east, then north into the passage. The main door is listed
    // FIRST and the onward passage before the stair's: entranceSpawn takes the
    // first real door as the front door and faces the first passage onward.
    name: 'Entry',
    type: 'foyer',
    w: 107, l: 366, x: 358.5, z: 1403,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.5, width: 95, height: 215, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 100, height: 215, sill: 0 },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.6421, width: 250, height: 230, sill: 0, bare: true },
    ],
    furniture: [],
  },
  {
    // bottom-right 10'×12': window on the front wall. Door = the gap at the LEFT
    // end of its TOP wall, onto the 8'-6" passage. Its left wall, along the
    // entry, is unbroken on the plan. An earlier trace put the door in that
    // left wall — there is no gap there.
    name: 'Bedroom 4',
    type: 'bedroom',
    w: 305, l: 366, x: 564.5, z: 1403,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.5, width: 120, height: 130, sill: 90, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.1803, width: 95, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
    ],
    furniture: [
      { a: 'bed-queen', x: 190, z: 200, rot: -Q, color: '#d6ccbc' },
      { a: 'storage-wardrobe', x: 200, z: 32, rot: 0, color: TEAK },
    ],
  },
]

/** Geometry only — no title, locality or source citation. The public demo builds
 *  its unbranded sample house from this (src/demo/homes.ts); importing PANDAUL
 *  there instead would ship the locality name (scripts/lib/demo-leaks.mjs). */
export const PANDAUL_LEVELS: MultiLevelHome['levels'] = [{ label: 'Ground floor', elevationCm: 0, rooms: ground }]

export const PANDAUL: MultiLevelHome = {
  id: 'pandaul',
  title: 'Pandaul 4BHK House',
  emoji: '🏡',
  blurb: '4 bed · 2 kitchens · hall + puja · 1383 sq ft ground floor',
  reference: 'User-supplied photo of an AutoCAD ground-floor plan, 2026-10-02 (independent house, 1382.84 sq ft).',
  planNote: 'Traced from a photo of the ground-floor CAD plan; room sizes from its printed labels, doors from the gaps in each room outline. Hall drawn 13\'6" × 15\' (label 13\'1" × 14\') and puja 5\' × 5\' (label 5\' × 6\') so kitchen 2\'s door lands on the hall as drawn.',
  levels: PANDAUL_LEVELS,
}
