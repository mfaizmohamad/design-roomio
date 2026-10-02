/**
 * AutosaveController — debounced, optimistic, retry-never-drop autosave.
 *
 * The trust foundation (brief §3, §6). Framework-agnostic so it is unit-testable
 * with fake timers; the React store + UI sit on top. Guarantees:
 *   - DEBOUNCED: a flurry of edits collapses into one save ~debounceMs after the
 *     user pauses (not per keystroke/drag).
 *   - OPTIMISTIC: callers update their own model instantly; this only persists.
 *   - COALESCED: an edit arriving mid-save re-saves the newest value afterward;
 *     never saves a stale snapshot over a newer one.
 *   - NEVER DROPS: on failure the pending value stays in memory and is retried
 *     with backoff until it succeeds (or a newer edit supersedes it). Status goes
 *     'error' (retrying) — never silent.
 *   - VISIBLE: every transition emits a SaveStatus for the UI indicator.
 */
import type { SaveStatus, SavePhase } from './status'

export interface AutosaveOptions<T> {
  /** Persist a value durably. Rejects on failure (triggers retry). */
  save: (value: T) => Promise<void>
  /** Quiet period after the last edit before autosaving. Default 1500 ms. */
  debounceMs?: number
  /** Retry backoff schedule (ms) on save failure; last value repeats. */
  backoffMs?: number[]
  /** Status change callback (drive the UI from this). */
  onStatus?: (status: SaveStatus) => void
  /** Clock, injectable for tests. Default Date.now. */
  now?: () => number
}

const DEFAULT_DEBOUNCE = 1500
const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000]

export class AutosaveController<T> {
  private opts: Required<Omit<AutosaveOptions<T>, 'onStatus'>> & {
    onStatus?: (s: SaveStatus) => void
  }
  private pending: { value: T } | null = null
  private inFlight = false
  private dirtySeq = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private _status: SaveStatus = { phase: 'idle' }

  constructor(options: AutosaveOptions<T>) {
    this.opts = {
      save: options.save,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE,
      backoffMs: options.backoffMs ?? DEFAULT_BACKOFF,
      now: options.now ?? Date.now,
      onStatus: options.onStatus,
    }
  }

  get status(): SaveStatus {
    return this._status
  }

  /** Are there edits not yet durably persisted? (drives beforeunload guard) */
  hasUnsaved(): boolean {
    return this.pending !== null || this.inFlight
  }

  private emit(patch: Partial<SaveStatus>): void {
    this._status = { ...this._status, ...patch }
    this.opts.onStatus?.(this._status)
  }

  private setPhase(phase: SavePhase, extra: Partial<SaveStatus> = {}): void {
    this.emit({ phase, ...extra })
  }

  /** Record an edit. Updates the pending value and (re)arms the debounce timer. */
  markDirty(value: T): void {
    this.pending = { value }
    this.dirtySeq++
    // A fresh edit supersedes any scheduled retry.
    this.clearRetry()
    if (this._status.phase !== 'saving') {
      this.setPhase('dirty')
    }
    this.armDebounce()
  }

  private armDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.flush()
    }, this.opts.debounceMs)
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * Manual save / Ctrl+Cmd-S / flush-before-unload. Persists the pending value
   * immediately (bypasses debounce). Resolves when the in-flight save settles.
   */
  async saveNow(): Promise<void> {
    this.clearDebounce()
    this.clearRetry()
    await this.flush()
  }

  private async flush(): Promise<void> {
    if (this.inFlight) return // a save is running; it will re-flush if needed
    if (!this.pending) return // nothing to do
    const value = this.pending.value
    const seqAtStart = this.dirtySeq
    this.inFlight = true
    this.setPhase('saving')
    try {
      await this.opts.save(value)
      this.inFlight = false
      if (this.dirtySeq !== seqAtStart) {
        // A newer edit arrived during the save → persist the latest too.
        void this.flush()
        return
      }
      // Fully caught up.
      this.pending = null
      this.setPhase('saved', { savedAt: this.opts.now(), attempt: 0, retrying: false, error: undefined })
    } catch (err) {
      this.inFlight = false
      // KEEP `pending` — the data is not lost. Schedule a backoff retry.
      const attempt = (this._status.attempt ?? 0) + 1
      const delay = this.opts.backoffMs[Math.min(attempt - 1, this.opts.backoffMs.length - 1)]
      this.setPhase('error', {
        attempt,
        retrying: true,
        error: err instanceof Error ? err.message : String(err),
      })
      this.scheduleRetry(delay)
    }
  }

  private scheduleRetry(delay: number): void {
    this.clearRetry()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delay)
  }

  /** Cancel timers (call on teardown). Pending data is left intact in memory. */
  dispose(): void {
    this.clearDebounce()
    this.clearRetry()
  }

  /**
   * Hard cancel: drop the pending value, stop all timers, and invalidate any
   * in-flight flush so it does NOT re-persist after it returns. Use when the save
   * target is gone (e.g. the design was deleted) — otherwise a queued/returning
   * save would resurrect it. Unlike dispose(), this discards pending on purpose.
   */
  cancel(): void {
    this.clearDebounce()
    this.clearRetry()
    this.pending = null
    this.dirtySeq++ // makes a returning in-flight flush see "no newer edit" and stop cleanly
    this.setPhase('idle', { attempt: 0, retrying: false, error: undefined })
  }
}
