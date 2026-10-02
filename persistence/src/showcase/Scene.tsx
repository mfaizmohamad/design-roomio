/**
 * Self-contained 3D scene for the view-only showcase. Reconstructs a faithful
 * room from the decoded payload (floors, walls, furniture boxes) with pleasant
 * lighting — zero coupling to Agent A's renderer. A guided "walkthrough" flies a
 * camera through the room centres (reuses the waypoint-tour idea from Agent B's
 * flythrough, implemented locally); when not playing, the viewer can orbit/look
 * around. Read-only: there is no editing, selection, or store here.
 */
import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { WorldScene, WorldFloor, WorldWall, WorldBox } from '../render/worldGeometry'
import { buildWorldScene } from '../render/worldGeometry'
import type { House } from '../scene/slices'

function Floor({ floor }: { floor: WorldFloor }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    floor.polygon.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)))
    s.closePath()
    return s
  }, [floor])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial color={floor.color} side={THREE.DoubleSide} roughness={0.95} />
    </mesh>
  )
}

function Wall({ wall }: { wall: WorldWall }) {
  const dx = wall.b[0] - wall.a[0]
  const dz = wall.b[1] - wall.a[1]
  const len = Math.hypot(dx, dz)
  const mx = (wall.a[0] + wall.b[0]) / 2
  const mz = (wall.a[1] + wall.b[1]) / 2
  const rotY = Math.atan2(-dz, dx)
  return (
    <mesh position={[mx, wall.height / 2, mz]} rotation={[0, rotY, 0]} castShadow receiveShadow>
      <boxGeometry args={[len, wall.height, Math.max(0.04, wall.thickness)]} />
      {/* "glass dollhouse": semi-transparent walls so the room stays legible from
          any overview angle (full-height solid walls would occlude the furniture). */}
      <meshStandardMaterial color="#e7e3da" roughness={0.85} transparent opacity={0.28} depthWrite={false} />
    </mesh>
  )
}

function FurnitureBox({ box }: { box: WorldBox }) {
  return (
    <mesh position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
      <boxGeometry args={box.size} />
      <meshStandardMaterial color={box.color} roughness={0.7} metalness={0.05} />
    </mesh>
  )
}

function Lights({ radius }: { radius: number }) {
  const d = Math.max(8, radius * 2)
  return (
    <>
      <hemisphereLight args={['#ffffff', '#cfcbc2', 0.8]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[d * 0.6, d, d * 0.5]}
        intensity={1.25}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={d * 4}
        shadow-camera-left={-d}
        shadow-camera-right={d}
        shadow-camera-top={d}
        shadow-camera-bottom={-d}
        shadow-bias={-0.0004}
      />
    </>
  )
}

/** Animated guided walk through the room centres at eye height. */
function Walkthrough({ scene, playing, onEnd }: { scene: WorldScene; playing: boolean; onEnd: () => void }) {
  const { camera } = useThree()
  const t = useRef(0)
  const curve = useMemo(() => {
    const pts = scene.tour.map(([x, z]) => new THREE.Vector3(x, 1.5, z))
    // Pad to >=2 distinct points without dereferencing a possibly-empty array
    // (a malformed/empty payload can yield an empty tour — must never crash render).
    const base = pts[0] ?? new THREE.Vector3(0, 1.5, 0)
    while (pts.length < 2) pts.push(new THREE.Vector3(base.x + 0.01 * pts.length, 1.5, base.z + 0.01 * pts.length))
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  }, [scene])

  useFrame((_, delta) => {
    if (!playing) return
    t.current = Math.min(1, t.current + delta * 0.06)
    const p = curve.getPointAt(t.current)
    const ahead = curve.getPointAt(Math.min(1, t.current + 0.02))
    camera.position.set(p.x, p.y, p.z)
    camera.lookAt(ahead.x, 1.2, ahead.z)
    if (t.current >= 1) {
      t.current = 0
      onEnd()
    }
  })
  return null
}

export function ShowcaseScene({ house, playing, onTourEnd }: { house: House; playing: boolean; onTourEnd: () => void }) {
  const scene = useMemo(() => buildWorldScene(house), [house])
  const start = scene.radius * 1.6 + 2.5
  return (
    <Canvas
      shadows
      camera={{ position: [start, start * 1.05, start], fov: 45, near: 0.1, far: 1000 }}
      gl={{ preserveDrawingBuffer: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#cdccc9']} />
      <Lights radius={scene.radius} />
      {scene.floors.map((f, i) => (
        <Floor key={`f${i}`} floor={f} />
      ))}
      {scene.walls.map((w, i) => (
        <Wall key={`w${i}`} wall={w} />
      ))}
      {scene.boxes.map((b, i) => (
        <FurnitureBox key={`b${i}`} box={b} />
      ))}
      <OrbitControls enabled={!playing} makeDefault target={[0, 0.8, 0]} maxPolarAngle={Math.PI / 2.05} />
      <Walkthrough scene={scene} playing={playing} onEnd={onTourEnd} />
    </Canvas>
  )
}
