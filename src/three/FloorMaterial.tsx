import * as THREE from 'three'
import { MeshReflectorMaterial } from '@react-three/drei'
import { FLOOR_MAP } from '../data/materials'
import { getFloorTexture } from './textures'

/**
 * Floor surface material driven by the FloorTexture def (data, not hardcoded):
 *  - a full PBR map-set {albedo, +Y normal, spatially-varying roughness} from
 *    the finish's SurfaceKind (marble veins / tile grout / wood grain) so the
 *    floor reads as real material at grazing angle, not a flat colour;
 *  - `material.roughness = 1` so the roughnessMap fully drives gloss (polished
 *    field vs rougher grout), mirroring the pbr contract;
 *  - `reflect` > 0 swaps in drei's MeshReflectorMaterial for real planar
 *    reflections (the glossy vitrified-marble look of builder flats), still fed
 *    the same normal/roughness maps.
 * Used by BOTH render sites (single-room Room.tsx and whole-house HouseView.tsx)
 * so the two views never diverge. `texture` is the albedo (same cached object
 * getFloorTexture returns); normal/roughness are re-read from the id here so the
 * geometry sites don't need to thread the extra maps.
 *
 * PERF INVARIANT — "max 1 floor reflection regardless of room count": each
 * MeshReflectorMaterial renders the WHOLE scene an extra time per frame (a
 * planar-reflection pass), and it has no cost cap of its own — a 5-room glossy
 * flat used to run 5 full reflection passes. The single-room view has one floor
 * (one pass, fine); the whole-house view (HouseView) grants a true planar pass to
 * ONLY the dominant glossy floor (`reflector`) and caps every other glossy floor
 * to the IBL-env path below, so the flat renders AT MOST ONE planar reflection no
 * matter how many rooms it has — mirroring the lighting rig's 1-shadow-caster rule.
 */
export function FloorSurfaceMaterial({
  floorId,
  texture,
  reflector = true,
}: {
  floorId: string
  texture: THREE.Texture
  /**
   * May THIS floor own a true planar reflection pass? Single-room callers leave it
   * true (one floor → one pass). HouseView passes true for only the dominant glossy
   * floor and false for the rest. A glossy floor with `reflector=false` still reads
   * glossy — it falls back to PMREM'd IBL env reflection instead of its own pass.
   */
  reflector?: boolean
}) {
  // Use only a small constant depth offset in both paths below. A slope-scaled
  // bias pushed the floor in front of raised rugs in the wide house overview.
  const def = FLOOR_MAP[floorId]
  const { normalMap, roughnessMap, normalScale } = getFloorTexture(floorId)
  // roughnessMap present → let the MAP drive roughness (material.roughness = 1);
  // otherwise fall back to the def's scalar (SSR / degraded path).
  const roughness = roughnessMap ? 1 : def?.roughness ?? 0.82
  const glossy = !!def?.reflect
  if (glossy && reflector) {
    return (
      <MeshReflectorMaterial
        name="roomio-floor"
        // Upstairs floors share their plane with the lower storey's wall caps
        // and cornice tops. Give the finished floor depth priority so white
        // sawtooth stripes cannot flicker through the wood/marble on orbit.
        polygonOffset
        polygonOffsetFactor={0}
        polygonOffsetUnits={-2}
        map={texture}
        normalMap={normalMap ?? undefined}
        normalScale={normalScale ?? undefined}
        roughnessMap={roughnessMap ?? undefined}
        // 512 (was 1024): the reflection RT is re-rendered every frame; halving the
        // side is a 4× cut in reflection-pass fill with no visible loss on a floor.
        resolution={512}
        blur={[320, 90]}
        mixBlur={0.65}
        mixStrength={def.reflect}
        mirror={0.45}
        depthScale={0.6}
        minDepthThreshold={0.4}
        maxDepthThreshold={1.6}
        roughness={roughness}
        metalness={0.02}
        side={THREE.DoubleSide}
      />
    )
  }
  // Non-planar path. A glossy floor whose planar pass was capped away (whole-house
  // cap) keeps reading glossy through the PMREM'd IBL env map: bias the roughness
  // glossier and add a faint metalness + envMapIntensity so the environment shows in
  // the surface instead of a flat matte colour.
  const capped = glossy && !reflector
  return (
    <meshStandardMaterial
      name="roomio-floor"
      polygonOffset
      polygonOffsetFactor={0}
      polygonOffsetUnits={-2}
      map={texture}
      normalMap={normalMap ?? undefined}
      normalScale={normalScale ?? undefined}
      roughnessMap={roughnessMap ?? undefined}
      roughness={capped ? (roughnessMap ? 0.6 : Math.min(roughness, 0.3)) : roughness}
      metalness={capped ? 0.12 : 0}
      envMapIntensity={capped ? 1.25 : 1}
      side={THREE.DoubleSide}
    />
  )
}
