/**
 * House (de)serialization with MANDATORY backward compatibility.
 *
 * Three input shapes must all load into a valid House:
 *   1. A new House JSON (has rooms[] / schema_version).
 *   2. A bare RoomDesign saved by today's Roomio (Agent A's single-room file)
 *      → wraps into a one-room house, empty connectors.
 *   3. Agent A's localStorage design-map { [id]: RoomDesign } (whole-store export)
 *      → loads each as a one-room house is overkill, so we wrap the first/only one;
 *      callers that want all rooms can use `housesFromDesignMap`.
 *
 * We are deliberately lenient (mirroring A's coerceDesign): anything we can't
 * recognize returns null rather than throwing.
 */
import type { RoomDesign } from './interior'
import type { House, HouseRoom } from './types'
import { HOUSE_SCHEMA_VERSION } from './types'
import { createHouse, footprintFromInterior, wrapSingleRoom } from './house'

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Looks like Agent A's RoomDesign (the fields our wrap actually relies on). */
export function looksLikeRoomDesign(v: unknown): v is RoomDesign {
  if (!isObj(v)) return false
  return (
    typeof v.id === 'string' &&
    Array.isArray(v.corners) &&
    v.corners.length >= 3 &&
    isObj(v.materials)
  )
}

/** Looks like our House envelope. */
export function looksLikeHouse(v: unknown): v is House {
  return isObj(v) && Array.isArray((v as Record<string, unknown>).rooms)
}

/**
 * Normalize an unknown parsed value into a House, or null if unrecognizable.
 * This is the single entry point the UI/server should call on load.
 */
export function coerceHouse(value: unknown): House | null {
  // (1) already a house
  if (looksLikeHouse(value)) {
    const v = value as unknown as Record<string, unknown>
    const rooms = (v.rooms as unknown[]).map(coerceRoom).filter((r): r is HouseRoom => r !== null)
    if (rooms.length === 0 && (v.rooms as unknown[]).length > 0) return null
    const now = Date.now()
    return {
      schema_version: HOUSE_SCHEMA_VERSION,
      house_id: typeof v.house_id === 'string' ? v.house_id : `house_${now.toString(36)}`,
      name: typeof v.name === 'string' ? v.name : 'My home',
      rooms,
      connectors: Array.isArray(v.connectors) ? (v.connectors as House['connectors']) : [],
      createdAt: isFiniteNumber(v.createdAt) ? v.createdAt : now,
      updatedAt: isFiniteNumber(v.updatedAt) ? v.updatedAt : now,
    }
  }

  // (2) a bare single-room RoomDesign → wrap it
  if (looksLikeRoomDesign(value)) {
    return wrapSingleRoom(value as RoomDesign)
  }

  // (3) Agent A's design-map { [id]: RoomDesign }
  if (isObj(value)) {
    const designs = Object.values(value).filter(looksLikeRoomDesign) as RoomDesign[]
    if (designs.length > 0) {
      // Most recently updated first, like A's listDesigns.
      designs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return wrapSingleRoom(designs[0])
    }
  }

  return null
}

/** Coerce one room entry; tolerates a bare RoomDesign in the rooms[] slot. */
function coerceRoom(value: unknown): HouseRoom | null {
  if (!isObj(value)) return null
  // A full HouseRoom
  if (looksLikeRoomDesign(value.interior)) {
    const interior = value.interior as RoomDesign
    return {
      room_id: typeof value.room_id === 'string' ? value.room_id : interior.id,
      type: (typeof value.type === 'string' ? value.type : 'bedroom') as HouseRoom['type'],
      footprint: isObj(value.footprint)
        ? (value.footprint as unknown as HouseRoom['footprint'])
        : footprintFromInterior(interior),
      interior,
    }
  }
  // A bare RoomDesign accidentally placed in rooms[]
  if (looksLikeRoomDesign(value)) {
    const interior = value as RoomDesign
    return {
      room_id: interior.id,
      type: 'bedroom',
      footprint: footprintFromInterior(interior),
      interior,
    }
  }
  return null
}

/** Parse a JSON string into a House (any supported shape); null on failure. */
export function loadHouseJSON(json: string): House | null {
  try {
    return coerceHouse(JSON.parse(json) as unknown)
  } catch {
    return null
  }
}

/** Serialize a House to pretty JSON. */
export function saveHouseJSON(house: House): string {
  return JSON.stringify(house, null, 2)
}

/** Wrap every design in A's design-map as its own one-room house (utility). */
export function housesFromDesignMap(map: Record<string, RoomDesign>): House[] {
  return Object.values(map)
    .filter(looksLikeRoomDesign)
    .map((d) => wrapSingleRoom(d))
}

export { createHouse }
