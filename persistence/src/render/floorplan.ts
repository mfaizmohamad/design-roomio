/**
 * Top-down floor-plan renderer (2D canvas) for a House. Owned by Agent C (house
 * data). One renderer, three consumers: the live library/demo preview, the auto
 * THUMBNAIL (toDataURL), and the floor-plan PDF / image exports (C2-5). Pure
 * drawing — give it a CanvasRenderingContext2D and a House.
 *
 * World cm → pixels: rooms are placed by footprint {x,z,rotation}; we fit the
 * union bounds into the canvas with a margin. Walls, door/window openings,
 * furniture footprints (with colour), room labels + dimensions are drawn.
 */
import type { House, HouseRoom, Vec2, FurnitureItem } from '../scene/slices'

export interface FloorplanOptions {
  width: number
  height: number
  /** px padding around the plan. */
  padding?: number
  background?: string
  /** Draw room labels + dimensions (off for tiny thumbnails). */
  labels?: boolean
  /** Draw furniture footprints. */
  furniture?: boolean
  /** Override device pixel ratio handling (canvas already sized in device px). */
  dpr?: number
}

interface Pt {
  x: number
  y: number
}

/** Rotate a local cm point by the footprint rotation, then translate to world cm. */
function roomPointToWorld(room: HouseRoom, p: Vec2): Pt {
  const { x, z, rotation } = room.footprint
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    x: x + p.x * cos - p.z * sin,
    y: z + p.x * sin + p.z * cos,
  }
}

function worldBounds(house: House): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const room of house.rooms) {
    for (const c of room.interior.corners) {
      const w = roomPointToWorld(room, c)
      if (w.x < minX) minX = w.x
      if (w.y < minY) minY = w.y
      if (w.x > maxX) maxX = w.x
      if (w.y > maxY) maxY = w.y
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  return { minX, minY, maxX, maxY }
}

const ROOM_FILL: Record<string, string> = {
  bedroom: '#eef2f7',
  living: '#eef6f0',
  kitchen: '#fbf3e8',
  bathroom: '#e9f3f6',
  dining: '#f5eef7',
  office: '#eef0f7',
  foyer: '#f3f1ec',
  hallway: '#f1f1f1',
}

export function renderFloorplan(
  ctx: CanvasRenderingContext2D,
  house: House,
  opts: FloorplanOptions,
): void {
  const { width, height } = opts
  const pad = opts.padding ?? Math.round(Math.min(width, height) * 0.08)
  const labels = opts.labels ?? true
  const showFurniture = opts.furniture ?? true

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = opts.background ?? '#cdccc9'
  ctx.fillRect(0, 0, width, height)

  const b = worldBounds(house)
  const planW = Math.max(1, b.maxX - b.minX)
  const planH = Math.max(1, b.maxY - b.minY)
  const scale = Math.min((width - pad * 2) / planW, (height - pad * 2) / planH)
  // Center the plan in the canvas.
  const offX = (width - planW * scale) / 2 - b.minX * scale
  const offY = (height - planH * scale) / 2 - b.minY * scale
  const toPx = (w: Pt): Pt => ({ x: w.x * scale + offX, y: w.y * scale + offY })

  for (const room of house.rooms) {
    drawRoom(ctx, room, toPx, scale, { labels, showFurniture })
  }
}

function drawRoom(
  ctx: CanvasRenderingContext2D,
  room: HouseRoom,
  toPx: (w: Pt) => Pt,
  scale: number,
  o: { labels: boolean; showFurniture: boolean },
): void {
  const corners = room.interior.corners
  if (corners.length < 3) return
  const pts = corners.map((c) => toPx(roomPointToWorld(room, c)))

  // floor fill
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.fillStyle = ROOM_FILL[room.type] ?? '#eef0f2'
  ctx.fill()

  // walls
  ctx.lineWidth = Math.max(1.5, (room.interior.wallThickness || 12) * scale)
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineJoin = 'miter'
  ctx.stroke()

  if (o.showFurniture) {
    // Draw largest footprints first (rugs under furniture), so small items stay visible.
    const ordered = [...room.interior.furniture].sort((a, b) => b.w * b.d - a.w * a.d)
    for (const f of ordered) drawFurniture(ctx, room, f, toPx)
  }

  if (o.labels) drawLabel(ctx, room, pts)
}

function drawFurniture(
  ctx: CanvasRenderingContext2D,
  room: HouseRoom,
  f: FurnitureItem,
  toPx: (w: Pt) => Pt,
): void {
  // Furniture is an OBB in room-local cm: center (x,z), size (w,d), rotation about Y.
  const hw = f.w / 2
  const hd = f.d / 2
  const local: Vec2[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ]
  const cos = Math.cos(f.rotation)
  const sin = Math.sin(f.rotation)
  const pts = local.map((p) => {
    const rx = p.x * cos - p.z * sin + f.x
    const rz = p.x * sin + p.z * cos + f.z
    return toPx(roomPointToWorld(room, { x: rx, z: rz }))
  })
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.fillStyle = f.color || '#b9b2a6'
  ctx.globalAlpha = 0.9
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()
}

function centroid(pts: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p.x
    y += p.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

function drawLabel(ctx: CanvasRenderingContext2D, room: HouseRoom, pts: Pt[]): void {
  const c = centroid(pts)
  const name = room.interior.name || titleCase(room.type)
  const dims = `${Math.round(room.footprint.w)}×${Math.round(room.footprint.l)} cm`
  ctx.fillStyle = '#222'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(name, c.x, c.y - 7)
  ctx.fillStyle = '#6b6b6b'
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.fillText(dims, c.x, c.y + 9)
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
