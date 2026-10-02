/**
 * Auto-thumbnail capture — renders the house top-down to an offscreen canvas and
 * returns a PNG data-URL. Called on save so the My Designs grid always looks
 * current (brief §4). Guarded: returns null off-DOM (tests / SSR).
 */
import type { House } from '../scene/slices'
import { renderFloorplan } from './floorplan'

export const THUMB_W = 320
export const THUMB_H = 220

export function captureThumbnail(house: House, w = THUMB_W, h = THUMB_H): string | null {
  try {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    renderFloorplan(ctx, house, { width: w, height: h, labels: false, furniture: true })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}
