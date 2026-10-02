/**
 * Kitchen work-triangle / zone guidance (C6). Offered as assistance, never forced.
 *
 * Research-grounded ranges (NKBA-style, as seeded by the brief — verified, not
 * invented):
 *   - Work triangle = sink → stove → fridge. Each leg ~122–274 cm (4–9 ft);
 *     total perimeter ~396–792 cm (13–26 ft); no major traffic should cross it.
 *   - Aisle clearance: ≥107 cm (42 in) one cook; ≥122 cm (48 in) two cooks.
 *   - Island only if the room is ≥366 cm (12 ft) wide; keep it ≥107 cm (42 in)
 *     from appliances/cabinets.
 *
 * Fixtures (sink/stove/fridge) aren't in Agent A's catalog yet (see REQUEST ->
 * ASSET); meanwhile these evaluators work on explicit fixture points, or on
 * placeholder furniture the user has labeled, so guidance is live regardless.
 */
import type { Vec2, FurnitureItem } from './interior'
import type { HouseRoom } from './types'
import { guidanceFor } from './data/roomTypes'

export const TRIANGLE_LEG_MIN = 122 // cm (4 ft)
export const TRIANGLE_LEG_MAX = 274 // cm (9 ft)
export const TRIANGLE_TOTAL_MIN = 396 // cm (13 ft)
export const TRIANGLE_TOTAL_MAX = 792 // cm (26 ft)
export const AISLE_ONE_COOK = 107 // cm (42 in)
export const AISLE_TWO_COOK = 122 // cm (48 in)
export const ISLAND_MIN_ROOM_WIDTH = 366 // cm (12 ft)
export const ISLAND_MIN_CLEARANCE = 107 // cm (42 in)

export interface WorkTriangleResult {
  legs: { sinkStove: number; stoveFridge: number; fridgeSink: number }
  total: number
  warnings: string[]
  ok: boolean
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

/** Evaluate the sink–stove–fridge work triangle against NKBA ranges. */
export function evaluateWorkTriangle(sink: Vec2, stove: Vec2, fridge: Vec2): WorkTriangleResult {
  const sinkStove = dist(sink, stove)
  const stoveFridge = dist(stove, fridge)
  const fridgeSink = dist(fridge, sink)
  const total = sinkStove + stoveFridge + fridgeSink
  const warnings: string[] = []

  const legChecks: Array<[string, number]> = [
    ['sink↔stove', sinkStove],
    ['stove↔fridge', stoveFridge],
    ['fridge↔sink', fridgeSink],
  ]
  for (const [name, len] of legChecks) {
    if (len < TRIANGLE_LEG_MIN) {
      warnings.push(`${name} leg is ${Math.round(len)} cm — tight (aim ≥ ${TRIANGLE_LEG_MIN} cm / 4 ft).`)
    } else if (len > TRIANGLE_LEG_MAX) {
      warnings.push(`${name} leg is ${Math.round(len)} cm — long (aim ≤ ${TRIANGLE_LEG_MAX} cm / 9 ft).`)
    }
  }
  if (total < TRIANGLE_TOTAL_MIN) {
    warnings.push(`Triangle perimeter ${Math.round(total)} cm is cramped (aim ≥ ${TRIANGLE_TOTAL_MIN} cm).`)
  } else if (total > TRIANGLE_TOTAL_MAX) {
    warnings.push(`Triangle perimeter ${Math.round(total)} cm is too spread out (aim ≤ ${TRIANGLE_TOTAL_MAX} cm).`)
  }

  return {
    legs: { sinkStove, stoveFridge, fridgeSink },
    total,
    warnings,
    ok: warnings.length === 0,
  }
}

export interface IslandFit {
  fits: boolean
  roomWidthCm: number
  note: string
}

/** Can an island fit, given the room's (bbox) width? */
export function islandFits(roomWidthCm: number): IslandFit {
  const fits = roomWidthCm >= ISLAND_MIN_ROOM_WIDTH
  return {
    fits,
    roomWidthCm,
    note: fits
      ? `Room is ${Math.round(roomWidthCm)} cm wide — an island fits; keep it ≥ ${ISLAND_MIN_CLEARANCE} cm (42 in) from cabinets/appliances.`
      : `Room is ${Math.round(roomWidthCm)} cm wide — below ~${ISLAND_MIN_ROOM_WIDTH} cm (12 ft); a peninsula or galley layout suits better than an island.`,
  }
}

/** Match a furniture item to a work-triangle role by name (case-insensitive). */
function roleOf(name: string): 'sink' | 'stove' | 'fridge' | null {
  const n = name.toLowerCase()
  if (n.includes('sink')) return 'sink'
  if (n.includes('stove') || n.includes('cooktop') || n.includes('range') || n.includes('oven')) return 'stove'
  if (n.includes('fridge') || n.includes('refrigerator')) return 'fridge'
  return null
}

/** Find sink/stove/fridge fixtures by label within a kitchen's furniture. */
export function findTriangleFixtures(
  furniture: FurnitureItem[],
): { sink?: Vec2; stove?: Vec2; fridge?: Vec2 } {
  const out: { sink?: Vec2; stove?: Vec2; fridge?: Vec2 } = {}
  for (const f of furniture) {
    const role = roleOf(f.name)
    if (role && !out[role]) out[role] = { x: f.x, z: f.z }
  }
  return out
}

export interface KitchenGuidance {
  guidance: string[]
  island: IslandFit
  /** present only when all three triangle fixtures are found/labeled */
  triangle?: WorkTriangleResult
}

/** Live kitchen guidance for a room: the offered tips + island fit + (if the user
 *  has labeled sink/stove/fridge) the work-triangle evaluation. */
export function kitchenGuidance(room: HouseRoom): KitchenGuidance {
  const island = islandFits(room.footprint.w)
  const fx = findTriangleFixtures(room.interior.furniture ?? [])
  const result: KitchenGuidance = { guidance: guidanceFor('kitchen'), island }
  if (fx.sink && fx.stove && fx.fridge) {
    result.triangle = evaluateWorkTriangle(fx.sink, fx.stove, fx.fridge)
  }
  return result
}
