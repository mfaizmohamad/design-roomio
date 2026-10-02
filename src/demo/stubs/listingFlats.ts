// PUBLIC DEMO stand-in for src/data/listingFlats.ts (swapped in by
// vite.demo.config.ts). The real module holds replicas of scraped Facebook
// listings keyed by post id — a post id is enough to rebuild the permalink to a
// real person's post, so none of it may reach the public bundle. The demo never
// opens a listing, so an empty table is behaviour-preserving.
export type { ReplicaFurniture, ReplicaRoom, ReplicaShot, ListingFlat } from '../../data/listingFlats'
import type { ListingFlat } from '../../data/listingFlats'

export const LISTING_FLATS: Record<string, ListingFlat> = {}

export function hasListingFlat(_listingId: string): boolean {
  return false
}
