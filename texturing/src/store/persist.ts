/**
 * Agent H — persistence assembly (H5 / brief §5, T-9). Turns the composed map images into an
 * AppliedTexture (the additive FurnitureItem.texture field) by storing the bytes in the
 * content-addressed asset store and keeping only sha256 REFERENCES on the design. The image
 * encoder is INJECTED (browser: canvas.toDataURL PNG; node/tests: a deterministic stub) so
 * this module stays pure and node-testable.
 */
import { type RGBAImage } from '../pipeline/image'
import { type ComposedTexture } from '../pipeline/compose'
import { AssetStore } from './assetStore'
import {
  type AppliedTexture,
  type AssetRef,
  type Slot,
  type Tiling,
  DEFAULT_TILING,
  DEFAULT_COLOR_SPACE,
} from '../contract'

/** Encode an RGBAImage to a storable string (a data-URL in the browser). */
export type ImageEncoder = (img: RGBAImage) => string

export interface BuildAppliedOptions {
  slot: Slot
  archetypeId: string
  tiling?: Tiling
  detectedAt?: number
}

/** Store the maps + source crop, return an AppliedTexture (references only — no bytes). */
export async function buildAppliedTexture(
  composed: ComposedTexture,
  store: AssetStore,
  encode: ImageEncoder,
  opts: BuildAppliedOptions,
): Promise<AppliedTexture> {
  const [albedo, roughness, normal, asset_id] = await Promise.all([
    store.put(encode(composed.albedo)),
    store.put(encode(composed.roughness)),
    store.put(encode(composed.normal)),
    store.put(encode(composed.crop)),
  ])
  return {
    asset_id,
    slot: opts.slot,
    maps: { albedo, roughness, normal },
    tiling: opts.tiling ?? { ...DEFAULT_TILING },
    color_space: { ...DEFAULT_COLOR_SPACE },
    source: { kind: 'photo', archetype_id: opts.archetypeId, detected_at: opts.detectedAt ?? 0 },
    status: 'ok',
  }
}

export interface ResolvedMaps {
  albedo: string | null
  roughness: string | null
  normal: string | null
}

/** Resolve an AppliedTexture's map refs back to stored strings (to re-apply after a reload). */
export async function resolveMaps(tex: AppliedTexture, store: AssetStore): Promise<ResolvedMaps> {
  const [albedo, roughness, normal] = await Promise.all([
    store.get(tex.maps.albedo),
    store.get(tex.maps.roughness),
    store.get(tex.maps.normal),
  ])
  return { albedo, roughness, normal }
}

/** All asset refs an AppliedTexture points at (for the GC keep-set). */
export function refsOf(tex: AppliedTexture): AssetRef[] {
  const r = [tex.asset_id, tex.maps.albedo, tex.maps.roughness, tex.maps.normal]
  if (tex.maps.metalness) r.push(tex.maps.metalness)
  return r
}
