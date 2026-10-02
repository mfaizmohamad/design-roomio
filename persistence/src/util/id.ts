/** Short unique ids. Mirrors the app's `uid()` (crypto.randomUUID with a fallback). */
export function uid(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
    }
  } catch {
    // fall through
  }
  // Non-crypto fallback (deterministic-enough for ids; not for security).
  return `${prefix}-${Math.abs(hashStr(`${prefix}:${seq()}`)).toString(36).slice(0, 8)}`
}

/** Opaque, URL-safe share token (longer than a uid; unguessable-ish for local use). */
export function shareToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '')
    }
  } catch {
    // fall through
  }
  let s = ''
  for (let i = 0; i < 4; i++) s += Math.abs(hashStr(`tok:${seq()}:${i}`)).toString(36)
  return s.slice(0, 24)
}

let _seq = 0
function seq(): number {
  _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER
  // Mix in a clock when available without relying on it (tests stay deterministic-ish).
  const t = typeof performance !== 'undefined' && performance.now ? performance.now() : 0
  return _seq + Math.floor(t)
}

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}
