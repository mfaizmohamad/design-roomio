/**
 * The House schema — Agent C's domain. A House WRAPS Agent A's RoomDesign.
 *
 * Layering: Agent A designs INSIDE a room (RoomDesign). Agent C arranges ROOMS
 * INTO A HOUSE and joins them with connectors. So `room.interior` is A's model
 * verbatim, and everything here is the container around it.
 *
 * Backward compatibility is mandatory (see persistence.ts): a saved bare
 * RoomDesign from today loads as a one-room house with an empty connectors array.
 */
import type { RoomDesign } from './interior'

export const HOUSE_SCHEMA_VERSION = '1.0' as const

/** The eight room types in scope (kitchen & bathroom explicitly included). */
export type RoomType =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'bathroom'
  | 'dining'
  | 'office'
  | 'foyer'
  | 'hallway'
  | 'balcony'

export const ROOM_TYPES: RoomType[] = [
  'bedroom',
  'living',
  'kitchen',
  'bathroom',
  'dining',
  'office',
  'foyer',
  'hallway',
  'balcony',
]

/**
 * Where a room sits in the house plane. The interior's local cm coordinates are
 * mapped to world cm by rotating by `rotation` then translating by (x, z).
 * `w`/`l` cache the interior's axis-aligned bbox size (cm) for quick layout/adjacency.
 */
export interface Footprint {
  shape: 'rectangular' | 'polygon'
  x: number // world cm of the interior's local origin
  z: number
  rotation: number // radians in the house plane (0 = unrotated)
  w: number // bbox width (cm)
  l: number // bbox length / depth (cm)
}

/** The full connector taxonomy (brief §4). */
export type ConnectorType =
  | 'hinged' // standard single swinging door
  | 'double' // two hinged leaves
  | 'pocket' // sliding / pocket door (no swing arc)
  | 'cased_opening' // framed opening, no door
  | 'archway' // curved-top open passage
  | 'wide_opening' // extra-wide cased/framed opening
  | 'pass_through' // window-like opening above counter height
  | 'half_wall' // partial-height pony wall
  | 'hallway_link' // circulation link to a hallway room

export const CONNECTOR_TYPES: ConnectorType[] = [
  'hinged',
  'double',
  'pocket',
  'cased_opening',
  'archway',
  'wide_opening',
  'pass_through',
  'half_wall',
  'hallway_link',
]

/**
 * Door swing. Generalizes the brief's `{dir, hinge}`: `into_room` is the room id
 * the leaf opens into (the "direction"), `hinge` is which end of the opening the
 * hinge sits on. `null` connector.swing means an open connector (no leaf).
 */
export interface Swing {
  into_room: string
  hinge: 'left' | 'right'
}

/** Which wall (by interior corner-edge index) is shared, in each room. */
export interface SharedWall {
  room_a_wall: number
  room_b_wall: number
}

/** A join between two rooms, living on a shared wall segment. */
export interface Connector {
  connector_id: string
  type: ConnectorType
  /** [roomIdA, roomIdB]; order matches shared_wall.room_a_wall / room_b_wall. */
  between: [string, string]
  shared_wall: SharedWall
  /** center of the opening along room A's wall, 0..1 */
  position_along_wall: number
  width_cm: number
  /** doors only; null for open connectors */
  swing: Swing | null
}

/** A room in the house: a type + a placement + Agent A's interior model. */
export interface HouseRoom {
  room_id: string
  type: RoomType
  footprint: Footprint
  interior: RoomDesign
}

/** The whole dwelling. */
export interface House {
  schema_version: typeof HOUSE_SCHEMA_VERSION
  house_id: string
  name: string
  rooms: HouseRoom[]
  connectors: Connector[]
  createdAt: number
  updatedAt: number
}
