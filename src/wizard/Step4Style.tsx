import { useStore } from '../store'
import { WALL_COLORS, FLOOR_TEXTURES, FLOOR_MAP } from '../data/materials'
import { getFloorThumb } from '../three/textures'

export function Step4Style() {
  const wallColor = useStore((s) => s.design.materials.wallColor)
  const floor = useStore((s) => s.design.materials.floorTexture)
  const setWallColor = useStore((s) => s.setWallColor)
  const setFloor = useStore((s) => s.setFloor)

  return (
    <div>
      <div className="section-label">Wall color</div>
      <div className="swatch-grid">
        {WALL_COLORS.map((c) => (
          <button
            key={c.id}
            title={c.name}
            className={`swatch${wallColor === c.hex ? ' active' : ''}`}
            style={{ background: c.hex }}
            onClick={() => setWallColor(c.hex)}
          />
        ))}
      </div>

      <div className="section-label">
        Floor style<span className="sub">{FLOOR_MAP[floor]?.name ?? ''}</span>
      </div>
      <div className="swatch-grid floors">
        {FLOOR_TEXTURES.map((f) => (
          <button
            key={f.id}
            title={f.name}
            className={`swatch tex${floor === f.id ? ' active' : ''}`}
            style={{ backgroundImage: `url(${getFloorThumb(f.id)})` }}
            onClick={() => setFloor(f.id)}
          />
        ))}
      </div>
    </div>
  )
}
