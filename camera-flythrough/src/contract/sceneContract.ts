import type * as THREE from 'three'

/**
 * TypeScript mirror of /shared/scene_contract.json (v1.0).
 *
 * These types are intentionally self-contained (no import from the front-end
 * src/) so the flythrough engine has zero build coupling to Agent A's tree.
 * The geometry shapes mirror src/types.ts + src/geometry exactly so the handle
 * the front-end publishes (via the sceneBus) drops in with no adapter.
 *
 * All collision coordinates are DESIGN centimeters; scene/camera coordinates
 * are world METERS centered on the room bbox (see src/three/coords.ts).
 */

/** Floor-plane point in centimeters. x = right, z = depth/forward. */
export interface Vec2 {
  x: number
  z: number
}

/** Derived wall segment (mirror of front-end Wall; only the fields we need). */
export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  length: number
  /** unit direction a->b */
  dirX: number
  dirZ: number
  /** unit inward normal (points toward room interior) */
  nx: number
  nz: number
}

/** Oriented bounding box footprint in cm. rot = radians about +Y, 0 faces +z. */
export interface OBB {
  cx: number
  cz: number
  w: number
  d: number
  rot: number
}

/** Axis-aligned bounds of the room polygon (cm). */
export interface Bounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** The collision world for first-person walk / walk-record (all cm). */
export interface Colliders {
  walls: Wall[]
  furniture: OBB[]
  polygon: Vec2[]
  wallThickness: number
  bounds: Bounds
}

/** cm(design) <-> m(world) frame, matching src/three/coords.ts makeFrame. */
export interface Frame {
  /** bbox center x (cm) */
  cx: number
  /** bbox center z (cm) */
  cz: number
}

export type FrameloopMode = 'always' | 'demand' | 'never'

/**
 * The live scene handle the front-end publishes via setSceneHandle().
 * Optional methods degrade gracefully — the engine null-checks each one.
 */
export interface SceneHandle {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  /** the live user camera (PerspectiveCamera); read-only to the engine */
  camera: THREE.PerspectiveCamera
  /** drei OrbitControls (or compatible) — disabled during walk/playback */
  controls?: { enabled: boolean } | null
  domElement: HTMLCanvasElement
  size?: { width: number; height: number }
  /**
   * Collision world for the walker. `floorCm` is the walker's current floor
   * height (cm above the ground floor): a multi-storey host returns the
   * colliders of the storey at that height. Hosts without storeys ignore it.
   */
  getColliders?: (floorCm?: number) => Colliders
  /**
   * Walkable floor height (cm above the ground floor) at a plan point, for a
   * walker currently at `currentFloorCm` — a stair's ramp, a landing, or a
   * storey's floor. Several floors can stack at one point (an upper room over
   * a lower one); return the one nearest `currentFloorCm`. `null` = no floor
   * there (a double-height void). Omitted ⇒ everything is flat at 0.
   */
  floorAt?: (xCm: number, zCm: number, currentFloorCm: number) => number | null
  frame?: () => Frame
  invalidate?: () => void
  setFrameloop?: (mode: FrameloopMode) => void
}
