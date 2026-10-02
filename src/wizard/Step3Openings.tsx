import { useStore } from '../store'
import { DOOR_DEFS, WINDOW_DEFS, type OpeningDef } from '../data/openings'
import { formatLenShort } from '../units'

function SelectedOpeningEditor() {
  const id = useStore((s) => s.selectedOpeningId)
  const openings = useStore((s) => s.design.openings)
  const walls = useStore((s) => s.walls)
  const wallHeight = useStore((s) => s.design.wallHeight)
  const unit = useStore((s) => s.design.unit)
  const updateOpening = useStore((s) => s.updateOpening)
  const removeOpening = useStore((s) => s.removeOpening)

  const op = id ? openings.find((o) => o.id === id) : undefined
  if (!op) return null
  const wall = walls.find((w) => w.id === op.wallId)
  const maxW = Math.round((wall ? wall.length : 400) * 0.96)
  const isWin = op.kind === 'window'

  const Row = ({ label, value, min, max, on }: { label: string; value: number; min: number; max: number; on: (v: number) => void }) => (
    <div className="wall-row" style={{ marginBottom: 10 }}>
      <span className="wall-name" style={{ flex: 'none', minWidth: 54 }}>{label}</span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => on(Number(e.target.value))} style={{ flex: 1 }} />
      <span style={{ minWidth: 56, textAlign: 'right', fontSize: 13.5, fontWeight: 600 }}>{formatLenShort(value, unit)}</span>
    </div>
  )

  return (
    <div style={{ background: '#fbfaf7', padding: '16px 18px', borderRadius: 14, border: '1.5px solid #e6e3dd', marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Adjust opening</span>
        <button onClick={() => removeOpening(op.id)} style={{ border: 'none', background: 'none', color: '#b0392f', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          Remove
        </button>
      </div>
      <Row label="Width" value={op.width} min={40} max={maxW} on={(v) => updateOpening(op.id, { width: v })} />
      <Row label="Height" value={op.height} min={40} max={wallHeight - 5} on={(v) => updateOpening(op.id, { height: v })} />
      {isWin && (
        <Row label="Sill" value={op.sill} min={0} max={Math.max(0, wallHeight - op.height)} on={(v) => updateOpening(op.id, { sill: v })} />
      )}
    </div>
  )
}

function OpeningIcon({ def }: { def: OpeningDef }) {
  const W = 60
  const H = 80
  const pad = 7
  const isWin = def.kind === 'window'
  const top = isWin ? 24 : pad
  const bottom = isWin ? H - 18 : H - pad
  const left = pad
  const right = W - pad
  const leafW = (right - left) / def.leaves
  const leaves = Array.from({ length: def.leaves })
  const pos = (v: number) => Math.max(0, v) // SVG rejects negative width/height

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%">
      {/* frame */}
      <rect x={left - 2} y={top - 2} width={right - left + 4} height={bottom - top + 4} rx={2} fill="#e9e6df" stroke="#b9b4a8" strokeWidth={1.5} />
      {leaves.map((_, i) => {
        const lx = left + i * leafW
        const gi = 2.5
        if (def.glass > 0) {
          const gy = top + gi
          const gh = bottom - top - gi * 2
          const gAbove = gh * (1 - def.glass)
          return (
            <g key={i}>
              <rect x={lx + gi} y={top + gi} width={pos(leafW - gi * 2)} height={pos(bottom - top - gi * 2)} fill="#f6f4ef" stroke="#c4bfb3" strokeWidth={1} />
              <rect x={lx + gi + 2} y={gy + gAbove} width={pos(leafW - gi * 2 - 4)} height={pos(gh - gAbove - 2)} fill="#cfe3ea" stroke="#9fb6bd" strokeWidth={1} />
              {/* muntin */}
              <line x1={lx + leafW / 2} y1={gy + gAbove} x2={lx + leafW / 2} y2={bottom - gi - 2} stroke="#9fb6bd" strokeWidth={0.8} />
            </g>
          )
        }
        return (
          <g key={i}>
            <rect x={lx + gi} y={top + gi} width={pos(leafW - gi * 2)} height={pos(bottom - top - gi * 2)} fill="#f6f4ef" stroke="#c4bfb3" strokeWidth={1} />
            <rect x={lx + 6} y={top + 7} width={pos(leafW - 12)} height={pos((bottom - top) / 2 - 9)} fill="#eceae3" stroke="#cfcabd" strokeWidth={0.8} />
            <rect x={lx + 6} y={top + (bottom - top) / 2 + 2} width={pos(leafW - 12)} height={pos((bottom - top) / 2 - 9)} fill="#eceae3" stroke="#cfcabd" strokeWidth={0.8} />
          </g>
        )
      })}
      {isWin && <rect x={left - 4} y={bottom + 1} width={right - left + 8} height={4} fill="#d9d4c8" />}
    </svg>
  )
}

function StyleCard({ def }: { def: OpeningDef }) {
  const placingStyle = useStore((s) => s.placingStyle)
  const setPlacingStyle = useStore((s) => s.setPlacingStyle)
  const active = placingStyle === def.style
  return (
    <button
      className={`opening-card${active ? ' active' : ''}`}
      onClick={() => setPlacingStyle(active ? null : def.style)}
    >
      <div className="opening-thumb">
        <OpeningIcon def={def} />
      </div>
      <span>{def.name}</span>
    </button>
  )
}

export function Step3Openings() {
  const placingStyle = useStore((s) => s.placingStyle)
  const openings = useStore((s) => s.design.openings)
  const removeOpening = useStore((s) => s.removeOpening)
  const selectOpening = useStore((s) => s.selectOpening)
  const selectedOpeningId = useStore((s) => s.selectedOpeningId)
  const allDefs = [...DOOR_DEFS, ...WINDOW_DEFS]

  return (
    <div>
      <SelectedOpeningEditor />
      <div className="section-label">Door styles</div>
      <div className="opening-grid">
        {DOOR_DEFS.map((d) => (
          <StyleCard key={d.style} def={d} />
        ))}
      </div>

      <div className="section-label">Window styles</div>
      <div className="opening-grid">
        {WINDOW_DEFS.map((d) => (
          <StyleCard key={d.style} def={d} />
        ))}
      </div>

      <p className={`place-hint${placingStyle ? ' armed' : ''}`}>
        {placingStyle ? '→ Click a wall in the 3D view to place it.' : 'Select a style, then click a wall to place. Drag to move, trash to delete.'}
      </p>

      {openings.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-label">
            Placed<span className="sub">{openings.length}</span>
          </div>
          <div className="placed-list">
            {openings.map((o) => {
              const def = allDefs.find((d) => d.style === o.style)
              return (
                <div
                  key={o.id}
                  className={`placed-row${selectedOpeningId === o.id ? ' active' : ''}`}
                  onClick={() => selectOpening(o.id)}
                >
                  <span>{def?.name ?? o.style}</span>
                  <button
                    className="placed-del"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeOpening(o.id)
                    }}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
