// Unified async designs repository. When the user is logged in, designs persist
// to the Postgres-backed server (per-user). Otherwise they fall back to the
// browser's localStorage (guest / offline mode). Both StartScreen and Wizard
// talk only to this module, so the storage backend is a single swap point.
//
// Error contract (callers rely on this):
//   • listDesigns / saveDesign / deleteDesign — throw ApiError on any cloud
//     failure (network down, 5xx, 401) so the UI can show real feedback
//     instead of pretending the account is empty (CODE-03/CODE-08).
//   • loadDesign — null means "no such design"; a DesignDataError means the
//     server HAS the design but its payload fails validation (CODE-06);
//     ApiError propagates for transport/server failures.

import type { DesignSummary, SavedDesign } from './persistence'
import {
  coerceDesign,
  listDesigns as localList,
  saveDesign as localSave,
  loadDesign as localLoad,
  deleteDesign as localDelete,
} from './persistence'
import { api, ApiError } from './api'
import { useAuth } from './auth'

// A revision belongs to one account's design. Keeping this in memory is enough:
// reopening after a reload fetches the current token from the server again.
const cloudRevisions = new Map<string, number>()
const revisionKey = (id: string) => `${useAuth.getState().user?.id ?? ''}:${id}`
const headerRevision = (headers: Headers): number | null => {
  const raw = headers.get('X-Design-Revision')
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null
  const revision = Number(raw)
  return Number.isSafeInteger(revision) ? revision : null
}

/** A cloud design exists but its stored payload fails validation. */
export class DesignDataError extends Error {
  constructor(message = 'This design’s saved data is invalid') {
    super(message)
    this.name = 'DesignDataError'
  }
}

function isAuthed(): boolean {
  return useAuth.getState().status === 'authed'
}

/** Server rows can carry null name/shape (older or buggy clients wrote them —
 *  the API only enforces a string id). Normalize so the UI never renders a
 *  blank, unclickable row. */
function coerceSummaries(rows: unknown): DesignSummary[] {
  if (!Array.isArray(rows)) return []
  const out: DesignSummary[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const v = row as Record<string, unknown>
    if (typeof v.id !== 'string' || !v.id) continue
    const num = (x: unknown, fallback: number) =>
      typeof x === 'number' && Number.isFinite(x) ? x : fallback
    const updatedAt = num(v.updatedAt, Date.now())
    out.push({
      id: v.id,
      name: typeof v.name === 'string' && v.name ? v.name : 'Untitled room',
      shape: typeof v.shape === 'string' && v.shape ? v.shape : 'rect',
      updatedAt,
      createdAt: num(v.createdAt, updatedAt),
    })
  }
  return out
}

export async function listDesigns(): Promise<DesignSummary[]> {
  if (isAuthed()) {
    return coerceSummaries(await api.get<unknown>('/designs'))
  }
  return localList()
}

export async function loadDesign(id: string): Promise<SavedDesign | null> {
  if (isAuthed()) {
    let raw: unknown
    let revision: number | null = null
    try {
      const response = await api.getWithMeta<unknown>(`/designs/${encodeURIComponent(id)}`)
      raw = response.data
      revision = headerRevision(response.headers)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
    // Cloud payloads get the SAME validation localStorage reads get — the
    // server stores whatever a client sent, verbatim (CODE-06).
    const design = coerceDesign(raw)
    if (!design) throw new DesignDataError()
    if (revision === null) throw new DesignDataError('This design has no save revision')
    cloudRevisions.set(revisionKey(id), revision)
    return design
  }
  return localLoad(id)
}

export async function saveDesign(d: SavedDesign): Promise<void> {
  if (isAuthed()) {
    const key = revisionKey(d.id)
    const expected = cloudRevisions.get(key) ?? 0
    const response = await api.postWithMeta('/designs', d, { 'X-Design-Revision': String(expected) })
    const revision = headerRevision(response.headers)
    if (revision === null) throw new DesignDataError('The server did not confirm the saved revision')
    cloudRevisions.set(key, revision)
    return
  }
  localSave(d)
}

export async function deleteDesign(id: string): Promise<void> {
  if (isAuthed()) {
    await api.del(`/designs/${encodeURIComponent(id)}`)
    cloudRevisions.delete(revisionKey(id))
    return
  }
  localDelete(id)
}

/** Where will a save go right now? — for UI labelling. */
export function storageMode(): 'cloud' | 'local' {
  return isAuthed() ? 'cloud' : 'local'
}
