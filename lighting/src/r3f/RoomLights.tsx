// Renders one room's layered Light[] as R3F primitives. Ambient/hemisphere are
// scene-wide fills (rendered once at rig level); here we render the positioned
// task/accent lights. Room lights default to NON-shadow-casting (sun is the caster).

import * as THREE from 'three'
import { useRef, useEffect } from 'react'
import type { Light } from '../types'

function PositionedLight({ light }: { light: Light }) {
  const targetRef = useRef<THREE.Object3D>(null)
  const spotRef = useRef<THREE.SpotLight>(null)

  // Spot/wall_wash need their target in the scene graph to aim.
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current
    }
  }, [])

  if (light.enabled === false || light.intensity <= 0) return null
  const pos = light.pos ?? [0, 2.5, 0]

  if (light.type === 'spot' || light.type === 'wall_wash') {
    const tgt = light.target ?? [pos[0], 0, pos[2]]
    return (
      <>
        <spotLight
          ref={spotRef}
          position={pos}
          color={light.color}
          intensity={light.intensity}
          angle={light.type === 'wall_wash' ? 0.9 : 0.6}
          penumbra={0.7}
          distance={0}
          castShadow={!!light.castShadow}
        />
        <object3D ref={targetRef} position={tgt} />
      </>
    )
  }

  // ceiling / pendant / desk / floor / point -> point light (soft, no distance falloff cap)
  return (
    <pointLight
      position={pos}
      color={light.color}
      intensity={light.intensity}
      distance={0}
      decay={0}
      castShadow={!!light.castShadow}
    />
  )
}

export function RoomLights({ lights }: { lights: Light[] }) {
  return (
    <>
      {lights
        .filter((l) => l.layer !== 'ambient')
        .map((l) => (
          <PositionedLight key={l.id} light={l} />
        ))}
    </>
  )
}
