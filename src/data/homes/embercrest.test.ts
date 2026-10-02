import { describe, expect, it } from 'vitest'
import { EMBERCREST } from './embercrest'

// Independently transcribed metric labels from Duplex.pptx slide 1, CAD pages
// 4–5, flat 504. Keep exact values: grid snapping previously removed 47 cm
// from the study bay and 10 cm from the living room without a failing test.
const dimensions: Record<string, [number, number]> = {
  'Bedroom 1': [335, 425],
  'Bedroom 2': [335, 425],
  'Bedroom 3': [335, 365],
  'Toilet 1': [150, 305],
  'Toilet 2': [250, 135],
  'Toilet 3': [150, 305],
  'Toilet 4': [150, 245],
  'Living & Dining': [650, 365],
  'Kitchen': [448, 305],
  'Family Room': [448, 305],
  'Lobby': [155, 193],
  'Upper Lobby': [165, 185],
  'Upper Entry': [167, 180],
  'Study Nook': [297, 135],
  'Open Balcony': [667, 160],
  'Open Balcony 1': [148, 360],
  'Open Balcony 2': [148, 360],
}

describe('Embercrest source-plan dimensions', () => {
  const rooms = EMBERCREST.levels.flatMap((level) => level.rooms)
  for (const [name, size] of Object.entries(dimensions)) {
    it(`${name} retains its printed metric dimensions`, () => {
      const room = rooms.find((r) => r.name === name)
      expect(room).toBeDefined()
      expect([room!.w, room!.l]).toEqual(size)
    })
  }
  it('does not market the balcony-inclusive area as carpet area', () => {
    expect(EMBERCREST.blurb).not.toContain('1867 sq ft carpet')
    expect(EMBERCREST.planNote).toContain('148.57 m² carpet + 24.85 m² balconies')
  })
})
