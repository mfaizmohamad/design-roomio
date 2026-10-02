import type { FurnitureItem } from '../types'

export interface FurnitureAssetVersion {
  id: string
  url: string
  sha256: string
  sourceUrl: string
  license: string
  attribution: string
  /** Mesh bounds after source transforms, in centimetres. These are not product measurements. */
  boundsCm: { w: number; d: number; h: number }
  sourceBoundsM: { min: [number, number, number]; max: [number, number, number] }
  front: '+z'
  status: 'illustrative' | 'approved'
  bytes: number
  triangles: number
}

// Every runtime URL is selected from this allowlist. A saved document may pin a
// version ID, but cannot make the browser fetch arbitrary third-party resources.
export const FURNITURE_ASSETS: Record<string, FurnitureAssetVersion> = {
  'sample-damask-chair-v1': {
    id: 'sample-damask-chair-v1',
    url: '/assets/furniture/chair-damask-purplegold-v1.glb',
    sha256: '9862ff753f25ca6738bf5924afbfde01b794fae73db3f94bcd8cdc7cc570d9bb',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ChairDamaskPurplegold',
    license: 'CC-BY-4.0',
    attribution: 'Chair Damask Purplegold © 2021 Wayfair, LLC; Eric Chadwick (model and textures)',
    boundsCm: { w: 82.8614, d: 57.183, h: 68.7355 },
    sourceBoundsM: {
      min: [-0.415071, -0.0004074, -0.2772534],
      max: [0.4135433, 0.6869473, 0.2945763],
    },
    front: '+z',
    status: 'illustrative',
    bytes: 2028924,
    triangles: 9984,
  },
}

/** Registers only asset URLs from one validated published release. */
export const registerReleaseAssets = (releaseId: string, assets: Array<{
  versionId: string; url: string; sha256: string;
  measuredCm: { w: number; d: number; h: number }
}>): boolean => {
  const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!idPattern.test(releaseId) || assets.length > 100) return false
  for (const asset of assets) {
    if (!asset || !idPattern.test(asset.versionId) ||
        asset.url !== `/api/releases/${releaseId}/assets/${asset.versionId}` ||
        !/^[0-9a-f]{64}$/.test(asset.sha256) ||
        !asset.measuredCm ||
        ![asset.measuredCm.w, asset.measuredCm.d, asset.measuredCm.h]
          .every((n) => Number.isFinite(n) && n > 0 && n <= 2000)) return false
  }
  for (const asset of assets) {
    FURNITURE_ASSETS[asset.versionId] = {
      id: asset.versionId, url: asset.url, sha256: asset.sha256,
      sourceUrl: '', license: 'Reviewed project license', attribution: '',
      boundsCm: asset.measuredCm,
      sourceBoundsM: { min: [0, 0, 0], max: [0, 0, 0] },
      front: '+z', status: 'approved', bytes: 0, triangles: 0,
    }
  }
  return true
}

export type AssetResolution =
  | { ok: true; asset: FurnitureAssetVersion }
  | { ok: false; reason: 'unknown-version' | 'dimensions-mismatch' }

/** Resolves a pinned version and refuses a geometry/collider dimension mismatch. */
export const resolveFurnitureAsset = (item: Pick<FurnitureItem, 'assetRef' | 'w' | 'd' | 'h'>): AssetResolution => {
  const asset = item.assetRef && FURNITURE_ASSETS[item.assetRef.assetVersionId]
  if (!asset) return { ok: false, reason: 'unknown-version' }
  const within = (actual: number, expected: number) =>
    Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(2, expected * 0.01)
  if (!within(item.w, asset.boundsCm.w) || !within(item.d, asset.boundsCm.d) || !within(item.h, asset.boundsCm.h)) {
    return { ok: false, reason: 'dimensions-mismatch' }
  }
  return { ok: true, asset }
}
