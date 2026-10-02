// Diagnostic probe: renders A's REAL furniture geometry (via the exported FurnitureModel) under the
// realism lighting, for visually verifying NEW furniture (e.g. the washing machine) alongside peers.
// Reached via ?probe=furniture in the harness.

import * as THREE from 'three'
import { FurnitureModel } from '../../../src/three/Furniture3D'
import type { ModelKind } from '../../../src/data/archetypes'

interface Piece { model: ModelKind; w: number; d: number; h: number; color: string; x: number }

const PIECES: Piece[] = [
  { model: 'washer', w: 60, d: 60, h: 85, color: '#eef0f2', x: -1.6 }, // the new washing machine
  { model: 'fridge', w: 91, d: 74, h: 178, color: '#cfd3d6', x: 0.0 },
  { model: 'stove', w: 76, d: 66, h: 92, color: '#c9ccce', x: 1.5 },
]

export function FurnitureProbe() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 5]} />
        <meshStandardMaterial color="#b9a98f" roughness={0.85} metalness={0} side={THREE.DoubleSide} />
      </mesh>
      {PIECES.map((p) => (
        <group key={p.model} position={[p.x, 0, 0]}>
          <FurnitureModel model={p.model} w={p.w} d={p.d} h={p.h} color={p.color} />
        </group>
      ))}
      <hemisphereLight color="#ffffff" groundColor="#cfcbc2" intensity={0.85} />
      <ambientLight intensity={0.32} />
      <directionalLight
        position={[6, 12, 8]}
        intensity={1.35}
        color="#fff6e8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.5, 40]} />
      </directionalLight>
    </group>
  )
}
