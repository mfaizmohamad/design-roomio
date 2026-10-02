// The sun: ONE THREE.DirectionalLight, aimed position->target(origin), driven by the
// time bar + north offset. Primary (ideally only) shadow caster. Orthographic shadow
// frustum sized to enclose the whole house, or shadows clip.

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useLighting } from '../store'
import { sampleSun } from '../sun'

export interface SunProps {
  /** half-extent of the house in meters (max(halfWidth, halfDepth)); frustum is sized to enclose it. */
  houseHalfExtentM: number
  /** renderer-tuned base intensity at noon (legacy units; matches A's ~1.35). */
  baseIntensity?: number
  /** extra meters of margin around the house for the shadow frustum. */
  marginM?: number
}

export function Sun({ houseHalfExtentM, baseIntensity = 1.35, marginM = 3 }: SunProps) {
  const ref = useRef<THREE.DirectionalLight>(null)
  const timeOfDay = useLighting((s) => s.timeOfDay)
  const northOffsetDeg = useLighting((s) => s.northOffsetDeg)
  const sun = useLighting((s) => s.sun)
  const shadow = useLighting((s) => s.shadow)
  const lightMode = useLighting((s) => s.lightMode)

  const half = (shadow.halfExtentM ?? houseHalfExtentM) + marginM
  // far must enclose the sun (on the dome) -> house, plus the frustum depth.
  const far = sun.domeRadiusM + half * 2 + 5

  const sample = useMemo(
    () =>
      sampleSun(timeOfDay, {
        maxElevationDeg: sun.maxElevationDeg,
        northOffsetDeg,
        domeRadiusM: sun.domeRadiusM,
        warmthShift: sun.warmthShift,
      }),
    [timeOfDay, northOffsetDeg, sun.maxElevationDeg, sun.domeRadiusM, sun.warmthShift],
  )

  // The orthographic shadow camera needs an explicit projection update when bounds change.
  useEffect(() => {
    const light = ref.current
    if (!light) return
    const cam = light.shadow.camera as THREE.OrthographicCamera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 0.5
    cam.far = far
    cam.updateProjectionMatrix()
    light.shadow.bias = shadow.bias
    light.shadow.normalBias = shadow.normalBias
    light.shadow.needsUpdate = true
  }, [half, far, shadow.bias, shadow.normalBias])

  if (!sun.enabled || sample.belowHorizon) return null

  const intensity = baseIntensity * sample.intensityFactor * sun.intensityScale

  // Visible sun body, co-located along the sun ray so it reads as the actual light source
  // (a DirectionalLight is infinitely far, so any point on the ray gives identical lighting).
  // Placed at a comfortable viewing distance + scaled so it's on-screen at room scale.
  const len = Math.hypot(...sample.position) || 1
  const vizDist = Math.min(Math.max(houseHalfExtentM * 3, 10), 18)
  const gizmoPos: [number, number, number] = [
    (sample.position[0] / len) * vizDist,
    (sample.position[1] / len) * vizDist,
    (sample.position[2] / len) * vizDist,
  ]
  const sunSize = vizDist * 0.075

  return (
    <>
      <directionalLight
        ref={ref}
        position={sample.position}
        intensity={intensity}
        color={sample.color}
        castShadow
        shadow-mapSize-width={shadow.mapSize}
        shadow-mapSize-height={shadow.mapSize}
      />
      {/* Visible sun body — only shown in Light Mode (it's a lighting-visualization aid).
          Moves along its arc as the time bar is scrubbed. */}
      {lightMode && (
        <group position={gizmoPos}>
          {/* bright core (unlit so it always glows) */}
          <mesh>
            <sphereGeometry args={[sunSize, 24, 24]} />
            <meshBasicMaterial color={sample.color} toneMapped={false} />
          </mesh>
          {/* soft halo */}
          <mesh>
            <sphereGeometry args={[sunSize * 2.4, 24, 24]} />
            <meshBasicMaterial
              color={sample.color}
              transparent
              opacity={0.16 + 0.14 * sample.intensityFactor}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}
    </>
  )
}
