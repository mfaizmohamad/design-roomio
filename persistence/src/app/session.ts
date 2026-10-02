/**
 * Session store (zustand) — ties the repository + autosave engine + the open
 * design together. This is the brain the UI binds to.
 *
 * Optimistic UI: edits mutate `current` IN MEMORY immediately (instant), and the
 * autosave engine persists in the background with a visible status. rev increments
 * once per successful durable save (strictly monotonic).
 */
import { create } from 'zustand'
import type { RoomioDesign, DesignSummary, ShareAccess } from '../envelope/types'
import { createDesign, duplicateDesign } from '../envelope/factory'
import { importRoomio } from '../envelope/serialize'
import { withAccess } from '../share/link'
import { uid } from '../util/id'
import type { House, LightingStateLike } from '../scene/slices'
import { DesignRepository } from '../storage/repository'
import { LocalStorageAdapter, type StorageAdapter } from '../storage/adapter'
import { importLegacyDesigns } from '../storage/legacy'
import { AutosaveController } from '../autosave/engine'
import type { SaveStatus } from '../autosave/status'
import { installUnloadGuard } from '../autosave/beforeUnload'
import { captureThumbnail } from '../render/thumbnail'
import { makeSnapshot, pushHistory, shouldAutoSnapshot, restoreFrom } from '../envelope/history'
import type { VersionSnapshot } from '../envelope/types'

/** Adapters that support fault injection (the demo "simulate save failure"). */
interface FaultInjectable {
  setFailing(on: boolean): void
  readonly failing: boolean
}
function asFault(a: StorageAdapter): FaultInjectable | null {
  const f = a as unknown as Partial<FaultInjectable>
  return typeof f.setFailing === 'function' ? (f as FaultInjectable) : null
}

/** Bound the in-memory undo stack (each entry holds a full envelope + thumbnail). */
const UNDO_STACK_MAX = 20

export interface SessionState {
  repo: DesignRepository
  autosave: AutosaveController<RoomioDesign>
  backend: string
  /** The open design (optimistic in-memory model). null = on the library screen. */
  current: RoomioDesign | null
  status: SaveStatus
  /** Library summaries (refreshed after every successful save / mutation). */
  summaries: DesignSummary[]
  /** True when the storage backend supports the demo failure simulation. */
  canSimulateFailure: boolean
  failureSimOn: boolean
  /** Undo STACK of deleted designs (LIFO), kept in memory so deletes are UNDOable. */
  lastDeleted: RoomioDesign[]

  // lifecycle
  refreshLibrary: () => Promise<void>
  // creation / navigation
  newDesign: (house: House, lighting?: LightingStateLike | null, name?: string) => Promise<RoomioDesign>
  open: (id: string) => Promise<boolean>
  closeToLibrary: () => Promise<void>
  // library management (operate by id; the design need not be open)
  duplicate: (id: string) => Promise<string | null>
  renameDesign: (id: string, name: string) => Promise<void>
  deleteDesign: (id: string) => Promise<void>
  undoDelete: () => Promise<void>
  /** Import a .roomio file's text → migrate → add to the library (fresh id on collision). */
  importDesign: (text: string) => Promise<string | null>
  // editing (optimistic + autosave)
  rename: (name: string) => void
  mutate: (producer: (d: RoomioDesign) => RoomioDesign) => void
  saveNow: () => Promise<void>
  // sharing
  setShareAccess: (access: ShareAccess) => void
  // version history
  checkpoint: (label?: string) => Promise<void>
  restoreVersion: (rev: number) => void
  history: () => VersionSnapshot[]
  // demo: simulate a storage outage
  simulateSaveFailure: (on: boolean) => void
}

/** Build the autosave controller, wiring its save fn through the repository. */
function makeAutosave(
  getRepo: () => DesignRepository,
  onSaved: (committed: RoomioDesign) => void,
  isTombstoned: (id: string) => boolean,
) {
  return new AutosaveController<RoomioDesign>({
    debounceMs: 1200,
    save: async (env) => {
      // Don't resurrect a design that was deleted while this save was pending/in-flight.
      // (A precise tombstone, not a has()-check, so a brand-new design whose first save
      // failed still persists on retry.)
      if (isTombstoned(env.design_id)) return
      const now = Date.now()
      let committed: RoomioDesign = {
        ...env,
        updatedAt: now,
        rev: Math.max(env.rev, currentRev() + 1),
        thumbnail: captureThumbnail(env.scene.house) ?? env.thumbnail,
      }
      // Periodic autosnapshot (throttled) so a bad edit can always be rolled back.
      if (shouldAutoSnapshot(committed, now)) {
        committed = pushHistory(committed, makeSnapshot(committed, 'auto', now))
      }
      await getRepo().save(committed)
      onSaved(committed)
    },
    onStatus: (s) => useSession.setState({ status: s }),
  })
}

let currentRevFn: () => number = () => 0
function currentRev(): number {
  return currentRevFn()
}

export function makeSession(adapter: StorageAdapter = new LocalStorageAdapter()): SessionState {
  const repo = new DesignRepository(adapter)
  const fault = asFault(adapter)
  // Ids deleted this session: the autosave save fn refuses to write them, so a
  // pending/in-flight edit can never resurrect a deleted design.
  const tombstones = new Set<string>()
  const autosave = makeAutosave(
    () => repo,
    (committed) => {
      const st = useSession.getState()
      const cur = st.current
      if (cur?.design_id === committed.design_id) {
        // The save fn keeps committed.scene === the scene object it was handed.
        // If `current` still points at that same scene, nothing newer happened →
        // reflect the whole committed envelope. If the user edited DURING the save
        // (current.scene is a newer object), we must NOT overwrite their newer
        // edit — adopt only the durable bookkeeping (rev/updatedAt) and keep the
        // newer scene/name/history. (Critical: prevents silent loss of an
        // acknowledged optimistic edit; the newer edit re-saves via coalescing.)
        if (cur.scene === committed.scene) {
          useSession.setState({ current: committed })
        } else {
          useSession.setState({ current: { ...cur, rev: committed.rev, updatedAt: committed.updatedAt } })
        }
      }
      void st.refreshLibrary()
    },
    (id) => tombstones.has(id),
  )
  return {
    repo,
    autosave,
    backend: repo.backend,
    current: null,
    status: { phase: 'idle' },
    summaries: [],
    canSimulateFailure: !!fault,
    failureSimOn: false,
    lastDeleted: [],

    refreshLibrary: async () => {
      // One-time, non-destructive import of pre-persistence saves (no-op after first run).
      await importLegacyDesigns(repo, adapter)
      const summaries = await useSession.getState().repo.list()
      useSession.setState({ summaries, backend: useSession.getState().repo.backend })
    },

    newDesign: async (house, lighting = null, name) => {
      const base = createDesign({ house, lighting, name })
      const d: RoomioDesign = { ...base, thumbnail: captureThumbnail(house) ?? null }
      useSession.setState({ current: d })
      await useSession.getState().repo.save(d)
      await useSession.getState().refreshLibrary()
      useSession.setState({ status: { phase: 'saved', savedAt: Date.now() } })
      return d
    },

    open: async (id) => {
      const d = await useSession.getState().repo.load(id)
      if (!d) return false
      useSession.setState({ current: d, status: { phase: 'saved', savedAt: d.updatedAt } })
      return true
    },

    closeToLibrary: async () => {
      // Flush any pending edits before leaving so nothing is lost.
      await useSession.getState().autosave.saveNow()
      // Guard against the cardinal sin: if a save is still pending (e.g. storage
      // down), keep the editor open rather than dropping the unsaved design.
      if (useSession.getState().autosave.hasUnsaved()) return
      useSession.setState({ current: null })
      await useSession.getState().refreshLibrary()
    },

    // ── library management ──
    duplicate: async (id) => {
      const st = useSession.getState()
      const src = await st.repo.load(id)
      if (!src) return null
      const copy = duplicateDesign(src)
      await st.repo.save(copy)
      await st.refreshLibrary()
      return copy.design_id
    },

    renameDesign: async (id, name) => {
      const st = useSession.getState()
      const trimmed = name.trim() || 'Untitled room'
      // If the design is currently open, route through the optimistic editor path.
      if (st.current?.design_id === id) {
        st.rename(trimmed)
        return
      }
      const d = await st.repo.load(id)
      if (!d) return
      await st.repo.save({ ...d, name: trimmed, updatedAt: Date.now(), rev: d.rev + 1 })
      await st.refreshLibrary()
    },

    deleteDesign: async (id) => {
      const st = useSession.getState()
      // Tombstone first (synchronously) so any pending/in-flight autosave for this
      // design refuses to re-write it — a delete must not be silently undone.
      tombstones.add(id)
      if (st.current?.design_id === id) {
        st.autosave.cancel() // drop pending edits + stop timers for the open design
        useSession.setState({ current: null }) // back to the library
      }
      // Keep the full envelope in memory so the delete is UNDOable (not a trap).
      const victim = await st.repo.load(id)
      await st.repo.remove(id)
      // Push onto an undo STACK so deleting B before undoing A never loses A.
      if (victim) useSession.setState({ lastDeleted: [...useSession.getState().lastDeleted, victim].slice(-UNDO_STACK_MAX) })
      await st.refreshLibrary()
    },

    undoDelete: async () => {
      const st = useSession.getState()
      const stack = st.lastDeleted
      if (stack.length === 0) return
      const d = stack[stack.length - 1] // LIFO: undo the most recent delete first
      tombstones.delete(d.design_id) // it lives again
      await st.repo.save(d)
      useSession.setState({ lastDeleted: stack.slice(0, -1) })
      await st.refreshLibrary()
    },

    importDesign: async (text) => {
      const st = useSession.getState()
      const env = importRoomio(text)
      if (!env) return null
      // Never silently overwrite an existing design: assign a fresh id on collision.
      const d = (await st.repo.has(env.design_id)) ? { ...env, design_id: uid('design') } : env
      tombstones.delete(d.design_id) // a re-imported id is alive again
      await st.repo.save(d)
      await st.refreshLibrary()
      return d.design_id
    },

    rename: (name) => {
      useSession.getState().mutate((d) => ({ ...d, name }))
    },

    mutate: (producer) => {
      const st = useSession.getState()
      if (!st.current) return
      const next = producer(st.current)
      useSession.setState({ current: next }) // optimistic: instant
      st.autosave.markDirty(next) // persist in background
    },

    saveNow: async () => {
      await useSession.getState().autosave.saveNow()
    },

    // ── sharing (share state is part of the envelope → autosaves) ──
    setShareAccess: (access) => {
      useSession.getState().mutate((d) => ({ ...d, share: withAccess(d.share, access) }))
    },

    // ── version history ──
    checkpoint: async (label) => {
      const st = useSession.getState()
      if (!st.current) return
      // A manual checkpoint doubles as a named restore point (brief §3).
      const snapped = pushHistory(st.current, makeSnapshot(st.current, 'manual', Date.now(), label))
      useSession.setState({ current: snapped })
      st.autosave.markDirty(snapped)
      await st.autosave.saveNow()
    },

    restoreVersion: (rev) => {
      const st = useSession.getState()
      if (!st.current) return
      const restored = restoreFrom(st.current, rev)
      if (!restored) return
      // Restoring is itself an edit → saved as a new rev; history is preserved.
      useSession.setState({ current: restored })
      st.autosave.markDirty(restored)
    },

    history: () => useSession.getState().current?.history ?? [],

    // ── demo: simulate a storage outage ──
    simulateSaveFailure: (on) => {
      fault?.setFailing(on)
      useSession.setState({ failureSimOn: on })
      // When recovering, nudge a flush so the kept-in-memory data lands immediately.
      if (!on) void useSession.getState().autosave.saveNow()
    },
  }
}

export const useSession = create<SessionState>(() => makeSession())

// rev source for the autosave commit step
currentRevFn = () => useSession.getState().current?.rev ?? 0

/** Install the unsaved-exit guard once (call from the app root). Returns cleanup. */
export function installSessionUnloadGuard(): () => void {
  return installUnloadGuard(() => useSession.getState().autosave.hasUnsaved())
}
