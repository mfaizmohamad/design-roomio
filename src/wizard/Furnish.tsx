import { useState, useMemo, useRef, useEffect, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useStore } from '../store'
import { useLighting } from '../../lighting/src/store'
import { showEditingHints } from '../../lighting/src/contract'
import { ARCHETYPES, ARCHETYPE_MAP, CATEGORY_ORDER, type Archetype } from '../data/archetypes'
import { formatLenShort } from '../units'
import { bbox, deriveWalls } from '../geometry/walls'
import { DOOR_DEFS, WINDOW_DEFS, OPENING_MAP } from '../data/openings'
import type { Opening, Vec2 } from '../types'

// Friendly labels for the catalogue sub-type facet chips (filter a drilled category by `model`).
const MODEL_LABEL: Record<string, string> = {
  sofa: 'Sofas', sectional: 'Sectionals', bed: 'Beds',
  table: 'Tables', roundTable: 'Round', desk: 'Desks',
  chair: 'Chairs', officeChair: 'Office', bench: 'Benches', ottoman: 'Ottomans', stool: 'Stools',
  cabinet: 'Cabinets', openShelf: 'Shelves', box: 'Boxes',
  lamp: 'Lamps', mirror: 'Mirrors', plant: 'Plants', rug: 'Rugs', tv: 'TVs',
  counter: 'Counters', fridge: 'Fridges', island: 'Islands', rangeHood: 'Hoods', stove: 'Stoves',
  washer: 'Washers', vanity: 'Sinks',
  bathtub: 'Bathtubs', jacuzzi: 'Jacuzzi', shower: 'Showers', toilet: 'Toilets', tubFreestanding: 'Tubs',
}
const modelLabel = (m: string) => MODEL_LABEL[m] ?? m
import type { FurnitureItem, FurnitureCategory } from '../types'
import { ScanRoom } from './ScanRoom'
import { Suggestions } from './Suggestions'
import { useHouse } from '../three/houseSession'
import { defaultFurnitureFor } from '../data/flatTemplates'
// Agent C (multi-room): in-app "add rooms" — switch between rooms of the house.
import { RoomsBar } from '../three/RoomsBar'

// Curated furniture palette — greys, blues, greens, tans, terracotta, charcoal,
// cream, mustard, plum. The selected item's archetype default is appended too,
// so the original colour always has a swatch.
const PALETTE = [
  '#c8c4bc', // light grey
  '#8a8780', // mid grey
  '#3b3f45', // charcoal
  '#7d8a99', // slate blue
  '#4f6275', // deep blue
  '#6f7d72', // sage green
  '#3f7a4b', // forest green
  '#cdbfa6', // tan
  '#f3eddf', // cream
  '#c08a6a', // terracotta
  '#d8a93a', // mustard
  '#7a4f6b', // plum
]

function normalizeDeg(rad: number): number {
  let deg = Math.round((rad * 180) / Math.PI) % 360
  if (deg < 0) deg += 360
  return deg
}

function ItemEditor({ item }: { item: FurnitureItem }) {
  const unit = useStore((s) => s.design.unit)
  const updateFurniture = useStore((s) => s.updateFurniture)
  const removeFurniture = useStore((s) => s.removeFurniture)

  const arch = ARCHETYPE_MAP[item.archetype]
  const min = arch?.min ?? [10, 10, 10]
  const max = arch?.max ?? [400, 400, 400]
  const lockH = arch?.lockH ?? false

  // palette including the archetype default colour (deduped)
  const colors = arch && !PALETTE.includes(arch.color) ? [...PALETTE, arch.color] : PALETTE

  const rotateBy = (delta: number) =>
    updateFurniture(item.id, { rotation: item.rotation + delta })
  const snap90 = () => {
    const step = Math.PI / 2
    updateFurniture(item.id, { rotation: Math.round(item.rotation / step) * step })
  }

  const dims: { label: string; key: 'w' | 'd' | 'h'; axis: number }[] = [
    { label: 'Width', key: 'w', axis: 0 },
    { label: 'Depth', key: 'd', axis: 1 },
    { label: 'Height', key: 'h', axis: 2 },
  ]

  return (
    <div
      style={{
        background: '#fbfaf7',
        padding: '16px 18px',
        borderRadius: 14,
        border: '1.5px solid #e6e3dd',
        marginBottom: 22,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{item.name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => updateFurniture(item.id, { locked: !item.locked })}
            title={item.locked ? 'Unlock to move' : 'Lock in place'}
            style={{
              border: `1.5px solid ${item.locked ? '#111' : '#d9d5cd'}`,
              background: item.locked ? '#111' : '#fff',
              color: item.locked ? '#fff' : 'var(--ink-2)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '5px 10px',
              borderRadius: 999,
            }}
          >
            {item.locked ? '🔒 Locked' : '🔓 Lock'}
          </button>
          <button
            onClick={() => removeFurniture(item.id)}
            style={{ border: 'none', background: 'none', color: '#b0392f', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}
          >
            Remove
          </button>
        </div>
      </div>

      {/* ---- Rotation ---- */}
      <div className="wall-row" style={{ marginBottom: 16 }}>
        <span className="wall-name">Rotation</span>
        <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={() => rotateBy(-Math.PI / 12)}>
          ⟲ 15°
        </button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={() => rotateBy(Math.PI / 12)}>
          ⟳ 15°
        </button>
        <button className="btn btn-ghost btn-sm" style={{ flex: 'none' }} onClick={snap90}>
          90°
        </button>
        <span style={{ minWidth: 42, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>
          {normalizeDeg(item.rotation)}°
        </span>
      </div>

      {/* ---- Resize ---- */}
      <div className="section-label" style={{ margin: '0 0 10px' }}>
        Size
      </div>
      {dims.map(({ label, key, axis }) => {
        const disabled = key === 'h' && lockH
        return (
          <div className="wall-row" key={key} style={{ marginBottom: 10 }}>
            <span className="wall-name" style={{ flex: 'none', minWidth: 54 }}>
              {label}
            </span>
            <input
              type="range"
              min={min[axis]}
              max={max[axis]}
              step={1}
              value={item[key]}
              disabled={disabled}
              onChange={(e) => updateFurniture(item.id, { [key]: Number(e.target.value) })}
              style={{ flex: 1, opacity: disabled ? 0.4 : 1 }}
            />
            <span style={{ minWidth: 56, textAlign: 'right', fontSize: 13.5, fontWeight: 600 }}>
              {formatLenShort(item[key], unit)}
            </span>
          </div>
        )
      })}

      {/* ---- Color ---- */}
      <div className="section-label" style={{ margin: '16px 0 10px' }}>
        Colour
      </div>
      <div className="swatch-grid">
        {colors.map((c) => (
          <button
            key={c}
            title={c}
            className={`swatch${item.color === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => updateFurniture(item.id, { color: c })}
          />
        ))}
      </div>
    </div>
  )
}

/** One 2-column grid of catalog cards. Each card adds an instance on click and,
 *  once ≥1 is placed, shows a live count with a "−" to remove the most recent. */
function CatalogGrid({
  items,
  counts,
  onAdd,
  onRemoveLast,
}: {
  items: Archetype[]
  counts: Record<string, number>
  onAdd: (id: string) => void
  onRemoveLast: (id: string) => void
}) {
  // IKEA-style cards: show a color swatch + W×D×H dimensions so "does it fit?" is answered before
  // placing (fit is the #1 question in a spatial planner). Data already lives on every Archetype.
  const unit = useStore((s) => s.design.unit)
  return (
    <div className="catalog-grid">
      {items.map((a) => {
        const n = counts[a.id] ?? 0
        const dims = `${formatLenShort(a.w, unit)} × ${formatLenShort(a.d, unit)} × ${formatLenShort(a.h, unit)}`
        return (
          <div
            key={a.id}
            className={`catalog-card${n > 0 ? ' added' : ''}`}
            data-testid={`catalog-card-${a.id}`}
          >
            <button className="catalog-card__add" onClick={() => onAdd(a.id)} title={`Add ${a.name} · ${dims} (W×D×H)`}>
              <span className="catalog-icon" style={{ position: 'relative' }}>
                {a.icon}
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: '50%',
                    background: a.color, border: '1.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.12)',
                  }}
                />
              </span>
              <span className="catalog-card__name">{a.name}</span>
              <span
                className="catalog-card__dims"
                style={{ fontSize: 10.5, opacity: 0.6, fontVariantNumeric: 'tabular-nums', marginTop: 1 }}
                aria-label={`${dims} width by depth by height`}
              >
                {dims}
              </span>
            </button>
            {n > 0 ? (
              <span className="catalog-card__stepper">
                <button
                  className="catalog-card__minus"
                  onClick={() => onRemoveLast(a.id)}
                  title={`Remove one ${a.name}`}
                  aria-label={`Remove one ${a.name}`}
                >
                  −
                </button>
                <span
                  className="catalog-card__count"
                  data-testid={`catalog-count-${a.id}`}
                  aria-label={`${n} in room`}
                >
                  {n}
                </span>
              </span>
            ) : (
              <span className="catalog-card__plus" aria-hidden>
                ＋
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Catalogue tab — category-first browsing (NN/g + Baymard): big identifying
 * category tiles are the primary content; tapping one drills into that topic's
 * pieces (navigation → browsing kept separate). A persistent search is the
 * escape hatch that flattens results across every category.
 */
function CataloguePanel({
  counts,
  onAdd,
  onRemoveLast,
  hints,
}: {
  counts: Record<string, number>
  onAdd: (id: string) => void
  onRemoveLast: (id: string) => void
  hints: boolean
}) {
  const [scanning, setScanning] = useState(false)
  const [cat, setCat] = useState<FurnitureCategory | null>(null)
  const [query, setQuery] = useState('')
  const [subModel, setSubModel] = useState<string | null>(null) // sub-type facet within a category
  const [fitsOnly, setFitsOnly] = useState(false) // "fits this room" size filter
  const inputRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  // Room footprint (cm) for the "fits this room" filter — Roomio's differentiator: it knows the
  // room's real dimensions, so it can hide pieces that can't physically fit (with side clearance).
  const corners = useStore((s) => s.design.corners)
  const roomB = bbox(corners)
  const CLEARANCE = 30 // cm each side
  const fitsRoom = (a: Archetype) =>
    (a.mount != null && a.mount !== 'floor') || // wall/surface pieces don't need floor footprint
    (a.w <= roomB.w - CLEARANCE && a.d <= roomB.d - CLEARANCE)
  const openCat = (c: FurnitureCategory | null) => {
    setCat(c)
    setSubModel(null) // reset the sub-type facet when switching categories
  }

  const catList = CATEGORY_ORDER.filter((c) => ARCHETYPES.some((a) => a.category === c.id))
  const activeCat = cat ? CATEGORY_ORDER.find((c) => c.id === cat) : null

  // IKEA "furnish this room" one-tap: the active room's type has a research-grounded starter set
  // (defaultFurnitureFor); drop the whole coordinated set in one tap, snapped by the §7 solver.
  const rooms = useHouse((s) => s.rooms)
  const activeId = useHouse((s) => s.activeId)
  const activeType = rooms.find((r) => r.id === activeId)?.type ?? 'living'
  const starterCount = defaultFurnitureFor(activeType, [
    { x: 0, z: 0 }, { x: 400, z: 0 }, { x: 400, z: 300 }, { x: 0, z: 300 },
  ]).length
  const furnishThisRoom = () => {
    const st = useStore.getState()
    const corners = st.design.corners
    const pieces = defaultFurnitureFor(activeType, corners)
    if (!pieces.length) return
    if (st.design.furniture.length > 0 && !confirm(`Add a starter ${activeType} set (${pieces.length} pieces) on top of what's here?`)) return
    for (const p of pieces) st.addFurniture(p.archetype, p.x, p.z)
    st.selectFurniture(null)
  }

  return (
    <div>
      <button
        className="btn btn-ghost"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}
        onClick={() => setScanning((v) => !v)}
      >
        📷 Scan a room photo
      </button>
      {scanning && <ScanRoom onClose={() => setScanning(false)} />}

      {starterCount > 0 && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}
          onClick={furnishThisRoom}
          data-testid="furnish-this-room"
          title={`Drop in a starter ${activeType} set (${starterCount} coordinated pieces), then tweak`}
        >
          ✨ Furnish this room ({activeType})
        </button>
      )}

      <div className="catalog-search">
        <span aria-hidden style={{ opacity: 0.5, fontSize: 14 }}>
          🔍
        </span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all furniture…"
          aria-label="Search furniture"
          data-testid="catalog-search"
        />
        {query && (
          <button
            className="catalog-search__clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            title="Clear search"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {searching ? (
        (() => {
          const items = ARCHETYPES.filter((a) => a.name.toLowerCase().includes(q))
          return items.length ? (
            <CatalogGrid items={items} counts={counts} onAdd={onAdd} onRemoveLast={onRemoveLast} />
          ) : (
            <div className="catalog-empty">No furniture matches “{query}”.</div>
          )
        })()
      ) : cat === null ? (
        <>
          <div className="section-label" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span>Browse by category</span>
            <span className="sub">{ARCHETYPES.length} pieces</span>
          </div>
          <div className="cat-tile-grid">
            {catList.map((c) => {
              const n = ARCHETYPES.filter((a) => a.category === c.id).length
              return (
                <button
                  key={c.id}
                  className="cat-tile"
                  style={{ background: `linear-gradient(150deg, ${c.tint} 0%, #ffffff 92%)` }}
                  onClick={() => openCat(c.id)}
                  data-testid={`cat-tile-${c.id}`}
                  aria-label={`${c.label}, ${n} pieces`}
                >
                  <span className="cat-tile__icon" aria-hidden>
                    {c.icon}
                  </span>
                  <span className="cat-tile__meta">
                    <span className="cat-tile__label">{c.label}</span>
                    <span className="cat-tile__count">{n} pieces</span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <>
          <div className="catalogue-drill">
            <button
              className="catalogue-back"
              onClick={() => openCat(null)}
              data-testid="catalogue-back"
              aria-label="Back to all categories"
            >
              ‹ Categories
            </button>
            <span className="catalogue-drill__title">
              <span aria-hidden style={{ marginRight: 6 }}>
                {activeCat?.icon}
              </span>
              {activeCat?.label}
              <span className="catalogue-drill__n"> · {ARCHETYPES.filter((a) => a.category === cat).length}</span>
            </span>
          </div>
          {(() => {
            const catItems = ARCHETYPES.filter((a) => a.category === cat)
            const models = [...new Set(catItems.map((a) => a.model))]
            // count how many would be hidden by the fit filter, to decide whether to offer it
            const anyTooBig = catItems.some((a) => !fitsRoom(a))
            const shown = catItems.filter(
              (a) => (!subModel || a.model === subModel) && (!fitsOnly || fitsRoom(a)),
            )
            const chip = (active: boolean): CSSProperties => ({
              padding: '5px 11px', borderRadius: 999, border: '1px solid rgba(0,0,0,0.14)',
              background: active ? '#111' : '#fff', color: active ? '#fff' : '#23211e',
              font: '600 12px ui-sans-serif, system-ui, sans-serif', cursor: 'pointer', flex: 'none',
            })
            return (
              <>
                {(models.length > 1 || anyTooBig) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }} data-testid="catalogue-facets">
                    {anyTooBig && (
                      <button
                        style={chip(fitsOnly)}
                        aria-pressed={fitsOnly}
                        onClick={() => setFitsOnly((v) => !v)}
                        data-testid="facet-fits-room"
                        title="Show only pieces that physically fit this room (with clearance)"
                      >
                        ↔ Fits this room
                      </button>
                    )}
                    {models.length > 1 && (
                      <>
                        <button style={chip(subModel === null)} aria-pressed={subModel === null} onClick={() => setSubModel(null)}>
                          All
                        </button>
                        {models.map((m) => (
                          <button
                            key={m}
                            style={chip(subModel === m)}
                            aria-pressed={subModel === m}
                            onClick={() => setSubModel((v) => (v === m ? null : m))}
                            data-testid={`facet-model-${m}`}
                          >
                            {modelLabel(m)}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
                {shown.length ? (
                  <CatalogGrid items={shown} counts={counts} onAdd={onAdd} onRemoveLast={onRemoveLast} />
                ) : (
                  <div className="catalog-empty">
                    {fitsOnly ? 'Nothing in this category fits the room — try a smaller piece or a bigger room.' : 'No pieces here.'}
                  </div>
                )}
              </>
            )
          })()}
        </>
      )}

      {hints && (
        <p className="hint" style={{ marginTop: 16 }}>
          Pick a category, then tap a piece to drop it in. Added pieces show a count you can adjust
          with <b>−</b>. Select any piece to fine-tune it in the <b>Design</b> tab.
        </p>
      )}
    </div>
  )
}

/** A welcoming, guided empty state so a brand-new room isn't a blank box. */
function EmptyRoomWelcome({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="lb-empty">
      <div style={{ fontSize: 26, marginBottom: 6 }}>🛋️</div>
      <div className="lb-empty__title">Your room is empty — let’s furnish it!</div>
      <div className="lb-empty__sub">
        Open the catalogue to browse furniture by category and drop pieces in. The 💡 Suggestions
        above call out what every room needs.
      </div>
      <button className="btn btn-primary btn-sm" onClick={onBrowse}>
        Browse catalogue →
      </button>
    </div>
  )
}

/** Shown on the Design tab when nothing is selected — points to how to edit / add. */
function SelectPrompt({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="lb-empty">
      <div style={{ fontSize: 22, marginBottom: 6 }}>👆</div>
      <div className="lb-empty__title">Nothing selected</div>
      <div className="lb-empty__sub">
        Click a piece in the scene — or open <b>In&nbsp;Room</b> — to edit it here. Add new furniture
        from the <b>Catalogue</b>.
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onBrowse}>
        Open catalogue
      </button>
    </div>
  )
}

/**
 * Design tab (default) — the contextual inspector. Selecting a piece shows ONLY
 * that piece's editor (so the default view stays focused); with nothing selected
 * it surfaces room-level Suggestions and a guided empty/select state.
 */
function DesignPanel({
  selected,
  roomEmpty,
  onBrowse,
}: {
  selected: FurnitureItem | undefined
  roomEmpty: boolean
  onBrowse: () => void
}) {
  const selectFurniture = useStore((s) => s.selectFurniture)
  if (selected) {
    return (
      <div>
        <button className="panel-back" onClick={() => selectFurniture(null)} data-testid="editor-done">
          ‹ Done editing
        </button>
        <ItemEditor item={selected} />
      </div>
    )
  }
  return (
    <div>
      <Suggestions />
      {roomEmpty ? <EmptyRoomWelcome onBrowse={onBrowse} /> : <SelectPrompt onBrowse={onBrowse} />}
    </div>
  )
}

/**
 * "In Room" tab — every piece placed in this room (a scene/objects list). Click
 * one to select it, which jumps to the Design tab to edit; × removes it.
 */
function PlacedPanel({ onBrowse }: { onBrowse: () => void }) {
  const furniture = useStore((s) => s.design.furniture)
  const selectFurniture = useStore((s) => s.selectFurniture)
  const removeFurniture = useStore((s) => s.removeFurniture)

  if (furniture.length === 0) {
    return (
      <div className="lb-empty" data-testid="products-used">
        <div style={{ fontSize: 22, marginBottom: 6 }}>📦</div>
        <div className="lb-empty__title">Nothing placed yet</div>
        <div className="lb-empty__sub">Add furniture from the catalogue and it’ll show up here.</div>
        <button className="btn btn-primary btn-sm" onClick={onBrowse}>
          Browse catalogue →
        </button>
      </div>
    )
  }
  return (
    <div data-testid="products-used">
      <div className="section-label" style={{ marginTop: 0 }}>
        Products used · {furniture.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {furniture.map((item) => {
          const arch = ARCHETYPE_MAP[item.archetype]
          return (
            <div key={item.id} style={prodRow}>
              <button
                onClick={() => selectFurniture(item.id)}
                title="Select to edit (rotate / resize / recolor)"
                style={prodMain}
                data-testid="placed-item"
              >
                <span style={{ fontSize: 15 }}>{arch?.icon ?? '📦'}</span>
                <span style={{ ...prodSwatch, background: item.color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {arch?.name ?? item.archetype}
                </span>
                {item.locked && (
                  <span title="Locked" style={{ marginLeft: 'auto', fontSize: 11 }}>
                    🔒
                  </span>
                )}
              </button>
              <button onClick={() => removeFurniture(item.id)} title="Remove this piece" style={prodX}>
                ×
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const prodRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  border: '1.5px solid #e6e3dd',
  borderRadius: 10,
  background: '#fff',
  overflow: 'hidden',
}
const prodMain: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '8px 10px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--ink-1, #23211e)',
}
const prodSwatch: CSSProperties = { width: 14, height: 14, borderRadius: 4, border: '1px solid rgba(0,0,0,.15)', flex: 'none' }
const prodX: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#b0392f',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  padding: '4px 10px',
  flex: 'none',
}

/**
 * Pick the wall + parametric t with the most free room for a new opening `defWidth` cm wide, so a
 * door/window added from the panel lands on an empty stretch of wall (not overlapping another
 * opening). Falls back to the longest wall centred. Null only for a degenerate (wall-less) room.
 */
function placeOpening(corners: Vec2[], openings: Opening[], defWidth: number): { wallId: string; t: number } | null {
  const walls = deriveWalls(corners)
  if (!walls.length) return null
  const margin = 20 // cm breathing room at wall ends + between openings
  const need = defWidth + margin
  let best: { wallId: string; t: number; gap: number } | null = null
  for (const w of walls) {
    if (w.length < defWidth + 2 * margin) continue
    const occ = openings
      .filter((o) => o.wallId === w.id)
      .map((o) => {
        const c = o.t * w.length
        return [c - o.width / 2 - margin, c + o.width / 2 + margin] as [number, number]
      })
      .sort((a, b) => a[0] - b[0])
    let cursor = margin
    const gaps: Array<[number, number]> = []
    for (const [s, e] of occ) {
      if (s - cursor >= need) gaps.push([cursor, s])
      cursor = Math.max(cursor, e)
    }
    if (w.length - margin - cursor >= need) gaps.push([cursor, w.length - margin])
    for (const [s, e] of gaps) {
      const gap = e - s
      if (!best || gap > best.gap) best = { wallId: w.id, t: (s + e) / 2 / w.length, gap }
    }
  }
  if (best) return { wallId: best.wallId, t: best.t }
  const longest = walls.reduce((m, w) => (w.length > m.length ? w : m))
  return { wallId: longest.id, t: 0.5 }
}

/**
 * "Openings" tab — add a window or door to the room without leaving Furnish. Each style drops onto a
 * free stretch of wall (auto-placed); the list below removes them. Adding a WINDOW unlocks Sun Mode.
 */
function OpeningsPanel() {
  const corners = useStore((s) => s.design.corners)
  const openings = useStore((s) => s.design.openings)
  const addOpening = useStore((s) => s.addOpening)
  const removeOpening = useStore((s) => s.removeOpening)

  const add = (style: (typeof WINDOW_DEFS)[number]['style'], width: number) => {
    const spot = placeOpening(corners, openings, width)
    if (spot) addOpening(style, spot.wallId, spot.t)
  }

  const windows = openings.filter((o) => o.kind === 'window')
  const doors = openings.filter((o) => o.kind === 'door')

  const Card = ({ icon, name, style, width, tid }: { icon: string; name: string; style: (typeof WINDOW_DEFS)[number]['style']; width: number; tid: string }) => (
    <div className="catalog-card" data-testid={tid}>
      <button className="catalog-card__add" onClick={() => add(style, width)} title={`Add ${name}`}>
        <span className="catalog-icon">{icon}</span>
        <span className="catalog-card__name">{name}</span>
      </button>
      <span className="catalog-card__plus" aria-hidden>
        ＋
      </span>
    </div>
  )

  return (
    <div>
      <div className="section-label" style={{ marginTop: 0 }}>
        Add a window or door
      </div>
      <p className="hint" style={{ margin: '0 0 12px' }}>
        Tap to drop one onto a free stretch of wall. Windows let daylight in — add one to unlock <b>☀ Sun&nbsp;Mode</b>.
      </p>

      <div className="catalog-subhead">
        <span>Windows</span>
        <span className="catalog-subhead__n">{windows.length}</span>
      </div>
      <div className="catalog-grid">
        {WINDOW_DEFS.map((d) => (
          <Card key={d.style} icon="🪟" name={d.name} style={d.style} width={d.width} tid={`opening-${d.style}`} />
        ))}
      </div>

      <div className="catalog-subhead" style={{ marginTop: 14 }}>
        <span>Doors</span>
        <span className="catalog-subhead__n">{doors.length}</span>
      </div>
      <div className="catalog-grid">
        {DOOR_DEFS.map((d) => (
          <Card key={d.style} icon="🚪" name={d.name} style={d.style} width={d.width} tid={`opening-${d.style}`} />
        ))}
      </div>

      {openings.length > 0 && (
        <>
          <div className="section-label">In this room · {openings.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="openings-list">
            {openings.map((o) => (
              <div key={o.id} style={prodRow}>
                <span style={{ ...prodMain, cursor: 'default' }}>
                  <span style={{ fontSize: 15 }}>{o.kind === 'window' ? '🪟' : '🚪'}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {OPENING_MAP[o.style]?.name ?? o.style}
                  </span>
                </span>
                <button onClick={() => removeOpening(o.id)} title="Remove this opening" style={prodX} data-testid="opening-remove">
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

type Tab = 'design' | 'catalogue' | 'openings' | 'placed'
const TABS: { id: Tab; label: string }[] = [
  { id: 'design', label: 'Design' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'openings', label: 'Openings' },
  { id: 'placed', label: 'In Room' },
]

/** The left-bar section switcher — a real ARIA tab pattern (each tab controls a panel). */
function TabBar({ tab, setTab, placedCount, openingsCount }: { tab: Tab; setTab: (t: Tab) => void; placedCount: number; openingsCount: number }) {
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const i = TABS.findIndex((t) => t.id === tab)
    let ni = i
    if (e.key === 'ArrowRight') ni = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') ni = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') ni = 0
    else ni = TABS.length - 1
    setTab(TABS[ni].id)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${TABS[ni].id}"]`)?.focus()
  }
  return (
    <div className="lb-tabs" role="tablist" aria-label="Furnish panel sections" onKeyDown={onKey}>
      {TABS.map((t) => {
        const active = tab === t.id
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls="lb-panel"
            tabIndex={active ? 0 : -1}
            data-tab={t.id}
            className={`lb-tab${active ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
            {t.id === 'placed' && placedCount > 0 && <span className="lb-tab__badge">{placedCount}</span>}
            {t.id === 'openings' && openingsCount > 0 && <span className="lb-tab__badge">{openingsCount}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Furnish() {
  const sel = useStore((s) => s.selectedFurnitureId)
  const furniture = useStore((s) => s.design.furniture)
  const addFurnitureCentered = useStore((s) => s.addFurnitureCentered)
  const removeFurniture = useStore((s) => s.removeFurniture)
  const selectFurniture = useStore((s) => s.selectFurniture)
  const openingsCount = useStore((s) => s.design.openings.length)
  const lightMode = useLighting((s) => s.lightMode)
  const [tab, setTab] = useState<Tab>('design')

  const selected = sel ? furniture.find((f) => f.id === sel) : undefined

  // Contextual-inspector behaviour (à la Figma / IKEA Kreativ): selecting a piece
  // — in the 3D scene or the "In Room" list — jumps to the Design tab so its
  // editor is what you see. Adding from the catalogue does NOT select (see onAdd),
  // so it never pulls you off the Catalogue tab.
  useEffect(() => {
    if (sel) setTab('design')
  }, [sel])

  // Live per-archetype counts drive the "N in room" badges on catalog cards.
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of furniture) m[f.archetype] = (m[f.archetype] ?? 0) + 1
    return m
  }, [furniture])

  // Add a piece WITHOUT yanking the panel: addFurnitureCentered() internally
  // selects the new item (which would flip us to the Design tab and hide the
  // catalogue). The card's count badge already confirms the add, so restore the
  // prior selection and stay put. Select a piece deliberately to edit it.
  const onAdd = (id: string) => {
    const prevSel = useStore.getState().selectedFurnitureId
    addFurnitureCentered(id)
    // Always restore the prior selection so a catalogue add never changes what's
    // selected (and so never yanks us off the Catalogue tab).
    selectFurniture(prevSel)
  }
  // Remove the most-recently-added instance of an archetype (the stepper "−").
  const onRemoveLast = (archetypeId: string) => {
    for (let i = furniture.length - 1; i >= 0; i--) {
      if (furniture[i].archetype === archetypeId) {
        removeFurniture(furniture[i].id)
        return
      }
    }
  }

  const goCatalogue = () => setTab('catalogue')

  return (
    <div>
      <RoomsBar />

      <TabBar tab={tab} setTab={setTab} placedCount={furniture.length} openingsCount={openingsCount} />

      <div role="tabpanel" id="lb-panel" aria-labelledby={`tab-${tab}`} className="lb-tabpanel">
        {tab === 'design' && (
          <DesignPanel selected={selected} roomEmpty={furniture.length === 0} onBrowse={goCatalogue} />
        )}
        {tab === 'catalogue' && (
          <CataloguePanel
            counts={counts}
            onAdd={onAdd}
            onRemoveLast={onRemoveLast}
            hints={showEditingHints(lightMode)}
          />
        )}
        {tab === 'openings' && <OpeningsPanel />}
        {tab === 'placed' && <PlacedPanel onBrowse={goCatalogue} />}
      </div>
    </div>
  )
}
