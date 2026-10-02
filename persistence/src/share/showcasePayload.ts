/**
 * Showcase payload — the SECURITY BOUNDARY for view-only sharing (brief §5/§6).
 *
 * The cardinal sin is a view link exposing the editor or the user's other designs.
 * We design against it structurally: a showcase link carries a MINIMAL, read-only
 * projection of exactly ONE design — { name, scene } — and nothing else. No
 * design_id, no share tokens, no history, no library, no list of other designs.
 * Even if the showcase code were buggy, the payload simply does not contain
 * anything but the one room being shown.
 *
 * Local-first tier: the payload is encoded into the URL fragment (#s=…), so the
 * link is self-contained and works incognito / on another device with no backend
 * (a static "showcase export"). A future backend swaps this for a short token that
 * resolves server-side to the same minimal projection — same boundary, shorter URL.
 *
 * The fragment is used (not the query string) so the payload is never sent to any
 * server in an HTTP request.
 */
import type { RoomioDesign, SceneEnvelope } from '../envelope/types'
import type { House } from '../scene/slices'
import { coerceHouse } from '../scene/coerce'

export const SHOWCASE_PAYLOAD_VERSION = 1 as const

/** Exactly what a showcase needs to render — and nothing that could leak. */
export interface ShowcasePayload {
  v: typeof SHOWCASE_PAYLOAD_VERSION
  name: string
  scene: SceneEnvelope
}

/**
 * Project a full design down to the minimal, safe showcase payload. Deliberately
 * DROPS design_id, share tokens, history, thumbnail, createdAt/updatedAt, rev —
 * none of which a viewer should receive.
 */
export function toShowcasePayload(d: RoomioDesign): ShowcasePayload {
  return {
    v: SHOWCASE_PAYLOAD_VERSION,
    name: d.name,
    // Deep-copy so the payload can never alias the live editor model.
    scene: JSON.parse(JSON.stringify(d.scene)) as SceneEnvelope,
  }
}

/** Validate + normalize an unknown decoded value into a ShowcasePayload, or null. */
export function coerceShowcasePayload(value: unknown): ShowcasePayload | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const scene = v.scene as Record<string, unknown> | undefined
  if (!scene) return null
  const house = coerceHouse(scene.house)
  if (!house) return null
  return {
    v: SHOWCASE_PAYLOAD_VERSION,
    name: typeof v.name === 'string' ? v.name : 'Roomio design',
    scene: {
      house: house as House,
      lighting: scene.lighting && typeof scene.lighting === 'object' ? (scene.lighting as SceneEnvelope['lighting']) : null,
    },
  }
}

// ── URL-safe base64 of UTF-8 JSON (no deps; works in browser + node) ──

function utf8ToBytes(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s)
  // node fallback
  return Uint8Array.from(Buffer.from(s, 'utf-8'))
}
function bytesToUtf8(b: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(b)
  return Buffer.from(b).toString('utf-8')
}
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}
function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}
const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromUrlSafe = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  return b64 + pad
}

/** Encode a payload to a compact URL-safe string. */
export function encodeShowcasePayload(payload: ShowcasePayload): string {
  return toUrlSafe(bytesToBase64(utf8ToBytes(JSON.stringify(payload))))
}

/** Decode + validate a URL-safe string into a payload; null on any failure. */
export function decodeShowcasePayload(encoded: string): ShowcasePayload | null {
  try {
    const json = bytesToUtf8(base64ToBytes(fromUrlSafe(encoded)))
    return coerceShowcasePayload(JSON.parse(json) as unknown)
  } catch {
    return null
  }
}
