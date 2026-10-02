import { useId, useState } from 'react'
import { useStore } from '../store'
import { formatLenShort, parseLen, formatLen, MAX_WALL_HEIGHT_CM } from '../units'
import { bbox } from '../geometry/walls'

function LengthInput({
  cm,
  onCommit,
}: {
  cm: number
  onCommit: (cm: number) => void
}) {
  const unit = useStore((s) => s.design.unit)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  // true when the last committed text was non-numeric — we surface it instead
  // of silently reverting, so a typo like "." or "abc" gets visible feedback.
  const [invalid, setInvalid] = useState(false)
  const errId = useId()

  const display = formatLenShort(cm, unit)
  const commit = () => {
    const parsed = parseLen(text, unit)
    if (parsed != null) {
      onCommit(parsed) // store clamps to the sane [min, max] range
      setInvalid(false)
      setEditing(false)
    } else if (text.trim() === '') {
      // empty field = cancel: silently revert to the current value
      setInvalid(false)
      setEditing(false)
    } else {
      // unparseable input — flag it (keep the bad text visible) rather than
      // silently snapping back so the user knows nothing was applied
      setInvalid(true)
      setEditing(false)
    }
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <input
        className={invalid ? 'len-input invalid' : 'len-input'}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errId : undefined}
        style={invalid ? { borderColor: '#e5484d' } : undefined}
        value={editing || invalid ? text : display}
        onFocus={() => {
          setEditing(true)
          setInvalid(false)
          setText(display)
        }}
        onChange={(e) => {
          setText(e.target.value)
          if (invalid) setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setInvalid(false)
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {invalid && (
        <span id={errId} role="alert" style={{ color: '#e5484d', fontSize: 11 }}>
          Enter a number
        </span>
      )}
    </span>
  )
}

export function Step2Dimensions() {
  const unit = useStore((s) => s.design.unit)
  const setUnit = useStore((s) => s.setUnit)
  const walls = useStore((s) => s.walls)
  const setWallLength = useStore((s) => s.setWallLength)
  const wallHeight = useStore((s) => s.design.wallHeight)
  const setWallHeight = useStore((s) => s.setWallHeight)
  const corners = useStore((s) => s.design.corners)
  const b = bbox(corners)

  return (
    <div>
      <div className="overall-size">
        <span>Overall</span>
        <strong>
          {formatLen(b.w, unit)} <span className="x">×</span> {formatLen(b.d, unit)}
        </strong>
      </div>
      <div className="segmented">
        <button className={unit === 'ft' ? 'active' : ''} onClick={() => setUnit('ft')}>
          Feet
        </button>
        <button className={unit === 'cm' ? 'active' : ''} onClick={() => setUnit('cm')}>
          Centimetres
        </button>
      </div>

      <div className="section-label">
        Wall lengths<span className="sub">{walls.length} walls</span>
      </div>
      <div className="wall-list">
        {walls.map((w, i) => (
          <div className="wall-row" key={w.id}>
            <span className="wall-dot" style={{ background: `hsl(${(i * 47) % 360} 55% 55%)` }} />
            <span className="wall-name">Wall {i + 1}</span>
            <LengthInput cm={w.length} onCommit={(cm) => setWallLength(w.id, cm)} />
          </div>
        ))}
      </div>

      <hr className="divider" />
      <div className="section-label">Wall height</div>
      <div className="wall-row">
        <input
          type="range"
          min={200}
          max={MAX_WALL_HEIGHT_CM}
          value={wallHeight}
          onChange={(e) => setWallHeight(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span className="wall-name" style={{ minWidth: 70, textAlign: 'right' }}>
          {formatLenShort(wallHeight, unit)}
        </span>
      </div>
      <p className="hint">Drag a wall in the 3D view, or type an exact length above.</p>
    </div>
  )
}
