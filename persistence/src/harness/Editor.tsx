/**
 * Demo editor screen. Stands in for Agent A's real editor — its job is to prove
 * the persistence behaviours end-to-end: optimistic edits, debounced autosave with
 * a visible status, inline rename, a manual Save (+ Ctrl/Cmd-S), and the
 * unsaved-exit guard. Edits here mutate the House via session.mutate().
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useSession } from '../app/session'
import { Floorplan } from '../ui/Floorplan'
import { SaveStatusIndicator } from '../ui/SaveStatus'
import { savedLabel } from '../autosave/status'
import { T, panel, btnPrimary, btnGhost } from '../ui/theme'
import type { House, FurnitureItem } from '../scene/slices'
import type { RoomioDesign } from '../envelope/types'

const WALL_COLORS = ['#e9e6df', '#d7e3dc', '#e6dce3', '#dce3ee', '#efe6d6', '#e3e0db']

export function Editor({ onShare }: { onShare: () => void }) {
  const current = useSession((s) => s.current)
  const status = useSession((s) => s.status)
  const backend = useSession((s) => s.backend)
  const rename = useSession((s) => s.rename)
  const mutate = useSession((s) => s.mutate)
  const checkpoint = useSession((s) => s.checkpoint)
  const restoreVersion = useSession((s) => s.restoreVersion)
  const closeToLibrary = useSession((s) => s.closeToLibrary)
  const canSimulateFailure = useSession((s) => s.canSimulateFailure)
  const failureSimOn = useSession((s) => s.failureSimOn)
  const simulateSaveFailure = useSession((s) => s.simulateSaveFailure)
  const [showHistory, setShowHistory] = useState(false)

  const [nameDraft, setNameDraft] = useState(current?.name ?? '')
  const nameRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setNameDraft(current?.name ?? '')
  }, [current?.design_id])

  // Ctrl/Cmd-S → manual save checkpoint (also a named restore point) with feedback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void checkpoint()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [checkpoint])

  if (!current) return null
  const house = current.scene.house

  return (
    <div style={shell}>
      <header style={topbar}>
        <button style={btnGhost} onClick={() => void closeToLibrary()} title="Back to My Designs">
          ‹ My Designs
        </button>
        <input
          ref={nameRef}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => rename(nameDraft.trim() || 'Untitled room')}
          onKeyDown={(e) => e.key === 'Enter' && nameRef.current?.blur()}
          style={nameInput}
          aria-label="Design name"
        />
        <div style={{ flex: 1 }} />
        <SaveStatusIndicator status={status} backend={backend} />
        <button style={btnGhost} onClick={() => void checkpoint()} title="Save a version now (⌘/Ctrl-S)">
          Save
        </button>
        <button style={btnGhost} onClick={() => setShowHistory((v) => !v)} title="Version history">
          History
        </button>
        <button style={btnPrimary} onClick={onShare}>
          Share
        </button>
      </header>

      <div style={body}>
        <aside style={{ ...panel, ...sidebar }}>
          <SectionTitle>Edit (demo)</SectionTitle>
          <p style={hint}>Each change shows instantly and autosaves after you pause.</p>
          <button style={ctrlBtn} onClick={() => nudgeFirstFurniture(mutate, 20, 0)}>Move item →</button>
          <button style={ctrlBtn} onClick={() => nudgeFirstFurniture(mutate, -20, 0)}>← Move item</button>
          <button style={ctrlBtn} onClick={() => nudgeFirstFurniture(mutate, 0, 20)}>Move item ↓</button>
          <button style={ctrlBtn} onClick={() => rotateFirstFurniture(mutate)}>Rotate item ⟳</button>

          <SectionTitle>Wall colour</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {WALL_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setWallColor(mutate, c)}
                title={c}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${T.panelBorder}`,
                  background: c,
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>

          <SectionTitle>Scene</SectionTitle>
          <div style={meta}>
            <div>{house.rooms.length} room{house.rooms.length === 1 ? '' : 's'}</div>
            <div>{house.rooms.reduce((n, r) => n + r.interior.furniture.length, 0)} items</div>
            <div>rev {current.rev}</div>
            <div>storage: {backend}</div>
          </div>

          {canSimulateFailure && (
            <>
              <SectionTitle>Reliability (demo)</SectionTitle>
              <button
                style={{ ...ctrlBtn, color: failureSimOn ? T.danger : T.ink, borderColor: failureSimOn ? '#e7c9c5' : T.panelBorder }}
                onClick={() => simulateSaveFailure(!failureSimOn)}
                title="Force the storage layer to fail, to prove edits are retried — never dropped."
              >
                {failureSimOn ? '■ Stop simulating failure' : '⚠ Simulate save failure'}
              </button>
              {failureSimOn && (
                <p style={{ ...hint, color: T.danger }}>
                  Storage is failing. Edits stay in memory and retry — nothing is lost. Turn off to recover.
                </p>
              )}
            </>
          )}
        </aside>

        <main style={{ ...panel, ...stage }}>
          <Floorplan house={house} style={{ width: '100%', height: '100%' }} />
        </main>

        {showHistory && (
          <aside style={{ ...panel, ...historyPanel }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <SectionTitle>Version history</SectionTitle>
              <button style={{ ...btnGhost, padding: 4 }} onClick={() => setShowHistory(false)}>✕</button>
            </div>
            <p style={hint}>Restore points. ⌘/Ctrl-S makes a manual one; autosnapshots happen as you work.</p>
            {(current.history ?? []).length === 0 ? (
              <p style={{ ...hint, fontStyle: 'italic' }}>No restore points yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 6 }}>
                {(current.history ?? []).map((h) => (
                  <div key={`${h.rev}-${h.at}`} style={historyRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {h.label || (h.kind === 'manual' ? 'Manual save' : 'Autosnapshot')}
                      </div>
                      <div style={{ fontSize: 11, color: T.inkFaint }}>rev {h.rev} · {savedLabel(h.at)}</div>
                    </div>
                    <button style={{ ...btnGhost, padding: '4px 8px', fontSize: 12 }} onClick={() => restoreVersion(h.rev)}>
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

// ── edit helpers (mutate the live House immutably) ──

type Mutate = (producer: (d: RoomioDesign) => RoomioDesign) => void

function nudgeFirstFurniture(mutate: Mutate, dx: number, dz: number) {
  mutate((d) => withFirstFurniture(d, (f) => ({ ...f, x: f.x + dx, z: f.z + dz })))
}
function rotateFirstFurniture(mutate: Mutate) {
  mutate((d) => withFirstFurniture(d, (f) => ({ ...f, rotation: f.rotation + Math.PI / 12 })))
}
function setWallColor(mutate: Mutate, color: string) {
  mutate((d) => mapHouse(d, (h) => ({
    ...h,
    rooms: h.rooms.map((r, i) =>
      i === 0
        ? { ...r, interior: { ...r.interior, materials: { ...r.interior.materials, wallColor: color } } }
        : r,
    ),
  })))
}

function mapHouse(d: RoomioDesign, fn: (h: House) => House): RoomioDesign {
  return { ...d, scene: { ...d.scene, house: fn(d.scene.house) } }
}
function withFirstFurniture(d: RoomioDesign, fn: (f: FurnitureItem) => FurnitureItem): RoomioDesign {
  return mapHouse(d, (h) => ({
    ...h,
    rooms: h.rooms.map((r, ri) =>
      ri === 0 && r.interior.furniture.length
        ? { ...r, interior: { ...r.interior, furniture: r.interior.furniture.map((f, fi) => (fi === 0 ? fn(f) : f)) } }
        : r,
    ),
  }))
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={sectionTitle}>{children}</div>
}

// ── styles ──
const shell: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 16, boxSizing: 'border-box' }
const topbar: CSSProperties = { ...panel, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }
const nameInput: CSSProperties = { font: 'inherit', fontSize: 15, fontWeight: 700, color: T.ink, border: '1px solid transparent', borderRadius: 8, padding: '4px 8px', background: 'transparent', minWidth: 160 }
const body: CSSProperties = { flex: 1, display: 'flex', gap: 12, minHeight: 0 }
const sidebar: CSSProperties = { width: 240, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }
const stage: CSSProperties = { flex: 1, overflow: 'hidden', padding: 0 }
const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: T.inkFaint, marginTop: 6 }
const hint: CSSProperties = { fontSize: 12, color: T.inkSoft, margin: 0 }
const ctrlBtn: CSSProperties = { ...btnGhost, justifyContent: 'flex-start', border: `1px solid ${T.panelBorder}` }
const meta: CSSProperties = { fontSize: 12, color: T.inkSoft, display: 'grid', gap: 3 }
const historyPanel: CSSProperties = { width: 240, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }
const historyRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', border: `1px solid ${T.panelBorder}`, borderRadius: 8 }
