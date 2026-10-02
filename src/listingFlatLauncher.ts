// Open a scraped listing in 3D: load its flat into the house session, show the
// whole-flat view, and set photo-like bright daylight (the listing photos are
// daytime real-estate shots — raking sun through the windows, lifted exposure).
// A listing with a hand-authored replica opens that exact photo-matched flat;
// any other listing opens a generic furnished flat inferred from its metadata.
// Shared by the Listings card button and the ?listing=<id> deep link.

import { useHouse } from './three/houseSession'
import { useHouseView } from './three/houseViewMode'
import { useLighting } from '../lighting/src/store'
import { useRender } from '../rendering/src/store'
import { hasListingFlat } from './data/listingFlats'
import type { FlatListing } from './data/listings'

export { hasListingFlat }

export function openListingFlat(listing: FlatListing): boolean {
  const ok = useHouse.getState().loadDynamicListing(listing)
  if (!ok) return false

  // Bright late-morning sun angled into the east-facing grille windows
  // (~10:30am, lower elevation → raking floor patches like the photos).
  const lighting = useLighting.getState()
  lighting.setTimeOfDay(0.35)
  lighting.setNorthOffset(115)
  lighting.setMaxElevation(45)

  // Real-estate exposure: brighter than the editor default, stronger IBL bounce.
  // Tuned for the Neutral (Khronos PBR-Neutral) tone curve — 1.1 keeps window
  // highlights just under clip where ACES @1.3 washed them out.
  const render = useRender.getState()
  render.setExposure(1.1)
  render.setEnvIntensity(0.8)

  // Land on the whole-flat overview (loadDynamicListing leaves stage = furnish).
  useHouseView.getState().setMode('house')
  return true
}
