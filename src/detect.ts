// detect.ts
// -----------------------------------------------------------------------------
// Front-end client for the "Scan a room photo" detection feature. Talks to the
// server's /api/detect endpoints, which queue a room photo for Agent B's Python
// watcher and let us poll for the resulting suggestions.
//
// Detection is suggestion-only: these proposals are rendered as confirmable
// dropdowns in ScanRoom.tsx — nothing is auto-added to the design.
// -----------------------------------------------------------------------------

/** One detected furniture region. Mirrors a proposal in shared/detection_schema.json. */
export interface Proposal {
  archetype_id: string
  display_label: string
  category?: string
  detected_label?: string
  confidence: number
  color_hex: string
  color_name: string
  bbox?: number[]
}

/** Shape of a <id>.result.json file written by Agent B's watcher. */
export interface DetectionResult {
  version: string
  request_id: string
  status: 'ok' | 'error'
  error?: string | null
  model: string
  proposals: Proposal[]
}

/** Result of GET /api/detect/:id before the watcher has produced a result. */
export interface PendingResult {
  status: 'pending'
}

/** Committed demo fixtures in shared/results/ — work without the watcher running. */
export const SAMPLE_IDS = ['living-room-demo', 'video-apartment'] as const

/**
 * Queue a room photo for detection.
 * @param imageBase64 A data URL ("data:image/...;base64,...") or raw base64.
 * @returns the request_id to poll with fetchDetection.
 */
export async function requestDetection(imageBase64: string): Promise<string> {
  const res = await fetch('/api/detect', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64 }),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data.request_id as string
}

/**
 * Poll once for a detection result.
 * @returns the full DetectionResult once ready, or { status: 'pending' }.
 */
export async function fetchDetection(
  id: string,
): Promise<DetectionResult | PendingResult> {
  const res = await fetch(`/api/detect/${encodeURIComponent(id)}`, {
    credentials: 'include',
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`)
  }
  return data as DetectionResult | PendingResult
}
