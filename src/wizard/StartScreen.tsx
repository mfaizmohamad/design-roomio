import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { useAuth } from '../auth'
import { importDesignJSON, type DesignSummary } from '../persistence'
import type { SavedDesign } from '../persistence'
import { useHouse } from '../three/houseSession'
import {
  listDesigns,
  loadDesign as repoLoad,
  saveDesign as repoSave,
  deleteDesign as repoDelete,
  DesignDataError,
} from '../repository'
import { toast } from '../toast'
import { confirmDialog } from '../confirm'
import { isDirty, markClean } from '../dirty'
import { StyleStart } from './StyleStart'

const SHAPE_LABELS: Record<string, string> = {
  rect: 'Rectangle',
  l: 'L-shape',
  t: 'T-shape',
  u: 'U-shape',
  cut: 'Cut corner',
  beveled: 'Beveled',
}

const shapeLabel = (shape: string): string => SHAPE_LABELS[shape] ?? shape

function formatUpdated(ts: number): string {
  const d = new Date(ts)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function StartScreen() {
  const resetDesign = useStore((s) => s.resetDesign)
  const setStage = useStore((s) => s.setStage)

  const authStatus = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const requestSignIn = useAuth((s) => s.requestSignIn)

  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [loading, setLoading] = useState(true)
  // A failed list-fetch is an ERROR, not an empty account — never show the
  // cheerful "No saved rooms yet" over a server failure (CODE-03).
  const [loadFailed, setLoadFailed] = useState(false)
  const [showStyles, setShowStyles] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Call sites use `void refresh()`: refresh() turns every failure into
  // loadFailed/loading state and never rejects, so awaiting it would only delay
  // the caller. The `void` is what tells no-floating-promises that is deliberate.
  async function refresh() {
    setLoading(true)
    try {
      setDesigns(await listDesigns())
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // Keyed on authStatus alone on purpose: the list is re-fetched when the user
    // signs in or out, not when refresh's identity changes on every render.
  }, [authStatus])

  async function handleOpen(id: string) {
    try {
      const d = await repoLoad(id)
      if (d) {
        useHouse.getState().loadSavedDesign(d)
        markClean()
      } else {
        toast("Couldn't find that room — it may have been deleted elsewhere.", 'error')
        void refresh()
      }
    } catch (e) {
      toast(
        e instanceof DesignDataError
          ? "This room's saved data is damaged, so it can't be opened."
          : "Couldn't open this room — check your connection and try again.",
        'error',
      )
    }
  }

  // WIZ-04: deleting a saved room is destructive and irreversible, so require an
  // explicit in-app confirm (never a native confirm()), then offer a brief Undo
  // that restores the just-deleted design.
  async function handleDelete(id: string, name: string) {
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      body: cloud
        ? 'This removes the saved room from your account.'
        : 'This removes the saved room from this browser.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      danger: true,
    })
    if (!ok) return

    // Capture the full design first so a mistaken delete can be undone.
    let snapshot: SavedDesign | null = null
    try {
      snapshot = await repoLoad(id)
    } catch {
      snapshot = null // damaged/unreadable — still allow the delete, just no undo
    }

    try {
      await repoDelete(id)
    } catch {
      toast("Couldn't delete this room — check your connection and try again.", 'error')
      return
    }
    void refresh()

    if (snapshot) {
      const restore = snapshot
      toast(`Deleted “${name}”.`, 'info', 7000, {
        label: 'Undo',
        onClick: async () => {
          try {
            await repoSave(restore)
            toast(`Restored “${name}”.`, 'success')
          } catch {
            toast("Couldn't restore this room — check your connection and try again.", 'error')
          } finally {
            void refresh()
          }
        },
      })
    } else {
      toast(`Deleted “${name}”.`, 'success')
    }
  }

  // CODE-16: starting a blank room discards the in-memory design. Guard it when
  // there are genuinely unsaved edits (e.g. the user navigated back here).
  async function handleBlankRoom() {
    if (isDirty()) {
      const ok = await confirmDialog({
        title: 'Discard unsaved changes?',
        body: 'You have unsaved edits to the current room. Starting a blank room will discard them.',
        confirmLabel: 'Discard & start',
        cancelLabel: 'Keep editing',
        danger: true,
      })
      if (!ok) return
    }
    resetDesign('rect')
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : ''
        const d = importDesignJSON(text)
        if (d) {
          useHouse.getState().loadSavedDesign(d)
          markClean()
        }
        else toast("That file isn't a Roomio design — choose a JSON file exported from Roomio.", 'error')
      } catch {
        toast("That file isn't a Roomio design — choose a JSON file exported from Roomio.", 'error')
      }
    }
    reader.onerror = () => toast("Couldn't read that file — please try again.", 'error')
    try {
      reader.readAsText(file)
    } catch {
      toast("Couldn't read that file — please try again.", 'error')
    }
  }

  const cloud = authStatus === 'authed'

  if (showStyles) return <StyleStart onClose={() => setShowStyles(false)} />

  return (
    <div className="start">
      <div className="start-card" style={{ width: 560, maxWidth: '92vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="brand" style={{ marginBottom: 0 }}>
            <span className="dot" />
            Roomio
          </div>
          {cloud ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {user?.name || user?.email}
              </span>
              <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={logout}>
                Log out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="guest-pill">Guest · saved to this browser</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ flex: 'none' }}
                onClick={requestSignIn}
                data-testid="guest-signin"
              >
                Sign in
              </button>
            </div>
          )}
        </div>

        {/* Entry choice: browse real flat listings (no broker) OR design a room. */}
        <button className="flats-hero" onClick={() => setStage('listings')}>
          <span className="flats-hero-emoji">🏠</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', minWidth: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 17 }}>Looking for a flat? Browse listings</span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>Live flatmate posts, newest first — no broker, no brokerage. Call the owner directly.</span>
          </span>
          <span className="flats-hero-go">Browse flats →</span>
        </button>

        <h1 className="start-title" style={{ marginTop: 28 }}>
          Or design your own room
        </h1>
        <p className="start-sub">
          Pick a shape, set the dimensions, add doors &amp; windows, choose your style — then
          furnish it. Or start from a persona room that’s already furnished for you.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ flex: '1 1 200px' }}
            onClick={() => setShowStyles(true)}
          >
            ✨ Start from a style that’s you
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: '1 1 160px' }}
            onClick={handleBlankRoom}
          >
            Start a blank room
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ flex: 'none' }}
            onClick={() => fileInputRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>

        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>
            {cloud ? 'Your saved rooms' : 'Saved rooms (this browser)'}
          </div>

          {loading ? (
            <p style={{ fontSize: 13.5, color: 'var(--ink-3)', margin: 0 }}>Loading…</p>
          ) : loadFailed ? (
            <div
              role="alert"
              data-testid="designs-load-error"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '13px 15px',
                borderRadius: 12,
                background: '#fbeae8',
                border: '1.5px solid #efc7c0',
              }}
            >
              <span aria-hidden style={{ fontSize: 17, flex: 'none' }}>
                ⚠️
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#8c2f24' }}>
                  Couldn't load your rooms
                </div>
                <div style={{ fontSize: 12.5, color: '#9a4d41', marginTop: 3, lineHeight: 1.45 }}>
                  The server didn't respond. Your rooms are safe — try again in a moment.
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ flex: 'none' }}
                onClick={refresh}
                data-testid="designs-retry"
              >
                Retry
              </button>
            </div>
          ) : designs.length === 0 ? (
            <p style={{ fontSize: 13.5, color: 'var(--ink-3)', margin: 0, lineHeight: 1.5 }}>
              No saved rooms yet — start one above.
            </p>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                maxHeight: 260,
                overflowY: 'auto',
                paddingRight: 4,
                marginRight: -4,
              }}
            >
              {designs.map((d) => (
                <div
                  key={d.id}
                  onClick={() => handleOpen(d.id)}
                  className="saved-row"
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: 'var(--ink)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {d.name}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>
                      {shapeLabel(d.shape)} · Updated {formatUpdated(d.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // `void`: handleDelete reports every failure through a
                      // toast and returns; an onClick cannot await it anyway.
                      void handleDelete(d.id, d.name)
                    }}
                    className="saved-del"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
