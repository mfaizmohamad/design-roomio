// PUBLIC DEMO stand-in for src/data/inferredScenes.ts (swapped in by
// vite.demo.config.ts). The real module embeds inferredScenes.json, keyed by
// scraped Facebook post ids; see stubs/listingFlats.ts for why those stay out.
// Every lookup degrades to "no inference", which is the real module's own
// fallback for an unknown listing.
import type { InferredFinish } from '../../data/flatTemplates'

export const INFERENCE_CONFIDENCE_MIN = 0.5

export function resolveFinish(_record: unknown, _minConfidence: number = INFERENCE_CONFIDENCE_MIN): InferredFinish | null {
  return null
}

export function getInferredFinish(_listingId: string): InferredFinish | null {
  return null
}

export function inferredListingIds(): string[] {
  return []
}
