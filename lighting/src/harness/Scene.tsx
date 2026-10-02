// A faithful furnished-room harness (a "dollhouse cutaway": floor + back/left walls +
// furniture) to RUN and verify lighting + shadows, mirroring A's renderer setup. This is
// NOT app source — it stands in for A's <Room/> so the lighting library proves itself
// end-to-end before A mounts <LightingRig/> in the real scene.

import { Html } from '@react-three/drei'
import { LightingRig } from '../r3f/LightingRig'
import { Ceiling } from '../r3f/Ceiling'
import { useLighting } from '../store'

// Room: 4m (x) x 5m (z), 2.7m walls, centered on origin (matches coords.ts convention).
const RW = 4
const RD = 5
const WH = 2.7
const WT = 0.12 // wall thickness

function Box(props: {
  pos: [number, number, number]
  size: [number, number, number]
  color: string
}) {
  return (
    <mesh position={props.pos} castShadow receiveShadow>
      <boxGeometry args={props.size} />
      <meshStandardMaterial color={props.color} roughness={0.85} metalness={0} />
    </mesh>
  )
}

// Furniture defs: [x,y,z] center (m), [w,h,d] size (m), color.
const FURNITURE: { pos: [number, number, number]; size: [number, number, number]; color: string }[] = [
  { pos: [-1.0, 0.28, -1.4], size: [1.6, 0.55, 2.1], color: '#8a6f5a' }, // bed
  { pos: [1.3, 1.0, -2.1], size: [1.0, 2.0, 0.55], color: '#5d4b3a' }, // wardrobe
  { pos: [0.4, 0.37, 0.6], size: [1.2, 0.75, 0.8], color: '#7a5c43' }, // table
  { pos: [-1.1, 0.4, 1.4], size: [1.9, 0.8, 0.85], color: '#9a9388' }, // sofa
  { pos: [1.2, 0.23, 1.2], size: [0.4, 0.45, 0.4], color: '#b5793f' }, // stool
]

/** One furnished room's geometry, offset by [ox,oz] meters (for the multi-room layout). */
function RoomGeo({ ox = 0, oz = 0 }: { ox?: number; oz?: number }) {
  // In Light Mode all furniture is locked -> show a lock badge over each piece (demo of A's behavior).
  const lightMode = useLighting((s) => s.lightMode)
  return (
    <group position={[ox, 0, oz]}>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[RW, RD]} />
        <meshStandardMaterial color="#c9bda8" roughness={0.95} />
      </mesh>
      {/* back wall (-z) */}
      <mesh position={[0, WH / 2, -RD / 2]} castShadow receiveShadow>
        <boxGeometry args={[RW, WH, WT]} />
        <meshStandardMaterial color="#e7e2d8" roughness={1} />
      </mesh>
      {/* left wall (-x) */}
      <mesh position={[-RW / 2, WH / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WT, WH, RD]} />
        <meshStandardMaterial color="#ded8cc" roughness={1} />
      </mesh>
      {/* furniture — boxes sized in meters, all cast + receive shadow */}
      {FURNITURE.map((f, i) => (
        <group key={i}>
          <Box pos={f.pos} size={f.size} color={f.color} />
          {lightMode && (
            <Html position={[f.pos[0], f.pos[1] + f.size[1] / 2 + 0.25, f.pos[2]]} center distanceFactor={8}>
              <div
                className="furniture-lock-badge"
                style={{
                  background: 'rgba(20,22,26,0.85)',
                  color: '#ffd9a0',
                  borderRadius: 999,
                  padding: '2px 6px',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                🔒
              </div>
            </Html>
          )}
        </group>
      ))}
    </group>
  )
}

// Multi-room layout: room B sits to the +x of room A (matches a House footprint offset).
export const ROOM_B_OFFSET_X = RW + 0.2

// Rectangular room footprint in world meters (matches RoomGeo at the origin).
const RECT_CORNERS: [number, number][] = [
  [-RW / 2, -RD / 2],
  [RW / 2, -RD / 2],
  [RW / 2, RD / 2],
  [-RW / 2, RD / 2],
]

export function Scene({ multi = false, roof = false }: { multi?: boolean; roof?: boolean }) {
  // House half-extent must enclose ALL rooms or the sun's shadow frustum clips.
  const houseHalf = multi ? (ROOM_B_OFFSET_X + RW / 2 + RW / 2) / 2 : Math.max(RW, RD) / 2

  return (
    <>
      <LightingRig houseHalfExtentM={houseHalf} />
      <RoomGeo />
      {multi && <RoomGeo ox={ROOM_B_OFFSET_X} />}
      {roof && <Ceiling cornersWorld={RECT_CORNERS} heightM={WH} />}
    </>
  )
}
