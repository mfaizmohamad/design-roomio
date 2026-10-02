// AreaLight — a RectAreaLight with declarative aiming. Soft, realistic falloff from a window- or
// panel-shaped source — far more natural for interiors than a point light. RectAreaLight has no
// `target` object, so we aim it with lookAt via a ref.
//
// CONSTRAINTS (three.js): only lights MeshStandard/MeshPhysical materials (✓ Roomio's), casts NO
// shadow (the sun stays the shadow caster), and needs RectAreaLightUniformsLib.init() once before it
// renders — done in <RealismLayer>. Use for windows / ceiling LED panels / under-cabinet fills.
// App wiring of window rects (from RoomDesign.openings / E's window helpers) is a follow-on co-tune.

import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'

export interface AreaLightProps {
  position: [number, number, number]
  /** world-space point the panel faces (it illuminates the side it faces). */
  target?: [number, number, number]
  width?: number
  height?: number
  color?: string
  intensity?: number
}

export function AreaLight({
  position,
  target = [0, 0, 0],
  width = 1,
  height = 1,
  color = '#ffffff',
  intensity = 3,
}: AreaLightProps) {
  const ref = useRef<THREE.RectAreaLight>(null)
  useLayoutEffect(() => {
    ref.current?.lookAt(target[0], target[1], target[2])
  }, [target])
  return (
    <rectAreaLight
      ref={ref}
      position={position}
      width={width}
      height={height}
      color={color}
      intensity={intensity}
    />
  )
}
