import { useMemo } from 'react'
import * as THREE from 'three'
import { FLOOR_MAP } from '../data/materials'
import { getFloorTexture } from './textures'
import { architecturalMaps, offsetMaps, type SurfaceMaps } from './furnitureTextures'
import type { WallPart } from '../geometry/walls'

// World-metres one plaster tile covers on a painted wall (subtle roller stipple).
const PLASTER_M = 1.6

/**
 * Wall material for one wall part.
 *
 *  - PLAIN PAINT: a shared, cached plaster finish tinted by the wall colour —
 *    subtle roller-stipple normal + faint roughness variation so paint catches a
 *    grazing highlight instead of reading as a flat colour. ONE base map-set per
 *    colour is shared across every wall (and room); the part's world-space UV
 *    tiling/offset is a cheap sampler clone that reuses the base GPU upload.
 *
 *  - CLAD (a `wallTexture` floor-catalog id — e.g. the large-format marble tile
 *    cladding a builder-flat kitchen): the SAME cached architectural map-set the
 *    floor uses (albedo + normal + roughness), with continuity driven by a
 *    per-part UV offset — NOT a fresh `base.clone()` per part. All parts and all
 *    rooms reference the one shared source, so renderer.info.memory.textures is a
 *    function of the distinct finishes, never the wall-part or room count.
 */
export function WallSurfaceMaterial({
  wallColor,
  wallTexture,
  part,
}: {
  wallColor: string
  wallTexture?: string
  part: WallPart
}) {
  const clad = wallTexture ? FLOOR_MAP[wallTexture] : undefined

  const cladMaps = useMemo<SurfaceMaps | null>(() => {
    if (!clad) return null
    const built = getFloorTexture(clad.id)
    if (!built.normalMap || !built.roughnessMap || !built.normalScale) return null
    const base: SurfaceMaps = {
      map: built.texture,
      normalMap: built.normalMap,
      roughnessMap: built.roughnessMap,
      normalScale: built.normalScale,
    }
    const areaCm = built.areaCm
    return offsetMaps(
      `clad:${clad.id}`,
      base,
      part.lenU / areaCm,
      part.lenV / areaCm,
      (part.uCenter - part.lenU / 2) / areaCm,
      (part.vCenter - part.lenV / 2) / areaCm,
    )
  }, [clad, part.lenU, part.lenV, part.uCenter, part.vCenter])

  const paintMaps = useMemo<SurfaceMaps | null>(() => {
    if (clad) return null
    const base = architecturalMaps('plaster', { tint: wallColor, accent: wallColor, gloss: 0.05 })
    if (!base) return null
    return offsetMaps(
      `paint:${wallColor}`,
      base,
      part.lenU / 100 / PLASTER_M,
      part.lenV / 100 / PLASTER_M,
      (part.uCenter - part.lenU / 2) / 100 / PLASTER_M,
      (part.vCenter - part.lenV / 2) / 100 / PLASTER_M,
    )
  }, [clad, wallColor, part.lenU, part.lenV, part.uCenter, part.vCenter])

  if (clad) {
    if (!cladMaps) {
      return <meshStandardMaterial color={clad.base} roughness={clad.roughness ?? 0.6} metalness={0} side={THREE.FrontSide} />
    }
    return (
      <meshStandardMaterial
        map={cladMaps.map}
        normalMap={cladMaps.normalMap}
        normalScale={cladMaps.normalScale}
        roughnessMap={cladMaps.roughnessMap}
        roughness={1}
        metalness={0}
        side={THREE.FrontSide}
      />
    )
  }

  if (!paintMaps) {
    return <meshStandardMaterial color={wallColor} roughness={0.95} metalness={0} />
  }
  return (
    <meshStandardMaterial
      // albedo already carries the wall colour (tinted plaster); no extra tint.
      map={paintMaps.map}
      normalMap={paintMaps.normalMap}
      normalScale={paintMaps.normalScale}
      roughnessMap={paintMaps.roughnessMap}
      roughness={1}
      metalness={0}
    />
  )
}
