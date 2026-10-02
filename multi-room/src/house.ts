/**
 * House construction + room placement. The House is the container that wraps
 * Agent A's RoomDesign — these helpers keep the wrap faithful and the
 * "everything optional" rule intact (a one-room house is always valid).
 */
import type { RoomDesign } from './interior'
import type { Footprint, House, HouseRoom, RoomType } from './types'
import { HOUSE_SCHEMA_VERSION } from './types'
import { bbox } from './geometry/walls'
import { uid } from './util/id'

/** Compute a room's footprint from its interior polygon's bounding box. */
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

/** Wrap a single RoomDesign as a one-room HouseRoom of the given type. */
export function roomFromInterior(
  interior: RoomDesign,
  type: RoomType = 'bedroom',
  placement?: { x: number; z: number; rotation?: number },
): HouseRoom {
  return {
    room_id: uid('room'),
    type,
    footprint: footprintFromInterior(interior, placement),
    interior,
  }
}

/**
 * Create a fresh House. With no rooms it is still a valid (empty) house; the
 * usual path is to seed it with the user's current single room.
 */
export function createHouse(opts: { name?: string; rooms?: HouseRoom[] } = {}): House {
  const now = Date.now()
  return {
    schema_version: HOUSE_SCHEMA_VERSION,
    house_id: uid('house'),
    name: opts.name ?? 'My home',
    rooms: opts.rooms ?? [],
    connectors: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Wrap today's single-room design as a complete one-room house with no
 * connectors. This is the backward-compatibility seam: a bare RoomDesign in,
 * a valid House out, nothing forced.
 */
export function wrapSingleRoom(interior: RoomDesign, type: RoomType = 'bedroom'): House {
  return createHouse({ name: interior.name || 'My home', rooms: [roomFromInterior(interior, type)] })
}

/** Append a room to a house (immutably), returning the new house. */
export function addRoom(house: House, room: HouseRoom): House {
  return { ...house, rooms: [...house.rooms, room], updatedAt: Date.now() }
}

/** Place/replace a room's footprint position (immutably). */
export function moveRoom(
  house: House,
  roomId: string,
  placement: { x: number; z: number; rotation?: number },
): House {
  return {
    ...house,
    rooms: house.rooms.map((r) =>
      r.room_id === roomId
        ? {
            ...r,
            footprint: {
              ...r.footprint,
              x: placement.x,
              z: placement.z,
              rotation: placement.rotation ?? r.footprint.rotation,
            },
          }
        : r,
    ),
    updatedAt: Date.now(),
  }
}

/** Look up a room by id. */
export function getRoom(house: House, roomId: string): HouseRoom | undefined {
  return house.rooms.find((r) => r.room_id === roomId)
}
