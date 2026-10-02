/**
 * Save status — the small piece of state that does the heavy lifting of trust
 * (brief §3, §6). The UI renders exactly this.
 */
export type SavePhase =
  | 'idle' // nothing to save (clean, no edits since load)
  | 'dirty' // edits made, save scheduled (debouncing)
  | 'saving' // a save is in flight (show spinner: "Saving…")
  | 'saved' // last save succeeded (show "Saved <relative time>")
  | 'error' // save failed; retrying, data kept in memory ("Couldn't save, retrying…")

export interface SaveStatus {
  phase: SavePhase
  /** Epoch ms of the last successful save (for "Saved just now / 2 min ago"). */
  savedAt?: number
  /** Retry attempt count while in `error`. */
  attempt?: number
  /** True while a retry is scheduled/in progress. */
  retrying?: boolean
  /** Last error message (for diagnostics; the UI shows a friendly line). */
  error?: string
}

/** Human "Saved just now / 2 min ago / 3:45 PM" label from a timestamp. */
export function savedLabel(savedAt: number | undefined, now = Date.now()): string {
  if (!savedAt) return ''
  const sec = Math.max(0, Math.round((now - savedAt) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  return `${Math.round(hr / 24)} d ago`
}

/** One-line status text for the indicator. */
export function statusText(s: SaveStatus, now = Date.now()): string {
  switch (s.phase) {
    case 'idle':
      return s.savedAt ? `Saved ${savedLabel(s.savedAt, now)}` : 'All changes saved'
    case 'dirty':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving…'
    case 'saved':
      return `Saved ${savedLabel(s.savedAt, now)}`
    case 'error':
      return 'Couldn’t save — retrying…'
  }
}
