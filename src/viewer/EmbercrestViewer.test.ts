import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { EMBERCREST } from '../data/homes/embercrest'
import { FloorPlan } from './EmbercrestViewer'
import { RoomView } from '../three/RoomView'

describe('Embercrest buyer preview', () => {
  it('keeps a legible source-plan fallback for each storey', () => {
    const lower = renderToStaticMarkup(createElement(FloorPlan, { level: EMBERCREST.levels[0] }))
    const upper = renderToStaticMarkup(createElement(FloorPlan, { level: EMBERCREST.levels[1] }))
    expect(lower).toContain('Lower floor plan')
    expect(upper).toContain('Upper floor plan')
    for (const room of EMBERCREST.levels[0].rooms) expect(lower).toContain(room.name.replace(/&/g, '&amp;'))
    for (const room of EMBERCREST.levels[1].rooms) expect(upper).toContain(room.name.replace(/&/g, '&amp;'))
  })

  it('omits studio lighting, render, floor arranger and debug controls in buyer mode', () => {
    const html = renderToStaticMarkup(createElement(RoomView, { buyerMode: true }))
    expect(html).not.toContain('Top-down 2D plan view')
    expect(html).not.toContain('Toggle the collision-footprint debug overlay')
    expect(html).not.toContain('View the whole house')
    expect(html).not.toContain('Light Mode')
  })
})
