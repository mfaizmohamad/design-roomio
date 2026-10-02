import { describe, it, expect } from 'vitest'
import { windowDaylight } from './WindowDaylight'
import { sampleSun } from '../../lighting/src/sun'

// The window daylight must track the SUN — bright at noon, ~0 at dusk/dawn, 0 when the sun is
// off/below horizon — AND be brighter on windows the sun faces than ones it doesn't. These pin the
// two properties the user asked for (time-of-day AND sun angle).
describe('windowDaylight — scales with sun elevation (time) and per-window facing', () => {
  const facing = 0.6 // a moderately sun-facing window

  it('is zero at night / when the sun is off (no constant "default" window light)', () => {
    expect(windowDaylight(0, facing)).toBe(0)
    expect(windowDaylight(0, 1)).toBe(0)
  })

  it('rises with the sun: noon > afternoon > dusk for the same window', () => {
    const noon = windowDaylight(sampleSun(0.5).intensityFactor, facing) // 12:00
    const aft = windowDaylight(sampleSun(0.77).intensityFactor, facing) // ~15:13
    const dusk = windowDaylight(sampleSun(0.99).intensityFactor, facing) // ~17:52
    expect(noon).toBeGreaterThan(aft)
    expect(aft).toBeGreaterThan(dusk)
    expect(dusk).toBeLessThan(0.1) // dusk window is nearly dark, not blazing
  })

  it('a sun-facing window is brighter than a back-facing one at the same time', () => {
    const t = sampleSun(0.5).intensityFactor
    const facingSun = windowDaylight(t, 0.9)
    const backToSun = windowDaylight(t, -0.5) // sun behind this wall
    const parallel = windowDaylight(t, 0)
    expect(facingSun).toBeGreaterThan(parallel)
    // A window the sun never reaches still admits only diffuse sky (SKY_BASE·t), never the beam.
    expect(backToSun).toBeCloseTo(parallel, 5)
  })

  it('dawn and dusk are symmetric and dim; noon is the peak', () => {
    expect(sampleSun(0.5).intensityFactor).toBeCloseTo(1, 5)
    expect(sampleSun(0).intensityFactor).toBeCloseTo(0, 5)
    expect(sampleSun(1).intensityFactor).toBeCloseTo(0, 5)
  })
})
