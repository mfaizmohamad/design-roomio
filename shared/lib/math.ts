// Canonical pure scalar-math helpers, shared across Roomio's build islands.
//
// Consolidated by Agent F (QA / dedup) from byte-identical copies that Agents
// A, C and E had each ported locally (src, multi-room, lighting). This file is
// the single source of truth — do NOT re-fork these into an island again.
//
// Pure + dependency-free by design, so any island can import it via a relative
// path (e.g. `../../shared/lib/math`) without build coupling beyond this leaf.
// Behavior is pinned by shared/lib/math.test.ts (run from the root vitest).

/** Clamp a value to [lo, hi]. (NaN passes through, matching the original ternary.) */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Clamp a value to the unit interval [0, 1]. Equivalent to clamp(v, 0, 1). */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Degrees → radians conversion factor (multiply a degree value by this). */
export const DEG2RAD = Math.PI / 180
