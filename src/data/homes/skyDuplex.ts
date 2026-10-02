// Raheja Vistas · 3+ Sky Duplex (1472 sq ft) — from the developer's unit
// layouts (RAHEJA VISTAS UNIT LAYOUTS.pdf, pp. 6–7: "Sky Duplex (Lower)" /
// "3+ Sky Duplex (Upper)"), the same home as the 2026-09-26 walkthrough video.
//
// Every room size below is the plan's printed metric dimension (w × l in cm);
// positions are the plan's arrangement snapped to a shared grid so neighbours
// butt exactly:
//   x: 0 · 165 (foyer) · 200 (stairwell | store, upper) · 320 · 490 · 552.5
//      · 625 · 690 · 935
//   z: 0 · 245 (foyer/kitchen | stair/dining) · 345 · 435 (stair | living)
//      · 482.5 · 592.5 · 832.5 (living | balcony) · 855 · 964.5
// Storeys are 300cm floor-to-floor. The living room and its balcony are double
// height (the upper plan's "LIVING BELOW" / "BALCONY BELOW" voids); upstairs,
// the stairwell (x 0..200 over the lower staircase) is left open.

import type { MultiLevelHome } from './types'
import type { ReplicaRoom } from '../listingFlats'
import { Q, DARK_FRAME, WOOD_FRAME, RAIL } from './types'

const WALL = '#e8e1d6'
const WALNUT = '#6e4f37'
const LINEN = '#d9d0c1'
const OAK = '#b99a7c'
const STOREY = 300
const DOUBLE = 2 * STOREY

// The attached toilet (2.45 × 1.375) sits in the same spot on both floors.
const attachedToilet = (name: string): ReplicaRoom => ({
  name,
  type: 'bathroom',
  w: 245, l: 137.5, x: 812.5, z: 413.75,
  wallHeight: STOREY,
  floor: 'grey-tile',
  wall: '#cfcac2',
  openings: [
    { kind: 'window', style: 'windowSingle', wallId: 'w0', t: 0.5, width: 60, height: 60, sill: 150, frameColor: DARK_FRAME },
    { kind: 'door', style: 'single', wallId: 'w2', t: 0.878, width: 60, height: 205, sill: 0, frameColor: WOOD_FRAME },
  ],
  furniture: [
    { a: 'bath-vanity', x: 55, z: 30, rot: 0, color: '#3a3330' },
    { a: 'bath-toilet', x: 160, z: 34, rot: 0 },
  ],
})

const lower: ReplicaRoom[] = [
  {
    // entry from the lift lobby (the plan's ▶ on the left)
    name: 'Foyer',
    type: 'foyer',
    w: 155, l: 245, x: 242.5, z: 122.5,
    wallHeight: STOREY,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.184, width: 90, height: 215, sill: 0, frameColor: WOOD_FRAME, leafColor: '#8a6a4e' },
      // no door here: the foyer flows straight on into the stair / dining area
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 140, height: 230, sill: 0 },
    ],
    furniture: [{ a: 'storage-shoe', x: 137, z: 60, rot: -Q, color: WALNUT }],
  },
  {
    // dog-leg stair as drawn: lower flight along the south side climbing west,
    // winder/half-landing at the west end, upper flight back east — so it is
    // entered from, and arrives upstairs at, the EAST end (foyer/store side);
    // the strip east of it is the open walkway from the foyer to the dining
    name: 'Staircase',
    type: 'hallway',
    w: 320, l: 190, x: 160, z: 340,
    wallHeight: STOREY,
    floor: 'ivory-marble',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.758, width: 140, height: 230, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 150, height: 230, sill: 0 },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 300, height: 250, sill: 0 },
    ],
    furniture: [{ a: 'stair-u', x: 115, z: 95, rot: Q, w: 180, d: 220, h: STOREY, color: '#a47a52' }],
  },
  {
    name: 'Kitchen',
    type: 'kitchen',
    w: 370, l: 245, x: 505, z: 122.5,
    wallHeight: STOREY,
    floor: 'marble-tile',
    wall: '#efe9df',
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w1', t: 0.5, width: 120, height: 120, sill: 100, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.703, width: 150, height: 220, sill: 0 },
    ],
    furniture: [
      { a: 'kitchen-stove', x: 160, z: 33, rot: 0 },
      { a: 'kitchen-sink', x: 300, z: 32, rot: 0, color: '#7a5a40' },
      { a: 'kitchen-counter', x: 340, z: 125, rot: -Q, w: 100, color: '#7a5a40' },
      { a: 'kitchen-fridge', x: 37, z: 170, rot: Q },
      { a: 'kitchen-washer', x: 330, z: 205, rot: Math.PI },
    ],
  },
  {
    name: 'Dining',
    type: 'dining',
    w: 232.5, l: 347.5, x: 436.25, z: 418.75,
    wallHeight: STOREY,
    floor: 'chevron',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.473, width: 150, height: 220, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.727, width: 150, height: 230, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.229, width: 140, height: 230, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.842, width: 100, height: 215, sill: 0, bare: true },
    ],
    furniture: [
      { a: 'table-dining', x: 116, z: 175, rot: Q, color: WALNUT, w: 160, d: 90 },
      { a: 'chair-dining', x: 45, z: 135, rot: Q, color: '#cdbfa8' },
      { a: 'chair-dining', x: 45, z: 215, rot: Q, color: '#cdbfa8' },
      { a: 'chair-dining', x: 187, z: 135, rot: -Q, color: '#cdbfa8' },
      { a: 'chair-dining', x: 187, z: 215, rot: -Q, color: '#cdbfa8' },
    ],
  },
  {
    // the little lobby the toilet and both bedrooms open off
    name: 'Passage',
    type: 'hallway',
    w: 72.5, l: 110, x: 588.75, z: 537.5,
    wallHeight: STOREY,
    floor: 'chevron',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.5, width: 100, height: 215, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 60, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.5, width: 80, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.5, width: 60, height: 205, sill: 0, frameColor: WOOD_FRAME },
    ],
    furniture: [],
  },
  {
    name: 'Toilet',
    type: 'bathroom',
    w: 137.5, l: 237.5, x: 621.25, z: 363.75,
    wallHeight: STOREY,
    floor: 'grey-tile',
    wall: '#cfcac2',
    openings: [{ kind: 'door', style: 'single', wallId: 'w2', t: 0.736, width: 60, height: 205, sill: 0, bare: true }],
    furniture: [
      { a: 'bath-toilet', x: 100, z: 110, rot: -Q },
      { a: 'bath-vanity', x: 100, z: 190, rot: -Q, color: '#3a3330' },
    ],
  },
  attachedToilet('Toilet 2'),
  {
    name: 'Bedroom 1',
    type: 'bedroom',
    w: 310, l: 372.5, x: 780, z: 668.75,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: '#ece6dc',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.306, width: 60, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.852, width: 80, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.5, width: 175, height: 150, sill: 80, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'storage-wardrobe', x: 220, z: 32, rot: 0, color: OAK },
      { a: 'bed-queen', x: 200, z: 230, rot: -Q, color: '#e9e4db' },
      { a: 'storage-nightstand', x: 285, z: 120, rot: -Q, color: WALNUT },
      { a: 'storage-nightstand', x: 285, z: 337, rot: -Q, color: WALNUT },
      { a: 'decor-lamp-table', x: 285, z: 120, rot: 0, color: '#d8c69a' },
      { a: 'decor-tv', x: 8, z: 230, rot: Q },
    ],
  },
  {
    name: 'Bedroom 2',
    type: 'bedroom',
    w: 305, l: 355, x: 472.5, z: 770,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: '#ece6dc',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.881, width: 60, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.475, width: 175, height: 150, sill: 80, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'storage-wardrobe', x: 140, z: 32, rot: 0, color: OAK },
      { a: 'bed-full', x: 111, z: 230, rot: Q, color: '#e6e1d8' },
      { a: 'storage-nightstand', x: 25, z: 125, rot: Q, color: WALNUT },
      { a: 'storage-nightstand', x: 25, z: 330, rot: Q, color: WALNUT },
      { a: 'desk-writing', x: 270, z: 250, rot: -Q, color: '#8a6a52' },
    ],
  },
  {
    // DOUBLE HEIGHT ("LIVING BELOW" on the upper plan): open to the staircase
    // and the dining, sofa on the west wall, TV on the east
    name: 'Living',
    type: 'living',
    w: 320, l: 397.5, x: 160, z: 633.75,
    wallHeight: DOUBLE,
    floor: 'chevron',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 300, height: 250, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.196, width: 140, height: 230, sill: 0 },
      { kind: 'door', style: 'slider', wallId: 'w2', t: 0.484, width: 170, height: 240, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
      // clerestory: daylight into the upper half of the two-storey volume
      { kind: 'window', style: 'windowDouble', wallId: 'w3', t: 0.5, width: 175, height: 180, sill: 340, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'decor-rug-large', x: 160, z: 260, rot: Q, color: '#b8aa95', w: 260, d: 220 },
      { a: 'sofa-3', x: 51, z: 260, rot: Q, color: LINEN },
      { a: 'table-coffee', x: 155, z: 260, rot: Q, color: WALNUT },
      { a: 'storage-tv', x: 299, z: 270, rot: -Q, color: WALNUT },
      { a: 'decor-tv', x: 299, z: 270, rot: -Q },
      { a: 'chair-arm', x: 110, z: 110, rot: 0.4, color: '#5b4636' },
      { a: 'chair-arm', x: 210, z: 110, rot: -0.4, color: '#5b4636' },
      { a: 'decor-chandelier', x: 160, z: 260, rot: 0, color: '#d9b57a', w: 90, d: 90, h: 300 },
      { a: 'decor-plant', x: 290, z: 370, rot: 0 },
    ],
  },
  {
    // DOUBLE HEIGHT ("BALCONY BELOW")
    name: 'Balcony',
    type: 'balcony',
    w: 320, l: 132, x: 160, z: 898.5,
    wallHeight: DOUBLE,
    floor: 'slate-tile',
    wall: '#9c9892',
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w0', t: 0.516, width: 170, height: 240, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w2', t: 0.5, width: 300, height: 110, sill: 0, frameColor: RAIL },
    ],
    furniture: [
      { a: 'decor-plant', x: 30, z: 100, rot: 0 },
      { a: 'chair-accent', x: 240, z: 70, rot: 0.6, color: '#b7a891' },
      { a: 'table-side', x: 170, z: 70, rot: 0, color: '#2e2b29' },
    ],
  },
]

const upper: ReplicaRoom[] = [
  {
    // WFH / study across the top: twin desks, a reading corner by the window
    name: 'WFH / Study',
    type: 'office',
    w: 535, l: 245, x: 432.5, z: 122.5,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: WALL,
    openings: [
      { kind: 'window', style: 'windowDouble', wallId: 'w1', t: 0.45, width: 150, height: 150, sill: 80, frameColor: DARK_FRAME },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.822, width: 100, height: 215, sill: 0 },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.551, width: 100, height: 215, sill: 0 },
    ],
    furniture: [
      { a: 'desk-office', x: 130, z: 35, rot: 0, color: WALNUT },
      { a: 'desk-office', x: 330, z: 35, rot: 0, color: WALNUT },
      { a: 'chair-office', x: 130, z: 100, rot: Math.PI },
      { a: 'chair-office', x: 330, z: 100, rot: Math.PI },
      { a: 'chair-lounge', x: 400, z: 180, rot: 0.6, color: '#8c8378' },
      { a: 'chair-lounge', x: 490, z: 180, rot: -0.6, color: '#8c8378' },
      { a: 'table-side', x: 445, z: 205, rot: 0, color: '#2e2b29' },
    ],
  },
  {
    // top of the stair: glass rail along the open stairwell to the west
    name: 'Store',
    type: 'hallway',
    w: 120, l: 190, x: 260, z: 340,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 100, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 100, height: 215, sill: 0 },
      // stairwell edge: open where the upper flight (the north half) arrives,
      // a glass rail only over the lower flight's half — a rail across the
      // whole edge walled the stair's top off from the store
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.737, width: 90, height: 215, sill: 0 },
      { kind: 'window', style: 'windowRail', wallId: 'w3', t: 0.25, width: 85, height: 110, sill: 0, frameColor: RAIL },
    ],
    furniture: [{ a: 'storage-cube', x: 60, z: 170, rot: Math.PI, color: '#b6b2aa' }],
  },
  {
    name: 'Landing',
    type: 'hallway',
    w: 170, l: 237.5, x: 405, z: 363.75,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 100, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w3', t: 0.6, width: 100, height: 215, sill: 0, bare: true },
      { kind: 'door', style: 'single', wallId: 'w1', t: 0.758, width: 70, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'single', wallId: 'w2', t: 0.529, width: 85, height: 205, sill: 0, bare: true },
    ],
    furniture: [{ a: 'decor-plant', x: 30, z: 205, rot: 0 }],
  },
  {
    // walk-through dresser into the master bedroom
    name: 'Dresser',
    type: 'hallway',
    w: 200, l: 237.5, x: 590, z: 363.75,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: WALL,
    openings: [
      { kind: 'door', style: 'single', wallId: 'w3', t: 0.242, width: 70, height: 205, sill: 0, bare: true },
      { kind: 'door', style: 'passage', wallId: 'w2', t: 0.15, width: 60, height: 210, sill: 0, bare: true },
    ],
    furniture: [
      { a: 'storage-wardrobe', x: 100, z: 32, rot: 0, color: OAK, w: 180 },
      { a: 'ottoman-pouf', x: 100, z: 140, rot: 0, color: '#d8cfc2' },
    ],
  },
  attachedToilet('Master Toilet'),
  {
    name: 'Master Bedroom',
    type: 'bedroom',
    w: 310, l: 372.5, x: 780, z: 668.75,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: '#ece6dc',
    openings: [
      { kind: 'door', style: 'passage', wallId: 'w0', t: 0.113, width: 60, height: 210, sill: 0 },
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.306, width: 60, height: 205, sill: 0, bare: true },
      { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.5, width: 175, height: 150, sill: 80, frameColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'bed-queen', x: 200, z: 230, rot: -Q, color: '#e9e4db' },
      { a: 'storage-nightstand', x: 285, z: 120, rot: -Q, color: WALNUT },
      { a: 'storage-nightstand', x: 285, z: 337, rot: -Q, color: WALNUT },
      { a: 'decor-lamp-table', x: 285, z: 337, rot: 0, color: '#d8c69a' },
      { a: 'chair-lounge', x: 80, z: 320, rot: 0.8, color: '#8c8378' },
    ],
  },
  {
    // the plan's unnamed 3.05 × 3.72 room: desk + armchairs round a table
    name: 'Family Lounge',
    type: 'living',
    w: 305, l: 372.5, x: 472.5, z: 668.75,
    wallHeight: STOREY,
    floor: 'natural-oak',
    wall: '#ece6dc',
    openings: [
      { kind: 'door', style: 'single', wallId: 'w0', t: 0.262, width: 85, height: 205, sill: 0, frameColor: WOOD_FRAME },
      { kind: 'door', style: 'slider', wallId: 'w2', t: 0.5, width: 180, height: 212, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_FRAME },
    ],
    furniture: [
      { a: 'desk-writing', x: 32, z: 230, rot: Q, color: '#8a6a52' },
      { a: 'chair-office', x: 95, z: 230, rot: -Q },
      { a: 'decor-rug-round', x: 210, z: 200, rot: 0, color: '#cdbfa8' },
      { a: 'chair-accent', x: 230, z: 120, rot: 2.6, color: '#b7a891' },
      { a: 'chair-accent', x: 230, z: 280, rot: 0.5, color: '#b7a891' },
      { a: 'table-side', x: 200, z: 200, rot: 0, color: '#2e2b29' },
      { a: 'decor-lamp', x: 280, z: 30, rot: 0, color: '#c9b48c' },
    ],
  },
  {
    name: 'Balcony 2',
    type: 'balcony',
    w: 305, l: 77.5, x: 472.5, z: 893.25,
    wallHeight: STOREY,
    floor: 'slate-tile',
    wall: '#9c9892',
    openings: [
      { kind: 'door', style: 'slider', wallId: 'w0', t: 0.5, width: 180, height: 212, sill: 0, bare: true },
      { kind: 'window', style: 'windowRail', wallId: 'w2', t: 0.5, width: 290, height: 110, sill: 0, frameColor: RAIL },
    ],
    furniture: [{ a: 'decor-plant', x: 30, z: 40, rot: 0 }],
  },
]

export const SKY_DUPLEX: MultiLevelHome = {
  id: 'sky',
  title: 'Raheja Sky Duplex',
  emoji: '🏙️',
  blurb: 'Raheja Vistas 3+ Sky Duplex · 1472 sq ft · double-height living',
  reference:
    'Raheja Vistas unit layouts pp. 6–7 (3+ Sky Duplex, 1472 sq ft) + walkthrough video 2026-09-26.',
  levels: [
    { label: 'Lower floor', elevationCm: 0, rooms: lower },
    { label: 'Upper floor', elevationCm: STOREY, rooms: upper },
  ],
}
