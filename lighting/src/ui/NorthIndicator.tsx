// North + Sun compass (Pillar 3). North (N) is FIXED at the top (map convention) so it never
// moves when you scrub time. A ☀ sun marker orbits the ring showing the sun's current compass
// direction — it moves as you scrub the TIME bar and as you rotate North. Reverse flips 180°.
// Toggles independently of the time bar. DOM overlay.

import { useLighting } from '../store'
import { sampleSun } from '../sun'

export function NorthIndicator() {
  const timeOfDay = useLighting((s) => s.timeOfDay)
  const northOffsetDeg = useLighting((s) => s.northOffsetDeg)
  const sun = useLighting((s) => s.sun)
  const rotateNorth = useLighting((s) => s.rotateNorth)
  const reverseNorth = useLighting((s) => s.reverseNorth)
  const setNorthOffset = useLighting((s) => s.setNorthOffset)

  // Sun's compass bearing (clockwise from the top/N), in degrees — moves with time + north.
  const s = sampleSun(timeOfDay, {
    maxElevationDeg: sun.maxElevationDeg,
    northOffsetDeg,
    domeRadiusM: sun.domeRadiusM,
    warmthShift: sun.warmthShift,
  })
  const sunBearingDeg = (s.azimuthRad * 180) / Math.PI
  const dim = s.belowHorizon

  const DIAL = 72
  const cardinal: React.CSSProperties = { position: 'absolute', fontWeight: 700, opacity: 0.7 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      {/* FIXED compass (N up). The ☀ marker orbits to show the sun direction. */}
      <div
        style={{
          position: 'relative',
          width: DIAL,
          height: DIAL,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)',
        }}
        aria-label={`Sun bearing ${Math.round(((sunBearingDeg % 360) + 360) % 360)} degrees from north`}
      >
        {/* fixed cardinal marks */}
        <span style={{ ...cardinal, top: 1, left: '50%', transform: 'translateX(-50%)', color: '#ff6b4a' }}>N</span>
        <span style={{ ...cardinal, right: 3, top: '50%', transform: 'translateY(-50%)' }}>E</span>
        <span style={{ ...cardinal, bottom: 1, left: '50%', transform: 'translateX(-50%)' }}>S</span>
        <span style={{ ...cardinal, left: 3, top: '50%', transform: 'translateY(-50%)' }}>W</span>

        {/* orbiting sun marker: rotate the layer, dot sits at the top -> lands at the bearing */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `rotate(${sunBearingDeg}deg)`,
            transition: 'transform 0.12s linear',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -3,
              left: '50%',
              width: 14,
              height: 14,
              marginLeft: -7,
              borderRadius: '50%',
              background: dim ? '#6b6b6b' : s.color,
              boxShadow: dim ? 'none' : `0 0 8px 2px ${s.color}`,
              border: '1px solid rgba(0,0,0,0.35)',
            }}
            title="Sun"
          />
        </div>
        {/* center pivot */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 4,
            height: 4,
            margin: '-2px 0 0 -2px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.5)',
          }}
        />
      </div>
      <div style={{ opacity: 0.7 }}>north {Math.round(northOffsetDeg)}°</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => rotateNorth(-15)} style={btn} aria-label="Rotate north counter-clockwise">
          ⟲
        </button>
        <button onClick={() => rotateNorth(15)} style={btn} aria-label="Rotate north clockwise">
          ⟳
        </button>
      </div>
      <button onClick={reverseNorth} style={{ ...btn, width: '100%' }}>
        Reverse 180°
      </button>
      <input
        type="range"
        min={0}
        max={359}
        step={1}
        value={northOffsetDeg}
        onChange={(e) => setNorthOffset(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#ff6b4a' }}
        aria-label="North rotation"
      />
    </div>
  )
}

const btn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
  color: '#f4f1ea',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 8,
  padding: '4px 8px',
  cursor: 'pointer',
  font: '13px ui-sans-serif',
}
