/**
 * Runtime loader for the OFFLINE-inferred per-listing finishes (Track B3).
 *
 * scripts/infer-listing-scene.mjs walks each photo'd listing's images and, using
 * classical CV only (no model, no network), emits a confidence-annotated finish
 * (a FLOOR_TEXTURES id + a wall hex) into ./inferredScenes.json — persisted +
 * committed so it survives the ~4-day CDN image expiry, and labelled an AI
 * approximation. This module is the ONLY consumer at runtime: it VALIDATES the
 * data (real texture id, well-formed hex) and CONFIDENCE-GATES each field, so a
 * malformed, missing, or low-confidence entry degrades to the generic template
 * rather than rendering something wrong. Geometry stays metadata-driven; this
 * only overlays finishes (see applyInferredFinish in ./flatTemplates.ts).
 *
 * Doing inference OFFLINE (never at runtime) keeps the app deterministic and
 * fast; this loader is pure data + a synchronous lookup.
 */
import rawDoc from './inferredScenes.json'
import { FLOOR_MAP } from './materials'
import type { InferredFinish } from './flatTemplates'

/** Minimum per-field confidence to apply an inferred finish; below → template. */
export const INFERENCE_CONFIDENCE_MIN = 0.5

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/**
 * Validate + confidence-gate ONE listing's raw inference record into an
 * `InferredFinish` (or null if nothing is usable). Pure and defensive — every
 * field is checked, so hand-written / corrupt / partial records can't inject a
 * bogus texture id or malformed colour. Exported so tests can exercise the gate
 * directly with synthetic records.
 */
export function resolveFinish(record: unknown, minConfidence: number = INFERENCE_CONFIDENCE_MIN): InferredFinish | null {
  if (!record || typeof record !== 'object') return null
  const rec = record as { floor?: unknown; wall?: unknown }
  const out: InferredFinish = {}

  if (rec.floor && typeof rec.floor === 'object') {
    const f = rec.floor as { textureId?: unknown; confidence?: unknown }
    if (typeof f.textureId === 'string' && FLOOR_MAP[f.textureId] && isNum(f.confidence) && f.confidence >= minConfidence) {
      out.floorTexture = f.textureId
    }
  }
  if (rec.wall && typeof rec.wall === 'object') {
    const w = rec.wall as { hex?: unknown; confidence?: unknown }
    if (typeof w.hex === 'string' && HEX_RE.test(w.hex) && isNum(w.confidence) && w.confidence >= minConfidence) {
      out.wallColor = w.hex.toLowerCase()
    }
  }
  return out.floorTexture || out.wallColor ? out : null
}

/** Build the validated, gated finish map once at module load. Tolerant of a
 *  missing/garbage document (→ empty map ⇒ every listing uses its template). */
function buildFinishes(doc: unknown): Record<string, InferredFinish> {
  const out: Record<string, InferredFinish> = {}
  if (!doc || typeof doc !== 'object') return out
  const listings = (doc as { listings?: unknown }).listings
  if (!listings || typeof listings !== 'object') return out
  for (const [id, rec] of Object.entries(listings as Record<string, unknown>)) {
    const finish = resolveFinish(rec)
    if (finish) out[id] = finish
  }
  return out
}

const FINISHES: Record<string, InferredFinish> = buildFinishes(rawDoc)

/** Validated, confidence-gated finish for a listing id, or null when there's no
 *  usable inference (no photos, low confidence, or absent) → template fallback. */
export function getInferredFinish(listingId: string): InferredFinish | null {
  return FINISHES[listingId] ?? null
}

/** Listing ids that have a usable inferred finish (for diagnostics/tests). */
export function inferredListingIds(): string[] {
  return Object.keys(FINISHES)
}
