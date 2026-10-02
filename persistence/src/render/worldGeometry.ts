/**
 * Convert a House into world-space (METERS) geometry primitives for the 3D
 * showcase. Pure + testable. Matches the app's convention (src/three/coords.ts):
 * design space is centimeters; world units are meters; the scene is centered on
 * the house bounding-box center. We reconstruct a faithful-enough scene from the
 * envelope (zero coupling to A's renderer): floors, wall segments, furniture boxes.
 */
import type { House, HouseRoom, Vec2 } from '../scene/slices'

export interface WorldFloor {
  /** polygon in meters [x,z] */
  polygon: [number, number][]
  color: string
  roomType: string
}
export interface WorldWall {
  /** segment endpoints in meters */
  a: [number, number]
  b: [number, number]
  thickness: number // m
  height: number // m
}
export interface WorldBox {
  center: [number, number, number] // meters [x,y,z]
  size: [number, number, number] // meters [w,h,d]
  rotationY: number // radians
  color: string
}
export interface WorldScene {
  floors: WorldFloor[]
  walls: WorldWall[]
  boxes: WorldBox[]
  /** centripetal tour waypoints (meters [x,z]) through room centers */
  tour: [number, number][]
  /** half-extent (m) of the house, for camera framing */
  radius: number
}

const ROOM_FILL: Record<string, string> = {
  bedroom: '#dfe6ef',
  living: '#dfeee4',
  kitchen: '#f3e7d3',
  bathroom: '#dceef3',
  dining: '#ece0f0',
  office: '#e0e4f0',
  foyer: '#ece9e0',
  hallway: '#e8e8e8',
}

/** Rotate a room-local cm point by the footprint, translate to world cm. */
function roomToWorldCm(room: HouseRoom, p: Vec2): [number, number] {
  const { x, z, rotation } = room.footprint
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return [x + p.x * cos - p.z * sin, z + p.x * sin + p.z * cos]
}

function houseBoundsCm(house: House): { cx: number; cz: number; w: number; d: number } {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const room of house.rooms) {
    for (const c of room.interior.corners) {
      const [wx, wz] = roomToWorldCm(room, c)
      if (wx < minX) minX = wx
      if (wx > maxX) maxX = wx
      if (wz < minZ) minZ = wz
      if (wz > maxZ) maxZ = wz
    }
  }
  if (!Number.isFinite(minX)) return { cx: 0, cz: 0, w: 100, d: 100 }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, d: maxZ - minZ }
}

export function buildWorldScene(house: House): WorldScene {
  const b = houseBoundsCm(house)
  // cm → m, recentered on the house center (so the scene sits around the origin).
  const M = (cm: number) => cm / 100
  const toM = ([x, z]: [number, number]): [number, number] => [M(x - b.cx), M(z - b.cz)]

  const floors: WorldFloor[] = []
  const walls: WorldWall[] = []
  const boxes: WorldBox[] = []
  const tour: [number, number][] = []

  for (const room of house.rooms) {
    const corners = room.interior.corners
    if (corners.length >= 3) {
      const poly = corners.map((c) => toM(roomToWorldCm(room, c)))
      floors.push({ polygon: poly, color: ROOM_FILL[room.type] ?? '#e7eaee', roomType: room.type })
      const th = M(room.interior.wallThickness || 12)
      const h = M(room.interior.wallHeight || 270)
      for (let i = 0; i < corners.length; i++) {
        const a = toM(roomToWorldCm(room, corners[i]))
        const bb = toM(roomToWorldCm(room, corners[(i + 1) % corners.length]))
        walls.push({ a, b: bb, thickness: th, height: h })
      }
      // tour waypoint = room centroid (m)
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length
      const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length
      tour.push([cx, cz])
    }
    for (const f of room.interior.furniture) {
      // furniture center: room-local OBB center → world cm → m
      const [wx, wz] = roomToWorldCm(room, { x: f.x, z: f.z })
      const [mx, mz] = toM([wx, wz])
      boxes.push({
        center: [mx, M(f.h) / 2, mz],
        size: [Math.max(0.05, M(f.w)), Math.max(0.02, M(f.h)), Math.max(0.05, M(f.d))],
        rotationY: room.footprint.rotation + f.rotation,
        color: f.color || '#b9b2a6',
      })
    }
  }

  const radius = Math.max(2, M(Math.max(b.w, b.d)) / 2)
  return { floors, walls, boxes, tour, radius }
}
