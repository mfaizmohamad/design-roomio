import { HOME_MAP } from '../data/homes'
import { bbox, signedArea } from '../geometry/walls'
import { formatLen } from '../units'
import { useStore } from '../store'
import { useHouse } from './houseSession'
import { levelOf } from './houseLevels'
import { useHouseView } from './houseViewMode'

/** Live room schedule: measured from the same polygons used by the renderer. */
export function RoomMeasurements() {
  const rooms = useHouse((s) => s.rooms)
  const homeId = useHouse((s) => s.homeId)
  const planNote = homeId ? HOME_MAP[homeId]?.planNote : undefined
  const activeId = useHouse((s) => s.activeId)
  const levels = useHouse((s) => s.levels)
  const design = useStore((s) => s.design)
  const filter = useHouseView((s) => s.levelFilter)
  const shown = rooms.filter((r) => filter === 'all' || levelOf(r) === filter)
  if (!shown.length) return null
  return (
    <details style={{ margin: '12px 0', border: '1px solid #dedbd5', borderRadius: 12, padding: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 650 }}>Room dimensions · {shown.length} rooms</summary>
      <p style={{ fontSize: 12, lineHeight: 1.5, color: '#625e57' }}>
        Model measurements between wall centre lines. Sizes are approximate until checked against your approved floor plan.
      </p>
      {planNote && <p style={{ fontSize: 12, lineHeight: 1.5, color: '#625e57' }}>{planNote}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
          <caption style={{ textAlign: 'left', paddingBottom: 8 }}>Width × depth, height and footprint area</caption>
          <thead><tr><th scope="col">Room</th><th scope="col">Dimensions</th><th scope="col">Area</th></tr></thead>
          <tbody>
            {shown.map((room) => {
              // The active room's snapshot lags edits until switching rooms;
              // use the live design so a builder never reviews stale sizes.
              const d = room.id === activeId ? design : room.design
              const b = bbox(d.corners)
              const area = Math.abs(signedArea(d.corners)) / 10000
              return (
                <tr key={room.id}>
                  <th scope="row" style={{ padding: '10px 8px 10px 0', borderTop: '1px solid #e8e5df', fontWeight: 500 }}>
                    {d.name}
                    {levels.length > 1 && <div style={{ color: '#625e57', fontWeight: 400 }}>{levels[levelOf(room)]?.label}</div>}
                  </th>
                  <td style={{ padding: '10px 8px', borderTop: '1px solid #e8e5df', whiteSpace: 'nowrap' }}>
                    {(b.w / 100).toFixed(3)} × {(b.d / 100).toFixed(3)} m
                    <div style={{ color: '#625e57' }}>{formatLen(b.w, 'ft')} × {formatLen(b.d, 'ft')}</div>
                    <div>Height {(d.wallHeight / 100).toFixed(2)} m</div>
                    <div style={{ color: '#625e57' }}>Walls {d.wallThickness} cm</div>
                  </td>
                  <td style={{ padding: '10px 0', borderTop: '1px solid #e8e5df', whiteSpace: 'nowrap' }}>{area.toFixed(2)} m²</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </details>
  )
}
