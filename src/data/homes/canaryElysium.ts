// The Canary Sky Oasis · 3 BHK Duplex "Elysium" (1574 sq ft · video 2026-09-24).
//
// Traced wall-by-wall from the unit plan in the video (lower + upper floor),
// room sizes from the plan's printed labels (ft → cm). Grid, so neighbours butt:
//   x: 0 · 175 (WIR | bedroom) · 270 (washroom | powder) · 510 (bedroom |
//      kitchen/passage) · 640 (powder | stair) · 815 · 840 (| living) · 1240
//   z: 16 (balcony) · 63 (dry bal) · 130 (bedroom) · 143 (kitchen) · 260
//      (balcony | living) · 342 (WIR) · 450 (passage) · 555 (bath row / stair)
//      · 710 · 840 (stair | lobby) · 1005
//
// Circulation as drawn — keep it that way, the plan is the source of truth:
//  - main door → LOBBY → living only. The stair box has a solid wall on the
//    lobby side: there is NO opening from the lobby into the stair.
//  - the stair is a dog-leg reached from the PASSAGE (its "UP" is at the
//    passage end); upstairs it arrives back at the same end, on the upper
//    passage. Its living-room side is open (a rail) at ground level only.
//  - the kitchen is open along most of its bottom edge to the passage; the
//    passage runs straight into the living room.
//  - WIR opens off the master bedroom's west side; the washroom is entered from
//    the bedroom, the powder room from the passage.
// Storeys are 290cm floor-to-floor. Double height (580): living & dining, its
// jali balcony, and the stairwell — the upper plan's "…below" voids.

import type { MultiLevelHome } from './types'
import type { ReplicaRoom } from '../listingFlats'
import { Q, DARK_FRAME, WOOD_FRAME, RAIL } from './types'

const WALL = '#ebe4da'
const OAK = '#b99a7c'
const STONE = '#2a2a2b'
const STOREY = 290
const DOUBLE = 2 * STOREY

// Bedroom + WIR + washroom block — the same footprint on both floors (master
// bedroom below, bedroom 2 above); only the top-wall opening differs.
const bedroomBlock = (name: string, suffix: string, bedColor: string, top: ReplicaRoom['openings']): ReplicaRoom[] => [
  {
    name,
    type: 'bedroom',
    w: 335, l: 425, x: 342.5, z: 342.5,
    wallHeight: STOREY,
    floor: 'light-concrete',
    wall: WALL,
    openings: [
      ...top,
      { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.765, width: 100, height: 120, sill: 90, frameColor: DARK_FRAME },
      // WIR (west), passage door (east, bottom end), washroom door (south)
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.254, width: 85, height: 210, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.876, width: 85, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.836, width: 70, height: 205, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      // bed head on the kitchen-side (east) wall, study desk top-left — as drawn
      { a: 'bed-queen', x: 220, z: 237, rot: -Q, color: bedColor },
      { a: 'storage-nightstand', x: 312, z: 132, rot: -Q, color: '#3a3634' },
      { a: 'storage-nightstand', x: 312, z: 342, rot: -Q, color: '#3a3634' },
      { a: 'decor-lamp-table', x: 312, z: 132, rot: 0, color: '#e7dcc3' },
      { a: 'decor-rug', x: 190, z: 237, rot: Q, color: '#ddd5c8' },
      { a: 'desk-writing', x: 40, z: 60, rot: Q, color: '#8a6a52' },
    ],
  },
  {
    // wardrobes run along its top and bottom walls; open to the bedroom
    name: `Walk-in Wardrobe${suffix}`,
    type: 'hallway',
    w: 175, l: 213, x: 87.5, z: 448.5,
    wallHeight: STOREY,
    floor: 'light-concrete',
    wall: WALL,
    openings: [{ kind: 'door', style: 'passage', wallId: 'w1', t: 0.493, width: 85, height: 210, sill: 0, bare: true }],
    furniture: [
      { a: 'storage-wardrobe', x: 87, z: 32, rot: 0, color: OAK, w: 150 },
      { a: 'storage-wardrobe', x: 87, z: 181, rot: Math.PI, color: OAK, w: 150 },
    ],
  },
  {
    name: `Washroom${suffix}`,
    type: 'bathroom',
    w: 270, l: 155, x: 135, z: 632.5,
    wallHeight: STOREY,
    floor: 'slate-tile',
    wall: '#8f8b86',
    wallTexture: 'slate-tile',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.852, width: 70, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowSingle', wallId: 'w2', t: 0.5, width: 60, height: 60, sill: 160, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'bath-shower', x: 60, z: 105, rot: 0 },
      { a: 'bath-toilet', x: 145, z: 121, rot: Math.PI },
      { a: 'bath-vanity', x: 225, z: 130, rot: Math.PI, color: STONE },
    ],
  },
]

// Powder room below / washroom 3 above — same footprint, entered from the passage.
const passageBath = (name: string): ReplicaRoom => ({
  name,
  type: 'bathroom',
  w: 370, l: 155, x: 455, z: 632.5,
  wallHeight: STOREY,
  floor: 'grey-tile',
  wall: '#cfcac2',
  openings: [
    { kind: 'door', style: 'single', wallId: 'w0', t: 0.838, width: 70, height: 205, sill: 0, frameColor: WOOD_FRAME },
    { kind: 'window', style: 'windowSingle', wallId: 'w2', t: 0.4, width: 60, height: 60, sill: 160, frameColor: DARK_FRAME },
  ],
  furniture: [
    { a: 'bath-toilet', x: 170, z: 121, rot: Math.PI },
    { a: 'bath-vanity', x: 300, z: 130, rot: Math.PI, color: STONE },
  ],
})

const lower: ReplicaRoom[] = [
  ...bedroomBlock('Master Bedroom', '', '#e6e1d8', [
    { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.3, width: 150, height: 150, sill: 80, frameColor: DARK_FRAME },
  ]),
  passageBath('Powder Room'),
  {
    name: 'Dry Balcony',
    type: 'balcony',
    w: 305, l: 80, x: 662.5, z: 103,
    wallHeight: STOREY,
    floor: 'grey-tile',
    wall: '#cfcac2',
    openings: [{ kind: 'door', style: 'glass', wallId: 'w2', t: 0.508, width: 90, height: 210, sill: 0, bare: true }],
    furniture: [{ a: 'kitchen-washer', x: 60, z: 40, rot: 0 }],
  },
  {
    // parallel kitchen: sink + hob on the west run, fridge + counter on the east
    name: 'Kitchen',
    type: 'kitchen',
    w: 305, l: 307, x: 662.5, z: 296.5,
    wallHeight: STOREY,
    floor: 'sand-tile',
    wall: '#e9e1d4',
    openings: [
      { kind: 'door', style: 'glass', wallId: 'w0', t: 0.492, width: 90, height: 210, sill: 0, frameColor: DARK_FRAME },
      // open along most of the bottom edge onto the passage
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.385, width: 210, height: 220, sill: 0 },
    ],
    furniture: [
      { a: 'kitchen-sink', x: 32, z: 60, rot: Q, color: OAK },
      { a: 'kitchen-stove', x: 35, z: 180, rot: Q },
      { a: 'kitchen-fridge', x: 268, z: 60, rot: -Q, color: '#4a4c4f' },
      { a: 'kitchen-counter', x: 275, z: 200, rot: -Q, w: 180, color: OAK },
    ],
  },
  {
    // the circulation spine: kitchen above, bedroom west, powder + stair below,
    // and straight on (east) into the living room
    name: 'Passage',
    type: 'hallway',
    w: 330, l: 105, x: 675, z: 502.5,
    wallHeight: STOREY,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.568, width: 210, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 85, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.788, width: 70, height: 205, sill: 0, bare: true },
      // the foot of the stair ("UP")
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.303, width: 180, height: 220, sill: 0 },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 95, height: 220, sill: 0 },
    ],
    furniture: [],
  },
  {
    // DOUBLE-HEIGHT stairwell. Dog-leg: "UP" from the passage end, half-landing
    // at the lobby end, back up to the passage end on the upper floor. The lobby
    // side (w2) is SOLID — the plan draws a full wall there.
    name: 'Stair Hall',
    type: 'hallway',
    w: 200, l: 285, x: 740, z: 697.5,
    wallHeight: DOUBLE,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 180, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 180, height: 220, sill: STOREY, bare: true },
      // open to the living at ground level (the plan's thin rail line)
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 260, height: 270, sill: 0 },
    ],
    furniture: [{ a: 'stair-u', x: 100, z: 142, rot: Math.PI, w: 190, d: 275, h: STOREY, color: '#b08f6e' }],
  },
  {
    // main door at the bottom; the lobby opens EAST into the living room only
    name: 'Entry Lobby',
    type: 'foyer',
    w: 200, l: 165, x: 740, z: 922.5,
    wallHeight: STOREY,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.425, width: 95, height: 215, sill: 0, frameColor: WOOD_FRAME, leafColor: '#8a6a4e' },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 110, height: 215, sill: 0 },
    ],
    furniture: [
      { a: 'bench-entry', x: 22, z: 82, rot: Q, color: '#8a6a52' },
      { a: 'decor-plant', x: 175, z: 30, rot: 0 },
    ],
  },
  {
    // the jali balcony: two storeys tall, lattice screen on both open sides
    name: 'Balcony',
    type: 'balcony',
    w: 400, l: 244, x: 1040, z: 138,
    wallHeight: DOUBLE,
    floor: 'slate-tile',
    wall: '#9c9892',
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w2', t: 0.5, width: 300, height: 260, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w0', t: 0.5, width: 370, height: 540, sill: 20, frameColor: DARK_FRAME },
      { kind: 'window', style: 'windowRail', wallId: 'w1', t: 0.5, width: 214, height: 540, sill: 20, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'decor-jali', x: 200, z: 12, rot: 0, w: 360, h: 540 },
      { a: 'decor-jali', x: 387, z: 132, rot: -Q, w: 220, h: 540 },
      // two lounge chairs + a side table, top-right as drawn
      { a: 'chair-accent', x: 270, z: 150, rot: -2.4, color: '#4b3a2d' },
      { a: 'chair-accent', x: 330, z: 80, rot: -0.8, color: '#4b3a2d' },
      { a: 'table-side', x: 250, z: 70, rot: 0, color: '#2e2b29' },
      { a: 'decor-plant', x: 50, z: 200, rot: 0 },
    ],
  },
  {
    // DOUBLE-HEIGHT living & dining: dining by the balcony, sofa on the east
    // wall with an armchair + side table at each end, as drawn
    name: 'Living & Dining',
    type: 'living',
    w: 400, l: 745, x: 1040, z: 632.5,
    wallHeight: DOUBLE,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w0', t: 0.5, width: 300, height: 260, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
      // west side, top to bottom: passage, stair (rail), lobby
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.6745, width: 95, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.4128, width: 260, height: 270, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.1107, width: 110, height: 215, sill: 0, bare: true },
      { kind: 'window', style: 'windowDouble', wallId: 'w1', t: 0.5, width: 175, height: 180, sill: 60, frameColor: DARK_FRAME },
      { kind: 'window', style: 'windowDouble', wallId: 'w1', t: 0.5, width: 175, height: 150, sill: 330, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'table-dining', x: 200, z: 185, rot: 0, color: '#e3ddd3', w: 190, d: 90 },
      { a: 'chair-dining', x: 140, z: 112, rot: 0, color: '#e8e2d8' },
      { a: 'chair-dining', x: 200, z: 112, rot: 0, color: '#e8e2d8' },
      { a: 'chair-dining', x: 260, z: 112, rot: 0, color: '#e8e2d8' },
      { a: 'chair-dining', x: 140, z: 258, rot: Math.PI, color: '#e8e2d8' },
      { a: 'chair-dining', x: 200, z: 258, rot: Math.PI, color: '#e8e2d8' },
      { a: 'chair-dining', x: 260, z: 258, rot: Math.PI, color: '#e8e2d8' },
      { a: 'decor-chandelier', x: 200, z: 185, rot: 0, color: '#d9b57a', w: 80, d: 80, h: 260 },
      { a: 'decor-rug-large', x: 270, z: 580, rot: 0, color: '#e6dfd3', w: 240, d: 300 },
      { a: 'sofa-3', x: 352, z: 580, rot: -Q, color: '#efeae1' },
      { a: 'table-coffee', x: 265, z: 580, rot: Q, color: '#e8e4dc' },
      { a: 'chair-accent', x: 265, z: 450, rot: 0, color: '#d8cfc2' },
      { a: 'chair-accent', x: 265, z: 700, rot: Math.PI, color: '#d8cfc2' },
      { a: 'table-side', x: 352, z: 445, rot: 0, color: '#2e2b29' },
      { a: 'table-side', x: 352, z: 712, rot: 0, color: '#2e2b29' },
      { a: 'decor-lamp-arc', x: 60, z: 60, rot: 0, color: '#b08d57' },
      { a: 'decor-tree', x: 370, z: 40, rot: 0 },
    ],
  },
]

const upper: ReplicaRoom[] = [
  {
    // off bedroom 2 (the lower plan's "balcony above")
    name: 'Balcony 2',
    type: 'balcony',
    w: 215, l: 80, x: 282.5, z: 90,
    wallHeight: STOREY,
    floor: 'slate-tile',
    wall: '#9c9892',
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w2', t: 0.512, width: 160, height: 212, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w0', t: 0.5, width: 200, height: 110, sill: 0, frameColor: RAIL },
    ],
    furniture: [
      { a: 'chair-accent', x: 60, z: 40, rot: 0.4, color: '#b7a891' },
      { a: 'table-side', x: 140, z: 40, rot: 0, color: '#2e2b29' },
    ],
  },
  // terracotta upholstered bed (video, bedroom 2); slider out to its balcony
  ...bedroomBlock('Bedroom 2', ' 2', '#b0735a', [
    { kind: 'door', style: 'slider', wallId: 'w0', t: 0.313, width: 160, height: 212, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
  ]),
  {
    // over the kitchen: bed head east, wardrobe along the south wall, desk top-left
    name: 'Bedroom 3',
    type: 'bedroom',
    w: 305, l: 430, x: 662.5, z: 235,
    wallHeight: STOREY,
    floor: 'light-concrete',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w0', t: 0.5, width: 200, height: 170, sill: 60, frameColor: DARK_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.852, width: 80, height: 205, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [
      { a: 'bed-full', x: 185, z: 180, rot: -Q, color: '#d6ccbc' },
      { a: 'storage-nightstand', x: 285, z: 80, rot: -Q, color: '#2e2b29' },
      { a: 'storage-nightstand', x: 285, z: 280, rot: -Q, color: '#2e2b29' },
      { a: 'decor-lamp-table', x: 285, z: 80, rot: 0, color: '#e7dcc3' },
      { a: 'storage-wardrobe', x: 187, z: 400, rot: Math.PI, color: OAK, w: 195 },
      { a: 'desk-writing', x: 32, z: 90, rot: Q, color: '#8a6a52' },
    ],
  },
  {
    // arrives from the stair; bedroom 3 above, bedroom 2 west, washroom 3 below.
    // Its east side is a solid wall over the living void (as drawn).
    name: 'Upper Passage',
    type: 'hallway',
    w: 330, l: 105, x: 675, z: 502.5,
    wallHeight: STOREY,
    floor: 'marble-tile',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.136, width: 80, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 85, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.788, width: 70, height: 205, sill: 0, bare: true },
      // top of the stair — the stair hall carries the twin hole at +290
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.303, width: 180, height: 220, sill: 0 },
    ],
    furniture: [],
  },
  passageBath('Washroom 3'),
]

export const CANARY_ELYSIUM: MultiLevelHome = {
  id: 'canary',
  title: 'Canary Elysium 3BHK',
  emoji: '🏛️',
  blurb: '3 BHK duplex · 1574 sq ft · double-height living + jali balcony',
  reference:
    'User-supplied show-flat video + unit plan, 2026-09-24 (The Canary Sky Oasis, 3 BHK Duplex Elysium, 1574 sq ft).',
  levels: [
    { label: 'Lower floor', elevationCm: 0, rooms: lower },
    { label: 'Upper floor', elevationCm: STOREY, rooms: upper },
  ],
}
