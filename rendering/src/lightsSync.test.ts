import { describe, it, expect } from 'vitest'
import { flatFillScale, fixturesLit } from './r3f/LightsSync'

// The sun-only contract for E's flat fill + electric fixtures under the two daylight-only
// presentations: Light Mode (E, traces only the sun through windows) and the plain lamps-off
// toggle (G, keeps a low fill floor).
describe('LightsSync daylight-only gating', () => {
  it('Light Mode collapses the flat fill to ZERO (sun-only), regardless of the lamps toggle', () => {
    expect(flatFillScale(true, true)).toBe(0)
    expect(flatFillScale(true, false)).toBe(0)
  })

  it('normal editing (lamps on, not Light Mode) keeps the full flat fill', () => {
    expect(flatFillScale(false, true)).toBe(1)
  })

  it('plain lamps-off (not Light Mode) keeps a low non-zero fill floor so it is not pitch black', () => {
    const s = flatFillScale(false, false)
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  it('electric fixtures are dark in Light Mode OR when the lamps are off; lit only in normal editing', () => {
    expect(fixturesLit(false, true)).toBe(true) // normal editing → fixtures lit
    expect(fixturesLit(true, true)).toBe(false) // Light Mode → sun only, fixtures dark
    expect(fixturesLit(false, false)).toBe(false) // lamps off → fixtures dark
    expect(fixturesLit(true, false)).toBe(false)
  })
})
