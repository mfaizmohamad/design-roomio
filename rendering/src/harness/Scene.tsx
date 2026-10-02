// Standalone furnished room for the realism harness (decoupled from A's real scene, per the
// island convention). 4m x 5m room, 2.7m walls, floor + back/left walls, a handful of furniture
// boxes with A-like MeshStandard materials, a chrome sphere (showcases IBL reflections), and an
// emissive table lamp + ceiling bulb (showcase emissive + bloom). Lit by E-like default lights
// (hemisphere + ambient fill, a directional sun, point "bulbs") so the RealismLayer is enhancing
// the same kind of lighting it will in the app.

import { useMemo } from 'react'
import * as THREE from 'three'
import { AreaLight } from '../r3f/AreaLight'

const RW = 4
const RD = 5
const WH = 2.7

// Procedural wood-plank floor texture (canvas → CanvasTexture), authored in sRGB — mirrors how A's
// real floor textures work. Verifies that a TEXTURED PBR material renders correctly under the realism
// stack (correct colour space, lit by IBL, tone-mapped without washout).
function makeFloorTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')!
  const planks = 6
  const ph = S / planks
  const tones = ['#b39069', '#a5825c', '#bd9a71', '#9c7852']
  for (let i = 0; i < planks; i++) {
    ctx.fillStyle = tones[i % tones.length]
    ctx.fillRect(0, i * ph, S, ph)
    // plank seam
    ctx.strokeStyle = 'rgba(60,40,20,0.55)'
    ctx.lineWidth = 2
    ctx.strokeRect(0, i * ph, S, ph)
    // grain streaks
    ctx.strokeStyle = 'rgba(90,65,40,0.25)'
    ctx.lineWidth = 1
    for (let g = 0; g < 5; g++) {
      const y = i * ph + ((g + 1) * ph) / 6
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(S, y + (g % 2 ? 3 : -3))
      ctx.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(RW / 1.2, RD / 1.2) // ~1.2 m per tile → physically-scaled planks
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

interface FurnProps {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  roughness?: number
  metalness?: number
  emissive?: string
  emissiveIntensity?: number
}

function Furn({ position, size, color, roughness = 0.7, metalness = 0, emissive, emissiveIntensity }: FurnProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        emissive={emissive ?? '#000000'}
        emissiveIntensity={emissiveIntensity ?? 0}
      />
    </mesh>
  )
}

export function HarnessScene({ lightsOn = true }: { lightsOn?: boolean }) {
  const floorTex = useMemo(() => makeFloorTexture(), [])
  return (
    <group>
      {/* floor — textured (procedural sRGB plank map) to verify textures render under the realism stack */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[RW, RD]} />
        <meshStandardMaterial map={floorTex} color="#ffffff" roughness={0.82} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* back wall (-z) */}
      <mesh position={[0, WH / 2, -RD / 2]} receiveShadow>
        <planeGeometry args={[RW, WH]} />
        <meshStandardMaterial color="#d8d2c6" roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {/* left wall (-x) */}
      <mesh position={[-RW / 2, WH / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[RD, WH]} />
        <meshStandardMaterial color="#d8d2c6" roughness={0.95} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {/* furniture (A-like materials: matte fabric, semi-gloss wood, brushed/polished metals) */}
      <Furn position={[-0.9, 0.3, -1.4]} size={[1.6, 0.6, 2.0]} color="#7d8a99" roughness={0.75} /> {/* bed */}
      <Furn position={[1.45, 1.0, -2.0]} size={[1.0, 2.0, 0.55]} color="#6b5640" roughness={0.6} metalness={0.1} /> {/* wardrobe */}
      <Furn position={[0.7, 0.35, 0.9]} size={[1.3, 0.7, 0.8]} color="#9a9488" roughness={0.6} /> {/* sofa */}
      <Furn position={[-0.4, 0.25, 1.25]} size={[0.95, 0.5, 0.55]} color="#caa15a" roughness={0.5} metalness={0.15} /> {/* table */}
      <Furn position={[1.5, 0.22, 1.5]} size={[0.4, 0.44, 0.4]} color="#3a3a3a" roughness={0.3} metalness={0.6} /> {/* metal stool */}

      {/* polished chrome sphere — the clearest IBL reflection showcase (dull in flat, mirror in realism) */}
      <mesh position={[0, 0.6, -0.1]} castShadow>
        <sphereGeometry args={[0.36, 48, 48]} />
        <meshStandardMaterial color="#cfd2d6" roughness={0.08} metalness={1.0} />
      </mesh>

      {/* table lamp: a coupled bulb — emissive shade (glow gated by MaterialEnhancer on `lightsOn`)
          + its point light (toggled by `lightsOn`). So turning the lights off removes the light AND
          the glow together (the "toggling a light changes light + glow" behaviour). */}
      <group position={[-1.45, 0, 1.7]}>
        <mesh position={[0, 0.18, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.5, 12]} />
          <meshStandardMaterial color="#8a7a55" roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.46, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.22, 0.28, 24]} />
          <meshStandardMaterial color="#f2dba0" emissive="#ffd98a" emissiveIntensity={0.45} roughness={0.7} metalness={0} />
        </mesh>
        {lightsOn && <pointLight position={[0, 0.5, 0]} color="#ffd98a" intensity={2.2} distance={0} decay={0} castShadow={false} />}
      </group>

      {/* a "window" on the back wall: an emissive pane (blooms into a bright window) + a RectAreaLight
          giving a soft, directional cool-daylight area fill — the realism stack's area-light layer.
          (App wiring of real window openings is a follow-on co-tune with E/A.) */}
      <mesh position={[1.0, 1.35, -RD / 2 + 0.03]}>
        <planeGeometry args={[1.4, 1.2]} />
        <meshStandardMaterial
          color="#eaf2ff"
          emissive="#cfe0ff"
          emissiveIntensity={0.5}
          roughness={1}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <AreaLight position={[1.0, 1.35, -RD / 2 + 0.1]} target={[0, 1.0, 0]} width={1.4} height={1.2} color="#cfe0ff" intensity={4} />

      {/* E-like default lights — the RealismLayer enhances these (it does NOT replace them). */}
      <hemisphereLight color="#ffffff" groundColor="#cfcbc2" intensity={0.85} />
      <ambientLight intensity={0.32} />
      <directionalLight
        position={[7, 13, 8]}
        intensity={1.35}
        color="#fff6e8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-8, 8, 8, -8, 0.5, 48]} />
      </directionalLight>

      {/* ceiling bulb: point light + a small emissive sphere fixture — also `lightsOn`-coupled */}
      {lightsOn && <pointLight position={[0, WH - 0.2, 0]} color="#fff1e0" intensity={1.4} distance={0} decay={0} castShadow={false} />}
      <mesh position={[0, WH - 0.12, 0]}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#fff1e0" emissiveIntensity={0.6} roughness={1} metalness={0} />
      </mesh>
    </group>
  )
}
