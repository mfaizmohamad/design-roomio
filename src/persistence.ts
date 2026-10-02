import type { RoomDesign } from './types'
import type { RoomEntry } from './three/houseSession'
import type { HouseLevel } from './three/houseLevels'
import type { LightingState, Light } from '../lighting/src/types'
import type { ViewMode, LevelFilter } from './three/houseViewMode'

/** Versioned whole-house data embedded in a normal design record for old API compatibility. */
export interface SavedHouse {
  version: 1
  activeId: string
  homeId: string | null
  levels: HouseLevel[]
  rooms: RoomEntry[]
  lighting: LightingState & { fillScale: number }
  viewMode: ViewMode
  levelFilter: LevelFilter
}

export type SavedDesign = RoomDesign & { house?: SavedHouse }

/** localStorage key holding the JSON map { [id]: RoomDesign }. */
const STORAGE_KEY = 'roomio.designs.v1'

export interface DesignSummary {
  id: string
  name: string
  updatedAt: number
  createdAt: number
  shape: string
}

type DesignMap = Record<string, SavedDesign>

/** Read the whole design map from localStorage, tolerating any corruption. */
function readMap(): DesignMap {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: DesignMap = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const d = coerceDesign(value)
      if (d && d.id === id) out[id] = d
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the design map; throw when the browser did not actually save it. */
function writeMap(map: DesignMap): void {
  // Swallowing QuotaExceededError made Wizard display "Saved ✓" while the
  // entire duplex was lost on reload. Let its existing error toast report it.
  if (typeof localStorage === 'undefined') throw new Error('Browser storage unavailable')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isVec2(v: unknown): v is { x: number; z: number } {
  return (
    !!v &&
    typeof v === 'object' &&
    isFiniteNumber((v as { x: unknown }).x) &&
    isFiniteNumber((v as { z: unknown }).z)
  )
}

function isTriple(t: unknown): t is [number, number, number] {
  return Array.isArray(t) && t.length === 3 && t.every(isFiniteNumber)
}

/** Validate an optional saved camera viewpoint; undefined when malformed. */
function coerceView(v: unknown): RoomDesign['view'] {
  if (!v || typeof v !== 'object') return undefined
  const cam = (v as { cam?: unknown }).cam
  const target = (v as { target?: unknown }).target
  if (!isTriple(cam) || !isTriple(target)) return undefined
  return { cam: [cam[0], cam[1], cam[2]], target: [target[0], target[1], target[2]] }
}

/** Validate an optional ceiling treatment; undefined when malformed/empty. */
function coerceCeiling(v: unknown): RoomDesign['ceiling'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const c = v as Record<string, unknown>
  const out: NonNullable<RoomDesign['ceiling']> = {}
  if (typeof c.color === 'string') out.color = c.color
  if (typeof c.texture === 'string') out.texture = c.texture
  if (typeof c.downlight === 'boolean') out.downlight = c.downlight
  return Object.keys(out).length > 0 ? out : undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const ROOM_ENTRY_TYPES = new Set(['bedroom', 'living', 'kitchen', 'bathroom', 'dining', 'foyer', 'hallway', 'office', 'balcony'])

/** Reject a damaged house atomically; silently dropping one room would misrepresent a floor plan. */
function coerceHouse(value: unknown): SavedHouse | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.rooms) || !value.rooms.length || value.rooms.length > 100) return null
  if (typeof value.activeId !== 'string' || !Array.isArray(value.levels) || value.levels.length > 20) return null
  if (value.homeId !== null && typeof value.homeId !== 'string') return null
  const levels: HouseLevel[] = []
  for (const raw of value.levels) {
    if (!isRecord(raw) || typeof raw.label !== 'string' || !isFiniteNumber(raw.elevationCm)) return null
    levels.push({ label: raw.label, elevationCm: raw.elevationCm })
  }
  const rooms: RoomEntry[] = []
  const ids = new Set<string>()
  for (const raw of value.rooms) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string' || !ROOM_ENTRY_TYPES.has(raw.type)) return null
    // House data is one level deep. A nested house inside a room would recurse
    // indefinitely through this validator on a hostile imported JSON payload.
    if (isRecord(raw.design) && raw.design.house !== undefined) return null
    const design = coerceDesign(raw.design)
    if (!design || design.id !== raw.id || ids.has(raw.id)) return null
    ids.add(raw.id)
    if (raw.level !== undefined && (!Number.isInteger(raw.level) || (raw.level as number) < 0 || (raw.level as number) >= Math.max(1, levels.length))) return null
    if (raw.pos !== undefined && !isVec2(raw.pos)) return null
    rooms.push({ id: raw.id, type: raw.type as RoomEntry['type'], design, ...(raw.pos ? { pos: raw.pos as RoomEntry['pos'] } : {}), ...(raw.level !== undefined ? { level: raw.level as number } : {}) })
  }
  if (!ids.has(value.activeId)) return null
  const l = value.lighting
  if (!isRecord(l) || l.version !== '1.0' || !isRecord(l.sun) || !isRecord(l.shadow) || !isRecord(l.rooms)) return null
  if (!isFiniteNumber(l.timeOfDay) || !isFiniteNumber(l.northOffsetDeg) || !isFiniteNumber(l.fillScale) || typeof l.barVisible !== 'boolean' || typeof l.northVisible !== 'boolean' || typeof l.lightMode !== 'boolean') return null
  if (typeof l.sun.enabled !== 'boolean' || !isFiniteNumber(l.sun.maxElevationDeg) || typeof l.sun.warmthShift !== 'boolean' || !isFiniteNumber(l.sun.intensityScale) || !isFiniteNumber(l.sun.domeRadiusM)) return null
  if (!isFiniteNumber(l.shadow.mapSize) || !isFiniteNumber(l.shadow.bias) || !isFiniteNumber(l.shadow.normalBias) || typeof l.shadow.type !== 'string' || !['PCFSoft', 'PCF', 'VSM', 'Basic'].includes(l.shadow.type)) return null
  const lightingRooms: LightingState['rooms'] = {}
  for (const [roomId, raw] of Object.entries(l.rooms)) {
    if (!ids.has(roomId) || !isRecord(raw) || !Array.isArray(raw.lights) || raw.lights.length > 100) return null
    const lights: Light[] = []
    for (const light of raw.lights) {
      if (!isRecord(light) || typeof light.id !== 'string' || typeof light.type !== 'string' || typeof light.layer !== 'string' || typeof light.color !== 'string' || !isFiniteNumber(light.intensity)) return null
      if (light.pos !== undefined && !isTriple(light.pos)) return null
      if (light.target !== undefined && !isTriple(light.target)) return null
      lights.push(light as unknown as Light)
    }
    lightingRooms[roomId] = { lights }
  }
  const viewMode = value.viewMode === 'house' ? 'house' : 'room'
  const levelFilter = value.levelFilter === 'all' ? 'all' : isFiniteNumber(value.levelFilter) && Number.isInteger(value.levelFilter) && value.levelFilter >= 0 && value.levelFilter < Math.max(1, levels.length) ? value.levelFilter : 'all'
  return {
    version: 1, activeId: value.activeId, homeId: value.homeId as string | null,
    levels, rooms,
    lighting: { ...(l as unknown as LightingState), rooms: lightingRooms, fillScale: l.fillScale },
    viewMode, levelFilter,
  }
}

const ROOM_TYPES: readonly string[] = ['living', 'bedroom', 'studio', 'family', 'office', 'den']

/**
 * Validate and normalize an unknown value into a RoomDesign.
 * Returns null when required fields are missing or malformed. Optional arrays
 * (openings, furniture) are coerced to [] when absent or invalid; additive
 * optional fields (view, roomType, ceiling, …) are kept when they validate.
 *
 * Shared by BOTH storage backends: localStorage reads here and cloud loads in
 * repository.ts run through this same choke point.
 */
export function coerceDesign(value: unknown): SavedDesign | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>

  // ---- required scalars ----
  if (typeof v.id !== 'string' || !v.id) return null
  if (typeof v.shape !== 'string' || !v.shape) return null

  // ---- required corner polygon ----
  if (!Array.isArray(v.corners) || v.corners.length < 3) return null
  const corners = v.corners.map((c) => (isVec2(c) ? { x: c.x, z: c.z } : null))
  if (corners.some((c) => c === null)) return null

  // ---- required materials ----
  const rawMaterials = v.materials
  if (!rawMaterials || typeof rawMaterials !== 'object' || Array.isArray(rawMaterials)) return null
  const mat = rawMaterials as Record<string, unknown>
  if (typeof mat.wallColor !== 'string' || typeof mat.floorTexture !== 'string') return null

  // ---- defaults for optional / derivable scalars ----
  const name = typeof v.name === 'string' ? v.name : 'Untitled room'
  const unit = v.unit === 'cm' || v.unit === 'ft' ? v.unit : 'ft'
  const wallHeight = isFiniteNumber(v.wallHeight) ? v.wallHeight : 270
  const wallThickness = isFiniteNumber(v.wallThickness) ? v.wallThickness : 12
  const createdAt = isFiniteNumber(v.createdAt) ? v.createdAt : Date.now()
  const updatedAt = isFiniteNumber(v.updatedAt) ? v.updatedAt : createdAt

  // ---- optional arrays: coerce missing/invalid to [] ----
  const openings = Array.isArray(v.openings) ? (v.openings as RoomDesign['openings']) : []
  const furniture = Array.isArray(v.furniture) ? (v.furniture as RoomDesign['furniture']) : []

  // ---- additive optional fields: keep them when valid, drop when not ----
  const view = coerceView(v.view)
  const ceiling = coerceCeiling(v.ceiling)
  const roomType =
    typeof v.roomType === 'string' && ROOM_TYPES.includes(v.roomType)
      ? (v.roomType as RoomDesign['roomType'])
      : undefined
  const personaGenre = typeof v.personaGenre === 'string' ? v.personaGenre : undefined
  const autoDoorways = typeof v.autoDoorways === 'boolean' ? v.autoDoorways : undefined
  const isReplica = typeof v.isReplica === 'boolean' ? v.isReplica : undefined
  const wallTexture = typeof mat.wallTexture === 'string' ? mat.wallTexture : undefined
  // A malformed house must fail the whole load; otherwise a damaged duplex
  // would quietly reopen as its single-room compatibility shell.
  const house = v.house === undefined ? undefined : coerceHouse(v.house)
  if (v.house !== undefined && !house) return null

  return {
    id: v.id,
    name,
    unit,
    shape: v.shape as RoomDesign['shape'],
    corners: corners as RoomDesign['corners'],
    wallHeight,
    wallThickness,
    openings,
    materials: {
      wallColor: mat.wallColor,
      floorTexture: mat.floorTexture,
      ...(wallTexture !== undefined ? { wallTexture } : {}),
    },
    furniture,
    ...(view ? { view } : {}),
    ...(ceiling ? { ceiling } : {}),
    ...(roomType !== undefined ? { roomType } : {}),
    ...(personaGenre !== undefined ? { personaGenre } : {}),
    ...(autoDoorways !== undefined ? { autoDoorways } : {}),
    ...(isReplica !== undefined ? { isReplica } : {}),
    ...(house ? { house } : {}),
    createdAt,
    updatedAt,
  }
}

/** All saved designs as lightweight summaries, newest first by updatedAt. */
export function listDesigns(): DesignSummary[] {
  const map = readMap()
  return Object.values(map)
    .map((d) => ({
      id: d.id,
      name: d.name,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
      shape: d.shape,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Upsert a design by id, stamping updatedAt = now. */
export function saveDesign(d: SavedDesign): void {
  const map = readMap()
  map[d.id] = { ...d, updatedAt: Date.now() }
  writeMap(map)
}

/** Load a single design by id, or null if absent/corrupt. */
export function loadDesign(id: string): SavedDesign | null {
  const map = readMap()
  return map[id] ?? null
}

/** Remove a design by id (no-op if it does not exist). */
export function deleteDesign(id: string): void {
  const map = readMap()
  if (id in map) {
    delete map[id]
    writeMap(map)
  }
}

/** Serialize a design to a pretty JSON string. */
export function exportDesignJSON(d: SavedDesign): string {
  return JSON.stringify(d, null, 2)
}

/** Parse + validate a JSON string into a RoomDesign; null on any failure. */
export function importDesignJSON(json: string): SavedDesign | null {
  try {
    const parsed = JSON.parse(json) as unknown
    return coerceDesign(parsed)
  } catch {
    return null
  }
}

/** Trigger a browser download of the design as a `${name}.json` file. */
export function downloadDesign(d: SavedDesign): void {
  try {
    if (typeof document === 'undefined' || typeof URL === 'undefined') return
    const json = exportDesignJSON(d)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const safeName = (d.name || 'design').trim().replace(/[^\w.-]+/g, '_') || 'design'
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeName}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch {
    // ignore: download not possible in this environment
  }
}
