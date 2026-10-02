import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EMBERCREST } from '../data/homes/embercrest'
import { PANDAUL } from '../data/homes/pandaul'
import { HOMES, HOME_MAP, SAMPLE_DUPLEX, SAMPLE_HOUSE } from './homes'
import { Landing } from './DemoApp'
import { isTourPath, tourForPath, TOUR_PATHS } from './routes'
import { LISTING_FLATS, hasListingFlat } from './stubs/listingFlats'
import { getInferredFinish, inferredListingIds } from './stubs/inferredScenes'

// Everything the public demo home carries ends up in public JS. The build-time
// scan (scripts/demo-leak-check.mjs) is the backstop; this catches it earlier.
const CLIENT = /embercrest|pptx|flat 504|a&b building|pandaul/i

describe('public demo home', () => {
  it('the demo registry holds exactly the two sample homes', () => {
    expect(HOMES).toEqual([SAMPLE_DUPLEX, SAMPLE_HOUSE])
    expect(Object.keys(HOME_MAP)).toEqual(['sample-duplex', 'sample-house'])
  })

  it('carries no client name, locality or source citation anywhere', () => {
    expect(JSON.stringify(SAMPLE_DUPLEX)).not.toMatch(CLIENT)
    expect(JSON.stringify(SAMPLE_HOUSE)).not.toMatch(CLIENT)
  })

  it('the sample house keeps the traced 4 BHK geometry, on one storey, procedural only', () => {
    const shape = (home: typeof SAMPLE_HOUSE) =>
      home.levels.flatMap((l) => l.rooms.map(({ name, x, z, w, l: len, openings }) => ({ name, x, z, w, len, openings })))
    expect(shape(SAMPLE_HOUSE)).toEqual(shape(PANDAUL))
    expect(SAMPLE_HOUSE.levels).toHaveLength(1)
    expect(SAMPLE_HOUSE.levels[0].rooms.filter((r) => r.type === 'bedroom')).toHaveLength(4)
    expect(SAMPLE_HOUSE.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture)).filter((f) => 'assetRef' in f)).toEqual([])
  })

  it('keeps the modelled geometry: same storeys, rooms and footprints', () => {
    expect(SAMPLE_DUPLEX.levels.map((l) => [l.label, l.elevationCm])).toEqual(
      EMBERCREST.levels.map((l) => [l.label, l.elevationCm]),
    )
    const shape = (home: typeof SAMPLE_DUPLEX) =>
      home.levels.flatMap((l) => l.rooms.map(({ name, x, z, w, l: len, wallHeight }) => ({ name, x, z, w, len, wallHeight })))
    expect(shape(SAMPLE_DUPLEX)).toEqual(shape(EMBERCREST))
  })

  it('ships procedural furniture only — no third-party GLB reference', () => {
    const items = SAMPLE_DUPLEX.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture))
    expect(items.length).toBeGreaterThan(0)
    expect(items.filter((f) => 'assetRef' in f)).toEqual([])
    // and the private fixture still has its asset (we copied, not mutated)
    expect(EMBERCREST.levels.flatMap((l) => l.rooms.flatMap((r) => r.furniture)).some((f) => f.assetRef)).toBe(true)
  })
})

describe('demo routing and landing', () => {
  it('/tour stays the duplex (old links keep working); /tour/4bhk is the house', () => {
    expect(tourForPath('/tour')).toBe('duplex')
    expect(tourForPath('/tour/')).toBe('duplex')
    expect(tourForPath('/tour/duplex')).toBe('duplex')
    expect(tourForPath('/tour/4bhk')).toBe('house')
    expect(tourForPath('/tour/4bhk/')).toBe('house')
    expect(tourForPath('/')).toBe(null)
    expect(tourForPath('/tours')).toBe(null)
    expect(tourForPath('/tour/other')).toBe(null)
    expect(isTourPath('/showcase/embercrest')).toBe(false)
  })

  it('the landing page offers both sample homes and names no client', () => {
    const html = renderToStaticMarkup(createElement(Landing))
    expect(html).toContain(`href="${TOUR_PATHS.duplex}"`)
    expect(html).toContain(`href="${TOUR_PATHS.house}"`)
    expect(html).toContain('3 BHK Duplex')
    expect(html).toContain('4 BHK House')
    expect(html).not.toMatch(CLIENT)
  })
})

describe('demo data stubs', () => {
  it('expose no scraped-listing data', () => {
    expect(LISTING_FLATS).toEqual({})
    expect(hasListingFlat('4551035318554515')).toBe(false)
    expect(getInferredFinish('4551035318554515')).toBeNull()
    expect(inferredListingIds()).toEqual([])
  })
})
