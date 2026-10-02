/**
 * Bathroom clearance + privacy guidance (C6). Offered as assistance, never forced.
 *
 * Research-grounded clearances (code/NKBA-style, as seeded by the brief — verified,
 * not invented):
 *   - Clear floor space in FRONT of a fixture (toilet/sink): ~53–76 cm (21–30 in).
 *   - Walkway / circulation: ~76 cm (30 in).
 *   - Group plumbing along wet walls; a door swing must not hit a fixture (AC7);
 *     privacy + ventilation from public rooms (hinged/pocket door, see AC1).
 *
 * Bathroom fixtures (toilet/sink/shower/tub) aren't in Agent A's catalog yet (see
 * REQUEST -> ASSET); the clearance check works on any furniture OBB meanwhile, so a
 * labeled placeholder behaves correctly.
 */
import type { FurnitureItem } from './interior'
import type { HouseRoom } from './types'
import { obbOf, obbOverlap, type OBB } from './geometry/obb'
import { guidanceFor } from './data/roomTypes'

export const FIXTURE_FRONT_CLEARANCE = 53 // cm (~21 in) minimum in front of a fixture
export const FIXTURE_FRONT_CLEARANCE_GENEROUS = 76 // cm (~30 in)
export const WALKWAY_CLEARANCE = 76 // cm (~30 in)

/**
 * The clear-floor zone in front of a fixture, as an OBB. The fixture faces +z in
 * its local frame (rotation 0); the zone extends `depthCm` out along that facing
 * normal, matching the fixture's width.
 */
export function clearanceZone(fixture: FurnitureItem, depthCm = FIXTURE_FRONT_CLEARANCE): OBB {
  // forward (local +z) in world = (sin, cos) per A's OBB convention.
  const fx = Math.sin(fixture.rotation)
  const fz = Math.cos(fixture.rotation)
  const offset = fixture.d / 2 + depthCm / 2
  return {
    cx: fixture.x + fx * offset,
    cz: fixture.z + fz * offset,
    w: fixture.w,
    d: depthCm,
    rot: fixture.rotation,
  }
}

export interface ClearanceResult {
  fixture_id: string
  fixture_name: string
  ok: boolean
  blockedBy: string[]
}

/**
 * Is the clear-floor zone in front of a fixture free of other furniture?
 * `others` defaults to every other item in the same room.
 */
export function checkFixtureClearance(
  fixture: FurnitureItem,
  others: FurnitureItem[],
  depthCm = FIXTURE_FRONT_CLEARANCE,
): ClearanceResult {
  const zone = clearanceZone(fixture, depthCm)
  const blockedBy: string[] = []
  for (const o of others) {
    if (o.id === fixture.id) continue
    if (obbOverlap(zone, obbOf(o))) blockedBy.push(o.name)
  }
  return { fixture_id: fixture.id, fixture_name: fixture.name, ok: blockedBy.length === 0, blockedBy }
}

/** Match a furniture item to a bathroom fixture role by name. */
function isBathroomFixture(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('toilet') ||
    n.includes('wc') ||
    n.includes('sink') ||
    n.includes('vanity') ||
    n.includes('shower') ||
    n.includes('bath') ||
    n.includes('tub')
  )
}

export interface BathroomGuidance {
  guidance: string[]
  /** clearance check per labeled fixture (empty when none are labeled yet) */
  clearances: ClearanceResult[]
}

/** Live bathroom guidance: the offered tips + a clearance check for any labeled fixtures. */
export function bathroomGuidance(room: HouseRoom, depthCm = FIXTURE_FRONT_CLEARANCE): BathroomGuidance {
  const furniture = room.interior.furniture ?? []
  const fixtures = furniture.filter((f) => isBathroomFixture(f.name))
  const clearances = fixtures.map((f) => checkFixtureClearance(f, furniture, depthCm))
  return { guidance: guidanceFor('bathroom'), clearances }
}
