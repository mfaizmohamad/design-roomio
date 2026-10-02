/**
 * Room-type taxonomy + per-type essentials and layout guidance (brief §3).
 *
 * Single source of truth for everything room-type-specific. Essentials are
 * OFFERED, never forced (the "everything optional" rule) — they can feed Agent
 * A's suggestion engine, but a room with none of them is still valid.
 *
 * Numbers are research-seeded (the brief seeds NKBA-style kitchen/bath guidance
 * and general floor-plan standards) — not invented. Each `archetype` points at a
 * REAL id in Agent A's catalog (src/data/archetypes.catalog.json) where Roomio
 * models the piece; `null` means Roomio has no asset yet, so we fall back to the
 * Placeholder Box ("misc-box"). Kitchen + bathroom fixtures are now modeled
 * (counter/island/sink/stove/fridge/hood; toilet/vanity/shower/bathtub/jacuzzi),
 * so those essentials point at real ids — only intentionally-empty essentials
 * (e.g. hallway circulation) remain null.
 */
import type { RoomType } from '../types'

/** The Placeholder Box id from Agent A's catalog — fallback for un-modeled assets. */
export const PLACEHOLDER_ARCHETYPE = 'misc-box'

export interface Essential {
  label: string
  /** A real catalog id, or null when Roomio has no asset yet (→ placeholder + asset request). */
  archetype: string | null
  note?: string
}

export interface RoomTypeInfo {
  type: RoomType
  label: string
  purpose: string
  essentials: Essential[]
  /** Research-seeded layout guidance lines (offered as assistance, not enforced). */
  guidance: string[]
}

export const ROOM_TYPE_INFO: Record<RoomType, RoomTypeInfo> = {
  bedroom: {
    type: 'bedroom',
    label: 'Bedroom',
    purpose: 'Sleep + private retreat.',
    essentials: [
      { label: 'Bed', archetype: 'bed-queen' },
      { label: 'Nightstand', archetype: 'storage-nightstand', note: 'pair where space allows' },
      { label: 'Wardrobe', archetype: 'storage-wardrobe' },
      { label: 'Lamp', archetype: 'decor-lamp-table' },
    ],
    guidance: [
      'Bed as the focal point; pair a nightstand + bedside light each side where space allows.',
      'Keep a walkable clearance (~60–75 cm) on the sides you access.',
      'Privacy: a hinged or pocket door is the sensible connector (see AC4).',
    ],
  },
  living: {
    type: 'living',
    label: 'Living room',
    purpose: 'Conversation, lounging, media.',
    essentials: [
      { label: 'Sofa', archetype: 'sofa-3' },
      { label: 'Coffee table', archetype: 'table-coffee' },
      { label: 'Rug', archetype: 'decor-rug-large' },
      { label: 'Media unit / TV', archetype: 'storage-media' },
      { label: 'Lighting', archetype: 'decor-lamp-arc' },
    ],
    guidance: [
      'Conversation zone with seating facing a focal point; rug anchors the seating.',
      'Layered lighting; avoid pushing every piece against the walls ("don’t wall-hug").',
      'Opens well to dining via an open connector (archway / wide opening / half-wall).',
    ],
  },
  kitchen: {
    type: 'kitchen',
    label: 'Kitchen',
    purpose: 'Food storage, prep, cooking, cleanup.',
    essentials: [
      { label: 'Counters / cabinets', archetype: 'kitchen-counter' },
      { label: 'Sink', archetype: 'kitchen-sink' },
      { label: 'Stove / cooktop', archetype: 'kitchen-stove' },
      { label: 'Refrigerator', archetype: 'kitchen-fridge' },
      { label: 'Island (optional)', archetype: 'kitchen-island', note: 'only if room ≥ ~366 cm (12 ft) wide' },
      { label: 'Counter stools (if island/peninsula)', archetype: 'stool-counter' },
    ],
    guidance: [
      'Classic work triangle (sink–stove–fridge): each leg ~122–274 cm (4–9 ft); total perimeter ~396–792 cm (13–26 ft); no major traffic should cross it.',
      'Modern alternative: zone planning (storage → prep → wash → cook) in a one-direction flow.',
      'Aisle clearance: min ~107 cm (42 in) for one cook; ~122 cm (48 in) for two.',
      'Island only if the room is ≥ ~366 cm (12 ft) wide; keep the island ≥ ~107 cm (42 in) from appliances/cabinets.',
      'Common layouts: galley, L, U, island, peninsula.',
      'Opens to dining via cased / wide opening / pass-through (door optional) — see AC2.',
    ],
  },
  bathroom: {
    type: 'bathroom',
    label: 'Bathroom',
    purpose: 'Hygiene; needs privacy + ventilation.',
    essentials: [
      { label: 'Toilet', archetype: 'bath-toilet' },
      { label: 'Sink / vanity', archetype: 'bath-vanity' },
      { label: 'Shower', archetype: 'bath-shower' },
      { label: 'Bathtub (optional)', archetype: 'bath-tub-alcove', note: 'alcove, freestanding, or jacuzzi variants are in the catalog' },
      { label: 'Storage (optional)', archetype: 'storage-shelving' },
    ],
    guidance: [
      'Group plumbing fixtures along wet walls.',
      'Maintain code-style clearance in front of each fixture (~53–76 cm / 21–30 in of clear floor in front of toilet/sink; ~76 cm / 30 in walkway).',
      'A door swing must not hit a fixture — flip the swing or use a pocket door (see AC7).',
      'Privacy + ventilation from public rooms: use a hinged or pocket door, not an open connector (see AC1).',
    ],
  },
  dining: {
    type: 'dining',
    label: 'Dining room',
    purpose: 'Seated meals.',
    essentials: [
      { label: 'Dining table', archetype: 'table-dining' },
      { label: 'Dining chairs', archetype: 'chair-dining' },
      { label: 'Sideboard (optional)', archetype: 'storage-sideboard' },
      { label: 'Light over the table', archetype: 'decor-lamp', note: 'pendant centered over the table' },
    ],
    guidance: [
      'Allow ~81 cm (32 in) from wall to table edge where no one passes behind diners.',
      'Allow ~112 cm (44 in) where traffic passes behind seated diners.',
      'Pendant light centered over the table.',
      'Opens to living + kitchen via open connectors (archway / wide opening / pass-through).',
    ],
  },
  office: {
    type: 'office',
    label: 'Home office',
    purpose: 'Focused work.',
    essentials: [
      { label: 'Desk', archetype: 'desk-office' },
      { label: 'Chair', archetype: 'chair-office' },
      { label: 'Shelving', archetype: 'storage-shelving' },
      { label: 'Task light', archetype: 'decor-lamp-table' },
    ],
    guidance: [
      'Orient the desk to a window/light without screen glare.',
      'Task + ambient lighting; keep a clear path to the seat.',
    ],
  },
  foyer: {
    type: 'foyer',
    label: 'Entry / foyer',
    purpose: 'Transitional arrival space.',
    essentials: [
      { label: 'Console', archetype: 'table-console' },
      { label: 'Coat / shoe storage', archetype: 'storage-shoe' },
      { label: 'Landing surface (keys/mail)', archetype: 'table-hall' },
    ],
    guidance: [
      'Transitional space with a framed sight line into the next room.',
      'A landing spot for keys/mail; welcoming connector into living (archway or cased opening) — see AC5.',
    ],
  },
  hallway: {
    type: 'hallway',
    label: 'Hallway',
    purpose: 'Circulation; connector-as-room.',
    essentials: [
      { label: '(circulation — minimal furniture)', archetype: null, note: 'keep clear for passage' },
    ],
    guidance: [
      'Keep the width comfortable for passage (~92 cm / 36 in minimum, ~107 cm / 42 in generous).',
      'Can host the connectors that branch to several rooms — suggested when many rooms meet (AC6).',
    ],
  },
  balcony: {
    type: 'balcony',
    label: 'Balcony',
    purpose: 'Outdoor sit-out / utility (standard in Indian flats).',
    essentials: [
      { label: 'Seating', archetype: 'chair-lounge', note: 'a chair or two for a sit-out' },
      { label: 'Side table', archetype: 'table-side' },
      { label: 'Plant', archetype: 'decor-plant' },
    ],
    guidance: [
      'Outdoor-grade anti-skid tile; open to the living room or a bedroom.',
      'Keep it uncluttered — a couple of chairs, a side table, and greenery.',
    ],
  },
}

export const ROOM_TYPE_LIST: RoomTypeInfo[] = Object.values(ROOM_TYPE_INFO)

/** Essentials offered for a room type (for A's suggestion engine; never forced). */
export function essentialsFor(type: RoomType): Essential[] {
  return ROOM_TYPE_INFO[type].essentials
}

/** Layout guidance lines for a room type. */
export function guidanceFor(type: RoomType): string[] {
  return ROOM_TYPE_INFO[type].guidance
}

/**
 * Essentials a room type wants but Roomio has no asset for yet (archetype === null).
 * These drive REQUEST -> ASSET log entries; meanwhile they fall back to the
 * Placeholder Box so nothing blocks.
 */
export function missingAssetsFor(type: RoomType): Essential[] {
  return ROOM_TYPE_INFO[type].essentials.filter((e) => e.archetype === null)
}

/** Resolve the archetype to actually place for an essential (placeholder when un-modeled). */
export function resolveEssentialArchetype(e: Essential): string {
  return e.archetype ?? PLACEHOLDER_ARCHETYPE
}
