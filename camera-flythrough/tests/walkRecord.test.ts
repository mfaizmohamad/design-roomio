import { describe, it, expect } from 'vitest'
import { rdp, decimateWalk, samplesToCameraPath } from '../src/engine/walkRecord'

type P3 = [number, number, number]

// a dense, slightly noisy L-shaped walk at constant eye height
function lShapedWalk(): P3[] {
  const pts: P3[] = []
  for (let i = 0; i <= 50; i++) pts.push([(-2 + (i / 50) * 4), 1.6, -1 + Math.sin(i) * 0.002])
  for (let i = 1; i <= 50; i++) pts.push([2, 1.6, -1 + (i / 50) * 3])
  return pts
}

describe('rdp', () => {
  it('reduces a straight line to its endpoints', () => {
    const line: P3[] = Array.from({ length: 20 }, (_, i) => [i * 0.1, 1.6, 0])
    const out = rdp(line, 0.01)
    expect(out.length).toBe(2)
    expect(out[0]).toEqual(line[0])
    expect(out[1]).toEqual(line[line.length - 1])
  })

  it('keeps a corner of an L', () => {
    const out = rdp(lShapedWalk(), 0.1)
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.length).toBeLessThan(10)
  })
})

describe('decimateWalk', () => {
  it('drops dense samples to a smooth handful, preserving endpoints', () => {
    const walk = lShapedWalk()
    const out = decimateWalk(walk, { maxPoints: 14 })
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out.length).toBeLessThanOrEqual(14)
    expect(out[0]).toEqual(walk[0])
    expect(out[out.length - 1]).toEqual(walk[walk.length - 1])
  })

  it('respects the maxPoints cap by growing tolerance', () => {
    // a wiggly path that RDP would keep many points of at small epsilon
    const wig: P3[] = Array.from({ length: 200 }, (_, i) => [i * 0.02, 1.6, Math.sin(i * 0.5) * 0.5])
    const out = decimateWalk(wig, { maxPoints: 8, epsilon: 0.01 })
    expect(out.length).toBeLessThanOrEqual(8)
  })

  it('handles a degenerate 2-sample walk', () => {
    const out = decimateWalk([[0, 1.6, 0], [1, 1.6, 1]])
    expect(out.length).toBe(2)
  })
})

describe('samplesToCameraPath', () => {
  it('produces a schema-shaped path from a walk', () => {
    const cp = samplesToCameraPath(lShapedWalk(), { name: 'Test walk', duration: 5 })
    expect(cp.version).toBe('1.0')
    expect(cp.coordinateSpace).toBe('world-meters')
    expect(cp.name).toBe('Test walk')
    expect(cp.duration).toBe(5)
    expect(cp.controlPoints.length).toBeGreaterThanOrEqual(2)
    expect(cp.controlPoints.every((c) => c.lookAt === null && c.dwell === 0)).toBe(true)
  })
})
