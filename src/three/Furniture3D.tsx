import { useMemo, useRef, useLayoutEffect } from 'react'
import * as THREE from 'three'
import { getMirrorEnvTexture } from './envTextures'
import type { ModelKind } from '../data/archetypes'
import { surfaceMaps, repeatForFace, type SurfaceKind } from './furnitureTextures'
import { resolveFurnitureAsset } from '../assets/furniture'
import { FurnitureAsset3D } from '../assets/FurnitureAsset3D'
import { Html } from '@react-three/drei'
import type { FurnitureItem } from '../types'

// ---------------------------------------------------------------------------
// In-house parametric furniture. Each piece is composed from a handful of
// box / cylinder primitives whose geometry is derived from the passed
// dimensions (cm) on every render, so items are freely resizable and
// recolorable. The parent wraps this in a positioned + rotated group, so we
// render purely in LOCAL space:
//   - footprint centered at x=0, z=0
//   - base on the floor at y=0, top at y = h/100
//   - width spans X, depth spans Z, height spans Y
// ---------------------------------------------------------------------------

const CM = 0.01 // cm -> meters

// Derive a tonal variant of the primary color (factor < 1 darkens, > 1 lightens).
function shade(color: string, factor: number): string {
  const c = new THREE.Color(color)
  if (factor >= 1) {
    // lighten toward white
    const t = Math.min(1, factor - 1)
    c.lerp(new THREE.Color('#ffffff'), t)
  } else {
    c.multiplyScalar(Math.max(0, factor))
  }
  return `#${c.getHexString()}`
}

const METAL = '#8a8a8a'
const DARK = '#2c2f33'
const GLASS = '#1c2226'

// Procedural PBR material for one primitive. When `surface` is set the mesh gets
// cached procedural albedo/normal/roughness maps (weave / grain / pile) tiled to
// world scale, so it reads as real material at close range instead of a flat
// colour box. `color` stays as the tint (multiplies the grayscale albedo). With
// no surface it degrades to the original plain painted material.
function SurfacedMaterial({
  color,
  roughness,
  metalness = 0,
  surface,
  repeat,
}: {
  color: string
  roughness: number
  metalness?: number
  surface?: SurfaceKind
  repeat: [number, number]
}): JSX.Element {
  const maps = surface ? surfaceMaps(surface, repeat[0], repeat[1]) : null
  if (!maps) {
    return <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
  }
  return (
    <meshStandardMaterial
      color={color}
      // material.roughness = 1 so the map fully drives roughness (pbr contract)
      roughness={1}
      metalness={metalness}
      map={maps.map}
      normalMap={maps.normalMap}
      normalScale={maps.normalScale}
      roughnessMap={maps.roughnessMap}
    />
  )
}

// A simple shadow-casting standard-material box helper. Optional `surface` gives
// it a procedural material tiled to the box's world dimensions.
function Box({
  size,
  pos,
  color,
  roughness = 0.7,
  metalness = 0,
  surface,
  repeat,
  rotation,
}: {
  size: [number, number, number]
  pos: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
  surface?: SurfaceKind
  /** tiles in [x,y]; defaults to world-space from the two largest box faces */
  repeat?: [number, number]
  rotation?: [number, number, number]
}): JSX.Element {
  const [w, h, d] = size
  const rep =
    repeat ?? (surface ? repeatForFace(surface, Math.max(w, d) * 100, h * 100) : [1, 1])
  return (
    <mesh position={pos} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <SurfacedMaterial color={color} roughness={roughness} metalness={metalness} surface={surface} repeat={rep} />
    </mesh>
  )
}

function Cyl({
  rTop,
  rBottom,
  height,
  pos,
  color,
  segments = 24,
  roughness = 0.6,
  metalness = 0,
  rotation,
  surface,
  repeat,
}: {
  rTop: number
  rBottom: number
  height: number
  pos: [number, number, number]
  color: string
  segments?: number
  roughness?: number
  metalness?: number
  rotation?: [number, number, number]
  surface?: SurfaceKind
  repeat?: [number, number]
}): JSX.Element {
  const rep =
    repeat ?? (surface ? repeatForFace(surface, 2 * Math.PI * rBottom * 100, height * 100) : [1, 1])
  return (
    <mesh position={pos} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[rTop, rBottom, height, segments]} />
      <SurfacedMaterial color={color} roughness={roughness} metalness={metalness} surface={surface} repeat={rep} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Per-model builders. Each returns an array of meshes composed in local space.
// ---------------------------------------------------------------------------

function buildSofa(W: number, D: number, H: number, color: string): JSX.Element {
  const legColor = shade(color, 0.45)
  const cushColor = shade(color, 1.12)
  const footH = Math.min(0.08, H * 0.12)
  const armW = Math.min(0.16, W * 0.16)
  const backT = Math.min(0.12, D * 0.16)
  const seatTop = Math.min(H * 0.5, 0.45)
  const seatH = seatTop - footH

  // Seat base block (sits between arms, in front of the back)
  const baseW = W - armW * 2
  const baseD = D - backT
  const baseY = footH + seatH / 2
  const baseZ = backT / 2 // shifted toward +z (front) since back occupies -z

  // Backrest along -z
  const backH = H - footH
  const backZ = -D / 2 + backT / 2

  // Cushions on top of the seat
  const nCush = baseW > 1.4 ? 3 : 2
  const gap = 0.015
  const cushTotalW = baseW - gap * (nCush + 1)
  const cushW = cushTotalW / nCush
  const cushH = Math.min(0.14, seatH * 0.7)
  const cushD = baseD * 0.92
  const cushY = footH + seatH + cushH / 2
  const cushions: JSX.Element[] = []
  for (let i = 0; i < nCush; i++) {
    const x = -baseW / 2 + gap * (i + 1) + cushW * (i + 0.5)
    cushions.push(
      <Box key={`c${i}`} size={[cushW, cushH, cushD]} pos={[x, cushY + 0.002, baseZ]} color={cushColor} roughness={0.85} surface="fabric" />,
    )
  }

  // Back cushions (leaning against backrest)
  const backCushH = (backH - seatH) * 0.7
  const backCushY = footH + seatH + backCushH / 2
  const backCushZ = -D / 2 + backT + cushD * 0.18

  const legInset = Math.min(0.06, W * 0.08)
  const legR = Math.min(0.03, footH * 0.6)
  const legPositions: [number, number][] = [
    [-W / 2 + legInset, -D / 2 + legInset],
    [W / 2 - legInset, -D / 2 + legInset],
    [-W / 2 + legInset, D / 2 - legInset],
    [W / 2 - legInset, D / 2 - legInset],
  ]

  return (
    <group>
      {/* feet */}
      {legPositions.map(([x, z], i) => (
        <Cyl key={`leg${i}`} rTop={legR} rBottom={legR * 0.8} height={footH} pos={[x, footH / 2, z]} color={legColor} segments={10} roughness={0.4} metalness={0.3} />
      ))}
      {/* seat base */}
      <Box size={[baseW, seatH, baseD]} pos={[0, baseY, baseZ]} color={color} roughness={0.8} surface="fabric" />
      {/* backrest */}
      <Box size={[W, backH, backT]} pos={[0, footH + backH / 2, backZ]} color={color} roughness={0.8} surface="fabric" />
      {/* arms */}
      <Box size={[armW, backH * 0.78, D]} pos={[-W / 2 + armW / 2, footH + (backH * 0.78) / 2, 0]} color={color} roughness={0.8} surface="fabric" />
      <Box size={[armW, backH * 0.78, D]} pos={[W / 2 - armW / 2, footH + (backH * 0.78) / 2, 0]} color={color} roughness={0.8} surface="fabric" />
      {/* seat cushions */}
      {cushions}
      {/* back cushion */}
      <Box size={[baseW, backCushH, Math.min(0.1, backT)]} pos={[0, backCushY, backCushZ]} color={cushColor} roughness={0.85} surface="fabric" />
    </group>
  )
}

function buildSectional(W: number, D: number, H: number, color: string): JSX.Element {
  const legColor = shade(color, 0.45)
  const cushColor = shade(color, 1.12)
  const footH = Math.min(0.08, H * 0.12)
  const backT = 0.12
  const armW = 0.16
  const seatTop = Math.min(H * 0.5, 0.45)
  const seatH = seatTop - footH

  // Main run occupies the back along -z (full width). Chaise return runs along
  // the +x side toward +z.
  const runD = Math.min(D * 0.55, 0.95) // depth of the main run
  const chaiseW = Math.min(W * 0.42, 1.0) // width of the chaise leg

  const backH = H - footH

  // Main run seat
  const mainSeatW = W - armW
  const mainSeatD = runD - backT
  const mainSeatZ = -D / 2 + backT + mainSeatD / 2

  // Chaise (extends forward on +x side)
  const chaiseD = D - runD
  const chaiseZ = -D / 2 + runD + chaiseD / 2
  const chaiseX = W / 2 - chaiseW / 2

  const cushH = Math.min(0.14, seatH * 0.7)
  const cushY = footH + seatH + cushH / 2

  return (
    <group>
      {/* feet (corners) */}
      {(
        [
          [-W / 2 + 0.07, -D / 2 + 0.07],
          [W / 2 - 0.07, -D / 2 + 0.07],
          [W / 2 - 0.07, D / 2 - 0.07],
          [-W / 2 + 0.07, runD - D / 2 - 0.07],
        ] as [number, number][]
      ).map(([x, z], i) => (
        <Cyl key={`leg${i}`} rTop={0.025} rBottom={0.02} height={footH} pos={[x, footH / 2, z]} color={legColor} segments={10} roughness={0.4} metalness={0.3} />
      ))}

      {/* main run seat base */}
      <Box size={[mainSeatW, seatH, mainSeatD]} pos={[-armW / 2, footH + seatH / 2, mainSeatZ]} color={color} roughness={0.8} surface="fabric" />
      {/* chaise seat base */}
      <Box size={[chaiseW, seatH, chaiseD]} pos={[chaiseX, footH + seatH / 2, chaiseZ]} color={color} roughness={0.8} surface="fabric" />

      {/* backrest along -z (full width) */}
      <Box size={[W, backH, backT]} pos={[0, footH + backH / 2, -D / 2 + backT / 2]} color={color} roughness={0.8} surface="fabric" />
      {/* outer arm on -x (left) */}
      <Box size={[armW, backH * 0.78, runD]} pos={[-W / 2 + armW / 2, footH + (backH * 0.78) / 2, -D / 2 + runD / 2]} color={color} roughness={0.8} surface="fabric" />
      {/* arm on the +x side spanning full depth (outer edge of chaise) */}
      <Box size={[armW, backH * 0.78, D]} pos={[W / 2 - armW / 2, footH + (backH * 0.78) / 2, 0]} color={color} roughness={0.8} surface="fabric" />

      {/* cushions: 2 on main run + 1 on chaise */}
      <Box size={[mainSeatW * 0.46, cushH, mainSeatD * 0.9]} pos={[-armW / 2 - mainSeatW * 0.24, cushY + 0.002, mainSeatZ]} color={cushColor} roughness={0.85} surface="fabric" />
      <Box size={[mainSeatW * 0.46, cushH, mainSeatD * 0.9]} pos={[-armW / 2 + mainSeatW * 0.24, cushY + 0.002, mainSeatZ]} color={cushColor} roughness={0.85} surface="fabric" />
      <Box size={[chaiseW * 0.86, cushH, chaiseD * 0.9]} pos={[chaiseX, cushY + 0.002, chaiseZ]} color={cushColor} roughness={0.85} surface="fabric" />
    </group>
  )
}

function buildBed(W: number, D: number, H: number, color: string): JSX.Element {
  const frameColor = shade(color, 0.5)
  const linen = shade(color, 1.18)
  const pillowColor = shade(color, 1.32)

  const frameH = Math.min(0.3, H * 0.35)
  const mattressH = Math.min(0.26, H * 0.32)
  const headboardH = H // headboard reaches full height
  const headboardT = Math.min(0.08, D * 0.06)

  const frameInset = 0.02
  const mattW = W - frameInset * 2
  const mattD = D - headboardT - frameInset
  const mattZ = -D / 2 + headboardT + mattD / 2 + frameInset / 2
  const mattY = frameH + mattressH / 2

  // duvet sits on the mattress, covering most of it
  const duvetH = 0.06
  const duvetD = mattD * 0.72
  const duvetZ = -D / 2 + headboardT + frameInset + duvetD / 2 + mattD * 0.26
  const duvetY = frameH + mattressH + duvetH / 2

  // pillows near the headboard
  const pillowH = 0.1
  const pillowW = Math.min(mattW * 0.42, 0.55)
  const pillowD = Math.min(mattD * 0.22, 0.4)
  const pillowZ = -D / 2 + headboardT + frameInset + pillowD / 2 + 0.04
  const pillowY = frameH + mattressH + pillowH / 2
  const pillowGap = mattW > 1.2 ? mattW * 0.24 : 0

  return (
    <group>
      {/* low frame */}
      <Box size={[W, frameH, D - headboardT]} pos={[0, frameH / 2, -D / 2 + headboardT + (D - headboardT) / 2]} color={frameColor} roughness={0.6} surface="wood" />
      {/* headboard */}
      <Box size={[W, headboardH, headboardT]} pos={[0, headboardH / 2, -D / 2 + headboardT / 2]} color={frameColor} roughness={0.6} surface="wood" />
      {/* mattress */}
      <Box size={[mattW, mattressH, mattD]} pos={[0, mattY, mattZ]} color={linen} roughness={0.9} surface="linen" />
      {/* duvet */}
      <Box size={[mattW * 0.98, duvetH, duvetD]} pos={[0, duvetY + 0.002, duvetZ]} color={color} roughness={0.88} surface="linen" />
      {/* pillows */}
      {pillowGap > 0 ? (
        <>
          <Box size={[pillowW, pillowH, pillowD]} pos={[-pillowGap / 2, pillowY + 0.002, pillowZ]} color={pillowColor} roughness={0.92} surface="linen" />
          <Box size={[pillowW, pillowH, pillowD]} pos={[pillowGap / 2, pillowY + 0.002, pillowZ]} color={pillowColor} roughness={0.92} surface="linen" />
        </>
      ) : (
        <Box size={[Math.min(mattW * 0.8, 0.6), pillowH, pillowD]} pos={[0, pillowY + 0.002, pillowZ]} color={pillowColor} roughness={0.92} surface="linen" />
      )}
    </group>
  )
}

function buildTable(W: number, D: number, H: number, color: string): JSX.Element {
  const legColor = shade(color, 0.55)
  const topT = Math.min(0.05, H * 0.12)
  const legR = Math.min(0.035, W * 0.05)
  const legH = H - topT
  const inset = Math.max(legR + 0.01, Math.min(0.07, W * 0.1))
  const legY = legH / 2
  const corners: [number, number][] = [
    [-W / 2 + inset, -D / 2 + inset],
    [W / 2 - inset, -D / 2 + inset],
    [-W / 2 + inset, D / 2 - inset],
    [W / 2 - inset, D / 2 - inset],
  ]
  return (
    <group>
      {/* top slab */}
      <Box size={[W, topT, D]} pos={[0, H - topT / 2, 0]} color={color} roughness={0.45} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* legs */}
      {corners.map(([x, z], i) => (
        <Box key={`l${i}`} size={[legR * 2, legH, legR * 2]} pos={[x, legY, z]} color={legColor} roughness={0.5} surface="wood" />
      ))}
    </group>
  )
}

function buildRoundTable(W: number, D: number, H: number, color: string): JSX.Element {
  const legColor = shade(color, 0.55)
  const r = Math.min(W, D) / 2
  const topT = Math.min(0.05, H * 0.12)
  const pedH = H - topT
  return (
    <group>
      {/* top */}
      <Cyl rTop={r} rBottom={r} height={topT} pos={[0, H - topT / 2, 0]} color={color} segments={40} roughness={0.45} surface="wood" repeat={repeatForFace('wood', 2 * r * 100, 2 * r * 100)} />
      {/* central pedestal */}
      <Cyl rTop={r * 0.16} rBottom={r * 0.2} height={pedH} pos={[0, pedH / 2, 0]} color={legColor} segments={24} roughness={0.5} surface="wood" />
      {/* foot base */}
      <Cyl rTop={r * 0.42} rBottom={r * 0.46} height={Math.min(0.04, H * 0.06)} pos={[0, Math.min(0.02, H * 0.03), 0]} color={legColor} segments={28} roughness={0.5} surface="wood" />
    </group>
  )
}

function buildChair(W: number, D: number, H: number, color: string): JSX.Element {
  const legColor = shade(color, 0.5)
  const seatH = Math.min(0.46, H * 0.5)
  const seatT = Math.min(0.05, seatH * 0.12)
  const legR = Math.min(0.02, W * 0.05)
  const legH = seatH - seatT
  const inset = legR + 0.02
  const backT = Math.min(0.04, D * 0.08)
  const backH = H - seatH

  const corners: [number, number][] = [
    [-W / 2 + inset, -D / 2 + inset],
    [W / 2 - inset, -D / 2 + inset],
    [-W / 2 + inset, D / 2 - inset],
    [W / 2 - inset, D / 2 - inset],
  ]
  return (
    <group>
      {/* legs */}
      {corners.map(([x, z], i) => (
        <Box key={`l${i}`} size={[legR * 2, legH, legR * 2]} pos={[x, legH / 2, z]} color={legColor} roughness={0.5} />
      ))}
      {/* seat */}
      <Box size={[W, seatT, D]} pos={[0, seatH - seatT / 2, 0]} color={color} roughness={0.7} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* backrest (along -z) */}
      <Box size={[W * 0.92, backH, backT]} pos={[0, seatH + backH / 2, -D / 2 + backT / 2]} color={color} roughness={0.7} surface="wood" />
    </group>
  )
}

function buildOfficeChair(W: number, D: number, H: number, color: string): JSX.Element {
  const seatH = Math.min(0.5, H * 0.46)
  const seatT = Math.min(0.08, seatH * 0.18)
  const seatW = W * 0.78
  const seatD = D * 0.78
  const backH = H - seatH
  const backT = Math.min(0.06, D * 0.1)

  const baseH = 0.04
  const postH = seatH - baseH - seatT
  const postR = Math.min(0.025, W * 0.05)
  const armR = Math.max(W, D) / 2

  // 5-star base spokes
  const spokes: JSX.Element[] = []
  const casters: JSX.Element[] = []
  const spokeLen = armR * 0.85
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const x = Math.cos(a) * (spokeLen * 0.5)
    const z = Math.sin(a) * (spokeLen * 0.5)
    spokes.push(
      <mesh key={`sp${i}`} position={[x, baseH / 2 + 0.02, z]} rotation={[0, -a, 0]} castShadow receiveShadow>
        <boxGeometry args={[spokeLen, 0.03, 0.05]} />
        <meshStandardMaterial color={DARK} roughness={0.5} metalness={0.3} />
      </mesh>,
    )
    const cx = Math.cos(a) * spokeLen
    const cz = Math.sin(a) * spokeLen
    casters.push(
      <Cyl key={`ca${i}`} rTop={0.025} rBottom={0.025} height={0.04} pos={[cx, 0.025, cz]} color={DARK} segments={12} rotation={[Math.PI / 2, 0, 0]} roughness={0.4} metalness={0.4} />,
    )
  }

  return (
    <group>
      {casters}
      {spokes}
      {/* central post */}
      <Cyl rTop={postR} rBottom={postR * 1.1} height={postH} pos={[0, baseH + postH / 2, 0]} color={METAL} segments={16} roughness={0.35} metalness={0.6} />
      {/* seat */}
      <Box size={[seatW, seatT, seatD]} pos={[0, seatH - seatT / 2, 0]} color={color} roughness={0.65} surface="fabric" />
      {/* backrest */}
      <Box size={[seatW * 0.95, backH, backT]} pos={[0, seatH + backH / 2, -seatD / 2 + backT / 2]} color={DARK} roughness={0.6} surface="fabric" />
    </group>
  )
}

function buildCabinet(W: number, D: number, H: number, color: string): JSX.Element {
  const bodyColor = color
  const topColor = shade(color, 0.85)
  const doorColor = shade(color, 1.06)
  const handleColor = METAL

  const toeH = Math.min(0.06, H * 0.08)
  const topT = Math.min(0.04, H * 0.06)
  const bodyH = H - toeH
  const doorInset = 0.015
  const doorT = Math.min(0.02, D * 0.06)
  const doorH = bodyH - topT - doorInset * 2
  const gap = 0.012
  const doorW = (W - doorInset * 2 - gap) / 2
  const doorY = toeH + doorInset + doorH / 2
  const doorZ = D / 2 - doorT / 2

  const handleH = Math.min(0.12, doorH * 0.3)
  const handleR = 0.008

  return (
    <group>
      {/* toe-kick base */}
      <Box size={[W * 0.94, toeH, D * 0.9]} pos={[0, toeH / 2, 0]} color={shade(color, 0.5)} roughness={0.6} surface="wood" />
      {/* body */}
      <Box size={[W, bodyH, D]} pos={[0, toeH + bodyH / 2, 0]} color={bodyColor} roughness={0.55} surface="wood" />
      {/* top slab overhang */}
      <Box size={[W * 1.03, topT, D * 1.06]} pos={[0, toeH + bodyH + topT / 2, 0]} color={topColor} roughness={0.45} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* two doors on +z */}
      <Box size={[doorW, doorH, doorT]} pos={[-doorW / 2 - gap / 2, doorY, doorZ + doorT / 2]} color={doorColor} roughness={0.5} surface="wood" />
      <Box size={[doorW, doorH, doorT]} pos={[doorW / 2 + gap / 2, doorY, doorZ + doorT / 2]} color={doorColor} roughness={0.5} surface="wood" />
      {/* handles (inner edges) */}
      <Cyl rTop={handleR} rBottom={handleR} height={handleH} pos={[-gap / 2 - 0.025, doorY, doorZ + doorT]} color={handleColor} segments={10} roughness={0.3} metalness={0.7} />
      <Cyl rTop={handleR} rBottom={handleR} height={handleH} pos={[gap / 2 + 0.025, doorY, doorZ + doorT]} color={handleColor} segments={10} roughness={0.3} metalness={0.7} />
    </group>
  )
}

function buildOpenShelf(W: number, D: number, H: number, color: string): JSX.Element {
  const frameColor = color
  const backColor = shade(color, 0.8)
  const panelT = Math.min(0.03, W * 0.04)
  const backT = 0.012

  // number of interior shelves
  const nGaps = H > 1.6 ? 4 : 3
  const innerH = H - panelT * 2
  const shelves: JSX.Element[] = []
  for (let i = 1; i < nGaps; i++) {
    const y = panelT + (innerH / nGaps) * i
    shelves.push(
      <Box key={`sh${i}`} size={[W - panelT * 2, panelT * 0.7, D - backT]} pos={[0, y, backT / 2]} color={frameColor} roughness={0.55} surface="wood" />,
    )
  }

  return (
    <group>
      {/* sides */}
      <Box size={[panelT, H, D]} pos={[-W / 2 + panelT / 2, H / 2, 0]} color={frameColor} roughness={0.55} surface="wood" />
      <Box size={[panelT, H, D]} pos={[W / 2 - panelT / 2, H / 2, 0]} color={frameColor} roughness={0.55} surface="wood" />
      {/* top + bottom */}
      <Box size={[W, panelT, D]} pos={[0, H - panelT / 2, 0]} color={frameColor} roughness={0.55} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      <Box size={[W, panelT, D]} pos={[0, panelT / 2, 0]} color={frameColor} roughness={0.55} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* back panel */}
      <Box size={[W - panelT * 2, H - panelT * 2, backT]} pos={[0, H / 2, -D / 2 + backT / 2]} color={backColor} roughness={0.7} surface="wood" />
      {/* shelves */}
      {shelves}
    </group>
  )
}

function buildRug(W: number, D: number, H: number, color: string): JSX.Element {
  const thick = Math.max(0.005, H) // h is tiny (cm)
  const borderColor = shade(color, 0.78)
  const inset = Math.min(W, D) * 0.08
  const pileRepeat = repeatForFace('rug', W * 100, D * 100)
  return (
    <group>
      {/* main rug slab, sits flat on floor */}
      <mesh position={[0, thick / 2, 0]} receiveShadow>
        <boxGeometry args={[W, thick, D]} />
        <SurfacedMaterial color={color} roughness={0.95} surface="rug" repeat={pileRepeat} />
      </mesh>
      {/* inset border stripe (a slightly raised thin frame drawn as a darker top slab) */}
      <mesh position={[0, thick + 0.0006, 0]}>
        <boxGeometry args={[W - inset, 0.001, D - inset]} />
        <SurfacedMaterial color={borderColor} roughness={0.95} surface="rug" repeat={pileRepeat} />
      </mesh>
    </group>
  )
}

function buildLamp(W: number, D: number, H: number, color: string): JSX.Element {
  const poleColor = shade(color, 0.5)
  const shadeColor = shade('#f2dba0', 1.0) // warm shade, independent of body
  const baseR = Math.min(W, D) / 2
  const baseH = Math.min(0.03, H * 0.03)
  const poleR = Math.max(0.012, baseR * 0.12)
  const shadeH = Math.min(0.28, H * 0.22)
  const shadeTopR = baseR * 0.7
  const shadeBotR = baseR * 0.95
  const poleH = H - baseH - shadeH
  return (
    <group>
      {/* base disc */}
      <Cyl rTop={baseR} rBottom={baseR} height={baseH} pos={[0, baseH / 2, 0]} color={poleColor} segments={28} roughness={0.4} metalness={0.5} />
      {/* pole */}
      <Cyl rTop={poleR} rBottom={poleR} height={poleH} pos={[0, baseH + poleH / 2, 0]} color={poleColor} segments={16} roughness={0.4} metalness={0.5} />
      {/* shade (truncated cone), faintly emissive warm glow */}
      <mesh position={[0, baseH + poleH + shadeH / 2, 0]} castShadow>
        <cylinderGeometry args={[shadeTopR, shadeBotR, shadeH, 28, 1, true]} />
        <meshStandardMaterial
          color={shadeColor}
          emissive={'#ffd98a'}
          emissiveIntensity={0.45}
          roughness={0.7}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}

// --- Realistic potted plant / tree -----------------------------------------
// Instead of a lollipop (few spheres + a cone), the foliage is a canopy of many
// individually-oriented, gently-curved, two-sided leaves (instanced so 150+ of
// them cost one draw call). A woody tapered trunk + branches (tall "tree") or a
// few slender arching stems (short "plant") give real structure. Everything is
// MeshStandard so it reads correctly under IBL AND the path tracer.

// A single lanceolate leaf in local space: base at origin, tip at +Y (length 1),
// width along X, with a drooping curl (−Z with length) and a midrib channel
// (edges dip in −Z) so each leaf catches light on a curved surface — the single
// biggest cue that separates "foliage" from "flat green cards". Shared by all plants.
const LEAF_GEOMETRY: THREE.BufferGeometry = (() => {
  const hw = 0.17 // half-width relative to unit length
  const s = new THREE.Shape()
  s.moveTo(0, 0)
  s.bezierCurveTo(hw, 0.16, hw * 0.9, 0.62, 0, 1) // base -> tip (right edge)
  s.bezierCurveTo(-hw * 0.9, 0.62, -hw, 0.16, 0, 0) // tip -> base (left edge)
  const g = new THREE.ShapeGeometry(s, 14)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    p.setZ(i, -0.16 * y * y - 0.22 * Math.abs(x)) // droop + midrib channel
  }
  p.needsUpdate = true
  g.computeVertexNormals()
  return g
})()

// Shared foliage material — WHITE base so per-instance instanceColor supplies the
// true leaf color; slightly waxy (moderate roughness) and two-sided.
const LEAF_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.52,
  metalness: 0,
  side: THREE.DoubleSide,
})

// Small deterministic PRNG so a plant's leaf layout is stable across re-renders
// (no popping) yet varies per size/color configuration.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface LeafInstance {
  pos: THREE.Vector3
  quat: THREE.Quaternion
  scale: number
  color: THREE.Color
}

// Instanced canopy: places `leaves` and pushes their matrices + colors once.
function LeafCanopy({ leaves }: { leaves: LeafInstance[] }): JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    for (let i = 0; i < leaves.length; i++) {
      const lf = leaves[i]
      dummy.position.copy(lf.pos)
      dummy.quaternion.copy(lf.quat)
      dummy.scale.setScalar(lf.scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, lf.color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [leaves])

  // dispose={null}: geometry/material are shared module singletons — never dispose them here.
  return (
    <instancedMesh
      ref={ref}
      args={[LEAF_GEOMETRY, LEAF_MATERIAL, leaves.length]}
      castShadow
      receiveShadow
      dispose={null}
    />
  )
}

function PlantModel({ W, D, H, color }: { W: number; D: number; H: number; color: string }): JSX.Element {
  const { leaves, pot, stems } = useMemo(() => {
    const rnd = mulberry32(hashStr(`${color}|${W.toFixed(2)}|${D.toFixed(2)}|${H.toFixed(2)}`))
    const rng = (lo: number, hi: number) => lo + (hi - lo) * rnd()

    const halfFoot = Math.min(W, D) / 2
    const woody = H >= 1.45 // tall "potted tree" vs short bushy "potted plant"

    // Planter: narrower than the canopy (which fills the footprint), with a rim lip.
    const potH = Math.min(H * 0.3, 0.34)
    const potTopR = halfFoot * (woody ? 0.44 : 0.56)
    const potBotR = potTopR * 0.74
    const rimR = potTopR * 1.06

    // Canopy volume fills the footprint; sits above a bare trunk (tree) or just above soil (plant).
    const canR = halfFoot * 0.98
    const canBottom = woody ? H * 0.5 : potH + 0.03
    const canTop = H
    const canH = Math.max(0.1, canTop - canBottom)

    // Trunk / stems ------------------------------------------------------------
    const trunkColor = '#5a4632'
    const stems: JSX.Element[] = []
    const trunkTopY = woody ? canBottom + canH * 0.28 : potH + Math.min(0.14, H * 0.14)
    const trunkR = Math.max(0.012, potTopR * (woody ? 0.16 : 0.05))
    // Main trunk (slightly tapered).
    stems.push(
      <Cyl
        key="trunk"
        rTop={trunkR * 0.72}
        rBottom={trunkR}
        height={trunkTopY - potH * 0.7}
        pos={[0, potH * 0.7 + (trunkTopY - potH * 0.7) / 2, 0]}
        color={trunkColor}
        segments={12}
        roughness={0.92}
      />,
    )

    // Leaf sizing — needed up front so the canopy can be bounded to the footprint.
    const nLeaves = woody ? 210 : 100
    const leafLen = canR * (woody ? 0.46 : 0.5)
    // Hard cap on how far any leaf ANCHOR may sit from the vertical axis. Leaves extend
    // ~leafLen outward from their anchor, so we pull the cap in by that much: this keeps
    // the whole canopy inside the piece footprint and OUT of adjacent walls.
    const maxAnchorR = Math.max(halfFoot * 0.3, halfFoot * 0.9 - leafLen * 0.55)
    const clampRadius = (v: THREE.Vector3, rMax: number) => {
      const hr = Math.hypot(v.x, v.z)
      if (hr > rMax) {
        const s = rMax / hr
        v.x *= s
        v.z *= s
      }
      return v
    }

    // Lobe centers — irregular clusters the leaves gather around (not one solid ball).
    // Woody trees get a wide, tall crown; short plants stay compact and centered over the pot.
    const nLobes = woody ? 5 : 3
    const lobeRadLo = woody ? 0.24 : 0.0
    const lobeRadHi = woody ? 0.6 : 0.28
    const lobeYLo = woody ? 0.2 : 0.12
    const lobeYHi = woody ? 0.95 : 0.72
    const lobes: { c: THREE.Vector3; r: number }[] = []
    for (let k = 0; k < nLobes; k++) {
      const ang = (k / nLobes) * Math.PI * 2 + rng(-0.5, 0.5)
      const rad = Math.min(maxAnchorR * 0.7, canR * rng(lobeRadLo, lobeRadHi))
      const y = canBottom + canH * rng(lobeYLo, lobeYHi)
      lobes.push({
        c: new THREE.Vector3(Math.cos(ang) * rad, y, Math.sin(ang) * rad),
        r: canR * rng(0.5, 0.72),
      })
    }

    // A stem from the trunk top to EVERY lobe so no foliage cluster ever floats detached —
    // thick woody branches for trees, slender stems for short plants.
    const top = new THREE.Vector3(0, trunkTopY, 0)
    for (let k = 0; k < lobes.length; k++) {
      const to = lobes[k].c
      const mid = top.clone().lerp(to, 0.5)
      const len = Math.max(0.02, top.distanceTo(to))
      const dir = to.clone().sub(top).normalize()
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      const euler = new THREE.Euler().setFromQuaternion(quat)
      stems.push(
        <Cyl
          key={`br${k}`}
          rTop={trunkR * (woody ? 0.28 : 0.5)}
          rBottom={trunkR * (woody ? 0.6 : 0.8)}
          height={len}
          pos={[mid.x, mid.y, mid.z]}
          rotation={[euler.x, euler.y, euler.z]}
          color={trunkColor}
          segments={8}
          roughness={0.92}
        />,
      )
    }

    // Leaves -------------------------------------------------------------------
    const baseCol = new THREE.Color(color)
    const up = new THREE.Vector3(0, 1, 0)
    const leaves: LeafInstance[] = []
    for (let i = 0; i < nLeaves; i++) {
      const lobe = lobes[Math.floor(rnd() * lobes.length)]
      // A point near the lobe's surface, biased upward/outward so gaps show through.
      const dir = new THREE.Vector3(rng(-1, 1), rng(-0.35, 1), rng(-1, 1)).normalize()
      const pos = lobe.c.clone().addScaledVector(dir, lobe.r * rng(0.72, 1.06))
      clampRadius(pos, maxAnchorR) // keep the canopy inside the footprint (out of walls)
      if (pos.y < canBottom) pos.y = canBottom + rng(0, 0.05)
      if (pos.y > H) pos.y = H

      // Growth direction: outward from the lobe, tilted up; leaf's local +Y aligns to it.
      const grow = dir.clone().addScaledVector(up, 0.35).normalize()
      const quat = new THREE.Quaternion().setFromUnitVectors(up, grow)
      // Random roll about the growth axis so leaves don't all face the same way.
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(up, rng(0, Math.PI * 2)))

      // Color: upper/outer leaves lighter (sunlit), inner darker; slight hue jitter.
      const light = 0.68 + Math.max(0, dir.y) * 0.28 + rng(0, 0.22)
      const col = baseCol.clone()
      if (light >= 1) col.lerp(new THREE.Color('#ffffff'), Math.min(0.35, light - 1))
      else col.multiplyScalar(light)
      col.offsetHSL(rng(-0.02, 0.02), rng(-0.06, 0.05), 0)

      leaves.push({ pos, quat, scale: leafLen * rng(0.72, 1.12), color: col })
    }

    const pot = (
      <group>
        {/* tapered planter body */}
        <Cyl rTop={potTopR} rBottom={potBotR} height={potH} pos={[0, potH / 2, 0]} color={'#b06a44'} segments={28} roughness={0.72} />
        {/* rim lip */}
        <Cyl rTop={rimR} rBottom={rimR} height={potH * 0.12} pos={[0, potH - potH * 0.06, 0]} color={'#9c5c39'} segments={28} roughness={0.7} />
        {/* soil, mounded slightly proud of the rim so the two discs don't coplanar Z-fight */}
        <Cyl rTop={potTopR * 0.9} rBottom={potTopR * 0.9} height={0.02} pos={[0, potH + 0.005, 0]} color={'#3a2a1e'} segments={24} roughness={1} />
      </group>
    )

    return { leaves, pot, stems }
  }, [W, D, H, color])

  return (
    <group>
      {pot}
      {stems}
      <LeafCanopy leaves={leaves} />
    </group>
  )
}

function buildPlant(W: number, D: number, H: number, color: string): JSX.Element {
  return <PlantModel W={W} D={D} H={H} color={color} />
}

function buildTv(W: number, D: number, H: number, _color: string, wallMounted = false): JSX.Element {
  // Flat-screen TV: wide thin screen. On a console it rides a small pedestal
  // stand; wall-hung (mount data) it drops the pedestal for a slim VESA bracket
  // so a floor stand isn't left floating in mid-air at wall height.
  const bezelT = Math.min(D, 0.08)
  const screenFace = (cY: number, screenH: number) => (
    <mesh position={[0, cY, bezelT / 2 + 0.002]} castShadow>
      <boxGeometry args={[W * 0.95, screenH * 0.9, 0.005]} />
      <meshStandardMaterial color={GLASS} emissive={'#0d1c2e'} emissiveIntensity={0.35} roughness={0.18} metalness={0.2} />
    </mesh>
  )
  if (wallMounted) {
    const screenH = H
    const cY = screenH / 2
    return (
      <group>
        {/* slim wall bracket behind the panel (hugs the wall at -z) — no floor stand */}
        <Box size={[W * 0.22, screenH * 0.3, bezelT * 0.5]} pos={[0, cY, -bezelT * 0.55]} color={DARK} roughness={0.5} metalness={0.3} />
        {/* screen body / bezel */}
        <Box size={[W, screenH, bezelT]} pos={[0, cY, 0]} color={'#15171a'} roughness={0.5} metalness={0.2} />
        {screenFace(cY, screenH)}
      </group>
    )
  }
  const standH = Math.min(H * 0.2, 0.18)
  const screenH = H - standH
  const baseY = standH
  return (
    <group>
      {/* pedestal base plate */}
      <Box size={[W * 0.42, standH * 0.28, Math.max(D, 0.18)]} pos={[0, (standH * 0.28) / 2, 0]} color={DARK} roughness={0.5} metalness={0.3} />
      {/* neck */}
      <Box size={[W * 0.08, standH, Math.max(D, 0.18) * 0.45]} pos={[0, standH / 2, 0]} color={DARK} roughness={0.5} metalness={0.2} />
      {/* screen body / bezel */}
      <Box size={[W, screenH, bezelT]} pos={[0, baseY + screenH / 2, 0]} color={'#15171a'} roughness={0.5} metalness={0.2} />
      {screenFace(baseY + screenH / 2, screenH)}
    </group>
  )
}

function buildDesk(W: number, D: number, H: number, color: string): JSX.Element {
  // Modesty-panel desk: top slab on two side panels + a back panel; small drawer block.
  const panelColor = shade(color, 0.62)
  const topT = Math.min(0.05, H * 0.12)
  const panelT = Math.min(0.04, W * 0.05)
  const legH = H - topT
  const sideD = D * 0.9
  const drawerW = Math.min(W * 0.3, 0.45)
  const drawerH = Math.min(legH * 0.35, 0.18)
  const drawerColor = shade(color, 1.05)
  return (
    <group>
      {/* top slab */}
      <Box size={[W, topT, D]} pos={[0, H - topT / 2, 0]} color={color} roughness={0.45} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* side panels */}
      <Box size={[panelT, legH, sideD]} pos={[-W / 2 + panelT / 2, legH / 2, 0]} color={panelColor} roughness={0.5} surface="wood" />
      <Box size={[panelT, legH, sideD]} pos={[W / 2 - panelT / 2, legH / 2, 0]} color={panelColor} roughness={0.5} surface="wood" />
      {/* back modesty panel (upper, along -z) */}
      <Box size={[W - panelT * 2, legH * 0.55, 0.02]} pos={[0, legH * 0.7, -D / 2 + 0.02]} color={panelColor} roughness={0.55} surface="wood" />
      {/* drawer block under the top on +x side */}
      <Box size={[drawerW, drawerH, sideD * 0.92]} pos={[W / 2 - panelT - drawerW / 2 - 0.01, H - topT - drawerH / 2 - 0.01, 0]} color={drawerColor} roughness={0.5} surface="wood" />
      {/* drawer handle */}
      <Cyl rTop={0.008} rBottom={0.008} height={drawerW * 0.4} pos={[W / 2 - panelT - drawerW / 2 - 0.01, H - topT - drawerH / 2 - 0.01, D / 2 * 0.92 + 0.012]} color={METAL} segments={10} rotation={[0, 0, Math.PI / 2]} roughness={0.3} metalness={0.7} />
    </group>
  )
}

function buildOttoman(W: number, D: number, H: number, color: string): JSX.Element {
  // Soft upholstered ottoman / pouf. Round if footprint is ~square, else a block.
  const round = Math.abs(W - D) < 0.12
  const footH = Math.min(0.04, H * 0.16)
  const bodyH = H - footH
  const seam = shade(color, 0.86)
  if (round) {
    const r = Math.min(W, D) / 2
    return (
      <group>
        <Cyl rTop={r * 0.96} rBottom={r} height={bodyH} pos={[0, footH + bodyH / 2, 0]} color={color} segments={32} roughness={0.92} surface="fabric" />
        {/* seam line */}
        <Cyl rTop={r * 1.01} rBottom={r * 1.01} height={0.012} pos={[0, footH + bodyH / 2, 0]} color={seam} segments={32} roughness={0.92} />
        {/* short feet */}
        {([[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]] as [number, number][]).map(([fx, fz], i) => (
          <Cyl key={i} rTop={0.012} rBottom={0.012} height={footH} pos={[fx * r * 0.7, footH / 2, fz * r * 0.7]} color={shade(color, 0.45)} segments={8} roughness={0.4} metalness={0.3} />
        ))}
      </group>
    )
  }
  return (
    <group>
      <Box size={[W, bodyH, D]} pos={[0, footH + bodyH / 2, 0]} color={color} roughness={0.92} surface="fabric" />
      {/* seam line around the middle */}
      <Box size={[W * 1.006, 0.012, D * 1.006]} pos={[0, footH + bodyH * 0.5, 0]} color={seam} roughness={0.92} />
      {/* feet */}
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).map(([sx, sz], i) => (
        <Cyl key={i} rTop={0.014} rBottom={0.014} height={footH} pos={[sx * (W / 2 - 0.06), footH / 2, sz * (D / 2 - 0.06)]} color={shade(color, 0.45)} segments={8} roughness={0.4} metalness={0.3} />
      ))}
    </group>
  )
}

function buildStool(W: number, D: number, H: number, color: string): JSX.Element {
  // Stool / bar stool. Tall (>70cm) → central post + base + footrest ring; else 4 legs.
  const legColor = shade(color, 0.5)
  const seatT = Math.min(0.06, H * 0.1)
  const seatTop = H
  const round = Math.abs(W - D) < 0.1
  const seatR = Math.min(W, D) / 2
  const seat = round ? (
    <Cyl rTop={seatR} rBottom={seatR * 0.96} height={seatT} pos={[0, seatTop - seatT / 2, 0]} color={color} segments={28} roughness={0.65} />
  ) : (
    <Box size={[W, seatT, D]} pos={[0, seatTop - seatT / 2, 0]} color={color} roughness={0.65} />
  )
  const tall = H > 0.7
  if (tall) {
    const postR = Math.min(0.03, W * 0.08)
    const baseR = Math.min(W, D) * 0.45
    const postH = seatTop - seatT
    return (
      <group>
        {seat}
        <Cyl rTop={postR} rBottom={postR} height={postH} pos={[0, postH / 2, 0]} color={METAL} segments={16} roughness={0.35} metalness={0.6} />
        <Cyl rTop={baseR} rBottom={baseR} height={0.02} pos={[0, 0.01, 0]} color={METAL} segments={28} roughness={0.35} metalness={0.6} />
        {/* footrest ring */}
        <mesh position={[0, H * 0.32, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <torusGeometry args={[baseR * 0.8, 0.012, 8, 28]} />
          <meshStandardMaterial color={METAL} roughness={0.35} metalness={0.6} />
        </mesh>
      </group>
    )
  }
  const legH = seatTop - seatT
  const inset = Math.min(0.05, W * 0.12)
  const corners: [number, number][] = [
    [-W / 2 + inset, -D / 2 + inset],
    [W / 2 - inset, -D / 2 + inset],
    [-W / 2 + inset, D / 2 - inset],
    [W / 2 - inset, D / 2 - inset],
  ]
  return (
    <group>
      {seat}
      {corners.map(([x, z], i) => (
        <Cyl key={i} rTop={0.013} rBottom={0.016} height={legH} pos={[x, legH / 2, z]} color={legColor} segments={10} roughness={0.45} metalness={0.2} />
      ))}
    </group>
  )
}

function buildBench(W: number, D: number, H: number, color: string): JSX.Element {
  // Bench: long seat slab on two end supports; backrest only when tall.
  const supportColor = shade(color, 0.55)
  const cushColor = shade(color, 1.12)
  const hasBack = H > 0.6
  const seatTop = hasBack ? Math.min(0.46, H * 0.5) : H
  const seatT = Math.min(0.06, seatTop * 0.16)
  const panelT = Math.min(0.05, W * 0.06)
  const legH = seatTop - seatT
  return (
    <group>
      {/* end supports */}
      <Box size={[panelT, legH, D * 0.92]} pos={[-W / 2 + panelT / 2, legH / 2, 0]} color={supportColor} roughness={0.5} surface="wood" />
      <Box size={[panelT, legH, D * 0.92]} pos={[W / 2 - panelT / 2, legH / 2, 0]} color={supportColor} roughness={0.5} surface="wood" />
      {/* seat slab */}
      <Box size={[W, seatT, D]} pos={[0, seatTop - seatT / 2, 0]} color={color} roughness={0.6} surface="wood" repeat={repeatForFace('wood', W * 100, D * 100)} />
      {/* thin cushion */}
      <Box size={[W * 0.96, 0.03, D * 0.9]} pos={[0, seatTop + 0.017, 0]} color={cushColor} roughness={0.88} surface="fabric" />
      {/* backrest when tall */}
      {hasBack && (
        <Box size={[W, H - seatTop, Math.min(0.05, D * 0.12)]} pos={[0, seatTop + (H - seatTop) / 2, -D / 2 + Math.min(0.05, D * 0.12) / 2]} color={color} roughness={0.6} surface="wood" />
      )}
    </group>
  )
}

function buildMirror(W: number, D: number, H: number, color: string): JSX.Element {
  // Freestanding full-length mirror (also used for tall room dividers).
  const frameT = Math.min(Math.max(D, 0.03), 0.06)
  const frameW = Math.min(0.05, W * 0.1)
  return (
    <group>
      {/* frame slab */}
      <Box size={[W, H, frameT]} pos={[0, H / 2, 0]} color={color} roughness={0.5} />
      {/* Reflective panel on +z (local front). A near-mirror metal reflecting a dedicated
          soft sky-to-floor envMap (envTextures.getMirrorEnvTexture) — it reads as a real
          silvered mirror instead of a black void (VIS-03). The env is self-contained (built once
          from a canvas, no CDN / no renderer), so it never depends on Agent G's scene.environment
          being present and is NEVER black. Deliberately NOT a planar reflector: those re-render
          the whole scene into an FBO EVERY frame (a per-frame cost the perf budget forbids) and
          rendered pure black here anyway. envMap reflection is static (zero per-frame cost) and
          the path tracer reads these PBR metal props for the beauty shot too. */}
      <mesh position={[0, H / 2, frameT / 2 + 0.004]}>
        <planeGeometry args={[W - frameW * 2, H - frameW * 2]} />
        <meshStandardMaterial
          color="#ffffff"
          metalness={1}
          roughness={0.045}
          envMap={getMirrorEnvTexture()}
          envMapIntensity={1.15}
        />
      </mesh>
      {/* back support strut (leans the mirror) */}
      <mesh position={[0, H * 0.42, -frameT / 2 - 0.04]} rotation={[0.16, 0, 0]} castShadow>
        <boxGeometry args={[W * 0.08, H * 0.7, 0.02]} />
        <meshStandardMaterial color={shade(color, 0.5)} roughness={0.5} />
      </mesh>
    </group>
  )
}

function buildBox(W: number, D: number, H: number, color: string): JSX.Element {
  const r = Math.min(W, D, H) * 0.06
  return (
    <group>
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
      </mesh>
      {/* subtle darker edge frame to suggest rounded form without rounded geo cost */}
      {r > 0.005 ? (
        <mesh position={[0, H / 2, 0]}>
          <boxGeometry args={[W * 1.001, H * 0.04, D * 1.001]} />
          <meshStandardMaterial color={shade(color, 0.7)} roughness={0.6} />
        </mesh>
      ) : null}
    </group>
  )
}

// --- kitchen / bathroom fixtures ------------------------------------------

/** Kitchen counter: base cabinet + stone top + backsplash + inset sink & faucet.
 *  A near-black tint reads as a bare polished-granite platform (new builder
 *  flats before trolleys are fitted): the slab + panels go glossy dark stone
 *  and the cabinet doors are omitted. */
function buildCounter(W: number, D: number, H: number, color: string): JSX.Element {
  const tint = new THREE.Color(color)
  const granite = tint.r + tint.g + tint.b < 0.9
  // Light/colored cabinets get a polished BLACK granite slab — the standard
  // Indian modular-kitchen top (every reference listing photo shows one);
  // near-black tints stay the all-granite bare platform.
  const stone = granite ? shade(color, 1.06) : '#26282b'
  const stoneRough = granite ? 0.13 : 0.14
  const bodyRough = granite ? 0.16 : 0.55
  const toeH = Math.min(0.08, H * 0.1)
  const topT = 0.04
  const bodyH = Math.max(0.1, H - toeH - topT)
  const splashH = 0.1
  const topY = toeH + bodyH + topT
  const sinkW = Math.min(0.5, W * 0.34)
  const sinkD = Math.min(D * 0.62, 0.42)
  const sinkX = W * 0.22
  const nDoors = Math.max(2, Math.round(W / 0.6))
  const doorW = (W - 0.04) / nDoors
  return (
    <group>
      <Box size={[W * 0.97, toeH, D * 0.9]} pos={[0, toeH / 2, 0]} color={shade(color, 0.5)} roughness={0.6} />
      <Box size={[W, bodyH, D]} pos={[0, toeH + bodyH / 2, 0]} color={color} roughness={bodyRough} />
      {/* stone countertop + backsplash */}
      <Box size={[W * 1.02, topT, D * 1.04]} pos={[0, topY - topT / 2, 0]} color={stone} roughness={stoneRough} metalness={granite ? 0.08 : 0} />
      <Box size={[W * 1.02, splashH, 0.02]} pos={[0, topY + splashH / 2, -D / 2 + 0.01]} color={stone} roughness={stoneRough + 0.05} />
      {/* cabinet door seams (front, +z) — omitted on a bare granite platform */}
      {!granite &&
        Array.from({ length: nDoors }).map((_, i) => {
          const cx = -W / 2 + 0.02 + doorW * (i + 0.5)
          return (
            <group key={i}>
              <Box size={[doorW - 0.02, bodyH - 0.06, 0.012]} pos={[cx, toeH + bodyH / 2, D / 2 + 0.005]} color={shade(color, 1.05)} roughness={0.5} />
              <Cyl rTop={0.007} rBottom={0.007} height={0.1} pos={[cx + doorW * 0.32, toeH + bodyH / 2, D / 2 + 0.008]} color={METAL} segments={8} roughness={0.3} metalness={0.7} />
            </group>
          )
        })}
      {/* inset stainless sink + faucet */}
      <Box size={[sinkW, 0.05, sinkD]} pos={[sinkX, topY - 0.02, 0]} color="#9a9ea2" roughness={0.25} metalness={0.45} />
      <Cyl rTop={0.012} rBottom={0.012} height={0.16} pos={[sinkX, topY + 0.08, -sinkD / 2 + 0.05]} color={METAL} segments={10} roughness={0.3} metalness={0.7} />
      <Box size={[0.05, 0.02, 0.1]} pos={[sinkX, topY + 0.15, -sinkD / 2 + 0.09]} color={METAL} roughness={0.3} metalness={0.7} />
    </group>
  )
}

/** Ceiling fan: canopy + downrod + motor hub + 3 flat blades. Hangs from the
 *  ceiling (mounted; base y=0 is the canopy — elevationCm lifts it). */
function buildFan(W: number, D: number, H: number, color: string): JSX.Element {
  const R = Math.min(W, D) / 2
  const rodH = Math.max(0.06, H * 0.45)
  const motorH = Math.max(0.05, H * 0.3)
  const bladeY = rodH + motorH * 0.55
  const bladeL = R * 0.92
  const bladeW = Math.max(0.09, R * 0.16)
  return (
    <group>
      {/* canopy at the ceiling */}
      <Cyl rTop={0.05} rBottom={0.035} height={0.04} pos={[0, 0.02, 0]} color={color} segments={16} roughness={0.4} />
      {/* downrod */}
      <Cyl rTop={0.012} rBottom={0.012} height={rodH} pos={[0, rodH / 2, 0]} color={shade(color, 0.85)} segments={10} roughness={0.35} metalness={0.4} />
      {/* motor hub */}
      <Cyl rTop={0.075} rBottom={0.09} height={motorH} pos={[0, rodH + motorH / 2, 0]} color={color} segments={20} roughness={0.35} />
      {/* 3 blades */}
      {[0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3
        return (
          <group key={i} rotation={[0, a, 0]}>
            <mesh position={[bladeL / 2 + 0.05, bladeY, 0]} rotation={[0, 0, -0.06]} castShadow>
              <boxGeometry args={[bladeL, 0.012, bladeW]} />
              <meshStandardMaterial color={shade(color, 1.02)} roughness={0.5} metalness={0.05} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Window curtains: rod + two gathered blackout side panels + a white sheer
 *  in the middle. Local y=0 is the panel bottom; elevationCm hangs the rod at
 *  lintel height. `color` tints the side panels. */
function buildCurtain(W: number, D: number, H: number, color: string): JSX.Element {
  const rodY = H - 0.02
  const panelW = W * 0.24
  const panelH = H - 0.05
  const folds = 5
  const foldW = panelW / folds
  const panels: JSX.Element[] = []
  for (const side of [-1, 1]) {
    const cx = side * (W / 2 - panelW / 2 - 0.01)
    for (let i = 0; i < folds; i++) {
      // alternating fold depth reads as gathered fabric
      const fx = cx - panelW / 2 + foldW * (i + 0.5)
      const fz = (i % 2 === 0 ? 1 : -1) * D * 0.16
      panels.push(
        <Box
          key={`p${side}-${i}`}
          size={[foldW * 1.06, panelH, D * 0.3]}
          pos={[fx, panelH / 2, fz]}
          color={shade(color, i % 2 === 0 ? 1.04 : 0.92)}
          roughness={0.92}
          surface="curtain"
        />,
      )
    }
    // tieback pinch at mid-height
    panels.push(
      <Box key={`t${side}`} size={[panelW * 0.55, 0.07, D * 0.5]} pos={[cx, panelH * 0.45, 0]} color={shade(color, 1.25)} roughness={0.8} surface="curtain" />,
    )
  }
  return (
    <group>
      {/* rod + finials */}
      <Cyl rTop={0.014} rBottom={0.014} height={W} pos={[0, rodY, 0]} color="#6d6f72" segments={10} roughness={0.35} metalness={0.6} rotation={[0, 0, Math.PI / 2]} />
      <mesh position={[-W / 2, rodY, 0]}><sphereGeometry args={[0.03, 10, 10]} /><meshStandardMaterial color="#6d6f72" roughness={0.35} metalness={0.6} /></mesh>
      <mesh position={[W / 2, rodY, 0]}><sphereGeometry args={[0.03, 10, 10]} /><meshStandardMaterial color="#6d6f72" roughness={0.35} metalness={0.6} /></mesh>
      {/* white sheer across the middle */}
      <mesh position={[0, panelH * 0.52, 0]}>
        <boxGeometry args={[W - 2 * panelW - 0.06, panelH * 0.96, D * 0.12]} />
        <meshStandardMaterial color="#f6f5f2" roughness={0.9} metalness={0} transparent opacity={0.45} />
      </mesh>
      {panels}
    </group>
  )
}

/** Open ladder/étagère shelf: slim metal frame, 4 shelves. */
function buildLadderShelf(W: number, D: number, H: number, color: string): JSX.Element {
  const leg = 0.022
  const nShelves = 4
  const parts: JSX.Element[] = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(
        <Box key={`l${sx}${sz}`} size={[leg, H, leg]} pos={[sx * (W / 2 - leg / 2), H / 2, sz * (D / 2 - leg / 2)]} color={color} roughness={0.4} metalness={0.5} />,
      )
    }
  }
  for (let i = 0; i < nShelves; i++) {
    const y = H * (0.16 + (i * 0.78) / (nShelves - 1))
    parts.push(
      <Box key={`s${i}`} size={[W - 0.01, 0.018, D - 0.01]} pos={[0, y, 0]} color={shade(color, 1.15)} roughness={0.5} metalness={0.3} />,
    )
  }
  // a couple of "objects" so the rack doesn't read empty (box + books)
  parts.push(<Box key="o1" size={[W * 0.4, 0.14, D * 0.6]} pos={[-W * 0.2, H * 0.16 + 0.08, 0]} color="#d8d2c4" roughness={0.8} />)
  parts.push(<Box key="o2" size={[W * 0.22, 0.17, D * 0.5]} pos={[W * 0.22, H * 0.68 + 0.1, 0]} color="#9aa0a4" roughness={0.7} />)
  return <group>{parts}</group>
}

/** Wall split-AC indoor unit: rounded white body + vent slot + status LED. */
function buildAc(W: number, D: number, H: number, color: string): JSX.Element {
  return (
    <group>
      <Box size={[W, H, D]} pos={[0, H / 2, 0]} color={color} roughness={0.35} />
      <Box size={[W * 0.96, H * 0.16, D * 0.2]} pos={[0, H * 0.16, D / 2 - D * 0.08]} color={shade(color, 0.82)} roughness={0.5} />
      <mesh position={[W * 0.38, H * 0.3, D / 2 + 0.002]}>
        <circleGeometry args={[0.011, 10]} />
        <meshStandardMaterial color="#3adf6e" emissive="#3adf6e" emissiveIntensity={0.6} />
      </mesh>
    </group>
  )
}

// ── Double-height / duplex pieces (Sky Duplex genre) ─────────────────────────

const RAIL_GLASS = '#c9dbe2'
const BRUSHED = '#b9b4ab' // brushed-steel handrail / standoffs

/** Frameless glass balustrade pane (no shadow: a 26%-opaque pane casting a solid
 *  shadow reads as a wall on the floor below). */
function GlassPane({
  size,
  pos,
  rotation,
}: {
  size: [number, number, number]
  pos: [number, number, number]
  rotation?: [number, number, number]
}): JSX.Element {
  return (
    <mesh position={pos} rotation={rotation}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={RAIL_GLASS} transparent opacity={0.26} roughness={0.06} metalness={0.1} />
    </mesh>
  )
}

/** Floating open-riser staircase: solid-timber treads cantilevered off a slim
 *  wall stringer on local -x, frameless glass balustrade + handrail on +x.
 *  Rises from the +z end (bottom step) to the -z end (top tread at y = H), so
 *  with its back to a mezzanine wall the top tread meets the gallery deck. */
function buildStaircase(W: number, D: number, H: number, color: string): JSX.Element {
  // ~18cm risers — the comfortable domestic rise; the tread count follows the height.
  const n = Math.max(3, Math.round(H / 0.18))
  const rise = H / n
  const going = D / n
  const treadT = Math.min(0.07, rise * 0.45)
  const L = Math.hypot(D, H)
  const pitch = Math.atan2(H, D) // +x rotation tips the -z end up
  const parts: JSX.Element[] = []
  for (let i = 0; i < n; i++) {
    const top = (i + 1) * rise
    parts.push(
      <Box
        key={`t${i}`}
        size={[W - 0.03, treadT, going * 1.04]}
        pos={[0.015, top - treadT / 2, D / 2 - going * (i + 0.5)]}
        color={color}
        roughness={0.55}
        surface="wood"
      />,
    )
  }
  const railX = W / 2 - 0.02
  const glassH = 0.9
  // offset along the pitched panel's local +y → world (y·cos, z·sin)
  const up = (o: number): [number, number] => [H / 2 + o * Math.cos(pitch), o * Math.sin(pitch)]
  const [gy, gz] = up(glassH / 2)
  const [ry, rz] = up(glassH + 0.02)
  return (
    <group>
      {/* wall stringer (dark steel plate the treads hang off) */}
      <Box size={[0.02, 0.22, L]} pos={[-W / 2 + 0.01, H / 2 - 0.06, 0]} rotation={[pitch, 0, 0]} color={DARK} roughness={0.45} metalness={0.4} />
      {parts}
      <GlassPane size={[0.012, glassH, L]} pos={[railX, gy, gz]} rotation={[pitch, 0, 0]} />
      <Box size={[0.03, 0.03, L]} pos={[railX, ry, rz]} rotation={[pitch, 0, 0]} color={BRUSHED} roughness={0.3} metalness={0.7} />
    </group>
  )
}

/** Dog-leg (U) staircase — the common Indian apartment stair: flight A climbs
 *  from the FRONT (+z) to a half-landing across the back (-z), flight B returns
 *  to the front at y = H. Entry (bottom of A) and exit (top of B) are therefore
 *  at the SAME end, side by side — so on a plan the stair is reached from one
 *  side on every floor. A straight flight here would put its foot at the far
 *  end, i.e. against whatever room lies there (the Canary lobby bug).
 *  Flight A is the -x half, flight B the +x half; a central wall divides them. */
function buildStaircaseU(W: number, D: number, H: number, color: string): JSX.Element {
  const wall = 0.08 // central dividing wall
  const fw = Math.max(0.3, (W - wall) / 2)
  const land = Math.min(fw, D * 0.45) // half-landing depth, square-ish like the plans
  const run = D - land
  // ~18cm risers per half; each flight climbs H/2
  const n = Math.max(2, Math.round(H / 2 / 0.18))
  const rise = H / 2 / n
  const going = run / n
  const treadT = Math.min(0.06, rise * 0.45)
  const xA = -(wall / 2 + fw / 2)
  const xB = wall / 2 + fw / 2
  const parts: JSX.Element[] = []
  for (let i = 0; i < n; i++) {
    // flight A: front → back, 0 → H/2
    const topA = (i + 1) * rise
    parts.push(
      <Box key={`a${i}`} size={[fw, treadT, going * 1.04]} pos={[xA, topA - treadT / 2, D / 2 - going * (i + 0.5)]} color={color} roughness={0.55} surface="wood" />,
    )
    // flight B: back → front, H/2 → H
    const topB = H / 2 + (i + 1) * rise
    parts.push(
      <Box key={`b${i}`} size={[fw, treadT, going * 1.04]} pos={[xB, topB - treadT / 2, -D / 2 + land + going * (i + 0.5)]} color={color} roughness={0.55} surface="wood" />,
    )
  }
  const pitch = Math.atan2(H / 2, run)
  const L = Math.hypot(run, H / 2)
  const glassH = 0.9
  // outer glass balustrade per flight, following its pitch (A rises toward -z, B toward +z)
  const rail = (x: number, sign: 1 | -1, base: number, key: string) => {
    const zc = D / 2 - run / 2
    const yc = base + H / 4
    const oy = (glassH / 2) * Math.cos(pitch)
    const oz = (glassH / 2) * Math.sin(pitch) * sign
    return (
      <group key={key}>
        <GlassPane size={[0.012, glassH, L]} pos={[x, yc + oy, zc + oz]} rotation={[pitch * sign, 0, 0]} />
        <Box
          size={[0.03, 0.03, L]}
          pos={[x, yc + 2 * oy + 0.02, zc + 2 * oz]}
          rotation={[pitch * sign, 0, 0]}
          color={BRUSHED}
          roughness={0.3}
          metalness={0.7}
        />
      </group>
    )
  }
  return (
    <group>
      {parts}
      {/* half-landing slab across the back, top at H/2 */}
      <Box size={[W, 0.12, land]} pos={[0, H / 2 - 0.06, -D / 2 + land / 2]} color={color} roughness={0.55} surface="wood" />
      {/* central dividing wall, floor to the top of flight B */}
      <Box size={[wall, H, run]} pos={[0, H / 2, D / 2 - run / 2]} color="#e9e4dc" roughness={0.85} surface="plaster" />
      {rail(-W / 2 + 0.01, 1, 0, 'ra')}
      {rail(W / 2 - 0.01, -1, H / 2, 'rb')}
    </group>
  )
}

/** Mezzanine gallery (the upper-floor overlook of a duplex): timber deck on a
 *  plaster slab, warm LED cove under the front fascia, frameless glass railing
 *  with a brushed handrail along the open (+z) edge. Local y=0 is the slab's
 *  underside; elevationCm lifts it to upper-floor height. Back (-z) is the wall.
 *  `color` is the plaster fascia/soffit. */
function buildMezzanine(W: number, D: number, H: number, color: string): JSX.Element {
  const slabT = Math.min(0.28, H * 0.22)
  const deckT = 0.02
  const railH = Math.max(0.3, H - slabT - deckT)
  const deckTop = slabT + deckT
  const frontZ = D / 2
  const posts: JSX.Element[] = []
  // standoff clamps every ~1.2m (one per pane joint)
  const nPanes = Math.max(1, Math.round(W / 1.2))
  for (let i = 0; i <= nPanes; i++) {
    const x = -W / 2 + 0.04 + ((W - 0.08) * i) / nPanes
    posts.push(
      <Box key={`p${i}`} size={[0.03, 0.08, 0.03]} pos={[x, deckTop + 0.06, frontZ - 0.03]} color={BRUSHED} roughness={0.3} metalness={0.7} />,
    )
  }
  return (
    <group>
      <Box size={[W, slabT, D]} pos={[0, slabT / 2, 0]} color={color} roughness={0.85} surface="plaster" />
      <Box size={[W, deckT, D - 0.02]} pos={[0, slabT + deckT / 2, -0.01]} color="#9a7352" roughness={0.5} surface="wood" />
      {/* recessed warm LED strip under the fascia — the cove glow in the reference */}
      <mesh position={[0, 0.004, frontZ - 0.06]}>
        <boxGeometry args={[W * 0.98, 0.008, 0.03]} />
        <meshStandardMaterial color="#fff1d6" emissive="#ffcf8a" emissiveIntensity={1.2} />
      </mesh>
      <GlassPane size={[W - 0.02, railH, 0.012]} pos={[0, deckTop + railH / 2, frontZ - 0.03]} />
      <Box size={[W, 0.035, 0.05]} pos={[0, deckTop + railH, frontZ - 0.03]} color={BRUSHED} roughness={0.3} metalness={0.7} />
      {posts}
    </group>
  )
}

/** Cascade chandelier: ceiling canopy at the top (y = H) with rings of fine rods
 *  dropping to glowing crystal tubes at staggered heights; the longest reach
 *  y = 0. Deterministic (hashed) drop lengths so it never re-shuffles on render. */
function buildChandelier(W: number, D: number, H: number, color: string): JSX.Element {
  const R = Math.min(W, D) / 2
  const crystalL = Math.min(0.28, H * 0.12)
  const rings: Array<[number, number]> = [
    [0.22, 5],
    [0.55, 9],
    [0.92, 13],
  ]
  const hash = (i: number) => {
    const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const drops: JSX.Element[] = []
  let k = 0
  for (const [rf, count] of rings) {
    for (let j = 0; j < count; j++, k++) {
      const a = (j / count) * Math.PI * 2 + rf * 1.7
      const x = Math.cos(a) * R * rf
      const z = Math.sin(a) * R * rf
      // inner rings drop lowest → the tapered "cascade" silhouette
      const len = Math.max(crystalL * 1.5, (H - 0.04) * (1 - rf * 0.45) * (0.82 + 0.18 * hash(k)))
      const rodL = len - crystalL
      drops.push(
        <group key={k}>
          <Cyl rTop={0.002} rBottom={0.002} height={rodL} pos={[x, H - rodL / 2, z]} color={color} segments={4} metalness={0.8} roughness={0.3} />
          <mesh position={[x, H - rodL - crystalL / 2, z]}>
            <cylinderGeometry args={[0.012, 0.012, crystalL, 8]} />
            <meshStandardMaterial color="#fff6e4" emissive="#ffd28a" emissiveIntensity={1.1} roughness={0.15} />
          </mesh>
        </group>,
      )
    }
  }
  return (
    <group>
      <Cyl rTop={R * 0.95} rBottom={R * 0.95} height={0.03} pos={[0, H - 0.015, 0]} color={color} segments={32} roughness={0.3} metalness={0.8} />
      {drops}
    </group>
  )
}

// Jali (perforated lattice) bars share ONE unit cube + ONE white material and
// are drawn as a single instanced mesh tinted per-instance. A floor-to-ceiling
// jali is ~300 bars — as individual <Box> meshes that is 300 draw calls and 300
// geometries per screen. Module singletons: never dispose them (dispose={null}).
const JALI_GEOMETRY = new THREE.BoxGeometry(1, 1, 1)
const JALI_MATERIAL = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 })

interface JaliBar {
  pos: [number, number, number]
  size: [number, number, number]
}

function JaliBars({ bars, color }: { bars: JaliBar[]; color: string }): JSX.Element {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    const c = new THREE.Color(color)
    for (let i = 0; i < bars.length; i++) {
      dummy.position.set(...bars[i].pos)
      dummy.scale.set(...bars[i].size)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, c)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [bars, color])
  return (
    <instancedMesh
      // count is baked into args: a resize that changes the bar count must remount
      key={bars.length}
      ref={ref}
      args={[JALI_GEOMETRY, JALI_MATERIAL, bars.length]}
      castShadow
      receiveShadow
      dispose={null}
    />
  )
}

/** Jali screen: a full-height masonry lattice in a running-bond pattern — the
 *  double-height balcony screen of the Elysium duplex. Face is the XY plane,
 *  D is the screen's depth. Daylight shows through the rectangular voids. */
function buildJali(W: number, D: number, H: number, color: string): JSX.Element {
  const t = 0.04 // bar thickness
  const rowH = 0.22
  const cellW = 0.34
  const rows = Math.max(2, Math.round(H / rowH))
  const rh = H / rows
  const bars: JaliBar[] = []
  // outer frame
  bars.push({ pos: [0, t / 2, 0], size: [W, t, D] })
  bars.push({ pos: [0, H - t / 2, 0], size: [W, t, D] })
  bars.push({ pos: [-W / 2 + t / 2, H / 2, 0], size: [t, H, D] })
  bars.push({ pos: [W / 2 - t / 2, H / 2, 0], size: [t, H, D] })
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh
    if (r > 0) bars.push({ pos: [0, y0, 0], size: [W, t, D] })
    // running bond: every other course shifts half a cell
    const shift = (r % 2) * cellW * 0.5
    for (let x = -W / 2 + shift + cellW; x < W / 2 - t; x += cellW) {
      bars.push({ pos: [x, y0 + rh / 2, 0], size: [t, rh, D] })
      // a half-height mullion in alternating cells gives the pinwheel voids
      const cx = x - cellW / 2
      if ((Math.round((x + W) / cellW) + r) % 3 === 0 && cx > -W / 2 + t) {
        bars.push({ pos: [cx, y0 + rh / 2, 0], size: [cellW * 0.5, t * 0.8, D] })
      }
    }
  }
  return <JaliBars bars={bars} color={color} />
}

/** Toilet (commode): tank at the back, pedestal bowl + seat at the front. */
function buildToilet(W: number, D: number, H: number, _color: string): JSX.Element {
  const white = '#f3f2ec'
  const tankH = H * 0.42
  const tankD = D * 0.22
  const tankW = W * 0.92
  const bowlH = H * 0.5
  const bowlZ = D * 0.1
  return (
    <group>
      {/* tank + lid at the back (-z) */}
      <Box size={[tankW, tankH, tankD]} pos={[0, H - tankH / 2, -D / 2 + tankD / 2]} color={white} roughness={0.4} />
      <Box size={[tankW * 1.04, 0.03, tankD * 1.15]} pos={[0, H + 0.015, -D / 2 + tankD / 2]} color={shade(white, 0.96)} roughness={0.4} />
      {/* pedestal + bowl + seat (front) */}
      <Cyl rTop={W * 0.3} rBottom={W * 0.22} height={bowlH} pos={[0, bowlH / 2, bowlZ]} color={white} segments={20} roughness={0.4} />
      <Cyl rTop={W * 0.46} rBottom={W * 0.32} height={H * 0.13} pos={[0, bowlH + H * 0.04, bowlZ]} color={white} segments={24} roughness={0.4} />
      <Cyl rTop={W * 0.48} rBottom={W * 0.48} height={0.03} pos={[0, bowlH + H * 0.12, bowlZ]} color={shade(white, 0.98)} segments={24} roughness={0.45} />
    </group>
  )
}

/** Shower: low tray + translucent glass enclosure (open front) + showerhead. */
function buildShower(W: number, D: number, H: number, _color: string): JSX.Element {
  const tray = '#e6e4de'
  const glass = '#bcd2dc'
  const t = 0.018
  const gh = H * 0.96
  const gy = 0.06 + gh / 2
  const Glass = ({ size, pos }: { size: [number, number, number]; pos: [number, number, number] }) => (
    <mesh position={pos}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={glass} transparent opacity={0.26} roughness={0.08} metalness={0.1} />
    </mesh>
  )
  return (
    <group>
      <Box size={[W, 0.06, D]} pos={[0, 0.03, 0]} color={tray} roughness={0.5} />
      {/* back + both sides glass, partial front (door gap) */}
      <Glass size={[W, gh, t]} pos={[0, gy, -D / 2 + t / 2]} />
      <Glass size={[t, gh, D]} pos={[-W / 2 + t / 2, gy, 0]} />
      <Glass size={[t, gh, D]} pos={[W / 2 - t / 2, gy, 0]} />
      <Glass size={[W * 0.46, gh, t]} pos={[-W * 0.26, gy, D / 2 - t / 2]} />
      {/* metal frame edges */}
      <Box size={[W, 0.03, 0.03]} pos={[0, 0.06 + gh, -D / 2 + t / 2]} color={METAL} roughness={0.3} metalness={0.6} />
      <Box size={[0.03, gh, 0.03]} pos={[-W / 2 + t / 2, gy, D / 2 - t / 2]} color={METAL} roughness={0.3} metalness={0.6} />
      {/* showerhead + arm on the back wall */}
      <Box size={[0.03, 0.03, 0.16]} pos={[0, H * 0.9, -D / 2 + 0.06]} color={METAL} roughness={0.3} metalness={0.6} />
      <Cyl rTop={0.06} rBottom={0.055} height={0.025} pos={[0, H * 0.88, -D / 2 + 0.16]} color={METAL} segments={16} roughness={0.3} metalness={0.7} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  )
}

/** Bathroom vanity / sink base: cabinet body + stone top + recessed basin + faucet. */
function buildVanity(W: number, D: number, H: number, color: string): JSX.Element {
  const stone = shade(color, 0.72)
  const door = shade(color, 1.06)
  const basinColor = '#eef2f3'
  const topT = 0.04
  const cabH = Math.max(0.1, H - topT)
  const basinR = Math.min(W * 0.3, D * 0.34)
  const topY = cabH + topT
  return (
    <group>
      <Box size={[W, cabH, D]} pos={[0, cabH / 2, 0]} color={color} roughness={0.5} />
      <Box size={[W * 1.02, topT, D * 1.04]} pos={[0, cabH + topT / 2, 0]} color={stone} roughness={0.3} />
      <Cyl rTop={basinR} rBottom={basinR * 0.7} height={topT * 1.6} pos={[0, topY - topT * 0.4, D * 0.05]} color={basinColor} segments={24} roughness={0.18} />
      <Cyl rTop={0.012} rBottom={0.012} height={0.14} pos={[0, topY + 0.07, -D / 2 + 0.09]} color={METAL} segments={10} roughness={0.3} metalness={0.7} />
      <Box size={[0.04, 0.02, 0.09]} pos={[0, topY + 0.13, -D / 2 + 0.12]} color={METAL} roughness={0.3} metalness={0.7} />
      <Box size={[W * 0.46, cabH * 0.82, 0.015]} pos={[-W * 0.24, cabH * 0.46, D / 2 - 0.006]} color={door} roughness={0.5} />
      <Box size={[W * 0.46, cabH * 0.82, 0.015]} pos={[W * 0.24, cabH * 0.46, D / 2 - 0.006]} color={door} roughness={0.5} />
    </group>
  )
}

/** Built-in (alcove) bathtub: apron shell with a recessed inner basin + faucet. */
function buildBathtub(W: number, D: number, H: number, color: string): JSX.Element {
  const inner = shade(color, 0.9)
  const rim = Math.min(0.09, Math.min(W, D) * 0.08)
  const innerH = H * 0.72
  return (
    <group>
      <Box size={[W, H, D]} pos={[0, H / 2, 0]} color={color} roughness={0.2} metalness={0.04} />
      <Box size={[W - rim * 2, innerH, D - rim * 2]} pos={[0, H - innerH / 2 - 0.02, 0]} color={inner} roughness={0.14} />
      <Cyl rTop={0.018} rBottom={0.018} height={0.14} pos={[-W / 2 + 0.12, H + 0.06, -D / 2 + 0.12]} color={METAL} segments={12} roughness={0.25} metalness={0.7} />
      <Box size={[0.05, 0.02, 0.1]} pos={[-W / 2 + 0.12, H + 0.12, -D / 2 + 0.16]} color={METAL} roughness={0.25} metalness={0.7} />
    </group>
  )
}

/** Freestanding soaker tub: rounded (elliptical) shell + inner basin + tall floor faucet. */
function buildTubFreestanding(W: number, D: number, H: number, color: string): JSX.Element {
  const inner = shade(color, 0.9)
  const faucetH = H + 0.2
  return (
    <group>
      <mesh position={[0, H / 2, 0]} scale={[W / 2, 1, D / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 0.86, H, 32]} />
        <meshStandardMaterial color={color} roughness={0.16} metalness={0.05} />
      </mesh>
      <mesh position={[0, H - H * 0.36 - 0.003, 0]} scale={[(W / 2) * 0.84, 1, (D / 2) * 0.84]}>
        <cylinderGeometry args={[1, 0.92, H * 0.72, 32]} />
        <meshStandardMaterial color={inner} roughness={0.13} />
      </mesh>
      <Cyl rTop={0.02} rBottom={0.022} height={faucetH} pos={[0, faucetH / 2, -D / 2 + 0.05]} color={METAL} segments={12} roughness={0.25} metalness={0.7} />
      <Box size={[0.05, 0.02, 0.14]} pos={[0, faucetH - 0.02, -D / 2 + 0.14]} color={METAL} roughness={0.25} metalness={0.7} />
    </group>
  )
}

/** Jacuzzi / whirlpool tub: wide deck surround, sunken basin, jet nozzles. */
function buildJacuzzi(W: number, D: number, H: number, color: string): JSX.Element {
  const inner = shade(color, 0.85)
  const rim = Math.min(0.16, Math.min(W, D) * 0.13)
  const innerH = H * 0.78
  const jy = H - innerH + 0.06
  const jx = (W - rim * 2) / 2 - 0.04
  const jz = (D - rim * 2) / 2 - 0.04
  const spots: [number, number, number, boolean][] = [
    [-jx, jy, 0, true], [jx, jy, 0, true], [0, jy, -jz, false], [0, jy, jz, false],
  ]
  const jets = spots.map(([x, y, z, sideWall], i) => (
    <Cyl
      key={`jet${i}`}
      rTop={0.02}
      rBottom={0.02}
      height={0.04}
      pos={[x, y, z]}
      rotation={sideWall ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]}
      color={METAL}
      segments={10}
      roughness={0.3}
      metalness={0.6}
    />
  ))
  return (
    <group>
      <Box size={[W, H, D]} pos={[0, H / 2, 0]} color={color} roughness={0.25} metalness={0.05} />
      <Box size={[W - rim * 2, innerH, D - rim * 2]} pos={[0, H - innerH / 2 - 0.02, 0]} color={inner} roughness={0.12} metalness={0.05} />
      {jets}
      <Cyl rTop={0.02} rBottom={0.02} height={0.12} pos={[-W / 2 + 0.16, H + 0.05, -D / 2 + 0.16]} color={METAL} segments={12} roughness={0.25} metalness={0.7} />
    </group>
  )
}

/** Kitchen island: base cabinet block + stone top overhanging the +z seating side. */
function buildIsland(W: number, D: number, H: number, color: string): JSX.Element {
  const stone = shade(color, 0.7)
  const door = shade(color, 1.05)
  const toeH = Math.min(0.06, H * 0.08)
  const topT = 0.05
  const bodyH = Math.max(0.1, H - toeH - topT)
  const nDoors = Math.max(2, Math.round(W / 0.6))
  const doorW = (W - 0.04) / nDoors
  const doors: JSX.Element[] = []
  for (let i = 0; i < nDoors; i++) {
    const cx = -W / 2 + 0.02 + doorW * (i + 0.5)
    doors.push(
      <Box key={`d${i}`} size={[doorW - 0.02, bodyH * 0.86, 0.012]} pos={[cx, toeH + bodyH / 2, -D / 2 - 0.002]} color={door} roughness={0.5} />,
    )
  }
  return (
    <group>
      <Box size={[W * 0.96, toeH, D * 0.94]} pos={[0, toeH / 2, 0]} color={shade(color, 0.45)} roughness={0.6} />
      <Box size={[W, bodyH, D]} pos={[0, toeH + bodyH / 2, 0]} color={color} roughness={0.5} />
      <Box size={[W * 1.04, topT, D * 1.28]} pos={[0, toeH + bodyH + topT / 2, D * 0.12]} color={stone} roughness={0.28} metalness={0.05} />
      {doors}
    </group>
  )
}

/** Range / stove: body + dark cooktop with burners + oven door/window + handle + knobs. */
function buildStove(W: number, D: number, H: number, color: string): JSX.Element {
  const top = DARK
  const bodyH = H * 0.96
  const bx = W * 0.26
  const bz = D * 0.22
  const burnerR = Math.min(0.09, W * 0.13)
  const burners = ([[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz]] as [number, number][]).map(([x, z], i) => (
    <Cyl key={`b${i}`} rTop={burnerR} rBottom={burnerR} height={0.01} pos={[x, bodyH + 0.012, z]} color={shade(top, 1.25)} segments={20} roughness={0.4} />
  ))
  const knobs: JSX.Element[] = []
  for (let i = 0; i < 4; i++) {
    knobs.push(
      <Cyl key={`k${i}`} rTop={0.012} rBottom={0.012} height={0.02} pos={[-W * 0.3 + (W * 0.6 * i) / 3, bodyH * 0.86, D / 2]} rotation={[Math.PI / 2, 0, 0]} color={METAL} segments={10} roughness={0.3} metalness={0.6} />,
    )
  }
  return (
    <group>
      <Box size={[W, bodyH, D]} pos={[0, bodyH / 2, 0]} color={color} roughness={0.35} metalness={0.2} />
      <Box size={[W * 0.98, 0.02, D * 0.96]} pos={[0, bodyH + 0.01, 0]} color={top} roughness={0.18} metalness={0.1} />
      {burners}
      <Box size={[W * 0.86, bodyH * 0.52, 0.02]} pos={[0, bodyH * 0.32, D / 2 - 0.005]} color={shade(color, 0.92)} roughness={0.3} metalness={0.25} />
      <Box size={[W * 0.6, bodyH * 0.26, 0.005]} pos={[0, bodyH * 0.34, D / 2 + 0.006]} color={GLASS} roughness={0.1} metalness={0.2} />
      <Cyl rTop={0.012} rBottom={0.012} height={W * 0.7} pos={[0, bodyH * 0.6, D / 2 + 0.03]} rotation={[0, 0, Math.PI / 2]} color={METAL} segments={10} roughness={0.3} metalness={0.7} />
      {knobs}
    </group>
  )
}

/** Refrigerator: tall body + two doors (fridge over freezer) + vertical handles. */
function buildFridge(W: number, D: number, H: number, color: string): JSX.Element {
  const door = shade(color, 1.04)
  const seam = 0.012
  const topH = H * 0.6
  const botH = H - topH - seam
  return (
    <group>
      <Box size={[W, H, D]} pos={[0, H / 2, 0]} color={color} roughness={0.3} metalness={0.25} />
      <Box size={[W * 0.97, topH - seam, 0.02]} pos={[0, H - topH / 2, D / 2 - 0.005]} color={door} roughness={0.32} metalness={0.2} />
      <Box size={[W * 0.97, botH, 0.02]} pos={[0, botH / 2, D / 2 - 0.005]} color={door} roughness={0.32} metalness={0.2} />
      <Cyl rTop={0.014} rBottom={0.014} height={topH * 0.6} pos={[-W / 2 + 0.06, H - topH / 2, D / 2 + 0.03]} color={METAL} segments={10} roughness={0.3} metalness={0.7} />
      <Cyl rTop={0.014} rBottom={0.014} height={botH * 0.6} pos={[-W / 2 + 0.06, botH / 2, D / 2 + 0.03]} color={METAL} segments={10} roughness={0.3} metalness={0.7} />
    </group>
  )
}

/** Front-load washing machine: cuboid body + round glass PORTHOLE door (metal ring + dark drum) +
 *  top control-panel strip (display + program dial) + detergent drawer + top lid + feet.
 *  Front faces +z (LOCAL space: footprint centered, base at y=0). */
function buildWasher(W: number, D: number, H: number, color: string): JSX.Element {
  const footH = Math.min(0.04, H * 0.05)
  const bodyH = H - footH
  const panelH = Math.min(0.14, bodyH * 0.18)
  const doorR = Math.min(W * 0.34, bodyH * 0.3)
  const doorY = footH + bodyH * 0.42
  const faceZ = D / 2
  const panelY = footH + bodyH - panelH / 2 - 0.02
  const drawerY = panelY - panelH * 0.85
  return (
    <group>
      {/* feet */}
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).map(([sx, sz], i) => (
        <Cyl key={i} rTop={0.02} rBottom={0.02} height={footH} pos={[sx * (W / 2 - 0.05), footH / 2, sz * (D / 2 - 0.05)]} color={DARK} segments={8} metalness={0.3} />
      ))}
      {/* body + top lid */}
      <Box size={[W, bodyH, D]} pos={[0, footH + bodyH / 2, 0]} color={color} roughness={0.32} metalness={0.18} />
      <Box size={[W, 0.02, D]} pos={[0, footH + bodyH + 0.01, 0]} color={shade(color, 0.94)} roughness={0.3} />
      {/* control-panel strip (top front) + display + program dial */}
      <Box size={[W * 0.96, panelH, 0.012]} pos={[0, panelY, faceZ + 0.002]} color={shade(color, 0.86)} roughness={0.4} />
      <Box size={[W * 0.22, panelH * 0.4, 0.006]} pos={[W * 0.18, panelY, faceZ + 0.013]} color={GLASS} roughness={0.15} />
      <Cyl rTop={panelH * 0.32} rBottom={panelH * 0.32} height={0.02} rotation={[Math.PI / 2, 0, 0]} pos={[-W * 0.28, panelY, faceZ + 0.015]} color={METAL} segments={20} metalness={0.5} />
      {/* detergent drawer (top-left front) + handle */}
      <Box size={[W * 0.3, panelH * 0.7, 0.02]} pos={[-W * 0.3, drawerY, faceZ + 0.006]} color={shade(color, 1.05)} roughness={0.5} />
      <Box size={[W * 0.2, 0.01, 0.012]} pos={[-W * 0.3, drawerY, faceZ + 0.018]} color={METAL} metalness={0.5} />
      {/* porthole: recessed metal ring + dark drum + proud glass disc, facing +z */}
      <Cyl rTop={doorR} rBottom={doorR} height={0.03} rotation={[Math.PI / 2, 0, 0]} pos={[0, doorY, faceZ - 0.01]} color={shade(color, 0.88)} segments={32} roughness={0.35} metalness={0.4} />
      <Cyl rTop={doorR * 0.62} rBottom={doorR * 0.62} height={0.02} rotation={[Math.PI / 2, 0, 0]} pos={[0, doorY, faceZ - 0.03]} color={DARK} segments={28} />
      <Cyl rTop={doorR * 0.74} rBottom={doorR * 0.74} height={0.02} rotation={[Math.PI / 2, 0, 0]} pos={[0, doorY, faceZ + 0.012]} color={GLASS} segments={32} roughness={0.08} metalness={0.1} />
    </group>
  )
}

/** Range hood: wide canopy + chimney duct (wall-mounted above a cooktop). */
function buildRangeHood(W: number, D: number, H: number, color: string): JSX.Element {
  const canopyH = H * 0.45
  const chimH = H - canopyH
  return (
    <group>
      <Box size={[W, canopyH, D]} pos={[0, canopyH / 2, 0]} color={color} roughness={0.3} metalness={0.3} />
      <Box size={[W * 0.92, 0.01, D * 0.86]} pos={[0, 0.006, 0]} color={shade(color, 0.7)} roughness={0.4} metalness={0.3} />
      <Box size={[W * 0.38, chimH, D * 0.5]} pos={[0, canopyH + chimH / 2, -D * 0.12]} color={shade(color, 0.96)} roughness={0.3} metalness={0.3} />
    </group>
  )
}

// ---------------------------------------------------------------------------

export function FurnitureModel({
  model,
  w,
  d,
  h,
  color,
  wallMounted = false,
  assetRef,
}: {
  model: ModelKind
  w: number
  d: number
  h: number
  color: string
  /** TV only: hung on a wall (no supporting console) → drop the floor pedestal. */
  wallMounted?: boolean
  assetRef?: FurnitureItem['assetRef']
}): JSX.Element {
  // Convert cm -> meters once; geometry is rebuilt whenever dims/color change.
  const content = useMemo(() => {
    const W = Math.max(0.01, w * CM)
    const D = Math.max(0.01, d * CM)
    const H = Math.max(0.01, h * CM)
    switch (model) {
      case 'sofa':
        return buildSofa(W, D, H, color)
      case 'sectional':
        return buildSectional(W, D, H, color)
      case 'bed':
        return buildBed(W, D, H, color)
      case 'table':
        return buildTable(W, D, H, color)
      case 'roundTable':
        return buildRoundTable(W, D, H, color)
      case 'chair':
        return buildChair(W, D, H, color)
      case 'officeChair':
        return buildOfficeChair(W, D, H, color)
      case 'cabinet':
        return buildCabinet(W, D, H, color)
      case 'openShelf':
        return buildOpenShelf(W, D, H, color)
      case 'rug':
        return buildRug(W, D, H, color)
      case 'lamp':
        return buildLamp(W, D, H, color)
      case 'plant':
        return buildPlant(W, D, H, color)
      case 'box':
        return buildBox(W, D, H, color)
      case 'tv':
        return buildTv(W, D, H, color, wallMounted)
      case 'desk':
        return buildDesk(W, D, H, color)
      case 'ottoman':
        return buildOttoman(W, D, H, color)
      case 'stool':
        return buildStool(W, D, H, color)
      case 'bench':
        return buildBench(W, D, H, color)
      case 'mirror':
        return buildMirror(W, D, H, color)
      case 'counter':
        return buildCounter(W, D, H, color)
      case 'toilet':
        return buildToilet(W, D, H, color)
      case 'shower':
        return buildShower(W, D, H, color)
      case 'vanity':
        return buildVanity(W, D, H, color)
      case 'bathtub':
        return buildBathtub(W, D, H, color)
      case 'tubFreestanding':
        return buildTubFreestanding(W, D, H, color)
      case 'jacuzzi':
        return buildJacuzzi(W, D, H, color)
      case 'island':
        return buildIsland(W, D, H, color)
      case 'stove':
        return buildStove(W, D, H, color)
      case 'fridge':
        return buildFridge(W, D, H, color)
      case 'rangeHood':
        return buildRangeHood(W, D, H, color)
      case 'washer':
        return buildWasher(W, D, H, color)
      case 'fan':
        return buildFan(W, D, H, color)
      case 'curtain':
        return buildCurtain(W, D, H, color)
      case 'ladderShelf':
        return buildLadderShelf(W, D, H, color)
      case 'ac':
        return buildAc(W, D, H, color)
      case 'staircase':
        return buildStaircase(W, D, H, color)
      case 'staircaseU':
        return buildStaircaseU(W, D, H, color)
      case 'mezzanine':
        return buildMezzanine(W, D, H, color)
      case 'chandelier':
        return buildChandelier(W, D, H, color)
      case 'jali':
        return buildJali(W, D, H, color)
      default:
        return buildBox(W, D, H, color)
    }
  }, [model, w, d, h, color, wallMounted])

  if (!assetRef) return <group>{content}</group>
  const resolved = resolveFurnitureAsset({ assetRef, w, d, h })
  if (!resolved.ok) {
    return <group>{content}<Html center position={[0, h * CM + 0.2, 0]}><span style={{ whiteSpace: 'nowrap', color: '#fff', background: '#7d3535', padding: '3px 7px', borderRadius: 4, fontSize: 11 }}>Model unavailable · illustrative substitute</span></Html></group>
  }
  return <FurnitureAsset3D asset={resolved.asset} fallback={<group>{content}</group>} />
}
