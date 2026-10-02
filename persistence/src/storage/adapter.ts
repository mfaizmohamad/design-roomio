/**
 * StorageAdapter — the single swap point for WHERE designs persist.
 *
 * Local-first tier ships `LocalStorageAdapter` (with an automatic in-memory
 * fallback when localStorage is unavailable — artifact/preview/incognito-quota
 * contexts, brief §7). A future cloud tier implements the SAME interface against
 * Agent A's server (:5181), so nothing above this layer changes.
 *
 * Keys are namespaced strings; values are strings (the caller serializes JSON).
 * All methods are async so a network-backed adapter is a drop-in.
 */
export interface StorageAdapter {
  /** Backend label for UI ("local" | "memory" | "cloud"). */
  readonly kind: string
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  /** All keys under a prefix (for listing designs). */
  keys(prefix: string): Promise<string[]>
}

/** Pure in-memory adapter. Always available; used as the localStorage fallback. */
export class InMemoryAdapter implements StorageAdapter {
  readonly kind = 'memory'
  private map = new Map<string, string>()

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value)
  }
  async removeItem(key: string): Promise<void> {
    this.map.delete(key)
  }
  async keys(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix))
  }
  /** Synchronous seed used by LocalStorageAdapter.degrade(); never overwrites a fresher key. */
  seedSync(key: string, value: string): void {
    if (!this.map.has(key)) this.map.set(key, value)
  }
}

/** True only when localStorage exists AND a write round-trips (private-mode safe). */
export function localStorageUsable(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const probe = '__roomio_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/**
 * localStorage-backed adapter. If localStorage is unusable at construction OR a
 * write throws (quota), it falls back to an in-memory store and flips `kind` to
 * 'memory' so the UI can warn the user their work is session-only. NEVER throws
 * on write — the autosave layer's retry/never-drop guarantee depends on this.
 */
export class LocalStorageAdapter implements StorageAdapter {
  private _kind: 'local' | 'memory'
  private fallback = new InMemoryAdapter()

  constructor() {
    this._kind = localStorageUsable() ? 'local' : 'memory'
  }

  get kind(): string {
    return this._kind
  }

  /**
   * Fall back to in-memory. CRITICAL: before flipping, copy every existing
   * localStorage entry into the fallback so designs already on disk stay
   * readable for the rest of the session (otherwise list()/load() would route
   * to an empty fallback and the user's whole library would appear wiped).
   * Idempotent: a second degrade() must not re-copy stale disk over fresher
   * in-memory writes.
   */
  private degrade(): void {
    if (this._kind === 'memory') return
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k !== null) {
          const v = localStorage.getItem(k)
          if (v !== null) this.fallback.seedSync(k, v)
        }
      }
    } catch {
      // localStorage fully unavailable: nothing to copy; keep whatever fallback has.
    }
    this._kind = 'memory'
  }

  async getItem(key: string): Promise<string | null> {
    if (this._kind === 'memory') return this.fallback.getItem(key)
    try {
      return localStorage.getItem(key)
    } catch {
      this.degrade()
      return this.fallback.getItem(key)
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    if (this._kind === 'memory') return this.fallback.setItem(key, value)
    try {
      localStorage.setItem(key, value)
    } catch {
      // Quota or availability lost mid-session: keep the data in memory so it is
      // NOT silently dropped, and downgrade the backend label.
      this.degrade()
      await this.fallback.setItem(key, value)
    }
  }

  async removeItem(key: string): Promise<void> {
    if (this._kind === 'memory') return this.fallback.removeItem(key)
    try {
      localStorage.removeItem(key)
    } catch {
      this.degrade()
      await this.fallback.removeItem(key)
    }
  }

  async keys(prefix: string): Promise<string[]> {
    if (this._kind === 'memory') return this.fallback.keys(prefix)
    try {
      const out: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(prefix)) out.push(k)
      }
      return out
    } catch {
      this.degrade()
      return this.fallback.keys(prefix)
    }
  }
}

/**
 * Test/demo adapter that fails `setItem` a configurable number of times before
 * succeeding — drives the "simulated save failure → retry, not loss" acceptance.
 */
export class FlakyAdapter implements StorageAdapter {
  private inner: StorageAdapter
  /** Number of upcoming setItem calls that should reject. */
  failsRemaining: number
  /** When true, every setItem rejects until set false (hard outage simulation). */
  hardDown = false

  constructor(failsRemaining = 0, inner: StorageAdapter = new InMemoryAdapter()) {
    this.failsRemaining = failsRemaining
    this.inner = inner
  }

  /** Report the real backend (e.g. "local"); the failure sim is surfaced via status. */
  get kind(): string {
    return this.inner.kind
  }

  /** Fault-injection toggle (drives the demo "simulate save failure" control). */
  setFailing(on: boolean): void {
    this.hardDown = on
  }
  get failing(): boolean {
    return this.hardDown
  }

  async getItem(key: string): Promise<string | null> {
    return this.inner.getItem(key)
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.hardDown || this.failsRemaining > 0) {
      if (!this.hardDown) this.failsRemaining--
      throw new Error('simulated storage failure')
    }
    return this.inner.setItem(key, value)
  }
  async removeItem(key: string): Promise<void> {
    return this.inner.removeItem(key)
  }
  async keys(prefix: string): Promise<string[]> {
    return this.inner.keys(prefix)
  }
}
