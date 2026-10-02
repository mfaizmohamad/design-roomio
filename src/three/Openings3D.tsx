import * as THREE from 'three'
import type { Opening, Wall } from '../types'
import type { Frame } from './coords'
import { OPENING_MAP, type OpeningDef } from '../data/openings'
import { pointOnWall } from '../geometry/walls'
import { WindowExterior } from './WindowExterior'

// ---- shared material palette ------------------------------------------------
const PAINT = '#f1efe9' // off-white painted frame / stile / rail (default)
const GLASS = '#cfe3ea' // tinted glazing (door lites — flat translucent film)
const GLASS_TINT = '#e6f1f3' // very faint cool tint for real window glazing (transmission multiplies
// this over the exterior, so it stays near-white to let the view read through)
const METAL = '#3a3a3a' // dark handle / threshold

const cm = (v: number) => v / 100 // centimeters -> meters (world units)

/** Dark (aluminum/wood-stain) frames read slightly glossier than paint. */
function paintRoughness(color: string): number {
  const c = new THREE.Color(color)
  return c.r + c.g + c.b < 1.2 ? 0.45 : 0.7
}

// Painted box (frames, leaves, panels, muntins). Tint via `color` (per-opening).
function Paint({
  pos,
  size,
  color = PAINT,
}: {
  pos: [number, number, number]
  size: [number, number, number]
  color?: string
}): JSX.Element {
  return (
    <mesh position={pos} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={paintRoughness(color)} metalness={0} />
    </mesh>
  )
}

/**
 * Glazing pane. WINDOW lites get a real `meshPhysicalMaterial` with transmission — believable
 * refraction/reflection of the exterior backdrop (<WindowExterior>) + IBL, instead of a flat gray
 * film. DOOR lites keep the cheap translucent `meshStandardMaterial` so the count of transmissive
 * materials stays bounded to windows only (transmission renders its own scene pass — see below).
 *
 * Transmission + the app's post pipeline (RealismPost): the transmission render target is produced
 * INSIDE `WebGLRenderer.render` (once per frame, regardless of pane count) BEFORE the HalfFloat
 * EffectComposer reads the color/depth buffers, so N8AO's depth pass and the transmissive panes
 * don't fight — verified live. `transparent` is intentionally left false: transmissive materials go
 * in three's dedicated `transmissive` render list (not the transparent pass), which is what keeps
 * them compositing correctly under the composer. `thickness` is kept small (a flat window is a thin
 * plate; a large volume thickness over-refracts and smears the view) with a faint tint + subtle IOR
 * so the glazing reflects/refracts without hiding the exterior.
 *
 * PERF — the glass is `FrontSide`, NOT DoubleSide: three's transmission pass renders every DoubleSide
 * transmissive object's BACK side into the transmission target AND flips material.side twice per frame
 * (…needsUpdate=true) when WEBGL_multisampled_render_to_texture is unavailable. Across a whole flat's
 * ~70 window lites that is a real per-frame cliff. FrontSide skips that branch entirely; from the room
 * interior (the editing/beauty viewpoint) the pane looks identical. The transmission render target is
 * still built ONCE per frame regardless of pane count, so the only added cost is bounded front-side
 * draws — no FPS cliff.
 */
function GlassPane({
  pos,
  size,
  window: isWindow = false,
}: {
  pos: [number, number, number]
  size: [number, number, number]
  /** window lites → physical transmission glass; door lites → flat translucent film. */
  window?: boolean
}): JSX.Element {
  if (isWindow) {
    return (
      <mesh position={pos}>
        <boxGeometry args={size} />
        <meshPhysicalMaterial
          color={GLASS_TINT}
          roughness={0.06}
          metalness={0}
          transmission={0.92}
          thickness={0.35}
          ior={1.5}
          specularIntensity={1}
          side={THREE.FrontSide}
        />
      </mesh>
    )
  }
  return (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={GLASS}
        roughness={0.05}
        metalness={0}
        transparent
        opacity={0.22}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// A thin muntin border drawn around a glass lite (top/bottom/left/right rails).
function MuntinBorder({
  w,
  h,
  z,
  bar,
  color,
}: {
  w: number
  h: number
  z: number
  bar: number
  color?: string
}): JSX.Element {
  return (
    <group>
      <Paint pos={[0, h / 2 - bar / 2, z]} size={[w, bar, bar]} color={color} />
      <Paint pos={[0, -h / 2 + bar / 2, z]} size={[w, bar, bar]} color={color} />
      <Paint pos={[-w / 2 + bar / 2, 0, z]} size={[bar, h - 2 * bar, bar]} color={color} />
      <Paint pos={[w / 2 - bar / 2, 0, z]} size={[bar, h - 2 * bar, bar]} color={color} />
    </group>
  )
}

/**
 * A single glazed leaf: a tinted pane in the central `glass` fraction with a
 * painted stile/rail surround and a small grid of muntins (divided lites).
 */
function GlazedLeaf({
  w,
  h,
  depth,
  glass,
  cols,
  rows,
  color,
  barScale = 1,
  windowGlass = false,
}: {
  w: number
  h: number
  depth: number
  glass: number
  cols: number
  rows: number
  color?: string
  barScale?: number
  /** true for real windows → transmission glazing; false for glazed doors → flat film. */
  windowGlass?: boolean
}): JSX.Element {
  const slab = depth * 0.55
  const gw = w * glass
  const gh = h * glass
  const bar = Math.min(w, h) * 0.045 * barScale
  const cellW = gw / cols
  const cellH = gh / rows
  const lites: JSX.Element[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = -gw / 2 + cellW * (c + 0.5)
      const cy = -gh / 2 + cellH * (r + 0.5)
      lites.push(
        <group key={`l${r}-${c}`} position={[cx, cy, 0]}>
          <GlassPane pos={[0, 0, 0]} size={[cellW, cellH, depth * 0.18]} window={windowGlass} />
          <MuntinBorder w={cellW} h={cellH} z={slab / 2} bar={bar} color={color} />
          <MuntinBorder w={cellW} h={cellH} z={-slab / 2} bar={bar} color={color} />
        </group>,
      )
    }
  }
  return (
    <group>
      {/* painted stile/rail surround framing the glazed area */}
      <Paint pos={[0, h / 2 - (h - gh) / 4, 0]} size={[w, (h - gh) / 2, slab]} color={color} />
      <Paint pos={[0, -h / 2 + (h - gh) / 4, 0]} size={[w, (h - gh) / 2, slab]} color={color} />
      <Paint pos={[-w / 2 + (w - gw) / 4, 0, 0]} size={[(w - gw) / 2, gh, slab]} color={color} />
      <Paint pos={[w / 2 - (w - gw) / 4, 0, 0]} size={[(w - gw) / 2, gh, slab]} color={color} />
      {lites}
    </group>
  )
}

/** A solid panel-door leaf with 1-2 recessed raised panels. */
function SolidLeaf({
  w,
  h,
  depth,
  color,
}: {
  w: number
  h: number
  depth: number
  color?: string
}): JSX.Element {
  const slab = depth * 0.6
  const border = Math.min(w, h) * 0.12
  const panelW = w - 2 * border
  const nPanels = h > w * 1.4 ? 2 : 1
  const gap = h * 0.04
  const panelH = (h - 2 * border - gap * (nPanels - 1)) / nPanels
  const panels: JSX.Element[] = []
  for (let i = 0; i < nPanels; i++) {
    const cy = h / 2 - border - panelH / 2 - i * (panelH + gap)
    // recessed raised panel: a slightly proud inner plate
    panels.push(
      <Paint
        key={`p${i}`}
        pos={[0, cy, slab / 2]}
        size={[panelW * 0.86, panelH * 0.86, depth * 0.18]}
        color={color}
      />,
    )
    panels.push(
      <Paint
        key={`pb${i}`}
        pos={[0, cy, -slab / 2]}
        size={[panelW * 0.86, panelH * 0.86, depth * 0.18]}
        color={color}
      />,
    )
  }
  return (
    <group>
      <Paint pos={[0, 0, 0]} size={[w, h, slab]} color={color} />
      {panels}
    </group>
  )
}

/** Dark metal lever handle on the leading edge of a door leaf. */
function Handle({
  x,
  depth,
}: {
  x: number
  depth: number
}): JSX.Element {
  const z = depth * 0.5
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.05, 12]} />
        <meshStandardMaterial color={METAL} roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0, -z]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.05, 12]} />
        <meshStandardMaterial color={METAL} roughness={0.35} metalness={0.8} />
      </mesh>
    </group>
  )
}

/**
 * Render a door or window as parametric primitive meshes oriented within the
 * wall. The returned <group> is centered on the opening's wall position; the
 * parent owns all interaction (selection, delete, pointer handlers).
 */
export function OpeningMesh({
  opening,
  wall,
  frame,
  wallHeight,
  wallThickness,
}: {
  opening: Opening
  wall: Wall
  frame: Frame
  wallHeight: number
  wallThickness: number
}): JSX.Element {
  const def: OpeningDef =
    OPENING_MAP[opening.style] ?? {
      style: opening.style,
      kind: opening.kind,
      name: opening.style,
      width: opening.width,
      height: opening.height,
      sill: opening.sill,
      leaves: 1,
      glass: opening.kind === 'window' ? 0.9 : 0,
    }

  const p = pointOnWall(wall, opening.t)
  const [wx, wz] = frame.toWorld(p.x, p.z)
  const yCenter = cm(opening.sill + opening.height / 2)
  const rotY = Math.atan2(-wall.dirZ, wall.dirX)

  // Per-opening tints (dark aluminum sliders, teak door frames, …); default paint.
  const paint = opening.frameColor ?? PAINT
  const leafTint = opening.leafColor ?? paint

  // Local opening dimensions (centered at origin after the group transform).
  const W = cm(opening.width)
  const H = cm(opening.height)
  const depth = cm(wallThickness) + 0.02 // slightly proud on both wall faces

  // Outer frame / jamb thickness. Big glazed units (sliders/rails) get slimmer
  // metal-section jambs than small painted openings.
  const jambScale = def.glass > 0.9 ? 0.035 : 0.06
  const jamb = Math.min(W, H) * jambScale
  const isWindow = def.kind === 'window'
  const frameDepth = depth

  // Exterior backdrop geometry (VIS-07 — only real windows get one; glass doors open onto a real
  // room). The group is rotated so local +z maps to world (-dirZ, dirX); wall.nx/nz is the INWARD
  // normal, so the OUTDOORS is whichever local-z faces away from it. We keep the backdrop just
  // behind the exterior wall face (small parallax, minimal edge sliver) and — critically — size it
  // to span floor→ceiling WITHIN the wall (never above the wall top, so it can't poke out at high
  // dollhouse angles), capped to the wall length so it can't overhang the wall ends either.
  const wallH = cm(wallHeight)
  const inwardIsLocalPlusZ = wall.nx * -wall.dirZ + wall.nz * wall.dirX >= 0
  const exteriorZ = (inwardIsLocalPlusZ ? -1 : 1) * (depth / 2 + 0.05)
  const bdHeight = Math.max(wallH - 0.2, H) // nearly full wall height (20cm margin top+bottom)
  const bdOffY = wallH / 2 - yCenter // local y that centres the backdrop on the wall (floor↔ceiling)
  const bdWidth = Math.min(W + 1.0, cm(wall.length) * 0.98)

  // Inner clear area (inside the jambs). Doors have no bottom rail.
  const sillBar = isWindow ? jamb * 1.2 : 0
  const innerW = W - 2 * jamb
  const innerTop = H / 2 - jamb
  const innerBottom = -H / 2 + sillBar
  const innerH = innerTop - innerBottom
  const innerCenterY = (innerTop + innerBottom) / 2

  // Frame border boxes: top + two sides (+ bottom rail/sill for windows).
  const frameBoxes: JSX.Element[] = [
    <Paint key="ft" pos={[0, H / 2 - jamb / 2, 0]} size={[W, jamb, frameDepth]} color={paint} />,
    <Paint
      key="fl"
      pos={[-W / 2 + jamb / 2, innerCenterY, 0]}
      size={[jamb, innerH, frameDepth]}
      color={paint}
    />,
    <Paint
      key="fr"
      pos={[W / 2 - jamb / 2, innerCenterY, 0]}
      size={[jamb, innerH, frameDepth]}
      color={paint}
    />,
  ]
  if (isWindow) {
    // sill slab, slightly proud of the wall on the interior side
    frameBoxes.push(
      <Paint
        key="fb"
        pos={[0, -H / 2 + sillBar / 2, 0]}
        size={[W, sillBar, frameDepth * 1.25]}
        color={paint}
      />,
    )
  }

  // Leaves: divide the inner clear width evenly. 0 leaves = an open passage
  // (jambs + header only — the open-kitchen entry).
  const leaves = def.leaves === 0 ? 0 : Math.max(1, def.leaves)
  const leafGap = innerW * 0.012
  const leafW = leaves > 0 ? (innerW - leafGap * (leaves - 1)) / leaves : innerW
  const leafH = innerH
  const leafItems: JSX.Element[] = []
  for (let i = 0; i < leaves; i++) {
    const lx = -innerW / 2 + leafW / 2 + i * (leafW + leafGap)
    if (def.glass > 0) {
      // Divided lites: def.grid override (sliders 1×1, grilles 3×4), else the
      // classic defaults (windows 2×2, glazed doors 1×3/1×4).
      const cols = def.grid?.[0] ?? (isWindow ? 2 : 1)
      const rows = def.grid?.[1] ?? (isWindow ? 2 : leaves >= 2 ? 3 : 4)
      leafItems.push(
        <group key={`leaf${i}`} position={[lx, innerCenterY, 0]}>
          <GlazedLeaf
            w={leafW}
            h={leafH}
            depth={depth}
            glass={def.glass}
            cols={cols}
            rows={rows}
            color={leafTint}
            barScale={def.barScale ?? 1}
            windowGlass={isWindow}
          />
        </group>,
      )
    } else {
      leafItems.push(
        <group key={`leaf${i}`} position={[lx, innerCenterY, 0]}>
          <SolidLeaf w={leafW} h={leafH} depth={depth} color={leafTint} />
        </group>,
      )
    }
  }

  // Door hardware + threshold.
  const extras: JSX.Element[] = []
  if (!isWindow && leaves > 0) {
    if (leaves === 1) {
      // single door: handle near the leading (right) edge
      const hx = -innerW / 2 + leafW - leafW * 0.12
      extras.push(<Handle key="h0" x={hx} depth={depth} />)
    } else {
      // double / french / bifold: handles on the meeting stiles of the two
      // central leaves
      const li = Math.floor((leaves - 1) / 2)
      const ri = Math.ceil(leaves / 2)
      const lxL = -innerW / 2 + leafW / 2 + li * (leafW + leafGap)
      const lxR = -innerW / 2 + leafW / 2 + ri * (leafW + leafGap)
      extras.push(
        <Handle key="hl" x={lxL + leafW * 0.38} depth={depth} />,
        <Handle key="hr" x={lxR - leafW * 0.38} depth={depth} />,
      )
    }
    // subtle threshold line at the floor (local y = -H/2 maps to floor for doors)
    extras.push(
      <mesh key="thr" position={[0, -H / 2 + 0.005, 0]} receiveShadow>
        <boxGeometry args={[W, 0.012, depth * 0.9]} />
        <meshStandardMaterial color={METAL} roughness={0.6} metalness={0.3} />
      </mesh>,
    )
  } else if (isWindow && leaves > 1) {
    // window mullion between the two sashes
    const mx = 0
    extras.push(
      <Paint
        key="mull"
        pos={[mx, innerCenterY, 0]}
        size={[leafGap + leafW * 0.04, innerH, frameDepth]}
        color={paint}
      />,
    )
  }

  return (
    <group position={[wx, yCenter, wz]} rotation={[0, rotY, 0]}>
      {isWindow && (
        <WindowExterior
          width={bdWidth}
          height={bdHeight}
          offY={bdOffY}
          z={exteriorZ}
          flip={!inwardIsLocalPlusZ}
        />
      )}
      {frameBoxes}
      {leafItems}
      {extras}
    </group>
  )
}
