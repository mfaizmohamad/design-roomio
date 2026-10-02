// PlanArranger — a flat 2D top-down floor-plan panel for arranging rooms (bottom-right).
//
// Replaces the old "drag rooms in the 3D perspective view" interaction (which was depth-ambiguous
// and fought OrbitControls). Industry standard (Floorplanner / RoomSketcher / magicplan): arrange in
// a flat 2D plan, preview in 3D. Here each room is a labelled rectangle you drag in a top-down SVG
// mini-plan; a screen drag maps 1:1 to a floor coordinate, so it's precise and intuitive. Dragging
// snaps rooms flush to each other (edge magnetism, like tldraw/Figma) so they share a wall and the
// existing layoutHouse auto-cuts a doorway between them. All positions commit through the SAME
// useHouse.moveRoom the 3D view reads, so the 3D preview + doorways update live.
//
// Everything is in house-plane CENTIMETERS: the SVG viewBox IS the house bounds in cm, so pointer↔cm
// is a single getScreenCTM().inverse() transform and snapping math stays in cm.

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { bbox, deriveWalls, pointOnWall } from '../geometry/walls'
import { useHouse, ROOM_TYPE_LIST, ROOM_TYPE_INFO, type RoomType } from './houseSession'
import { applySnaps, type SnapGuide, type SnapRect } from './planSnap'
import type { PlacedRoom } from './houseLayout'

interface Bounds {
  /** house extents (cm) + center — from houseBoundsCm. minX/minZ are derived from cx/cz ± w/d÷2. */
  w: number
  d: number
  cx: number
  cz: number
}

export interface PlanArrangerProps {
  /** the whole house's placed rooms (from layoutHouse, active room merged) — same as HouseView. */
  placed: PlacedRoom[]
  /** overall house extents in cm (from houseBoundsCm). */
  bounds: Bounds
  anchorRightPx?: number
  anchorBottomPx?: number
}

// Distinctive per-type fill so the plan reads at a glance (kitchen warm, bath cool, bedroom blue…).
const TYPE_COLORS: Record<string, string> = {
  living: '#f3c98f',
  bedroom: '#a9c9f2',
  kitchen: '#f2a9a2',
  bathroom: '#a6dfe0',
  bath: '#a6dfe0',
  dining: '#cbb2ea',
  office: '#bad9a6',
  foyer: '#e6d6a3',
  hallway: '#dcdcd6',
  utility: '#cfd6d8',
  balcony: '#cfe6cf',
}
const typeColor = (t?: string) => (t && TYPE_COLORS[t]) || '#d9d2c5'

interface RoomRect {
  id: string
  name: string
  type?: string
  center: { x: number; z: number }
  size: { w: number; d: number }
}

/** Door midpoints (house cm) for every auto-cut connector, so we can show where rooms connect. */
function doorwayMarks(placed: PlacedRoom[]): { x: number; z: number }[] {
  const marks: { x: number; z: number }[] = []
  for (const p of placed) {
    const bb = bbox(p.design.corners)
    const off = { x: p.centerCm.x - bb.cx, z: p.centerCm.z - bb.cz }
    const walls = deriveWalls(p.design.corners)
    for (const o of p.extraOpenings) {
      const w = walls.find((ww) => ww.id === o.wallId)
      if (!w) continue
      const pt = pointOnWall(w, o.t)
      marks.push({ x: pt.x + off.x, z: pt.z + off.z })
    }
  }
  return marks
}

export function PlanArranger({ placed, bounds, anchorRightPx = 14, anchorBottomPx = 72 }: PlanArrangerProps) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const activeId = useHouse((s) => s.activeId)
  const roomCount = useHouse((s) => s.rooms.length)
  const moveRoom = useHouse((s) => s.moveRoom)
  const switchRoom = useHouse((s) => s.switchRoom)
  const addRoom = useHouse((s) => s.addRoom)
  const removeRoom = useHouse((s) => s.removeRoom)

  const svgRef = useRef<SVGSVGElement>(null)
  // Synchronous drag state (refs so handlers never read stale state mid-gesture).
  const dragRef = useRef<{ id: string; grabX: number; grabZ: number; sx: number; sy: number; moved: boolean } | null>(null)
  const lastCenterRef = useRef<{ x: number; z: number } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [localCenter, setLocalCenter] = useState<{ x: number; z: number } | null>(null)
  const [guides, setGuides] = useState<SnapGuide[]>([])

  // Drawable rooms (center + footprint size, cm) from the placed layout.
  const rooms: RoomRect[] = placed.map((p) => {
    const bb = bbox(p.design.corners)
    return { id: p.design.id, name: p.design.name, type: p.type, center: p.centerCm, size: { w: bb.w, d: bb.d } }
  })
  const doors = doorwayMarks(placed)

  // ── SVG framing: viewBox = house bounds (cm) + padding; pixel size matches the aspect ──────────
  const minX = bounds.cx - bounds.w / 2
  const minZ = bounds.cz - bounds.d / 2
  const pad = Math.max(50, Math.max(bounds.w, bounds.d) * 0.08)
  const vb = { x: minX - pad, y: minZ - pad, w: Math.max(bounds.w + 2 * pad, 1), h: Math.max(bounds.d + 2 * pad, 1) }
  const MAXW = 244
  const MAXH = 210
  const aspect = vb.w / vb.h
  let pxW = MAXW
  let pxH = MAXW / aspect
  if (pxH > MAXH) {
    pxH = MAXH
    pxW = MAXH * aspect
  }
  // Line/text sizes in cm (viewBox units) so they look consistent at any house size.
  const strokeCm = vb.w * 0.005

  const clientToCm = (clientX: number, clientY: number): { x: number; z: number } | null => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: p.x, z: p.y }
  }
  const pxPerCm = (): number => svgRef.current?.getScreenCTM()?.a || 1

  const onDown = (e: ReactPointerEvent<SVGGElement>, r: RoomRect, center: { x: number; z: number }) => {
    e.stopPropagation()
    if (!e.isPrimary) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const cm = clientToCm(e.clientX, e.clientY)
    dragRef.current = {
      id: r.id,
      grabX: cm ? cm.x - center.x : 0,
      grabZ: cm ? cm.z - center.z : 0,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    }
    lastCenterRef.current = { x: center.x, z: center.z }
    setDraggingId(r.id)
    setLocalCenter({ x: center.x, z: center.z })
  }

  const onMove = (e: ReactPointerEvent<SVGGElement>, r: RoomRect) => {
    const d = dragRef.current
    if (!d || d.id !== r.id) return
    const cm = clientToCm(e.clientX, e.clientY)
    if (!cm) return
    const proposed = { x: cm.x - d.grabX, z: cm.z - d.grabZ }
    const others: SnapRect[] = rooms.filter((o) => o.id !== r.id).map((o) => ({ x: o.center.x, z: o.center.z, w: o.size.w, d: o.size.d }))
    // ~8 screen px snap radius, converted to cm so the feel is constant regardless of panel size.
    const thresholdCm = 8 / pxPerCm()
    const snapped = applySnaps(proposed, r.size, others, { thresholdCm, gridCm: 10, disable: e.altKey })
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true
    lastCenterRef.current = { x: snapped.x, z: snapped.z }
    setLocalCenter({ x: snapped.x, z: snapped.z })
    setGuides(snapped.guides)
  }

  const onUp = (e: ReactPointerEvent<SVGGElement>, r: RoomRect) => {
    const d = dragRef.current
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    if (d && d.id === r.id) {
      if (d.moved && lastCenterRef.current) {
        // Commit through the store, which enforces touch-never-overlap + rounds to int cm.
        moveRoom(r.id, { x: Math.round(lastCenterRef.current.x), z: Math.round(lastCenterRef.current.z) })
      } else {
        switchRoom(r.id) // a tap (no real drag) selects the room to edit
      }
    }
    dragRef.current = null
    lastCenterRef.current = null
    setDraggingId(null)
    setLocalCenter(null)
    setGuides([])
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: anchorRightPx,
        bottom: anchorBottomPx,
        zIndex: 9,
        width: 268,
        background: 'rgba(255,255,255,0.94)',
        backdropFilter: 'blur(6px)',
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        border: '1px solid rgba(0,0,0,0.08)',
        font: '12px ui-sans-serif, system-ui, sans-serif',
        color: '#23211e',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle floor-plan arranger"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          font: '700 13px ui-sans-serif, system-ui, sans-serif',
          color: '#23211e',
        }}
      >
        <span>🧩 Floor plan · {roomCount} rooms</span>
        <span style={{ opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ opacity: 0.62, fontSize: 11 }}>Drag a room to move it · it snaps to neighbours · tap to edit</div>

          <div style={{ display: 'flex', justifyContent: 'center', background: '#f3f1ec', borderRadius: 10, padding: 8, border: '1px solid #e6e3dd' }}>
            <svg
              ref={svgRef}
              width={pxW}
              height={pxH}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              style={{ touchAction: 'none', userSelect: 'none', display: 'block' }}
            >
              {/* faint plot background */}
              <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#fbfaf7" />

              {/* engaged alignment guides (Figma-red), drawn while snapping */}
              {guides.map((g, i) =>
                g.axis === 'x' ? (
                  <line key={`g${i}`} x1={g.at} y1={vb.y} x2={g.at} y2={vb.y + vb.h} stroke="#e0483a" strokeWidth={strokeCm} strokeDasharray={`${strokeCm * 3} ${strokeCm * 2}`} />
                ) : (
                  <line key={`g${i}`} x1={vb.x} y1={g.at} x2={vb.x + vb.w} y2={g.at} stroke="#e0483a" strokeWidth={strokeCm} strokeDasharray={`${strokeCm * 3} ${strokeCm * 2}`} />
                ),
              )}

              {/* rooms */}
              {rooms.map((r) => {
                const c = draggingId === r.id && localCenter ? localCenter : r.center
                const x = c.x - r.size.w / 2
                const y = c.z - r.size.d / 2
                const active = r.id === activeId
                const dragging = draggingId === r.id
                const labelCm = Math.min(38, Math.max(16, r.size.d * 0.22))
                return (
                  <g
                    key={r.id}
                    onPointerDown={(e) => onDown(e, r, c)}
                    onPointerMove={(e) => onMove(e, r)}
                    onPointerUp={(e) => onUp(e, r)}
                    style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
                    role="button"
                    aria-label={`${r.name}${active ? ' (editing)' : ''} — drag to move, tap to edit`}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={r.size.w}
                      height={r.size.d}
                      rx={Math.min(12, r.size.w * 0.06)}
                      fill={typeColor(r.type)}
                      fillOpacity={dragging ? 0.9 : 1}
                      stroke={active ? '#111' : 'rgba(0,0,0,0.22)'}
                      strokeWidth={active ? strokeCm * 2.4 : strokeCm}
                    />
                    <text
                      x={c.x}
                      y={c.z}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={labelCm}
                      fontWeight={700}
                      fill="#1c1a17"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {r.name}
                    </text>
                  </g>
                )
              })}

              {/* doorway connectors (auto-cut between touching rooms) */}
              {doors.map((m, i) => (
                <circle key={`d${i}`} cx={m.x} cy={m.z} r={strokeCm * 3.5} fill="#fff" stroke="#8a8577" strokeWidth={strokeCm * 0.8} />
              ))}
            </svg>
          </div>

          {/* Add-room + remove-selected */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setAdding((v) => !v)} style={miniBtn(adding)} aria-expanded={adding}>
              ＋ Add room
            </button>
            <button
              onClick={() => activeId && removeRoom(activeId)}
              disabled={roomCount <= 1}
              title={roomCount <= 1 ? 'Keep at least one room' : 'Remove the selected room (you can undo)'}
              style={{ ...miniBtn(false), color: roomCount <= 1 ? '#bbb' : '#b0392f', cursor: roomCount <= 1 ? 'not-allowed' : 'pointer' }}
            >
              ✕ Remove
            </button>
          </div>

          {adding && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 8, borderRadius: 10, background: '#fbfaf7', border: '1px solid #e6e3dd' }}>
              {ROOM_TYPE_LIST.map((info) => (
                <button
                  key={info.type}
                  onClick={() => {
                    addRoom(info.type as RoomType)
                    setAdding(false)
                  }}
                  title={info.purpose}
                  style={{ ...miniBtn(false), justifyContent: 'flex-start', fontSize: 11.5 }}
                >
                  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: typeColor(info.type), marginRight: 6 }} />
                  {ROOM_TYPE_INFO[info.type].label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function miniBtn(active: boolean): CSSProperties {
  return {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid rgba(0,0,0,0.14)',
    background: active ? '#111' : '#fff',
    color: active ? '#fff' : '#23211e',
    font: '700 12px ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
  }
}
