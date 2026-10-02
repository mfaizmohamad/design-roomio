/**
 * Rooms bar (Agent C, multi-room) — the in-app UI to ADD ROOMS and switch between
 * them, shown at the top of the Furnish panel. Reuses /multi-room's room types.
 * Self-contained; drives the additive house session (houseSession.ts).
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useStore } from '../store'
import { useHouse, ROOM_TYPE_LIST, ROOM_TYPE_INFO } from './houseSession'
import { useHouseView } from './houseViewMode'
import { HOMES } from '../data/homes'
import { openHome } from '../homeLauncher'
import { levelOf } from './houseLevels'
import { RoomMeasurements } from './RoomMeasurements'
import type { LevelFilter } from './houseViewMode'

export function RoomsBar() {
  const rooms = useHouse((s) => s.rooms)
  const activeId = useHouse((s) => s.activeId)
  const ensureInit = useHouse((s) => s.ensureInit)
  const addRoom = useHouse((s) => s.addRoom)
  const switchRoom = useHouse((s) => s.switchRoom)
  const removeRoom = useHouse((s) => s.removeRoom)
  const loadFlat1BHK = useHouse((s) => s.loadFlat1BHK)
  const loadFlat2BHK = useHouse((s) => s.loadFlat2BHK)
  const loadFlat3BHK = useHouse((s) => s.loadFlat3BHK)
  const currentHome = useHouse((s) => s.homeId)
  const levels = useHouse((s) => s.levels)
  const levelFilter = useHouseView((s) => s.levelFilter)
  const lastRemoved = useHouse((s) => s.lastRemoved)
  const undoRemove = useHouse((s) => s.undoRemove)
  const dismissUndo = useHouse((s) => s.dismissUndo)
  // live name of the active room (the editor owns the active design)
  const activeName = useStore((s) => s.design.name)
  const [adding, setAdding] = useState(false)

  // Seed the house from the current room the first time the furnish view shows.
  useEffect(() => {
    ensureInit()
  }, [ensureInit])

  // Auto-dismiss the "Undo" banner a few seconds after a delete.
  useEffect(() => {
    if (!lastRemoved) return
    const t = setTimeout(() => dismissUndo(), 7000)
    return () => clearTimeout(t)
  }, [lastRemoved, dismissUndo])

  const list = rooms.length ? rooms : []

  // Load a furnished flat template (each room gets a distinctive floor + starter furniture).
  const loadTemplate = (fn: () => void, label: string) => {
    if (list.length <= 1 || confirm(`Replace the current rooms with a furnished ${label} flat? Current rooms will be discarded.`)) {
      fn()
      useHouseView.getState().setMode('house')
    }
  }

  // Isolating a storey also moves editing onto it (first room of that level),
  // so the 2D plan and the room chips follow what is on screen.
  const showLevel = (f: LevelFilter) => {
    useHouseView.getState().setLevelFilter(f)
    useHouseView.getState().setMode('house')
    if (f === 'all') return
    const active = list.find((r) => r.id === activeId)
    if (active && levelOf(active) === f) return
    const first = list.find((r) => levelOf(r) === f)
    if (first) switchRoom(first.id)
  }

  // Loading a home replaces the user's rooms, so confirm unless there is nothing to lose.
  const loadHome = (homeId: string, title: string) => {
    if (homeId === currentHome) return
    if (list.length <= 1 || confirm(`Replace the current rooms with the ${title}? Current rooms will be discarded.`)) {
      openHome(homeId)
    }
  }

  return (
    <div style={wrap}>
      <div className="section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Rooms{list.length > 1 ? ` · ${list.length}` : ''}</span>
      </div>

      {/* Storey toggle for ANY multi-level house: every floor stacked (default) or one isolated. */}
      {levels.length > 1 && (
        <div style={{ ...chipRow, marginTop: 8 }} data-testid="level-toggle">
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, marginRight: 2 }}>Floors</span>
          {(['all', ...levels.map((_, i) => i)] as LevelFilter[]).map((f) => (
            <button
              key={String(f)}
              className={`btn btn-sm ${levelFilter === f ? '' : 'btn-ghost'}`}
              style={{ flex: 'none' }}
              aria-pressed={levelFilter === f}
              onClick={() => showLevel(f)}
              data-testid={`level-${f}`}
            >
              {f === 'all' ? '▦ All floors' : levels[f].label}
            </button>
          ))}
        </div>
      )}
      <RoomMeasurements />

      <div style={chipRow}>
        {list.filter((r) => levelFilter === 'all' || levelOf(r) === levelFilter).map((r) => {
          const active = r.id === activeId
          const name = active ? activeName : r.design.name
          const typeLabel = ROOM_TYPE_INFO[r.type].label
          // Show the type as a muted prefix only when it adds information.
          const showType = name.trim().toLowerCase() !== typeLabel.toLowerCase()
          return (
            <span key={r.id} style={{ ...chip, ...(active ? chipActive : null) }} data-testid="room-chip">
              <button
                onClick={() => switchRoom(r.id)}
                title={`${typeLabel} — switch to this room`}
                style={chipBtn(active)}
              >
                {showType && <span style={{ opacity: 0.7, marginRight: 5 }}>{typeLabel}</span>}
                {name}
              </button>
              {list.length > 1 && (
                <button
                  onClick={() => removeRoom(r.id)}
                  title="Remove room (you can undo)"
                  style={chipX(active)}
                >
                  ×
                </button>
              )}
            </span>
          )
        })}

        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 'none' }}
          onClick={() => setAdding((v) => !v)}
          data-testid="add-room"
        >
          ＋ Add room
        </button>

      </div>

      {/* Furnished flat templates — each room gets a distinctive floor + type-appropriate starter
          furniture (kitchen tile + counter/sink/stove, bathroom blue tile + toilet/vanity/shower,
          bedroom warm wood + bed, …) so the plan reads as a real home the moment it loads. */}
      <div style={{ ...chipRow, marginTop: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, marginRight: 2 }}>🏠 Start from a flat</span>
        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 'none' }}
          onClick={() => loadTemplate(loadFlat1BHK, '1BHK (~460 sq ft)')}
          title="Load a furnished 1BHK: living, bedroom, kitchen, bath, foyer + utility balcony"
          data-testid="load-1bhk"
        >
          1BHK
        </button>
        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 'none' }}
          onClick={() => loadTemplate(loadFlat2BHK, '2BHK (~800 sq ft)')}
          title="Load a furnished 2BHK: living, kitchen, dining, 2 bedrooms, 2 baths, hallway, balcony"
          data-testid="load-2bhk"
        >
          2BHK
        </button>
        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 'none' }}
          onClick={() => loadTemplate(loadFlat3BHK, '3BHK (~1250 sq ft)')}
          title="Load a furnished 3BHK: foyer, living, dining, kitchen, 3 bedrooms, baths, hallway"
          data-testid="load-3bhk"
        >
          3BHK
        </button>
      </div>

      {/* Multi-storey homes from the registry (data/homes) — add a home there and it shows here. */}
      <div style={{ ...chipRow, marginTop: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.6, marginRight: 2 }}>🏙️ Duplex homes</span>
        {HOMES.map((h) => (
          <button
            key={h.id}
            className={`btn btn-sm ${currentHome === h.id ? '' : 'btn-ghost'}`}
            style={{ flex: 'none' }}
            onClick={() => loadHome(h.id, h.title)}
            title={h.blurb}
            data-testid={`load-home-${h.id}`}
          >
            {h.emoji} {h.title}
          </button>
        ))}
      </div>


      {lastRemoved && (
        <div style={undoBar} data-testid="undo-bar">
          <span style={{ flex: 1 }}>
            Removed <b>{lastRemoved.entry.design.name}</b>
          </span>
          <button onClick={() => undoRemove()} style={undoBtn} data-testid="undo-btn">
            ↩ Undo
          </button>
          <button onClick={() => dismissUndo()} title="Dismiss" style={undoDismiss}>
            ×
          </button>
        </div>
      )}

      {adding && (
        <div style={picker} data-testid="room-type-picker">
          <div className="section-label" style={{ margin: '2px 0 6px' }}>Add a…</div>
          <div style={pickerGrid}>
            {ROOM_TYPE_LIST.map((info) => (
              <button
                key={info.type}
                className="btn btn-ghost btn-sm"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => {
                  addRoom(info.type)
                  setAdding(false)
                }}
                title={info.purpose}
              >
                {info.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const wrap: CSSProperties = {
  marginBottom: 18,
  paddingBottom: 16,
  borderBottom: '1.5px solid #e6e3dd',
}
const chipRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }
const chip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1.5px solid #d9d5cd',
  borderRadius: 999,
  overflow: 'hidden',
  background: '#fff',
}
const chipActive: CSSProperties = { border: '1.5px solid #111', background: '#111' }
const chipBtn = (active: boolean): CSSProperties => ({
  border: 'none',
  background: 'transparent',
  color: active ? '#fff' : 'var(--ink-1, #23211e)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '6px 12px',
})
const chipX = (active: boolean): CSSProperties => ({
  border: 'none',
  background: 'transparent',
  color: active ? '#fff' : '#b0392f',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 8px 4px 0',
})
const picker: CSSProperties = {
  marginTop: 10,
  padding: 12,
  borderRadius: 12,
  border: '1.5px solid #e6e3dd',
  background: '#fbfaf7',
}
const pickerGrid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }
const undoBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  padding: '8px 12px',
  borderRadius: 10,
  background: '#1f2937',
  color: '#e9eef5',
  fontSize: 13,
}
const undoBtn: CSSProperties = {
  border: '1px solid #3b82f6',
  background: '#3b82f6',
  color: '#fff',
  borderRadius: 999,
  padding: '5px 12px',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
  flex: 'none',
}
const undoDismiss: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#9fb0c3',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 2px',
  flex: 'none',
}
