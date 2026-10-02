// Boundary checks for the versioned whole-home envelope. Legacy single-room
// clients retain their historical permissive format; a damaged duplex cannot
// be stored because the reader would otherwise drop rooms or fail to reopen it.

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const bounded = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max
const vec2 = (value) => record(value) && finite(value.x) && finite(value.z)
const triple = (value) => Array.isArray(value) && value.length === 3 && value.every(finite)
const ROOM_TYPES = new Set(['bedroom', 'living', 'kitchen', 'bathroom', 'dining', 'foyer', 'hallway', 'office', 'balcony'])
const SHADOW_TYPES = new Set(['PCFSoft', 'PCF', 'VSM', 'Basic'])

const validRoomDesign = (d) => {
  if (!record(d) || !bounded(d.id) || !bounded(d.shape, 32) || !bounded(d.name, 200)) return false
  if (!Array.isArray(d.corners) || d.corners.length < 3 || d.corners.length > 32 || !d.corners.every(vec2)) return false
  if (!finite(d.wallHeight) || !finite(d.wallThickness) || !record(d.materials)) return false
  if (!bounded(d.materials.wallColor, 256) || !bounded(d.materials.floorTexture, 256)) return false
  if (!Array.isArray(d.openings) || d.openings.length > 100 || !Array.isArray(d.furniture) || d.furniture.length > 100) return false
  for (const opening of d.openings) {
    if (!record(opening) || !bounded(opening.id) || !bounded(opening.kind, 32) || !bounded(opening.style, 64) || !bounded(opening.wallId, 256)) return false
    if (![opening.t, opening.width, opening.height, opening.sill].every(finite)) return false
  }
  for (const item of d.furniture) {
    if (!record(item) || !bounded(item.id) || !bounded(item.archetype) || !bounded(item.category, 32) || !bounded(item.name, 200) || !bounded(item.color, 256)) return false
    if (![item.x, item.z, item.rotation, item.w, item.d, item.h].every(finite)) return false
  }
  if (d.view !== undefined && (!record(d.view) || !triple(d.view.cam) || !triple(d.view.target))) return false
  return true
}

/**
 * Return a public-safe error string for an invalid whole-home document, or null
 * when valid. The complete document still gets the route's byte ceiling.
 */
export const validateWholeHome = (design) => {
  if (!record(design) || !record(design.house)) return 'invalid whole-home design'
  const house = design.house
  if (house.version !== 1 || !validRoomDesign(design)) return 'invalid whole-home design'
  if (!bounded(house.activeId) || !(house.homeId === null || bounded(house.homeId))) return 'invalid whole-home design'
  if (!Array.isArray(house.levels) || house.levels.length > 20) return 'invalid whole-home design'
  if (!Array.isArray(house.rooms) || house.rooms.length < 1 || house.rooms.length > 100) return 'invalid whole-home design'
  for (const level of house.levels) {
    if (!record(level) || !bounded(level.label, 200) || !finite(level.elevationCm)) return 'invalid whole-home design'
  }
  const ids = new Set()
  for (const room of house.rooms) {
    if (!record(room) || !bounded(room.id) || !ROOM_TYPES.has(room.type) || !validRoomDesign(room.design)) return 'invalid whole-home design'
    if (room.design.id !== room.id || room.design.house !== undefined || ids.has(room.id)) return 'invalid whole-home design'
    if (room.pos !== undefined && !vec2(room.pos)) return 'invalid whole-home design'
    if (room.level !== undefined && (!Number.isInteger(room.level) || room.level < 0 || room.level >= Math.max(1, house.levels.length))) return 'invalid whole-home design'
    ids.add(room.id)
  }
  if (!ids.has(house.activeId)) return 'invalid whole-home design'
  if (house.viewMode !== 'room' && house.viewMode !== 'house') return 'invalid whole-home design'
  if (house.levelFilter !== 'all' && (!Number.isInteger(house.levelFilter) || house.levelFilter < 0 || house.levelFilter >= Math.max(1, house.levels.length))) return 'invalid whole-home design'
  const light = house.lighting
  if (!record(light) || light.version !== '1.0' || !record(light.sun) || !record(light.shadow) || !record(light.rooms)) return 'invalid whole-home design'
  if (![light.timeOfDay, light.northOffsetDeg, light.fillScale].every(finite)) return 'invalid whole-home design'
  if (![light.barVisible, light.northVisible, light.lightMode].every((v) => typeof v === 'boolean')) return 'invalid whole-home design'
  if (typeof light.sun.enabled !== 'boolean' || typeof light.sun.warmthShift !== 'boolean' || ![light.sun.maxElevationDeg, light.sun.intensityScale, light.sun.domeRadiusM].every(finite)) return 'invalid whole-home design'
  if (!SHADOW_TYPES.has(light.shadow.type) || ![light.shadow.mapSize, light.shadow.bias, light.shadow.normalBias].every(finite)) return 'invalid whole-home design'
  for (const [roomId, value] of Object.entries(light.rooms)) {
    if (!ids.has(roomId) || !record(value) || !Array.isArray(value.lights) || value.lights.length > 100) return 'invalid whole-home design'
    for (const lamp of value.lights) {
      if (!record(lamp) || !bounded(lamp.id) || !bounded(lamp.type, 64) || !bounded(lamp.layer, 64) || !bounded(lamp.color, 256) || !finite(lamp.intensity)) return 'invalid whole-home design'
      if (lamp.pos !== undefined && !triple(lamp.pos)) return 'invalid whole-home design'
      if (lamp.target !== undefined && !triple(lamp.target)) return 'invalid whole-home design'
    }
  }
  return null
}
