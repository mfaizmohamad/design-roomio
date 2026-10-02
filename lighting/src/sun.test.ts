import { describe, it, expect } from 'vitest'
import { sampleSun } from './sun'

describe('sampleSun — arc + intensity', () => {
  it('peaks at noon (time=0.5) and is dark at dawn/dusk', () => {
    const noon = sampleSun(0.5)
    const dawn = sampleSun(0)
    const dusk = sampleSun(1)
    expect(noon.intensityFactor).toBeCloseTo(1, 5)
    expect(dawn.intensityFactor).toBeCloseTo(0, 5)
    expect(dusk.intensityFactor).toBeCloseTo(0, 5)
    expect(dawn.belowHorizon).toBe(true)
    expect(noon.belowHorizon).toBe(false)
  })

  it('sun is highest at noon (max y), low at the horizon', () => {
    const noon = sampleSun(0.5, { maxElevationDeg: 60, domeRadiusM: 30 })
    const morning = sampleSun(0.2, { maxElevationDeg: 60, domeRadiusM: 30 })
    expect(noon.position[1]).toBeGreaterThan(morning.position[1])
    // noon elevation == maxElevation
    expect(noon.elevationRad).toBeCloseTo((60 * Math.PI) / 180, 5)
    expect(noon.position[1]).toBeCloseTo(30 * Math.sin((60 * Math.PI) / 180), 4)
  })

  it('azimuth sweeps across the day (sun moves east->west side)', () => {
    const a = sampleSun(0.25, { domeRadiusM: 30 })
    const b = sampleSun(0.75, { domeRadiusM: 30 })
    // x position flips sign across noon -> shadows sweep the other way
    expect(Math.sign(a.position[0])).not.toBe(Math.sign(b.position[0]))
  })

  it('northOffset rotates azimuth; +180 reverses the light direction', () => {
    const base = sampleSun(0.5, { domeRadiusM: 30, northOffsetDeg: 0 })
    const rotated = sampleSun(0.5, { domeRadiusM: 30, northOffsetDeg: 90 })
    const reversed = sampleSun(0.5, { domeRadiusM: 30, northOffsetDeg: 180 })
    // rotation changes horizontal position
    expect(rotated.position[0]).not.toBeCloseTo(base.position[0], 2)
    // reverse flips x and z (opposite side), same height
    expect(reversed.position[0]).toBeCloseTo(-base.position[0], 4)
    expect(reversed.position[2]).toBeCloseTo(-base.position[2], 4)
    expect(reversed.position[1]).toBeCloseTo(base.position[1], 6)
  })

  it('warms toward the horizon and cools toward noon', () => {
    const low = sampleSun(0.08, { warmthShift: true })
    const high = sampleSun(0.5, { warmthShift: true })
    // warmer = more red-dominant. Compare red-vs-blue channel ratios.
    const redBlue = (hex: string) => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16)
    expect(redBlue(low.color)).toBeGreaterThan(redBlue(high.color))
  })

  it('position magnitude stays ~dome radius (sun outside the house)', () => {
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const s = sampleSun(t, { domeRadiusM: 30 })
      const mag = Math.hypot(...s.position)
      expect(mag).toBeCloseTo(30, 3)
    }
  })
})
