/**
 * "My Designs" library — the home base users return to (brief §4). Grid of cards
 * (thumbnail + name + last-edited) with open / inline-rename / duplicate /
 * delete-with-undo, plus sort + search. New designs start "Untitled room" and
 * autosave immediately (no name dialog up front).
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSession } from '../app/session'
import { savedLabel } from '../autosave/status'
import { T, panel, btnPrimary, btnGhost } from '../ui/theme'
import { sampleBedroom, sampleTwoRoom, sampleLighting } from '../demo/sampleScene'
import type { DesignSummary } from '../envelope/types'

type SortBy = 'recent' | 'name'

export function Library() {
  const summaries = useSession((s) => s.summaries)
  const refreshLibrary = useSession((s) => s.refreshLibrary)
  const open = useSession((s) => s.open)
  const newDesign = useSession((s) => s.newDesign)
  const duplicate = useSession((s) => s.duplicate)
  const renameDesign = useSession((s) => s.renameDesign)
  const deleteDesign = useSession((s) => s.deleteDesign)
  const undoDelete = useSession((s) => s.undoDelete)
  const importDesign = useSession((s) => s.importDesign)
  const lastDeleted = useSession((s) => s.lastDeleted)
  const backend = useSession((s) => s.backend)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showUndo, setShowUndo] = useState(false)

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  const pendingUndo = lastDeleted.length ? lastDeleted[lastDeleted.length - 1] : null
  // Show the Undo snackbar when a deletion happens; auto-hide after a while.
  useEffect(() => {
    if (lastDeleted.length === 0) return
    setShowUndo(true)
    const t = setTimeout(() => setShowUndo(false), 8000)
    return () => clearTimeout(t)
  }, [lastDeleted])

  const createBedroom = () => {
    const h = sampleBedroom()
    void newDesign(h, sampleLighting(h.rooms.map((r) => r.room_id)))
  }
  const createApartment = () => {
    const h = sampleTwoRoom()
    void newDesign(h, sampleLighting(h.rooms.map((r) => r.room_id)))
  }

  const visible = filterSort(summaries, query, sortBy)

  return (
    <div style={shell}>
      <header style={head}>
        <div>
          <h1 style={title}>My Designs</h1>
          <div style={sub}>{summaries.length} saved · storage: {backend}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnPrimary} onClick={createBedroom}>+ New room</button>
          <button style={btnGhost} onClick={createApartment}>+ New apartment</button>
          <button style={btnGhost} onClick={() => fileRef.current?.click()} title="Import a .roomio file">⤒ Import</button>
          <input
            ref={fileRef}
            type="file"
            accept=".roomio,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = '' // allow re-importing the same file
              if (!file) return
              const text = await file.text()
              await importDesign(text)
            }}
          />
        </div>
      </header>

      {summaries.length > 0 && (
        <div style={toolbar}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs…"
            style={search}
            aria-label="Search designs"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.inkFaint }}>Sort</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} style={select} aria-label="Sort by">
              <option value="recent">Recently edited</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
        </div>
      )}

      {summaries.length === 0 ? (
        <div style={{ ...panel, ...empty }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>No designs yet</div>
          <div style={{ color: T.inkSoft, fontSize: 13 }}>Create one — it autosaves as “Untitled room”.</div>
        </div>
      ) : (
        <div style={grid}>
          {visible.map((s) => (
            <Card
              key={s.design_id}
              summary={s}
              editing={editingId === s.design_id}
              onOpen={() => void open(s.design_id)}
              onStartRename={() => setEditingId(s.design_id)}
              onCommitRename={(name) => {
                setEditingId(null)
                void renameDesign(s.design_id, name)
              }}
              onCancelRename={() => setEditingId(null)}
              onDuplicate={() => void duplicate(s.design_id)}
              onDelete={() => void deleteDesign(s.design_id)}
            />
          ))}
          {visible.length === 0 && <div style={{ color: T.inkSoft, fontSize: 13 }}>No designs match “{query}”.</div>}
        </div>
      )}

      {showUndo && pendingUndo && (
        <div style={snackbar} role="status">
          <span>Deleted “{pendingUndo.name}”.{lastDeleted.length > 1 ? ` (+${lastDeleted.length - 1} more)` : ''}</span>
          <button
            style={{ ...btnGhost, color: '#9fe3cf', border: '1px solid transparent', padding: '4px 8px' }}
            onClick={() => {
              setShowUndo(false)
              void undoDelete()
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

function Card({
  summary: s,
  editing,
  onOpen,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onDelete,
}: {
  summary: DesignSummary
  editing: boolean
  onOpen: () => void
  onStartRename: () => void
  onCommitRename: (name: string) => void
  onCancelRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(s.name)
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing) {
      setDraft(s.name)
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [editing, s.name])

  return (
    <div style={card}>
      <button style={thumbBtn} onClick={onOpen} title="Open" aria-label={`Open ${s.name}`}>
        <div style={thumbWrap}>
          {s.thumbnail ? (
            <img src={s.thumbnail} alt="" style={thumb} />
          ) : (
            <div style={{ ...thumb, display: 'grid', placeItems: 'center', color: T.inkFaint }}>no preview</div>
          )}
        </div>
      </button>
      <div style={cardBody}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onCommitRename(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename(draft)
              if (e.key === 'Escape') onCancelRename()
            }}
            style={renameInput}
            aria-label="Rename design"
          />
        ) : (
          <div style={cardName} onDoubleClick={onStartRename} title={s.name}>
            {s.name}
          </div>
        )}
        <div style={cardMeta}>
          {s.roomCount} room{s.roomCount === 1 ? '' : 's'} · {savedLabel(s.updatedAt)}
        </div>
        <div style={actions}>
          <button style={miniBtn} onClick={onStartRename}>Rename</button>
          <button style={miniBtn} onClick={onDuplicate}>Duplicate</button>
          <button style={{ ...miniBtn, color: T.danger }} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function filterSort(list: DesignSummary[], query: string, sortBy: SortBy): DesignSummary[] {
  const q = query.trim().toLowerCase()
  const filtered = q ? list.filter((s) => s.name.toLowerCase().includes(q)) : list
  const sorted = [...filtered]
  if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
  return sorted
}

const shell: CSSProperties = { padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: '100%', boxSizing: 'border-box', overflow: 'auto' }
const head: CSSProperties = { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }
const title: CSSProperties = { margin: 0, fontSize: 26, fontWeight: 800, color: T.ink, letterSpacing: -0.5 }
const sub: CSSProperties = { color: T.inkSoft, fontSize: 13, marginTop: 4 }
const toolbar: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
const search: CSSProperties = { font: 'inherit', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: `1px solid ${T.panelBorder}`, background: '#fff', minWidth: 220 }
const select: CSSProperties = { font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8, border: `1px solid ${T.panelBorder}`, background: '#fff' }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }
const card: CSSProperties = { ...panel, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }
const thumbBtn: CSSProperties = { all: 'unset', cursor: 'pointer', display: 'block' }
const thumbWrap: CSSProperties = { aspectRatio: '16/11', background: '#cdccc9', overflow: 'hidden' }
const thumb: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
const cardBody: CSSProperties = { padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }
const cardName: CSSProperties = { fontSize: 14, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'text' }
const renameInput: CSSProperties = { font: 'inherit', fontSize: 14, fontWeight: 700, color: T.ink, border: `1px solid ${T.accent}`, borderRadius: 6, padding: '3px 6px', width: '100%', boxSizing: 'border-box' }
const cardMeta: CSSProperties = { fontSize: 12, color: T.inkSoft }
const actions: CSSProperties = { display: 'flex', gap: 4, marginTop: 6 }
const miniBtn: CSSProperties = { font: 'inherit', fontSize: 12, fontWeight: 600, color: T.inkSoft, background: 'transparent', border: `1px solid ${T.panelBorder}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }
const empty: CSSProperties = { padding: 40, display: 'grid', gap: 6, placeItems: 'center', textAlign: 'center' }
const snackbar: CSSProperties = { position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: T.ink, color: '#fff', padding: '10px 14px', borderRadius: 10, boxShadow: T.shadow, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, zIndex: 60 }
