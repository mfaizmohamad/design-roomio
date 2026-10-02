/**
 * Agent A's single-room model, PORTED READ-ONLY.
 *
 * The canonical source of truth is `src/types.ts` (RoomDesign) in Agent A's
 * front-end. Agent C never edits that file; we mirror its shape here verbatim so
 * the House schema can WRAP a RoomDesign (room.interior: RoomDesign) without a
 * build-time import (zero coupling — same approach Agent B used for the collision
 * math). If A changes RoomDesign (pinged in roomio.txt), re-sync this file.
 *
 * Last synced against src/types.ts @ 2026-06-30 (Agent A v3 catalog/detection).
 */

export type Unit = 'cm' | 'ft'

export type ShapeId = 'rect' | 'l' | 't' | 'u' | 'cut' | 'beveled'

/** Floor-plane point in centimeters. x = right, z = depth (forward). */
export interface Vec2 {
  x: number
  z: number
}

export type OpeningKind = 'door' | 'window'
export type DoorStyle = 'single' | 'glass' | 'french' | 'double' | 'bifold' | 'glassDouble'
export type WindowStyle = 'windowSingle' | 'windowDouble'
export type OpeningStyle = DoorStyle | WindowStyle

export interface Opening {
  id: string
  kind: OpeningKind
  style: OpeningStyle
  wallId: string
  /** center position along the wall, 0..1 */
  t: number
  width: number // cm
  height: number // cm
  sill: number // cm — bottom height above floor (0 for doors)
}

export type FurnitureCategory =
  | 'sofa'
  | 'bed'
  | 'table'
  | 'chair'
  | 'storage'
  | 'decor'
  | 'misc'

export interface FurnitureItem {
  id: string
  archetype: string // key into catalog
  category: FurnitureCategory
  name: string
  x: number // center, cm
  z: number // center, cm
  rotation: number // radians around Y (0 = facing +z)
  w: number // width (local x), cm
  d: number // depth (local z), cm
  h: number // height, cm
  color: string
  locked?: boolean
}

export interface Materials {
  wallColor: string
  floorTexture: string
}

export interface CameraView {
  cam: [number, number, number]
  target: [number, number, number]
}

export interface RoomDesign {
  id: string
  name: string
  unit: Unit
  shape: ShapeId
  corners: Vec2[] // ordered polygon (cm)
  wallHeight: number // cm
  wallThickness: number // cm
  openings: Opening[]
  materials: Materials
  furniture: FurnitureItem[]
  view?: CameraView
  createdAt: number
  updatedAt: number
}

/** Derived (not stored) wall segment between two consecutive corners. */
export interface Wall {
  id: string
  index: number
  a: Vec2
  b: Vec2
  length: number // cm
  dirX: number
  dirZ: number
  nx: number // unit inward normal
  nz: number
  midX: number
  midZ: number
  angle: number
}
