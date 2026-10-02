import { registerReleaseAssets } from '../assets/furniture'
import { coerceDesign, type SavedDesign } from '../persistence'

export interface PublishedManifest {
  id: string
  version: 1
  projectId: string
  homeId: string
  homeRevision: number
  home: SavedDesign
  claims: Array<{ id: string; label: string; value: string }>
  assets: Array<{ versionId: string; url: string; sha256: string;
    measuredCm: { w: number; d: number; h: number } }>
}

export const releaseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Null means the public response is malformed; the viewer never opens a partial house. */
export const coercePublishedManifest = (value: unknown, releaseId: string): PublishedManifest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.id !== releaseId || raw.version !== 1 ||
      typeof raw.projectId !== 'string' || !releaseIdPattern.test(raw.projectId) ||
      typeof raw.homeId !== 'string' || !releaseIdPattern.test(raw.homeId) ||
      typeof raw.homeRevision !== 'number' || !Number.isSafeInteger(raw.homeRevision) ||
      !Array.isArray(raw.claims) || raw.claims.length > 100 ||
      !raw.claims.every((c) => c && typeof c === 'object' &&
        typeof c.id === 'string' && typeof c.label === 'string' && typeof c.value === 'string') ||
      !Array.isArray(raw.assets)) return null
  const home = coerceDesign(raw.home)
  if (!home?.house || !registerReleaseAssets(releaseId, raw.assets)) return null
  return { id: releaseId, version: 1, projectId: raw.projectId, homeId: raw.homeId,
    homeRevision: raw.homeRevision, home, claims: raw.claims, assets: raw.assets }
}
