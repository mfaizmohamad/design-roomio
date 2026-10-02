/**
 * Normalize any historical "scene" payload into a current `House`.
 *
 * Ported read-only from multi-room/src/{house,persistence,geometry/walls}.ts
 * (Agent C's own module — the source of truth). Kept here so /persistence builds
 * standalone with zero cross-package coupling, mirroring the team convention.
 * If C's house coercion changes materially, re-sync this mirror (noted in LEARNINGS).
 *
 * Recognizes, in order: a full House, a bare RoomDesign (today's single-room save),
 * and Agent A's localStorage design-map { [id]: RoomDesign } (wraps the newest).
 */
import {
  HOUSE_SCHEMA_VERSION,
  type House,
  type HouseRoom,
  type HouseRoomType,
  type Footprint,
  type RoomDesign,
  type Vec2,
} from './slices'
import { uid } from '../util/id'

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Axis-aligned bounding box of a cm polygon. */
function bbox(corners: Vec2[]): { w: number; d: number } {
  if (!corners.length) return { w: 0, d: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const c of corners) {
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.z < minZ) minZ = c.z
    if (c.z > maxZ) maxZ = c.z
  }
  return { w: maxX - minX, d: maxZ - minZ }
}

export function footprintFromInterior(
  interior: RoomDesign,
  placement: { x: number; z: number; rotation?: number } = { x: 0, z: 0 },
): Footprint {
  const b = bbox(interior.corners)
  return {
    shape: interior.shape === 'rect' ? 'rectangular' : 'polygon',
    x: placement.x,
    z: placement.z,
    rotation: placement.rotation ?? 0,
    w: b.w,
    l: b.d,
  }
}

/** Looks like Agent A's RoomDesign (the fields our wrap relies on). */
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

function roomFromInterior(interior: RoomDesign, type: HouseRoomType = 'bedroom'): HouseRoom {
  return { room_id: uid('room'), type, footprint: footprintFromInterior(interior), interior }
}

export function wrapSingleRoom(interior: RoomDesign, type: HouseRoomType = 'bedroom'): House {
  const now = nowOr(interior.updatedAt)
  return {
    schema_version: HOUSE_SCHEMA_VERSION,
    house_id: uid('house'),
    name: interior.name || 'My home',
    rooms: [roomFromInterior(interior, type)],
    connectors: [],
    createdAt: nowOr(interior.createdAt),
    updatedAt: now,
  }
}

function coerceRoom(value: unknown): HouseRoom | null {
  if (!isObj(value)) return null
  if (looksLikeRoomDesign(value.interior)) {
    const interior = value.interior as RoomDesign
    return {
      room_id: typeof value.room_id === 'string' ? value.room_id : interior.id,
      type: (typeof value.type === 'string' ? value.type : 'bedroom') as HouseRoomType,
      footprint: isObj(value.footprint)
        ? (value.footprint as unknown as Footprint)
        : footprintFromInterior(interior),
      interior,
    }
  }
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

/** Single entry point: any supported scene payload → a valid House, or null. */
export function coerceHouse(value: unknown): House | null {
  // (1) already a house
  if (looksLikeHouse(value)) {
    const v = value as unknown as Record<string, unknown>
    const rawRooms = v.rooms as unknown[]
    const rooms = rawRooms.map(coerceRoom).filter((r): r is HouseRoom => r !== null)
    // A zero-room house is not a renderable design (and a crafted/empty showcase
    // payload must fall through to the graceful "invalid link" state, not crash).
    if (rooms.length === 0) return null
    return {
      schema_version: HOUSE_SCHEMA_VERSION,
      house_id: typeof v.house_id === 'string' ? v.house_id : uid('house'),
      name: typeof v.name === 'string' ? v.name : 'My home',
      rooms,
      connectors: Array.isArray(v.connectors) ? (v.connectors as House['connectors']) : [],
      createdAt: isFiniteNumber(v.createdAt) ? v.createdAt : nowOr(),
      updatedAt: isFiniteNumber(v.updatedAt) ? v.updatedAt : nowOr(),
    }
  }
  // (2) a bare single-room RoomDesign → wrap it
  if (looksLikeRoomDesign(value)) {
    return wrapSingleRoom(value as RoomDesign)
  }
  // (3) Agent A's design-map { [id]: RoomDesign } → wrap the newest
  if (isObj(value)) {
    const designs = Object.values(value).filter(looksLikeRoomDesign) as RoomDesign[]
    if (designs.length > 0) {
      designs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      return wrapSingleRoom(designs[0])
    }
  }
  return null
}

/** First room's id (the canonical room for single-room lighting/thumbnails). */
export function primaryRoomId(house: House): string | null {
  return house.rooms[0]?.room_id ?? null
}

function nowOr(v?: unknown): number {
  return isFiniteNumber(v) ? v : Date.now()
}
