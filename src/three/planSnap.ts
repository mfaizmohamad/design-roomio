// planSnap — pure, DOM-free snapping math for the 2D plan arranger (PlanArranger.tsx).
//
// Industry-standard magnetic snapping (Figma / tldraw / Konva model): while a room rectangle is
// dragged, compare its edges + center against every OTHER room's edges + center on each axis
// independently, and snap to the closest match within a threshold. Comparing ALL of the moving
// rect's lines (left/center/right) against ALL of a neighbour's lines naturally covers both
// edge-alignment (left↔left) AND flush adjacency (moving.right↔neighbour.left) — which is exactly
// how rooms "click together" sharing a wall so layoutHouse can auto-cut a doorway between them.
//
// Everything is in house-plane CENTIMETERS (the same space as useHouse room `pos` / layoutHouse
// centerCm). No overlap resolution here — the store's moveRoom owns the touch-never-overlap
// invariant; snapping is purely a UX hint applied before commit.

/** A room footprint: (x,z) is the bbox CENTER, (w,d) the full width/depth — all cm. */
export interface SnapRect {
  x: number
  z: number
  w: number
  d: number
}

/** An engaged alignment guide to draw: a line at `at` along `axis` ('x' ⇒ vertical, 'z' ⇒ horizontal). */
export interface SnapGuide {
  axis: 'x' | 'z'
  at: number
}

export interface SnapOptions {
  /** snap radius in cm (convert from ~8 screen px ÷ px-per-cm at call time). */
  thresholdCm: number
  /** optional grid quantization in cm (e.g. 10). Omit/0 to disable grid snap. */
  gridCm?: number
  /** true ⇒ bypass all snapping (e.g. the user holds Alt for free placement). */
  disable?: boolean
}

/** Build a SnapRect from a center + size (cm). */
export function rectFromCenter(center: { x: number; z: number }, size: { w: number; d: number }): SnapRect {
  return { x: center.x, z: center.z, w: size.w, d: size.d }
}

/**
 * Snap a proposed room center to nearby room edges/centers and (optionally) a grid.
 * Returns the nudged center plus the guides that engaged (for drawing alignment lines).
 * Each axis is resolved independently, so a room can snap its left edge to one neighbour
 * while its center aligns to another.
 */
export function applySnaps(
  center: { x: number; z: number },
  size: { w: number; d: number },
  others: SnapRect[],
  opts: SnapOptions,
): { x: number; z: number; guides: SnapGuide[] } {
  if (opts.disable) return { x: center.x, z: center.z, guides: [] }

  let outX = center.x
  let outZ = center.z
  const guides: SnapGuide[] = []

  for (const axis of ['x', 'z'] as const) {
    const c = axis === 'x' ? center.x : center.z
    const half = (axis === 'x' ? size.w : size.d) / 2
    // The dragged rect's three "interesting" lines on this axis: start edge, center, end edge.
    const movingLines = [c - half, c, c + half]

    // Candidate target coordinates: every other room's start/center/end on this axis.
    const targets: number[] = []
    for (const o of others) {
      const oc = axis === 'x' ? o.x : o.z
      const oh = (axis === 'x' ? o.w : o.d) / 2
      targets.push(oc - oh, oc, oc + oh)
    }

    let bestDelta = Infinity // signed offset that best aligns a moving line to a target
    let bestAt = 0
    for (const ml of movingLines) {
      for (const tg of targets) {
        const delta = tg - ml
        if (Math.abs(delta) <= opts.thresholdCm && Math.abs(delta) < Math.abs(bestDelta)) {
          bestDelta = delta
          bestAt = tg
        }
      }
      if (opts.gridCm && opts.gridCm > 0) {
        const snapped = Math.round(ml / opts.gridCm) * opts.gridCm
        const delta = snapped - ml
        if (Math.abs(delta) <= opts.thresholdCm && Math.abs(delta) < Math.abs(bestDelta)) {
          bestDelta = delta
          bestAt = snapped
        }
      }
    }

    if (bestDelta !== Infinity) {
      if (axis === 'x') outX += bestDelta
      else outZ += bestDelta
      guides.push({ axis, at: bestAt })
    }
  }

  return { x: outX, z: outZ, guides }
}
