import { useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import type { Wall } from '../types'
import type { Frame } from './coords'

const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

/** Returns a fn that raycasts a client pointer position to the floor plane (y=0). */
export function useFloorRay() {
  const { camera, gl } = useThree()
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  return (clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
    ray.setFromCamera(ndc, camera)
    const hit = new THREE.Vector3()
    return ray.ray.intersectPlane(FLOOR_PLANE, hit) ? hit : null
  }
}

/** Disable/enable OrbitControls during a drag (via the R3F default controls). */
export function useControlsToggle() {
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | undefined
  return (enabled: boolean) => {
    if (controls) controls.enabled = enabled
  }
}

/** Project a world point onto a wall, returning the parametric t (clamped to interior). */
export function pointToWallT(point: THREE.Vector3, wall: Wall, frame: Frame): number {
  const [ax, az] = frame.toWorld(wall.a.x, wall.a.z)
  const uM = (point.x - ax) * wall.dirX + (point.z - az) * wall.dirZ
  const t = uM / (wall.length / 100)
  return Math.min(0.97, Math.max(0.03, t))
}
