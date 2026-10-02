// Embercrest · 3 BHK Duplex (flat 504 · 173.42 m² including balconies) — from the
// architect's CAD plans in Duplex.pptx slide 1 ("A&B Building Floor Plans",
// pp. 4–5: typical lower + upper floor). Furniture and finishes follow the
// user-supplied furnished walkthrough (2026-09-26) — a style reference only,
// its layout is NOT this flat.
//
// Printed sizes were checked against Duplex.pptx slide 1 on 2026-09-28.
// These are model footprint dimensions; wall thickness / storey heights are
// assumptions, and the curved balconies are rectangular approximations.
// Positions are inferred from the CAD image scale, with shared boundaries kept
// aligned when correcting printed sizes. Balcony north edge is z=-20; the
// living's north/south edges are z=140/505. The enlarged study bay keeps its
// family-room boundary at x=832, and the upper entry ends at x=1447.
//
// Circulation as drawn:
//  - main door (from the common lift passage) → LOBBY → open into the living.
//  - the dog-leg stair (with a well) is entered from a small CORRIDOR south of
//    it; the corridor also serves bedroom 1, the common toilet and the living.
//  - the kitchen + wash area opens wide onto the living/dining.
//  - upstairs: the corridor (rail over the living void) → nook → family room
//    (rail over the void) → upper entry → upper lobby → bedroom 3 + its toilet.
// Storeys are 300cm. The living & dining and the stairwell are double height
// ("DOUBLE HT. LIVING BELOW" on the upper plan).

import type { MultiLevelHome } from './types'
import type { ReplicaRoom } from '../listingFlats'
import { Q, DARK_FRAME, WOOD_FRAME, RAIL } from './types'

const WALL = '#ede7dd'
const MARBLE = 'ivory-marble'
const BLUSH = '#d8bfb2' // upholstered beds in the reference
const WALNUT = '#6e4f37'
const BOUCLE = '#e7dfd3'
const STOREY = 300
const DOUBLE = 2 * STOREY

// Balcony finish from the reference: wood deck + slatted wood ceiling + glass rail.
const DECK = { floor: 'teak-plank', wall: '#e9e4dc', ceiling: { texture: 'wood-plank-ceiling', downlight: true } } as const

// Side balcony + bedroom + attached toilet — the same stack on both floors
// (bedroom 1 below, bedroom 2 above).
const bedroomStack = (n: 1 | 2, toiletName: string): ReplicaRoom[] => [
  {
    name: `Open Balcony ${n}`,
    type: 'balcony',
    w: 148, l: 360, x: 73, z: 325,
    wallHeight: STOREY,
    ...DECK,
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w1', t: 0.5, width: 200, height: 240, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w3', t: 0.5, width: 330, height: 270, sill: 0, frameColor: RAIL },
    ],
    furniture: [
      { a: 'chair-accent', x: 75, z: 80, rot: 0.3, color: BOUCLE },
      { a: 'decor-plant', x: 75, z: 300, rot: 0 },
    ],
  },
  {
    name: `Bedroom ${n}`,
    type: 'bedroom',
    w: 335, l: 425, x: 314.5, z: 292.5,
    wallHeight: STOREY,
    floor: 'walnut',
    wall: '#efe6dc',
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.5, width: 200, height: 170, sill: 50, frameColor: DARK_FRAME },
      { kind: 'door', style: 'slider', wallId: 'w3', t: 0.424, width: 200, height: 240, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.588, width: 70, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.876, width: 80, height: 210, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      // head on the east wall; bouclé chair by the window; AC over the balcony slider
      { a: 'bed-queen', x: 224, z: 180, rot: -Q, color: BLUSH },
      { a: 'storage-nightstand', x: 310, z: 40, rot: -Q, color: WALNUT },
      { a: 'storage-nightstand', x: 310, z: 290, rot: -Q, color: WALNUT },
      { a: 'decor-lamp-table', x: 310, z: 40, rot: 0, color: '#e7dcc3' },
      { a: 'decor-rug', x: 190, z: 180, rot: Q, color: '#e3d6c8' },
      { a: 'storage-wardrobe', x: 60, z: 393, rot: Math.PI, color: '#9a7352', w: 80 },
      { a: 'chair-accent', x: 80, z: 60, rot: 0.6, color: BOUCLE },
      { a: 'decor-ac', x: 170, z: 12, rot: 0 },
    ],
  },
  {
    name: toiletName,
    type: 'bathroom',
    w: 150, l: 305, x: 250, z: 657.5,
    wallHeight: STOREY,
    floor: 'grey-tile',
    wall: '#d9d4cc',
    wallTexture: 'marble-wall',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.733, width: 70, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.5, width: 60, height: 60, sill: 150, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'bath-vanity', x: 25, z: 80, rot: Q, color: '#e9e4dc' },
      { a: 'bath-toilet', x: 116, z: 150, rot: -Q },
      { a: 'bath-shower', x: 50, z: 250, rot: 0 },
    ],
  },
]

const lower: ReplicaRoom[] = [
  ...bedroomStack(1, 'Toilet 1'),
  {
    // DOUBLE-HEIGHT stairwell: dog-leg round a well, entered from the corridor (south)
    name: 'Stair Hall',
    type: 'hallway',
    w: 328, l: 320, x: 646, z: 240,
    wallHeight: DOUBLE,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.5, width: 150, height: 150, sill: 380, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 300, height: 230, sill: 0 },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 300, height: 230, sill: STOREY, bare: true },
    ],
    // rot 0 ⇒ entry/exit end faces +z (the corridor); lower flight is the west one
    furniture: [{ a: 'stair-u', x: 164, z: 160, rot: 0, w: 290, d: 300, h: STOREY, color: '#8a6446' }],
  },
  {
    name: 'Corridor',
    type: 'hallway',
    w: 328, l: 105, x: 646, z: 452.5,
    wallHeight: STOREY,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 300, height: 230, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 80, height: 210, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.0915, width: 60, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 100, height: 230, sill: 0 },
    ],
    furniture: [],
  },
  {
    name: 'Toilet 2',
    type: 'bathroom',
    w: 250, l: 135, x: 707, z: 572.5,
    wallHeight: STOREY,
    floor: 'grey-tile',
    wall: '#d9d4cc',
    wallTexture: 'marble-wall',
    openings: [{ kind: 'door', style: 'single', wallId: 'w0', t: 0.792, width: 60, height: 205, sill: 0, bare: true }],
    furniture: [
      { a: 'bath-toilet', x: 34, z: 80, rot: Q },
      { a: 'bath-vanity', x: 110, z: 110, rot: Math.PI, color: '#e9e4dc' },
    ],
  },
  {
    // DOUBLE-HEIGHT living & dining: dining toward the kitchen opening, lounge
    // on the east wall, the mural console by the corridor — as in the reference
    name: 'Living & Dining',
    type: 'living',
    w: 650, l: 365, x: 1135, z: 322.5,
    wallHeight: DOUBLE,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w0', t: 0.5, width: 400, height: 260, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
      // west: the corridor below; the upper corridor's rail looks in above it
      { kind: 'door', style: 'passage', wallId: 'w3', t: 52.5 / 365, width: 100, height: 230, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w3', t: 52.5 / 365, width: 100, height: 110, sill: STOREY, bare: true },
      // south: kitchen + lobby below; the family room's rail over the void above
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.592, width: 290, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.142, width: 140, height: 230, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w2', t: 0.6215, width: 400, height: 110, sill: STOREY, bare: true },
    ],
    furniture: [
      { a: 'table-dining', x: 265, z: 190, rot: 0, color: '#ece8e1', w: 190, d: 100 },
      { a: 'chair-dining', x: 205, z: 112, rot: 0, color: '#c9c6c1' },
      { a: 'chair-dining', x: 265, z: 112, rot: 0, color: '#c9c6c1' },
      { a: 'chair-dining', x: 325, z: 112, rot: 0, color: '#c9c6c1' },
      { a: 'chair-dining', x: 205, z: 268, rot: Math.PI, color: '#c9c6c1' },
      { a: 'chair-dining', x: 265, z: 268, rot: Math.PI, color: '#c9c6c1' },
      { a: 'chair-dining', x: 325, z: 268, rot: Math.PI, color: '#c9c6c1' },
      { a: 'decor-chandelier', x: 265, z: 190, rot: 0, color: '#d9b57a', w: 100, d: 100, h: 300 },
      { a: 'decor-rug-large', x: 500, z: 170, rot: Q, color: '#d8cdbd', w: 240, d: 260 },
      { a: 'sofa-3', x: 600, z: 170, rot: -Q, color: BOUCLE },
      { a: 'table-coffee', x: 490, z: 170, rot: Q, color: '#e8e4dc' },
      { a: 'chair-accent', x: 420, z: 80, rot: 2.4, color: BOUCLE },
      // Illustrative licensed GLB, sized from its mesh bounds; not a real product specification.
      { a: 'chair-accent', x: 420, z: 260, rot: 0.7, color: BOUCLE,
        w: 82.8614, d: 57.183, h: 68.7355, assetRef: { assetVersionId: 'sample-damask-chair-v1' } },
      { a: 'table-console', x: 19, z: 120, rot: Q, color: '#8c6a4e' },
      { a: 'decor-lamp', x: 630, z: 330, rot: 0, color: '#c9b48c' },
      { a: 'decor-plant', x: 40, z: 30, rot: 0 },
    ],
  },
  {
    name: 'Open Balcony',
    type: 'balcony',
    w: 667, l: 160, x: 1143.5, z: 60,
    wallHeight: STOREY,
    ...DECK,
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w2', t: 342 / 667, width: 400, height: 260, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w0', t: 0.5, width: 620, height: 270, sill: 0, frameColor: RAIL },
    ],
    furniture: [
      { a: 'decor-plant', x: 40, z: 75, rot: 0 },
      { a: 'chair-accent', x: 300, z: 75, rot: 0.4, color: BOUCLE },
      { a: 'table-side', x: 380, z: 75, rot: 0, color: '#2e2b29' },
      { a: 'decor-plant', x: 610, z: 75, rot: 0 },
    ],
  },
  {
    // L-shaped white/grey kitchen + wash area, open to the dining
    name: 'Kitchen',
    type: 'kitchen',
    w: 448, l: 305, x: 1056, z: 657.5,
    wallHeight: STOREY,
    floor: MARBLE,
    wall: '#efe9df',
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.542, width: 290, height: 220, sill: 0 },
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.5, width: 150, height: 120, sill: 100, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'kitchen-stove', x: 40, z: 272, rot: Math.PI },
      { a: 'kitchen-counter', x: 200, z: 275, rot: Math.PI, w: 240, color: '#e6e3de' },
      { a: 'kitchen-sink', x: 368, z: 275, rot: Math.PI, color: '#e6e3de' },
      { a: 'kitchen-fridge', x: 411, z: 110, rot: -Q, color: '#8a8d90' },
      { a: 'kitchen-washer', x: 40, z: 60, rot: Q },
    ],
  },
  {
    // main door from the common lift passage (east); opens north into the living
    name: 'Lobby',
    type: 'foyer',
    w: 155, l: 193, x: 1367.5, z: 601.5,
    wallHeight: STOREY,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 140, height: 230, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.26, width: 95, height: 215, sill: 0, frameColor: WOOD_FRAME, leafColor: '#8a6a4e' },
    ],
    furniture: [{ a: 'storage-shoe', x: 20, z: 150, rot: Q, color: '#8c6a4e' }],
  },
]

const upper: ReplicaRoom[] = [
  ...bedroomStack(2, 'Toilet 3'),
  {
    // top of the stair; its east end is a glass rail over the living void
    name: 'Upper Corridor',
    type: 'hallway',
    w: 328, l: 105, x: 646, z: 452.5,
    wallHeight: STOREY,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 300, height: 230, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 80, height: 210, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.348, width: 180, height: 220, sill: 0 },
      { kind: 'window', style: 'windowRail', wallId: 'w1', t: 0.5, width: 100, height: 110, sill: 0, frameColor: RAIL },
    ],
    furniture: [],
  },
  {
    // the plan's 2.97 × 1.35 bay between the corridor and the family room
    name: 'Study Nook',
    type: 'office',
    w: 297, l: 135, x: 683.5, z: 572.5,
    wallHeight: STOREY,
    floor: 'walnut',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 161 / 297, width: 180, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 110, height: 220, sill: 0, bare: true },
    ],
    furniture: [
      { a: 'desk-writing', x: 40, z: 67, rot: Q, color: WALNUT },
      { a: 'chair-office', x: 95, z: 67, rot: -Q },
    ],
  },
  {
    // over the kitchen; its north side is a glass rail over the living void
    name: 'Family Room',
    type: 'living',
    w: 448, l: 305, x: 1056, z: 657.5,
    wallHeight: STOREY,
    floor: 'walnut',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowRail', wallId: 'w0', t: 0.5, width: 400, height: 110, sill: 0, frameColor: RAIL },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.779, width: 110, height: 220, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.295, width: 80, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.5, width: 175, height: 150, sill: 80, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'decor-rug-large', x: 200, z: 215, rot: Q, color: '#d8cdbd', w: 200, d: 260 },
      { a: 'sofa-2', x: 46, z: 215, rot: Q, color: BOUCLE },
      { a: 'table-coffee', x: 160, z: 215, rot: Q, color: WALNUT },
      { a: 'chair-accent', x: 270, z: 130, rot: -2.2, color: BOUCLE },
      { a: 'storage-tv', x: 428, z: 215, rot: -Q, color: WALNUT },
      { a: 'decor-tv', x: 428, z: 215, rot: -Q },
      { a: 'decor-lamp', x: 30, z: 280, rot: 0, color: '#c9b48c' },
    ],
  },
  {
    name: 'Upper Entry',
    type: 'hallway',
    w: 167, l: 180, x: 1363.5, z: 595,
    wallHeight: STOREY,
    floor: 'walnut',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 80, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.5, width: 80, height: 205, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [],
  },
  {
    name: 'Upper Lobby',
    type: 'hallway',
    w: 165, l: 185, x: 1529.5, z: 597.5,
    wallHeight: STOREY,
    floor: MARBLE,
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.514, width: 80, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w0', t: 53 / 165, width: 80, height: 210, sill: 0, bare: true },
    ],
    furniture: [{ a: 'decor-plant', x: 140, z: 160, rot: 0 }],
  },
  {
    name: 'Bedroom 3',
    type: 'bedroom',
    w: 335, l: 365, x: 1627.5, z: 322.5,
    wallHeight: STOREY,
    floor: 'walnut',
    wall: '#efe6dc',
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.45, width: 200, height: 160, sill: 50, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.881, width: 80, height: 210, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.575, width: 60, height: 205, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      { a: 'bed-queen', x: 111, z: 180, rot: Q, color: BLUSH },
      { a: 'storage-nightstand', x: 25, z: 70, rot: Q, color: WALNUT },
      { a: 'storage-nightstand', x: 25, z: 290, rot: Q, color: WALNUT },
      { a: 'decor-lamp-table', x: 25, z: 70, rot: 0, color: '#e7dcc3' },
      { a: 'storage-wardrobe', x: 200, z: 335, rot: Math.PI, color: '#9a7352', w: 150 },
      { a: 'decor-ac', x: 280, z: 12, rot: 0 },
    ],
  },
  {
    name: 'Toilet 4',
    type: 'bathroom',
    w: 150, l: 245, x: 1870, z: 262.5,
    wallHeight: STOREY,
    floor: 'grey-tile',
    wall: '#d9d4cc',
    wallTexture: 'marble-wall',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.143, width: 60, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowSingle', wallId: 'w1', t: 0.5, width: 60, height: 60, sill: 150, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'bath-toilet', x: 116, z: 60, rot: -Q },
      { a: 'bath-vanity', x: 125, z: 150, rot: -Q, color: '#e9e4dc' },
    ],
  },
]

/** The duplex geometry alone, without any client name or source citation. The
 *  public demo (src/demo/homes.ts) builds an unbranded home from this, so the
 *  EMBERCREST object below — and its strings — tree-shake out of that bundle.
 *  Keep names, citations and claims OFF the rooms; put them on EMBERCREST. */
export const EMBERCREST_LEVELS: MultiLevelHome['levels'] = [
  { label: 'Lower floor', elevationCm: 0, rooms: lower },
  { label: 'Upper floor', elevationCm: STOREY, rooms: upper },
]

export const EMBERCREST: MultiLevelHome = {
  id: 'embercrest',
  title: 'Embercrest 3BHK Duplex',
  emoji: '🔥',
  blurb: 'Flat 504 · 3 BHK duplex · 173.42 m² including balconies · double-height living',
  reference:
    'Duplex.pptx slide 1 (flat 504, 3 BHK duplex; 148.57 m² carpet + 24.85 m² balconies; A&B Building floor plans pp. 4–5) + furnished walkthrough video 2026-09-26 (style only).',
  planNote: 'Duplex.pptx · page 1 · A/B flat 504. Printed room sizes checked. Plan area: 148.57 m² carpet + 24.85 m² balconies. Wall thickness, ceiling heights and curved balcony shapes remain approximate.',
  levels: EMBERCREST_LEVELS,
}
