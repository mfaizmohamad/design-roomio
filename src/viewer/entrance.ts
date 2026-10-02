import { bbox, deriveWalls } from '../geometry/walls'
import type { Opening, RoomDesign, Vec2 } from '../types'

/** How far inside the front door (cm) a walkthrough starts — about one step in,
 *  clear of the door leaf's swing so the walker is not born inside the door. */
export const ENTRANCE_STEP_IN_CM = 70

interface RoomLike {
  type: string
  level?: number
  pos?: Vec2
  design: Pick<RoomDesign, 'corners' | 'openings'>
}

/** A real door (not an open passage or archway) — what a front door is. */
const isEntryDoor = (o: Pick<Opening, 'kind' | 'style'>) => o.kind === 'door' && o.style !== 'passage'

/** An opening's centre on its wall, in house-plane cm. Room corners are local to
 *  the room's bbox centre, which layoutHouse places at room.pos. */
function openingPoint(room: RoomLike, o: Pick<Opening, 'wallId' | 't'>): Vec2 | null {
  if (!room.pos) return null
  const wall = deriveWalls(room.design.corners).find((w) => w.id === o.wallId)
  if (!wall) return null
  const b = bbox(room.design.corners)
  const along = o.t * wall.length
  return { x: wall.a.x + wall.dirX * along - b.cx + room.pos.x, z: wall.a.z + wall.dirZ * along - b.cz + room.pos.z }
}

/**
 * Where a buyer walkthrough should begin: just inside the home's front door,
 * facing into the home. `at` is in house-plane cm (the walker's coordinate
 * space); `face` is a unit direction in the same space.
 *
 * The front door is the first real door of a ground-floor FOYER room (the
 * entrance lobby). The walker faces that room's open passage onward when it has
 * one, else straight in from the door. Returns null when the home has no such
 * room/door or the room has no position — callers fall back to another start
 * (e.g. the living room).
 */
export function entranceSpawn(rooms: readonly RoomLike[]): { at: Vec2; face: Vec2 } | null {
  for (const room of rooms) {
    if (room.type !== 'foyer' || (room.level ?? 0) !== 0 || !room.pos) continue
    const door = room.design.openings.find(isEntryDoor)
    if (!door) continue
    const wall = deriveWalls(room.design.corners).find((w) => w.id === door.wallId)
    const doorPos = openingPoint(room, door)
    if (!wall || !doorPos) continue
    const { x: doorX, z: doorZ } = doorPos
    // Wall normals point INTO the room (deriveWalls), i.e. into the home.
    const at = { x: doorX + wall.nx * ENTRANCE_STEP_IN_CM, z: doorZ + wall.nz * ENTRANCE_STEP_IN_CM }
    // Face the foyer's open passage onward into the home when it has one. Straight
    // in from the door often faces the lobby's far wall a metre away; the passage
    // is where a visitor actually looks and walks.
    const onward = room.design.openings.find((o) => o.kind === 'door' && o !== door && !isEntryDoor(o))
    const onwardPos = onward && openingPoint(room, onward)
    if (onwardPos) {
      const dx = onwardPos.x - at.x
      const dz = onwardPos.z - at.z
      const len = Math.hypot(dx, dz)
      if (len > 1) return { at, face: { x: dx / len, z: dz / len } }
    }
    return { at, face: { x: wall.nx, z: wall.nz } }
  }
  return null
}
