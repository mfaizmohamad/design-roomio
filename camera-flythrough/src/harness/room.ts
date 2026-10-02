import type { Vec2, OBB } from '../contract/sceneContract'

/**
 * Furnished room definition for the dev harness, in DESIGN centimeters.
 * A rectangular 6.0 m × 4.0 m living/dining room (matches presets.ts default
 * W=600, D=400) with a believable furniture set. Coordinates/rotations follow
 * the front-end convention exactly (rotation 0 faces +z; see geometry.ts).
 */

export interface HarnessFurniture {
  id: string
  category: string
  name: string
  /** center, cm */
  x: number
  z: number
  /** radians about +Y, 0 faces +z */
  rotation: number
  /** width (local x), depth (local z), height, cm */
  w: number
  d: number
  h: number
  color: string
}

export const ROOM_CORNERS: Vec2[] = [
  { x: 0, z: 0 },
  { x: 600, z: 0 },
  { x: 600, z: 400 },
  { x: 0, z: 400 },
]

export const WALL_HEIGHT = 270 // cm
export const WALL_THICKNESS = 10 // cm

// Furniture placed comfortably inside the 600×400 room. Backs to walls where
// natural. Leaves a clear walking path down the middle for the walk test.
export const FURNITURE: HarnessFurniture[] = [
  // 3-seat sofa against the bottom wall (z≈400), facing into the room (-z).
  { id: 'sofa', category: 'sofa', name: '3-Seater Sofa', x: 200, z: 350, rotation: Math.PI, w: 220, d: 95, h: 80, color: '#6b7d8c' },
  // Coffee table in front of the sofa.
  { id: 'coffee', category: 'table', name: 'Coffee Table', x: 200, z: 250, rotation: 0, w: 110, d: 60, h: 42, color: '#8a6f4a' },
  // TV stand against the top wall (z≈0), facing the sofa (+z).
  { id: 'tv', category: 'storage', name: 'TV Stand', x: 200, z: 40, rotation: 0, w: 160, d: 40, h: 50, color: '#3a3d42' },
  // Wardrobe against the left wall (x≈0), facing +x.
  { id: 'wardrobe', category: 'storage', name: 'Wardrobe', x: 45, z: 200, rotation: Math.PI / 2, w: 60, d: 120, h: 200, color: '#7a5c43' },
  // Dining table to the right.
  { id: 'dining', category: 'table', name: 'Dining Table', x: 470, z: 200, rotation: 0, w: 140, d: 90, h: 75, color: '#9a7b52' },
  { id: 'chair-a', category: 'chair', name: 'Dining Chair', x: 470, z: 130, rotation: 0, w: 45, d: 50, h: 90, color: '#5a5048' },
  { id: 'chair-b', category: 'chair', name: 'Dining Chair', x: 470, z: 270, rotation: Math.PI, w: 45, d: 50, h: 90, color: '#5a5048' },
  // Potted plant in the corner.
  { id: 'plant', category: 'decor', name: 'Potted Plant', x: 555, z: 50, rotation: 0, w: 45, d: 45, h: 140, color: '#3f6b3a' },
]

/** Build collision OBBs (cm) from the furniture set. */
export function furnitureOBBs(): OBB[] {
  return FURNITURE.map((f) => ({ cx: f.x, cz: f.z, w: f.w, d: f.d, rot: f.rotation }))
}
