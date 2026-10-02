// WindowExterior (VIS-07) — a believable daytime outdoors seen through a glazed opening.
//
// Windows used to read as opaque milky/black voids: the tinted GlassPane sat over the flat
// scene background (#cdccc9) with nothing beyond it. This parks an UNLIT (meshBasic) sky→ground
// gradient plane just OUTSIDE the aperture, so a window reads as real glazing with a bright
// exterior beyond — in every mode (lamps on/off) and in the whole-house dollhouse, since it is
// rendered by OpeningMesh which BOTH the single-room view (Room.tsx) and the house view
// (HouseView.tsx) already use.
//
// Design:
//  - meshBasic + toneMapped=false → self-lit, always bright regardless of the room's lighting
//    (the outdoors is far brighter than the interior — the whole point of the "bright exterior").
//  - Static: no per-frame render (unlike a planar reflector / cube camera) — perf-safe.
//  - A child of the OpeningMesh group, so it inherits the same open-dollhouse cull as the frame;
//    only the wall's aperture reveals it (the opaque wall occludes the oversized overspill).
//  - Only mounted for windows (kind === 'window'); glass DOORS open onto a real adjacent
//    room/balcony, so they must NOT get a fake sky behind them.
import * as THREE from 'three'
import { getSkyBackdropTexture } from './envTextures'

export function WindowExterior({
  width,
  height,
  offY,
  z,
  flip,
}: {
  /** backdrop width (world m) — capped to the wall length by the caller so it can't overhang ends */
  width: number
  /** backdrop height (world m) — the caller sizes it to span floor→ceiling WITHIN the wall, so it
   *  never pokes above the wall top at high (dollhouse) camera angles */
  height: number
  /** local-y offset that centres the backdrop on the wall (aperture-relative) */
  offY: number
  /** local-z of the backdrop — the OUTWARD side of the wall, a touch beyond the face */
  z: number
  /** rotate 180° so the plane's front face always points at the room interior (see below) */
  flip: boolean
}): JSX.Element {
  // FrontSide only, facing the room interior: from inside (or through a far wall in the dollhouse)
  // the sky is visible; from the exterior side the plane is back-face-culled, so at grazing angles
  // it can NEVER read as a floating panel sticking out past an edge-on wall.
  return (
    <mesh position={[0, offY, z]} rotation={[0, flip ? Math.PI : 0, 0]} renderOrder={-1}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={getSkyBackdropTexture()}
        toneMapped={false}
        fog={false}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}
