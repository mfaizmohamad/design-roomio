/**
 * `.roomio` file export/import — the local-first "share" until live URLs exist
 * (brief §5). A `.roomio` file IS one envelope as pretty JSON. Importing runs the
 * same forward-migration as loading, so a `.roomio` written by an older Roomio
 * still opens.
 */
import type { RoomioDesign } from './types'
import { migrateToEnvelope } from './migrate'

export const ROOMIO_EXT = '.roomio'

/** Serialize an envelope to the canonical `.roomio` text. */
export function exportRoomio(d: RoomioDesign): string {
  return JSON.stringify(d, null, 2)
}

/** Parse + migrate `.roomio` text into a current envelope; null on any failure. */
export function importRoomio(text: string): RoomioDesign | null {
  try {
    return migrateToEnvelope(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

/** A filesystem-safe basename for a design (no extension). */
export function safeFileBase(name: string): string {
  return (name || 'design').trim().replace(/[^\w.-]+/g, '_') || 'design'
}

/** Trigger a browser download of a design as `<name>.roomio`. No-op off-DOM. */
export function downloadRoomio(d: RoomioDesign): void {
  triggerDownload(exportRoomio(d), `${safeFileBase(d.name)}${ROOMIO_EXT}`, 'application/json')
}

/** Generic browser download helper (guarded for non-DOM/test environments). */
export function triggerDownload(content: string | Blob, filename: string, mime: string): void {
  try {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return
    const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    // ignore: download not possible in this environment
  }
}
