/**
 * Connector taxonomy (brief §4) — single source of truth for connector behavior.
 *
 * A connector occupies a span on a SHARED WALL between two rooms. Mechanically it
 * is an OPENING cut into both rooms' walls; the per-type `opening` here maps a
 * connector to the {height, sill} of that hole (width is per-instance). We reuse
 * Agent A's buildWallParts to actually cut it (see geometry/connectors.ts), so the
 * hole geometry matches A's door/window holes exactly.
 *
 * Dimensions are research-seeded, aligned with Agent A's DOOR_DEFS (src/data/
 * openings.ts: single 85, double 160, french 150 cm @ ~205–210 high) and standard
 * residential clearances — not invented.
 */
import type { ConnectorType } from '../types'

export interface ConnectorTypeInfo {
  type: ConnectorType
  label: string
  /** Has a swinging leaf whose arc must clear fixtures (AC7). */
  hasSwing: boolean
  /** Provides visual/acoustic privacy (used by AC1/AC4 privacy suggestions). */
  privacy: boolean
  /** Default clear width (cm) for a fresh placement. */
  defaultWidth: number
  /** The wall-hole this connector cuts, as {height, sill} in cm above floor. */
  opening: { height: number; sill: number }
  description: string
}

/**
 * Half-wall / pony wall: solid up to ~107 cm (42 in), open above. So the cut hole
 * starts at sill = HALF_WALL_SILL and runs to the ceiling.
 */
export const HALF_WALL_SILL = 107
/** Pass-through serving hatch: opening sits above counter height (~90 cm). */
export const PASS_THROUGH_SILL = 90
const STD_DOOR_HEIGHT = 205
const STD_OPEN_HEIGHT = 210

/**
 * `opening.height` for sill-raised connectors is the hole height (top = sill +
 * height). For full-height open connectors we use STD_OPEN_HEIGHT; the room's
 * actual wallHeight clamps it in buildWallParts.
 */
export const CONNECTOR_TYPE_INFO: Record<ConnectorType, ConnectorTypeInfo> = {
  hinged: {
    type: 'hinged',
    label: 'Hinged door',
    hasSwing: true,
    privacy: true,
    defaultWidth: 85,
    opening: { height: STD_DOOR_HEIGHT, sill: 0 },
    description: 'Standard single swinging door. Default private room-to-room connector; the swing must clear fixtures.',
  },
  double: {
    type: 'double',
    label: 'Double door',
    hasSwing: true,
    privacy: true,
    defaultWidth: 160,
    opening: { height: STD_DOOR_HEIGHT, sill: 0 },
    description: 'Two hinged leaves side by side — wider, more formal openings (dining, primary suite). Two swing arcs.',
  },
  pocket: {
    type: 'pocket',
    label: 'Pocket / sliding door',
    hasSwing: false,
    privacy: true,
    defaultWidth: 90,
    opening: { height: STD_DOOR_HEIGHT, sill: 0 },
    description: 'Slides into/along the wall. Space-saving where a swing won’t fit; adds privacy without an arc.',
  },
  cased_opening: {
    type: 'cased_opening',
    label: 'Cased opening',
    hasSwing: false,
    privacy: false,
    defaultWidth: 100,
    opening: { height: STD_OPEN_HEIGHT, sill: 0 },
    description: 'A framed doorway-sized opening with no door. Keeps definition without privacy (kitchen↔dining, hall↔living).',
  },
  archway: {
    type: 'archway',
    label: 'Archway',
    hasSwing: false,
    privacy: false,
    defaultWidth: 120,
    opening: { height: STD_OPEN_HEIGHT, sill: 0 },
    description: 'A curved-top open passage. Decorative open connector (living↔dining, foyer↔living). No door.',
  },
  wide_opening: {
    type: 'wide_opening',
    label: 'Wide / double-wide opening',
    hasSwing: false,
    privacy: false,
    defaultWidth: 200,
    opening: { height: STD_OPEN_HEIGHT, sill: 0 },
    description: 'An extra-wide cased/framed opening for an open-plan feel between major living spaces. Strong sight line.',
  },
  pass_through: {
    type: 'pass_through',
    label: 'Pass-through',
    hasSwing: false,
    privacy: false,
    defaultWidth: 100,
    opening: { height: 110, sill: PASS_THROUGH_SILL },
    description: 'A window-like opening above counter height — classic kitchen↔dining serving hatch. Opens sight/serving without a doorway.',
  },
  half_wall: {
    type: 'half_wall',
    label: 'Half-wall / pony wall',
    hasSwing: false,
    privacy: false,
    defaultWidth: 150,
    // open ABOVE the pony wall: sill at HALF_WALL_SILL, hole runs to ceiling.
    opening: { height: STD_OPEN_HEIGHT, sill: HALF_WALL_SILL },
    description: 'A partial-height wall that divides without enclosing. Defines zones while keeping openness (living↔dining, stair edges).',
  },
  hallway_link: {
    type: 'hallway_link',
    label: 'Hallway link',
    hasSwing: false,
    privacy: false,
    defaultWidth: 100,
    opening: { height: STD_OPEN_HEIGHT, sill: 0 },
    description: 'A circulation link into a hallway room. Used when many rooms branch off a common path.',
  },
}

export const CONNECTOR_TYPE_LIST: ConnectorTypeInfo[] = Object.values(CONNECTOR_TYPE_INFO)

/** Minimum sensible clear width for an interior door/passage (~32 in). AC9 threshold. */
export const MIN_PASSAGE_WIDTH = 80
/** Comfortable passage width (~36 in). */
export const COMFORTABLE_PASSAGE_WIDTH = 92

export function connectorInfo(type: ConnectorType): ConnectorTypeInfo {
  return CONNECTOR_TYPE_INFO[type]
}

/** Open connectors offer no privacy — used by AC1 (bathroom) / AC4 (bedroom). */
export function isOpenConnector(type: ConnectorType): boolean {
  return !CONNECTOR_TYPE_INFO[type].privacy
}
