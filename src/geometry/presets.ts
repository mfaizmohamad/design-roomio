import type { ShapeId, Vec2 } from '../types'

// All preset polygons are authored in centimeters, bounding box starting at (0,0).
// Corners are ordered; each consecutive pair (wrapping) forms a wall.
// The geometry builder recenters the polygon on its bounding box.

export interface ShapePreset {
  id: ShapeId
  label: string
  /** SVG path drawn inside a 100x80 viewBox for the picker icon. */
  icon: string
  corners: () => Vec2[]
}

const p = (x: number, z: number): Vec2 => ({ x, z })

// Default footprint dimensions (cm)
const W = 600
const D = 400

export const PRESETS: ShapePreset[] = [
  {
    id: 'rect',
    label: 'Rectangular',
    icon: 'M14,14 H86 V66 H14 Z',
    corners: () => [p(0, 0), p(W, 0), p(W, D), p(0, D)],
  },
  {
    id: 'l',
    label: 'L-Shape',
    icon: 'M14,14 H56 V40 H86 V66 H14 Z',
    corners: () => {
      const cutW = 240
      const cutD = 180
      return [
        p(0, 0),
        p(W - cutW, 0),
        p(W - cutW, cutD),
        p(W, cutD),
        p(W, D),
        p(0, D),
      ]
    },
  },
  {
    id: 'cut',
    label: 'Cut',
    icon: 'M14,14 H66 L86,32 V66 H14 Z',
    corners: () => {
      const cut = 200
      return [p(0, 0), p(W - cut, 0), p(W, cut), p(W, D), p(0, D)]
    },
  },
  {
    id: 't',
    label: 'T-Shape',
    icon: 'M14,14 H86 V46 H64 V66 H36 V46 H14 Z',
    corners: () => {
      const notchW = 150
      const notchD = 90
      return [
        p(0, 0),
        p(W, 0),
        p(W, D - notchD),
        p(W - notchW, D - notchD),
        p(W - notchW, D),
        p(notchW, D),
        p(notchW, D - notchD),
        p(0, D - notchD),
      ]
    },
  },
  {
    id: 'u',
    label: 'U-Shape',
    icon: 'M14,14 H38 V36 H62 V14 H86 V66 H14 Z',
    corners: () => {
      const notchW = 200
      const notchD = 200
      const x0 = (W - notchW) / 2
      const x1 = (W + notchW) / 2
      return [
        p(0, 0),
        p(x0, 0),
        p(x0, notchD),
        p(x1, notchD),
        p(x1, 0),
        p(W, 0),
        p(W, D),
        p(0, D),
      ]
    },
  },
  {
    id: 'beveled',
    label: 'Beveled',
    icon: 'M30,14 H70 L86,28 V52 L70,66 H30 L14,52 V28 Z',
    corners: () => {
      const b = 130
      return [
        p(b, 0),
        p(W - b, 0),
        p(W, b),
        p(W, D - b),
        p(W - b, D),
        p(b, D),
        p(0, D - b),
        p(0, b),
      ]
    },
  },
]

export const PRESET_MAP: Record<ShapeId, ShapePreset> = Object.fromEntries(
  PRESETS.map((s) => [s.id, s]),
) as Record<ShapeId, ShapePreset>

export function presetCorners(id: ShapeId): Vec2[] {
  return PRESET_MAP[id].corners()
}
