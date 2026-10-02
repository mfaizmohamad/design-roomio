// Listing-replica flats: hand-authored room sets that reproduce a REAL scraped
// listing's flat from its photos (geometry, finishes, openings, fixtures) —
// unlike the generic FLAT_*BHK templates, every doorway/window/slider here is
// EXPLICIT (autoDoorways: false) and the finishes match the photos, not the
// per-type defaults. Consumed by houseSession.loadListingFlat(listingId).
//
// Wall ids are deterministic for rectCorners(w,l):
//   w0 = z=0 (back) · w1 = x=w (right) · w2 = z=l (front) · w3 = x=0 (left)
// t runs a→b per wall: w0 along +x, w1 along +z, w2 along -x, w3 along -z.
// Shared-wall openings are authored on BOTH rooms (each room owns its own wall
// mesh); the far side is `bare: true` (hole only) so frames don't z-fight.

import type { Opening, CeilingSpec } from '../types'
import type { RoomType } from '../../multi-room/src/index'

export interface ReplicaFurniture {
  a: string // archetype id
  x: number // cm, room-local
  z: number
  rot: number // radians
  color?: string
  w?: number
  d?: number
  h?: number
  assetRef?: { assetVersionId: string }
}

export interface ReplicaRoom {
  name: string
  type: RoomType
  w: number // cm
  l: number
  x: number // house-plane bbox-center (cm)
  z: number
  floor: string // FLOOR_TEXTURES id
  wall: string // hex
  wallTexture?: string // FLOOR_TEXTURES id used as wall cladding
  ceiling?: CeilingSpec
  /** ceiling height (cm); omitted ⇒ the editor default (270). A duplex's
   *  double-height hall sets ~580 so its void reads as two storeys tall. */
  wallHeight?: number
  openings: Array<Omit<Opening, 'id'>>
  furniture: ReplicaFurniture[]
}

/** A photo-matched camera pose for the replica (world meters — the house is
 *  centred at the origin; see houseBoundsCm). Consumed by the generic shoot
 *  pipeline (scripts/shoot-listing-replica.mjs) and reusable by in-app tours. */
export interface ReplicaShot {
  name: string
  /** matches this photo index of the listing (for side-by-side sheets) */
  photo: number
  /** 'house' shows neighbouring rooms through openings (most interior shots);
   *  'room' isolates one room (needed for ceilings, which only render there) */
  mode: 'house' | 'room'
  /** room name — required when mode is 'room' */
  room?: string
  cam: [number, number, number]
  target: [number, number, number]
  fov: number
}

export interface ListingFlat {
  /** FlatListing.id this replica reproduces */
  listingId: string
  title: string
  rooms: ReplicaRoom[]
  /** photo-matched camera poses for renders/comparisons */
  shots: ReplicaShot[]
}

// ── Kothrud 2BHK (₹40,000/mo · listing 4550925665232147) ──────────────────────
// From the 5 listing photos: glossy grey-veined vitrified floors throughout,
// white walls, open parallel kitchen with black granite platforms + marble-clad
// walls, dark-aluminum sliding doors onto a full-width balcony (teak deck,
// dark wood-plank ceiling with one round downlight), black grille windows,
// brown wooden doors, white ceiling fans. Unfurnished.

const WHITE = '#f2f0ea'
const BALCONY_WALL = '#dedbd2' // textured white stucco
const DARK_FRAME = '#3f4447' // dark-aluminum slider sections
const DARK_LEAF = '#4a5054'
const BLACK_FRAME = '#2e3234' // grille window sections
const WOOD_FRAME = '#6b4f3a' // brown wooden door frame
const WOOD_LEAF = '#8a6a4e' // wooden door leaf
const GRANITE = '#1b1c1e' // polished black granite platform

const MARBLE = 'glossy-marble'

const KOTHRUD_2BHK: ListingFlat = {
  listingId: '4550925665232147',
  title: '2BHK · Kothrud, near Badhai Sweets',
  rooms: [
    {
      // Full-width balcony across the front of the living room + master bedroom
      // (photo 4: teak deck, plank ceiling + round downlight, glass rail).
      name: 'Balcony',
      type: 'balcony',
      w: 940, l: 130, x: 470, z: 65,
      floor: 'teak-plank',
      wall: BALCONY_WALL,
      ceiling: { texture: 'wood-plank-ceiling', downlight: true },
      openings: [
        // far side of the two sliders (living / master own the framed side)
        { kind: 'door', style: 'slider', wallId: 'w2', t: 0.766, width: 240, height: 212, sill: 0, bare: true },
        { kind: 'door', style: 'slider', wallId: 'w2', t: 0.202, width: 240, height: 212, sill: 0, bare: true },
        // tall glass railing band on the open exterior edge
        { kind: 'window', style: 'windowRail', wallId: 'w0', t: 0.5, width: 860, height: 215, sill: 12, frameColor: DARK_FRAME },
      ],
      furniture: [],
    },
    {
      // Living/dining (photos 1 & 5): slider to the balcony, wooden door to the
      // hallway, wide open passage into the kitchen, grille window for light.
      name: 'Living Room',
      type: 'living',
      w: 440, l: 520, x: 220, z: 390,
      floor: MARBLE,
      wall: WHITE,
      openings: [
        { kind: 'door', style: 'slider', wallId: 'w0', t: 0.5, width: 240, height: 212, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_LEAF },
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.65, width: 90, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
        { kind: 'door', style: 'passage', wallId: 'w2', t: 0.5, width: 280, height: 225, sill: 0, frameColor: '#eceae4' },
        { kind: 'window', style: 'windowGrille', wallId: 'w3', t: 0.4, width: 170, height: 150, sill: 85, frameColor: BLACK_FRAME },
      ],
      furniture: [{ a: 'decor-ceiling-fan', x: 220, z: 260, rot: 0 }],
    },
    {
      // Open parallel kitchen (photos 1 & 5): two black-granite platforms along
      // the side walls, marble-clad walls, glass door + window to the dry balcony.
      name: 'Kitchen',
      type: 'kitchen',
      w: 440, l: 250, x: 220, z: 775,
      floor: MARBLE,
      wall: WHITE,
      wallTexture: 'marble-wall',
      openings: [
        { kind: 'door', style: 'passage', wallId: 'w0', t: 0.5, width: 280, height: 225, sill: 0, bare: true },
        { kind: 'door', style: 'glass', wallId: 'w2', t: 0.58, width: 90, height: 205, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_LEAF },
        { kind: 'window', style: 'windowGrille', wallId: 'w2', t: 0.295, width: 140, height: 120, sill: 100, frameColor: DARK_FRAME },
        { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.5, width: 100, height: 100, sill: 110, frameColor: BLACK_FRAME },
      ],
      furniture: [
        { a: 'kitchen-counter', x: 35, z: 125, rot: Math.PI / 2, color: GRANITE, w: 240, d: 60, h: 90 },
        { a: 'kitchen-counter', x: 405, z: 125, rot: (3 * Math.PI) / 2, color: GRANITE, w: 240, d: 60, h: 90 },
      ],
    },
    {
      // Dry balcony behind the kitchen (photo 1, beyond the glass door).
      name: 'Dry Balcony',
      type: 'balcony',
      w: 440, l: 130, x: 220, z: 965,
      floor: 'grey-tile',
      wall: BALCONY_WALL,
      openings: [
        { kind: 'door', style: 'glass', wallId: 'w0', t: 0.42, width: 90, height: 205, sill: 0, bare: true },
        { kind: 'window', style: 'windowGrille', wallId: 'w0', t: 0.705, width: 140, height: 120, sill: 100, bare: true },
        { kind: 'window', style: 'windowRail', wallId: 'w2', t: 0.5, width: 380, height: 110, sill: 95, frameColor: DARK_FRAME },
      ],
      furniture: [],
    },
    {
      // Corridor from the living room to both bedrooms + bathroom.
      name: 'Hallway',
      type: 'hallway',
      w: 120, l: 900, x: 500, z: 580,
      floor: MARBLE,
      wall: WHITE,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.624, width: 90, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.217, width: 90, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.506, width: 75, height: 200, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.689, width: 90, height: 205, sill: 0, bare: true },
      ],
      furniture: [],
    },
    {
      // Master bedroom (photo 3): slider onto the balcony, grille window, fan.
      name: 'Master Bedroom',
      type: 'bedroom',
      w: 380, l: 390, x: 750, z: 325,
      floor: MARBLE,
      wall: WHITE,
      openings: [
        { kind: 'door', style: 'slider', wallId: 'w0', t: 0.5, width: 240, height: 212, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_LEAF },
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 90, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
        { kind: 'window', style: 'windowGrille', wallId: 'w1', t: 0.5, width: 170, height: 150, sill: 85, frameColor: BLACK_FRAME },
      ],
      furniture: [{ a: 'decor-ceiling-fan', x: 190, z: 195, rot: 0 }],
    },
    {
      // Bathroom off the hallway (geyser per the listing text).
      name: 'Bathroom',
      type: 'bathroom',
      w: 380, l: 130, x: 750, z: 585,
      floor: 'grey-tile',
      wall: WHITE,
      wallTexture: 'marble-wall',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 75, height: 200, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
      ],
      furniture: [
        { a: 'bath-geyser', x: 190, z: 12, rot: 0 },
        { a: 'bath-toilet', x: 330, z: 65, rot: (3 * Math.PI) / 2 },
      ],
    },
    {
      // Second bedroom (photo 2): grille windows on two walls, fan.
      name: 'Bedroom 2',
      type: 'bedroom',
      w: 380, l: 380, x: 750, z: 840,
      floor: MARBLE,
      wall: WHITE,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.737, width: 90, height: 205, sill: 0, frameColor: WOOD_FRAME, leafColor: WOOD_LEAF },
        { kind: 'window', style: 'windowGrille', wallId: 'w1', t: 0.5, width: 170, height: 150, sill: 85, frameColor: BLACK_FRAME },
        { kind: 'window', style: 'windowGrille', wallId: 'w2', t: 0.5, width: 140, height: 140, sill: 90, frameColor: BLACK_FRAME },
      ],
      furniture: [{ a: 'decor-ceiling-fan', x: 190, z: 190, rot: 0 }],
    },
  ],
  // House bbox 940×1030 cm centred at the world origin.
  shots: [
    { name: 'living-to-kitchen', photo: 0, mode: 'house', cam: [-2.5, 1.45, -3.55], target: [-2.5, 0.85, 3.8], fov: 62 },
    { name: 'kitchen-to-living', photo: 4, mode: 'house', cam: [-2.5, 1.55, 3.7], target: [-2.5, 0.8, -3.8], fov: 80 },
    { name: 'master-window', photo: 1, mode: 'house', cam: [1.5, 1.5, -0.3], target: [4.25, 0.9, -2.2], fov: 62 },
    { name: 'master-slider', photo: 2, mode: 'house', cam: [3.8, 1.5, 0.0], target: [1.3, 0.9, -4.3], fov: 62 },
    { name: 'balcony', photo: 3, mode: 'room', room: 'Balcony', cam: [-3.6, 1.3, 0.05], target: [3.0, 2.45, 0.15], fov: 68 },
  ],
}

// ── Andheri West PG (boys · ₹25k single / ₹15k double-sharing · listing 4551035318554515) ──
// From the 5 listing photos: warm cream-yellow walls, glossy white vitrified
// tiles throughout, dark-wenge wardrobes + single beds with printed mattresses,
// red-and-black galley kitchen (white tile backsplash, black fridge, maroon
// washing machine), hall used as a double-sharing room with a slider onto a
// railed balcony and a dusty-pink door at its end, white-framed windows,
// white + maroon ceiling fans. Fully furnished.

const CREAM = '#eee3c0' // warm cream-yellow paint
const WHITE_FRAME = '#eceae4' // white uPVC window sections
const WENGE = '#33241b' // dark wardrobe / bed frames
const PINK_LEAF = '#c9a1b4' // the hall's dusty-pink door
const RED_CAB = '#a33226' // kitchen cabinet red
const MAROON = '#6e3a34' // maroon fan / washing machine

const WHITE_TILE = 'glossy-white-tile'

const ANDHERI_PG: ListingFlat = {
  listingId: '4551035318554515',
  title: 'PG flat · Old MHADA, Four Bungalows, Andheri West',
  rooms: [
    {
      // Double-sharing hall (photos 3 & 4): two single beds, wardrobe, TV unit,
      // slider to the railed balcony, dusty-pink door at the far end.
      name: 'Hall',
      type: 'living',
      w: 400, l: 520, x: 480, z: 260,
      floor: WHITE_TILE,
      wall: CREAM,
      openings: [
        { kind: 'door', style: 'slider', wallId: 'w1', t: 0.4, width: 220, height: 212, sill: 0, frameColor: DARK_FRAME, leafColor: DARK_LEAF },
        // the flat's dusty-pink entry door at the hall's end (photo 3)
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.45, width: 90, height: 205, sill: 0, frameColor: '#e8e2d8', leafColor: PINK_LEAF },
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.5, width: 90, height: 205, sill: 0, frameColor: WENGE, leafColor: '#4a362a' },
        // far side of the two bedroom doors (bedrooms own the framed side)
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.75, width: 85, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.25, width: 85, height: 205, sill: 0, bare: true },
      ],
      furniture: [
        { a: 'bed-twin', x: 60, z: 120, rot: 0, color: WENGE },
        { a: 'bed-twin', x: 60, z: 340, rot: 0, color: WENGE },
        { a: 'storage-wardrobe', x: 320, z: 60, rot: 0, color: WENGE },
        { a: 'storage-tv', x: 330, z: 460, rot: Math.PI, color: '#5a4433' },
        { a: 'decor-ceiling-fan', x: 200, z: 140, rot: 0 },
        { a: 'decor-ceiling-fan', x: 200, z: 390, rot: 0, color: MAROON },
      ],
    },
    {
      // Balcony off the hall (photo 4): black metal railing band.
      name: 'Balcony',
      type: 'balcony',
      w: 120, l: 520, x: 740, z: 260,
      floor: 'grey-tile',
      wall: '#dedbd2',
      openings: [
        { kind: 'door', style: 'slider', wallId: 'w3', t: 0.6, width: 220, height: 212, sill: 0, bare: true },
        { kind: 'window', style: 'windowRail', wallId: 'w1', t: 0.5, width: 480, height: 110, sill: 95, frameColor: BLACK_FRAME },
      ],
      furniture: [],
    },
    {
      // Single-occupancy bedroom (photo 1): wenge wardrobe with mirror, single
      // bed under the white-framed window, white fan.
      name: 'Bedroom',
      type: 'bedroom',
      w: 280, l: 260, x: 140, z: 130,
      floor: WHITE_TILE,
      wall: CREAM,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.5, width: 85, height: 205, sill: 0, frameColor: WENGE, leafColor: '#4a362a' },
        { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.5, width: 150, height: 130, sill: 90, frameColor: WHITE_FRAME },
      ],
      furniture: [
        { a: 'bed-twin', x: 60, z: 130, rot: 0, color: WENGE },
        { a: 'storage-wardrobe', x: 220, z: 55, rot: 0, color: WENGE },
        { a: 'decor-ceiling-fan', x: 140, z: 130, rot: 0 },
      ],
    },
    {
      // Second bedroom (photo 5): mirror of the first.
      name: 'Bedroom 2',
      type: 'bedroom',
      w: 280, l: 260, x: 140, z: 390,
      floor: WHITE_TILE,
      wall: CREAM,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.5, width: 85, height: 205, sill: 0, frameColor: WENGE, leafColor: '#4a362a' },
        { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.5, width: 150, height: 130, sill: 90, frameColor: WHITE_FRAME },
      ],
      furniture: [
        { a: 'bed-twin', x: 60, z: 130, rot: 0, color: WENGE },
        { a: 'storage-wardrobe', x: 225, z: 210, rot: Math.PI, color: WENGE },
        { a: 'decor-ceiling-fan', x: 140, z: 130, rot: 0 },
      ],
    },
    {
      // Circulation spine between the hall and the service rooms.
      name: 'Hallway',
      type: 'hallway',
      w: 800, l: 120, x: 400, z: 580,
      floor: WHITE_TILE,
      wall: CREAM,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.6, width: 90, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.825, width: 85, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.5, width: 75, height: 200, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.175, width: 75, height: 200, sill: 0, bare: true },
      ],
      furniture: [],
    },
    {
      // Red-and-black galley kitchen (photo 2): red cabinet run with black
      // counter, white tile backsplash walls, black fridge + maroon washer,
      // small white window at the end.
      name: 'Kitchen',
      type: 'kitchen',
      w: 280, l: 240, x: 140, z: 760,
      floor: WHITE_TILE,
      wall: CREAM,
      wallTexture: 'white-tile',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 85, height: 205, sill: 0, frameColor: WENGE, leafColor: '#4a362a' },
        { kind: 'window', style: 'windowSingle', wallId: 'w2', t: 0.5, width: 110, height: 110, sill: 100, frameColor: WHITE_FRAME },
      ],
      furniture: [
        // photo 2 viewed from the door: red cabinet run LEFT (+x side), black
        // fridge + maroon washer RIGHT
        { a: 'kitchen-counter', x: 245, z: 120, rot: (3 * Math.PI) / 2, color: RED_CAB, w: 230, d: 60, h: 90 },
        { a: 'kitchen-fridge', x: 40, z: 70, rot: Math.PI / 2, color: '#1a1b1d' },
        { a: 'kitchen-washer', x: 45, z: 185, rot: Math.PI / 2, color: MAROON },
        { a: 'decor-ceiling-fan', x: 140, z: 120, rot: 0, w: 100, d: 100 },
      ],
    },
    {
      // Attached bathrooms off the hallway.
      name: 'Bathroom',
      type: 'bathroom',
      w: 240, l: 240, x: 400, z: 760,
      floor: 'white-tile',
      wall: '#f0ede6',
      wallTexture: 'white-tile',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 75, height: 200, sill: 0, frameColor: '#e8e2d8', leafColor: PINK_LEAF },
      ],
      furniture: [{ a: 'bath-toilet', x: 190, z: 60, rot: (3 * Math.PI) / 2 }],
    },
    {
      name: 'Bathroom 2',
      type: 'bathroom',
      w: 280, l: 240, x: 660, z: 760,
      floor: 'white-tile',
      wall: '#f0ede6',
      wallTexture: 'white-tile',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 75, height: 200, sill: 0, frameColor: '#e8e2d8', leafColor: PINK_LEAF },
      ],
      furniture: [{ a: 'bath-toilet', x: 230, z: 60, rot: (3 * Math.PI) / 2 }],
    },
  ],
  // House bbox 800×880 cm centred at the world origin.
  shots: [
    { name: 'bedroom', photo: 0, mode: 'house', cam: [-1.3, 1.5, -1.95], target: [-3.9, 0.62, -3.5], fov: 76 },
    { name: 'kitchen', photo: 1, mode: 'house', cam: [-2.6, 1.5, 2.12], target: [-2.6, 0.78, 4.3], fov: 78 },
    { name: 'hall-to-door', photo: 2, mode: 'house', cam: [0.85, 1.5, 0.72], target: [0.55, 0.7, -4.35], fov: 68 },
    { name: 'hall-to-balcony', photo: 3, mode: 'house', cam: [-0.6, 1.5, -2.6], target: [2.9, 0.85, -0.3], fov: 66 },
    { name: 'bedroom-2', photo: 4, mode: 'house', cam: [-1.3, 1.5, -1.65], target: [-3.9, 0.62, 0.1], fov: 76 },
  ],
}

// ── Malad East 1BHK (Sethiya Imperial Heights · ₹45k/1L · listing 4551037518554295) ──
// From the 5 listing photos: fully furnished high-rise 1BHK — ivory marble
// floors, white L-kitchen with black granite top + white speckled wall tile +
// sliding window over the counter, utility passage with maroon floral fridge,
// dark washing machine, wall basin + geyser, bedroom with wenge sliding
// wardrobe / bed / vanity mirror and brown flush doors, dark-tile bathroom.

const M_WALL = '#efece3' // off-white paint
const M_DOOR_FRAME = '#5a4232' // brown flush door frames
const M_DOOR_LEAF = '#6e4f3a'
const M_WENGE = '#43302a' // wardrobe / bed frames
const M_FRIDGE = '#571f22' // maroon floral fridge
const M_WASHER = '#2e181c' // dark maroon washer
const M_CAB = '#e3e1da' // white kitchen cabinets (black granite top auto)

const M_MARBLE = 'ivory-marble'

const MALAD_1BHK: ListingFlat = {
  listingId: '4551037518554295',
  title: '1BHK · Sethiya Imperial Heights, Malad East',
  rooms: [
    {
      // Hall (entry + sofa + TV) — north-west of the plan.
      name: 'Hall',
      type: 'living',
      w: 340, l: 380, x: 170, z: 190,
      floor: M_MARBLE,
      wall: M_WALL,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.18, width: 90, height: 205, sill: 0, frameColor: M_DOOR_FRAME, leafColor: M_DOOR_LEAF },
        { kind: 'window', style: 'windowSingle', wallId: 'w3', t: 0.5, width: 140, height: 130, sill: 90, frameColor: '#eceae4' },
        { kind: 'door', style: 'single', wallId: 'w1', t: 0.5, width: 90, height: 205, sill: 0, bare: true },
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.632, width: 90, height: 205, sill: 0, bare: true },
      ],
      furniture: [
        { a: 'storage-tv', x: 170, z: 35, rot: 0, color: '#4a382c' },
        { a: 'decor-tv', x: 170, z: 30, rot: 0 },
        { a: 'sofa-3', x: 170, z: 300, rot: Math.PI, color: '#6b5d4e' },
        { a: 'decor-ceiling-fan', x: 170, z: 190, rot: 0 },
      ],
    },
    {
      // Bedroom (photo 4): bed, wenge sliding wardrobe on the south wall next
      // to the bathroom door, vanity + mirror, brown main door.
      name: 'Bedroom',
      type: 'bedroom',
      w: 300, l: 380, x: 490, z: 190,
      floor: M_MARBLE,
      wall: M_WALL,
      openings: [
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.5, width: 90, height: 205, sill: 0, frameColor: M_DOOR_FRAME, leafColor: M_DOOR_LEAF },
        { kind: 'window', style: 'windowSingle', wallId: 'w1', t: 0.35, width: 150, height: 130, sill: 90, frameColor: '#eceae4' },
        // attached bathroom below (photo 4's dark doorway)
        { kind: 'door', style: 'single', wallId: 'w2', t: 0.333, width: 80, height: 202, sill: 0, frameColor: M_DOOR_FRAME, leafColor: M_DOOR_LEAF },
      ],
      furniture: [
        { a: 'bed-full', x: 105, z: 110, rot: (3 * Math.PI) / 2, color: M_WENGE },
        { a: 'storage-wardrobe', x: 110, z: 355, rot: Math.PI, color: M_WENGE },
        { a: 'table-vanity', x: 265, z: 300, rot: (3 * Math.PI) / 2, color: '#7a5c40' },
        { a: 'decor-mirror', x: 292, z: 300, rot: (3 * Math.PI) / 2 },
        { a: 'decor-ceiling-fan', x: 150, z: 190, rot: 0 },
      ],
    },
    {
      // White L-kitchen (photo 5): black granite top, speckled wall tile,
      // sliding window above the counter.
      name: 'Kitchen',
      type: 'kitchen',
      w: 250, l: 260, x: 125, z: 510,
      floor: M_MARBLE,
      wall: M_WALL,
      wallTexture: 'speckle-tile',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 90, height: 205, sill: 0, frameColor: M_DOOR_FRAME, leafColor: M_DOOR_LEAF },
        { kind: 'window', style: 'windowDouble', wallId: 'w2', t: 0.42, width: 150, height: 125, sill: 95, frameColor: '#eceae4' },
        { kind: 'door', style: 'passage', wallId: 'w1', t: 0.5, width: 120, height: 210, sill: 0, frameColor: '#eceae4' },
      ],
      furniture: [
        { a: 'kitchen-counter', x: 40, z: 130, rot: Math.PI / 2, color: M_CAB, w: 240, d: 60, h: 90 },
        { a: 'kitchen-counter', x: 155, z: 225, rot: Math.PI, color: M_CAB, w: 160, d: 60, h: 90 },
        { a: 'kitchen-stove', x: 190, z: 220, rot: Math.PI, color: '#2a2c2e' },
      ],
    },
    {
      // Utility passage (photos 1 & 2): maroon floral fridge, dark washer,
      // wall basin + geyser, speckled tile walls.
      name: 'Utility',
      type: 'hallway',
      w: 190, l: 260, x: 345, z: 510,
      floor: M_MARBLE,
      wall: M_WALL,
      wallTexture: 'speckle-tile',
      openings: [
        { kind: 'door', style: 'passage', wallId: 'w3', t: 0.5, width: 120, height: 210, sill: 0, bare: true },
      ],
      furniture: [
        { a: 'kitchen-fridge', x: 55, z: 65, rot: Math.PI / 2, color: M_FRIDGE },
        { a: 'kitchen-washer', x: 50, z: 175, rot: Math.PI / 2, color: M_WASHER },
        { a: 'bath-vanity', x: 145, z: 225, rot: Math.PI, color: '#f0efec' },
        { a: 'bath-geyser', x: 160, z: 12, rot: 0 },
      ],
    },
    {
      // Attached bathroom (photo 3): dark stone tile, wall-hung toilet, shower.
      name: 'Bathroom',
      type: 'bathroom',
      w: 200, l: 260, x: 540, z: 510,
      floor: 'slate-tile',
      wall: '#9a9c9e',
      wallTexture: 'slate-tile',
      openings: [
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.5, width: 80, height: 202, sill: 0, bare: true },
      ],
      furniture: [
        { a: 'bath-toilet', x: 60, z: 70, rot: Math.PI / 2, color: '#f3f2ee' },
        { a: 'bath-shower', x: 145, z: 205, rot: 0 },
        { a: 'bath-geyser', x: 100, z: 250, rot: Math.PI },
      ],
    },
  ],
  // House bbox 640×640 cm centred at the world origin.
  shots: [
    { name: 'utility', photo: 0, mode: 'house', cam: [0.95, 1.45, 0.95], target: [-0.55, 0.75, 3.0], fov: 78 },
    { name: 'hall', photo: 1, mode: 'house', cam: [-0.1, 1.45, 0.4], target: [-1.6, 0.85, -3.0], fov: 72 },
    { name: 'bathroom', photo: 2, mode: 'house', cam: [1.4, 1.35, 0.8], target: [2.4, 0.6, 2.9], fov: 74 },
    { name: 'bedroom', photo: 3, mode: 'house', cam: [1.75, 1.45, -2.7], target: [1.75, 0.95, 0.55], fov: 72 },
    { name: 'kitchen', photo: 4, mode: 'house', cam: [-0.85, 1.5, 0.95], target: [-2.9, 0.9, 2.7], fov: 74 },
  ],
}

// ── Oshiwara single room (₹32k single occupancy · listing 4551033371888043) ──
// A SINGLE-ROOM replica (rooms can be just one — it renders in the single-room
// view with ceiling + downlights). From the 5 photos: spacious room with glossy
// cream tile, white walls, full-width low-sill sliding window onto the balcony
// with grey blackout curtains + white sheer, double bed (wenge frame, blush
// bedding), black ladder shelf with decor, brown wardrobe + garment stand,
// split AC over the entry door, floor-lounge rug + cushions by the window,
// recessed downlights + ceiling fan.

const O_WALL = '#f1efe9'
const O_DOOR_FRAME = '#4c3527'
const O_DOOR_LEAF = '#5f4634'
const O_WINDOW = '#6f6653' // champagne-bronze sliding sections
const O_CURTAIN = '#5c6066' // grey blackout panels

const OSHIWARA_ROOM: ListingFlat = {
  listingId: '4551033371888043',
  title: 'Single room · Near Oshiwara Metro',
  rooms: [
    {
      name: 'Room',
      type: 'bedroom',
      w: 420, l: 480, x: 210, z: 240,
      floor: 'glossy-white-tile',
      wall: O_WALL,
      openings: [
        // full-width sliding window band, low sill (the balcony beyond)
        { kind: 'window', style: 'windowRail', wallId: 'w2', t: 0.5, width: 310, height: 175, sill: 42, frameColor: O_WINDOW },
        // bathroom door (back wall) + entry door (west wall), dark brown
        { kind: 'door', style: 'single', wallId: 'w0', t: 0.68, width: 85, height: 205, sill: 0, frameColor: O_DOOR_FRAME, leafColor: O_DOOR_LEAF },
        { kind: 'door', style: 'single', wallId: 'w3', t: 0.38, width: 90, height: 205, sill: 0, frameColor: O_DOOR_FRAME, leafColor: O_DOOR_LEAF },
      ],
      furniture: [
        { a: 'bed-full', x: 330, z: 250, rot: (3 * Math.PI) / 2, color: '#8a655c' },
        { a: 'storage-nightstand', x: 350, z: 120, rot: (3 * Math.PI) / 2, color: '#26221f' },
        { a: 'storage-wardrobe', x: 75, z: 45, rot: 0, color: '#5a4030' },
        { a: 'decor-ladder-shelf', x: 42, z: 380, rot: Math.PI / 2, color: '#2c3136' },
        { a: 'decor-curtain', x: 210, z: 470, rot: Math.PI, w: 350, h: 222 },
        { a: 'decor-ac', x: 270, z: 10, rot: 0 },
        { a: 'decor-rug-large', x: 175, z: 390, rot: Math.PI / 2, color: '#ddd5c2' },
        { a: 'ottoman-pouf', x: 105, z: 420, rot: 0, color: '#8b8e93' },
        { a: 'table-side', x: 240, z: 415, rot: 0, color: '#6b4c33' },
        { a: 'decor-ceiling-fan', x: 210, z: 220, rot: 0 },
      ],
    },
  ],
  // Single room 420×480 cm centred at the origin (single-room view).
  shots: [
    { name: 'room-wide', photo: 4, mode: 'room', room: 'Room', cam: [1.8, 1.5, -1.95], target: [-1.9, 0.7, 2.1], fov: 80 },
    { name: 'bed-window', photo: 1, mode: 'room', room: 'Room', cam: [-1.9, 1.35, 0.4], target: [1.9, 0.85, 1.2], fov: 70 },
    { name: 'window-curtains', photo: 3, mode: 'room', room: 'Room', cam: [0.1, 1.3, -1.3], target: [0.1, 1.05, 2.35], fov: 72 },
    { name: 'floor-lounge', photo: 2, mode: 'room', room: 'Room', cam: [-1.5, 1.45, 0.3], target: [1.5, 0.35, 2.3], fov: 76 },
    { name: 'wardrobe-door', photo: 0, mode: 'room', room: 'Room', cam: [1.7, 1.4, 2.0], target: [-1.5, 0.9, -2.3], fov: 74 },
  ],
}

export const LISTING_FLATS: Record<string, ListingFlat> = {
  [KOTHRUD_2BHK.listingId]: KOTHRUD_2BHK,
  [ANDHERI_PG.listingId]: ANDHERI_PG,
  [MALAD_1BHK.listingId]: MALAD_1BHK,
  [OSHIWARA_ROOM.listingId]: OSHIWARA_ROOM,
}

/** True when a scraped listing has a hand-authored 3D replica. */
export function hasListingFlat(listingId: string): boolean {
  return !!LISTING_FLATS[listingId]
}
