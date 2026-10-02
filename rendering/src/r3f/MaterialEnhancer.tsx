// Runtime PBR material enhancer — a drop-in that upgrades the LOOK of existing
// MeshStandardMaterials WITHOUT editing A's source (Furniture3D/Room author them already).
//
// Two cheap, recompile-free uniform tweaks (no material.needsUpdate, no shader rebuild):
//   1) envMapIntensity — scene.environment (IBL) auto-applies as the envMap to every standard
//      material; we only scale how strongly each receives it (per-material, default 1.0; the
//      global dial is scene.environmentIntensity in IBL.tsx).
//   2) emissiveIntensity boost — A authors lamp shades (~0.45) and TV screens (~0.35) with a low
//      emissive glow. Bloom is SELECTIVE by HDR luminance (threshold ~1.0 in the HalfFloat buffer),
//      so we lift authored emissive ABOVE 1.0 (×EMISSIVE_BOOST), proportional to A's value (lamp
//      ends up brighter than the TV), making bulbs/screens actually glow. Idempotent via userData
//      (original value stashed once, always recomputed from it).
//
// Re-runs on a light throttle so furniture added/edited at runtime (A's editor) gets upgraded too.
// Skips non-standard materials (E's meshBasic sun gizmo / ceiling discs are left untouched).

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useRender } from '../store'

const EMISSIVE_BOOST = 8

interface RoomioMatData {
  __roomioBaseEmissive?: number
  /** Tagged by WindowDaylight on the emissive "sky" pane so the lights-off gate NEVER zeroes it —
   *  the window is the daylight source when the lamps are off, so it must keep glowing. */
  __roomioWindow?: boolean
  /** Opt-out of IBL: dark clad surfaces (a stained-wood balcony ceiling) get washed grey by the
   *  bright procedural environment's irradiance — tag them to keep envMapIntensity at 0. */
  __roomioNoEnv?: boolean
}

/** Walk up the object tree to find the owning lamp's furniture id (tagged by FurnitureGizmo). */
function findLampId(obj: THREE.Object3D | null): string | undefined {
  for (let o = obj; o; o = o.parent) {
    const id = (o.userData as { __roomioLampId?: string }).__roomioLampId
    if (id) return id
  }
  return undefined
}

function enhanceScene(
  scene: THREE.Object3D,
  envMapIntensity: number,
  lightsOn: boolean,
  lampOff: Record<string, boolean>,
) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (!mat) return
    const mats = Array.isArray(mat) ? mat : [mat]
    // Which lamp (if any) owns this mesh — so its emissive shade can be gated per-lamp.
    let lampId: string | undefined
    let lampResolved = false
    for (const m of mats) {
      const sm = m as THREE.MeshStandardMaterial
      if (!sm.isMeshStandardMaterial) continue

      const ud = sm.userData as RoomioMatData

      // (1) scale IBL contribution (uniform set — no recompile); tagged materials opt out
      sm.envMapIntensity = ud.__roomioNoEnv ? 0 : envMapIntensity

      // Window "sky" panes are DYNAMICALLY authored by WindowDaylight — its emissiveIntensity already
      // tracks the sun's elevation (time of day) and this window's facing angle. Leave it EXACTLY as
      // authored: do NOT stash/boost/gate it. (The old ×8 stash froze the glass at its first-frame
      // brightness, so a dusk or shaded window stayed blazing.) envMapIntensity was already set above.
      if (ud.__roomioWindow) continue

      // (2) lift authored emissive into the HDR bloom range, proportional to its authored value,
      //     and GATE it. A lamp's shade glow is gated on THIS lamp (lightsOn && !lampOff[id]) so
      //     each lamp switches off independently; other bulbs (TV, etc.) follow the master lightsOn.
      const isBulb =
        ud.__roomioBaseEmissive !== undefined ||
        (!!sm.emissive && sm.emissive.r + sm.emissive.g + sm.emissive.b > 0.01 && sm.emissiveIntensity > 0)
      if (isBulb) {
        if (ud.__roomioBaseEmissive === undefined) ud.__roomioBaseEmissive = sm.emissiveIntensity
        if (!lampResolved) {
          lampId = findLampId(obj)
          lampResolved = true
        }
        const lit = lampId ? lightsOn && !lampOff[lampId] : lightsOn
        sm.emissiveIntensity = lit ? ud.__roomioBaseEmissive * EMISSIVE_BOOST : 0
      }
    }
  })
}

export function MaterialEnhancer() {
  const scene = useThree((s) => s.scene)
  const envMapIntensity = useRender((s) => s.settings.materials.envMapIntensity)
  const lightsOn = useRender((s) => s.lightsOn)
  const lampOff = useRender((s) => s.lampOff)
  const frame = useRef(0)

  // Immediate apply on mount + whenever the intensity dial, master toggle, or a per-lamp toggle changes.
  useEffect(() => {
    enhanceScene(scene, envMapIntensity, lightsOn, lampOff)
  }, [scene, envMapIntensity, lightsOn, lampOff])

  // Catch dynamically added/edited furniture without per-frame cost.
  useFrame(() => {
    frame.current += 1
    if (frame.current % 24 === 0) enhanceScene(scene, envMapIntensity, lightsOn, lampOff)
  })

  return null
}
