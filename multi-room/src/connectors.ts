/**
 * Connector placement + wall-cutting. The core C3 deliverable: placing a connector
 * cuts a matching opening into BOTH rooms' walls.
 *
 * We do NOT reinvent wall-cutting — a connector is reduced to an `Opening` on each
 * room's shared wall and fed through Agent A's `buildWallParts` (ported read-only
 * in geometry/walls.ts). The opening's location on room B is derived by projecting
 * room A's opening center onto room B's wall, so the hole lines up physically even
 * when the two walls differ in length or offset.
 */
import type { Opening, OpeningKind, OpeningStyle } from './interior'
import type { Connector, ConnectorType, House, HouseRoom, Swing } from './types'
import { connectorInfo } from './data/connectorTypes'
import { buildWallParts, deriveWalls, pointOnWall, type WallPart } from './geometry/walls'
import { findSharedWalls, worldWalls } from './geometry/placement'
import { getRoom } from './house'
import { uid } from './util/id'
import { clamp01 } from '../../shared/lib/math'

/** A connector's hole as it lands in one specific room. */
export interface DerivedOpening {
  connector_id: string
  room_id: string
  opening: Opening
}

/** Map a connector type to the closest interior opening kind/style (for cutting + optional render). */
function openingStyleFor(type: ConnectorType): { kind: OpeningKind; style: OpeningStyle } {
  switch (type) {
    case 'double':
      return { kind: 'door', style: 'double' }
    case 'pass_through':
      return { kind: 'window', style: 'windowSingle' }
    case 'half_wall':
      return { kind: 'window', style: 'windowDouble' }
    default:
      // hinged, pocket, cased_opening, archway, wide_opening, hallway_link
      return { kind: 'door', style: 'single' }
  }
}

/**
 * Derive the opening cut into each of the two rooms for a connector.
 * Returns [openingInRoomA, openingInRoomB]. Throws only if the referenced rooms
 * are missing (a programmer error, not user input).
 */
export function connectorOpenings(connector: Connector, house: House): [DerivedOpening, DerivedOpening] {
  const [aId, bId] = connector.between
  const roomA = getRoom(house, aId)
  const roomB = getRoom(house, bId)
  if (!roomA || !roomB) throw new Error(`connector ${connector.connector_id} references missing room(s)`)

  const info = connectorInfo(connector.type)
  const { kind, style } = openingStyleFor(connector.type)
  const { height, sill } = info.opening

  // Room A: the connector's position_along_wall is defined along A's wall.
  const tA = clamp01(connector.position_along_wall)
  const aWallId = `w${connector.shared_wall.room_a_wall}`

  // Room B: project A's opening-center world point onto B's wall to get tB.
  const tB = projectOntoRoomBWall(connector, roomA, roomB)
  const bWallId = `w${connector.shared_wall.room_b_wall}`

  const mk = (room_id: string, wallId: string, t: number): DerivedOpening => ({
    connector_id: connector.connector_id,
    room_id,
    opening: {
      id: `conn_${connector.connector_id}_${room_id === aId ? 'a' : 'b'}`,
      kind,
      style,
      wallId,
      t,
      width: connector.width_cm,
      height,
      sill,
    },
  })

  return [mk(aId, aWallId, tA), mk(bId, bWallId, tB)]
}

/** Center of the connector on room A's wall, projected onto room B's wall → tB (0..1). */
function projectOntoRoomBWall(connector: Connector, roomA: HouseRoom, roomB: HouseRoom): number {
  const aWalls = worldWalls(roomA)
  const bWalls = worldWalls(roomB)
  const wa = aWalls.find((w) => w.index === connector.shared_wall.room_a_wall)
  const wb = bWalls.find((w) => w.index === connector.shared_wall.room_b_wall)
  if (!wa || !wb) return clamp01(connector.position_along_wall)
  const t = clamp01(connector.position_along_wall)
  const px = wa.a.x + (wa.b.x - wa.a.x) * t
  const pz = wa.a.z + (wa.b.z - wa.a.z) * t
  const s = (px - wb.a.x) * wb.dirX + (pz - wb.a.z) * wb.dirZ
  return clamp01(s / wb.length)
}

/**
 * All openings that exist in a room's walls = the room's own interior openings
 * PLUS every connector-derived opening that lands in this room. This is what a
 * renderer (A or B) draws to show the room with its connector holes.
 */
export function openingsForRoom(room: HouseRoom, house: House): Opening[] {
  const own = room.interior.openings ?? []
  const fromConnectors: Opening[] = []
  for (const c of house.connectors) {
    if (!c.between.includes(room.room_id)) continue
    const [a, b] = connectorOpenings(c, house)
    if (a.room_id === room.room_id) fromConnectors.push(a.opening)
    if (b.room_id === room.room_id) fromConnectors.push(b.opening)
  }
  return [...own, ...fromConnectors]
}

/**
 * Cut a room's walls into solid parts, with holes for both its own openings and
 * every connector that lands on it. Proves the opening is cut in this room; call
 * for both rooms of a connector to confirm it's cut in BOTH. Keyed by wall index.
 */
export function wallPartsWithConnectors(room: HouseRoom, house: House): Map<number, WallPart[]> {
  const walls = deriveWalls(room.interior.corners)
  const openings = openingsForRoom(room, house)
  const out = new Map<number, WallPart[]>()
  for (const w of walls) {
    const onThisWall = openings.filter((o) => o.wallId === w.id)
    out.set(w.index, buildWallParts(w, onThisWall, room.interior.wallHeight, room.interior.wallThickness))
  }
  return out
}

export interface PlaceConnectorInput {
  type: ConnectorType
  between: [string, string]
  shared_wall: { room_a_wall: number; room_b_wall: number }
  position_along_wall: number
  /** defaults to the connector type's default width */
  width_cm?: number
  swing?: Swing | null
}

/**
 * Place a connector and return the updated house + the new connector. Never
 * blocks (the "everything optional" rule); callers run adjacency checks (C5)
 * separately to surface dismissible warnings.
 */
export function placeConnector(
  house: House,
  input: PlaceConnectorInput,
): { house: House; connector: Connector } {
  const info = connectorInfo(input.type)
  const connector: Connector = {
    connector_id: uid('conn'),
    type: input.type,
    between: input.between,
    shared_wall: input.shared_wall,
    position_along_wall: clamp01(input.position_along_wall),
    width_cm: input.width_cm ?? info.defaultWidth,
    // doors carry a swing; open connectors are null. Default a hinged swing into room B.
    swing:
      input.swing !== undefined
        ? input.swing
        : info.hasSwing
          ? { into_room: input.between[1], hinge: 'left' }
          : null,
  }
  return {
    house: { ...house, connectors: [...house.connectors, connector], updatedAt: Date.now() },
    connector,
  }
}

/**
 * Convenience: given two rooms the user wants to join, pick the best shared wall
 * and a centered placement. Returns null if the rooms don't actually touch (the
 * caller can still place manually — we never force adjacency).
 */
export function suggestPlacement(
  house: House,
  roomAId: string,
  roomBId: string,
  type: ConnectorType,
): PlaceConnectorInput | null {
  const roomA = getRoom(house, roomAId)
  const roomB = getRoom(house, roomBId)
  if (!roomA || !roomB) return null
  const shared = findSharedWalls(roomA, roomB)
  if (shared.length === 0) return null
  const best = shared[0]
  const info = connectorInfo(type)
  // center of the overlap interval, in A's wall t-space
  const center = (best.a_t0 + best.a_t1) / 2
  // clamp width to the overlap so the opening fits the shared span
  const walls = worldWalls(roomA)
  const wa = walls.find((w) => w.index === best.room_a_wall)
  const overlapLen = best.overlap_cm
  const width = Math.min(info.defaultWidth, Math.max(40, overlapLen - 20))
  void wa
  return {
    type,
    between: [roomAId, roomBId],
    shared_wall: { room_a_wall: best.room_a_wall, room_b_wall: best.room_b_wall },
    position_along_wall: center,
    width_cm: width,
  }
}

/** Midpoint world position of a connector (handy for labels / camera targets). */
export function connectorWorldPoint(connector: Connector, house: House) {
  const roomA = getRoom(house, connector.between[0])
  if (!roomA) return null
  const walls = deriveWalls(roomA.interior.corners)
  const w = walls.find((x) => x.index === connector.shared_wall.room_a_wall)
  if (!w) return null
  const local = pointOnWall(w, clamp01(connector.position_along_wall))
  const fp = roomA.footprint
  const r = fp.rotation || 0
  if (r === 0) return { x: local.x + fp.x, z: local.z + fp.z }
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: fp.x + (local.x * cos - local.z * sin), z: fp.z + (local.x * sin + local.z * cos) }
}
