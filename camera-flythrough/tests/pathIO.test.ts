import { describe, it, expect } from 'vitest'
import { serializePath, parsePath } from '../src/engine/pathIO'
import { validatePath, emptyPath } from '../src/contract/pathSchema'
import type { CameraPath } from '../src/contract/pathSchema'

const sample: CameraPath = {
  version: '1.0',
  name: 'Round trip',
  designId: 'design-7',
  coordinateSpace: 'world-meters',
  fps: 24,
  duration: 9,
  loop: true,
  eyeHeight: 1.55,
  lookAheadEps: 0.03,
  fov: 55,
  controlPoints: [
    { position: [-2, 1.55, 1], lookAt: [0, 0.8, 0], dwell: 1 },
    { position: [0, 1.55, -1], lookAt: null, dwell: 0 },
    { position: [2, 1.55, 1], lookAt: null, dwell: 0.5 },
  ],
}

describe('pathIO round-trip', () => {
  it('serialize → parse preserves the path', () => {
    const back = parsePath(serializePath(sample))
    expect(back).toEqual(sample)
  })

  it('parse fills defaults for a minimal path', () => {
    const minimal = JSON.stringify({
      version: '1.0',
      controlPoints: [{ position: [0, 1.6, 0] }, { position: [1, 1.6, 1] }],
    })
    const p = parsePath(minimal)
    expect(p.fps).toBe(30)
    expect(p.duration).toBe(8)
    expect(p.eyeHeight).toBe(1.6)
    expect(p.coordinateSpace).toBe('world-meters')
    expect(p.controlPoints[0].lookAt).toBe(null)
    expect(p.controlPoints[0].dwell).toBe(0)
  })

  it('rejects invalid JSON', () => {
    expect(() => parsePath('{not json')).toThrow()
  })

  it('rejects a path with < 2 control points', () => {
    expect(() => parsePath(JSON.stringify({ version: '1.0', controlPoints: [{ position: [0, 0, 0] }] }))).toThrow()
  })

  it('rejects a bad control point position', () => {
    expect(() =>
      parsePath(JSON.stringify({ version: '1.0', controlPoints: [{ position: [0, 0] }, { position: [1, 1, 1] }] })),
    ).toThrow()
  })

  it('rejects wrong version', () => {
    const res = validatePath({ version: '2.0', controlPoints: sample.controlPoints })
    expect(res.ok).toBe(false)
  })

  it('emptyPath is well-formed but has no points', () => {
    const e = emptyPath('x')
    expect(e.controlPoints.length).toBe(0)
    expect(e.version).toBe('1.0')
  })
})
