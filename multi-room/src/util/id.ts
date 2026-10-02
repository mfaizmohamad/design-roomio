/**
 * ID generation — single source for all id minting in /multi-room.
 * Kept dependency-light and deterministic-friendly (an optional counter seed lets
 * tests assert on stable ids without mocking globals).
 */
let counter = 0

/** Monotonic, prefixed id: `${prefix}_${base36-time}_${seq}`. */
export function uid(prefix: string): string {
  counter += 1
  const t = (typeof Date !== 'undefined' ? Date.now() : 0).toString(36)
  return `${prefix}_${t}_${counter.toString(36)}`
}

/** Reset the internal counter — test-only helper. */
export function __resetIdCounter(): void {
  counter = 0
}
