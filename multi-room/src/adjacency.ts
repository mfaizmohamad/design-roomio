/**
 * Adjacency suggestion rules AC1–AC9 (brief §5).
 *
 * These are DISMISSIBLE NUDGES, never blocks — mirroring Agent A's suggestion-
 * engine philosophy. A user can put an archway into a bathroom if they insist; we
 * warn, we don't forbid. `evaluateAdjacency(house)` returns the current set of
 * suggestions/warnings for the whole house; the UI shows each with its one-line
 * rationale and a dismiss affordance.
 */
import type { ConnectorType, House, HouseRoom, RoomType } from './types'
import { isOpenConnector, connectorInfo, MIN_PASSAGE_WIDTH } from './data/connectorTypes'
import { findSharedWalls } from './geometry/placement'
import { swingHitsFurniture } from './geometry/swing'

export type Severity = 'suggest' | 'warn'
export type AdjacencyRuleId = 'AC1' | 'AC2' | 'AC3' | 'AC4' | 'AC5' | 'AC6' | 'AC7' | 'AC8' | 'AC9'

export interface AdjacencySuggestion {
  rule: AdjacencyRuleId
  severity: Severity
  /** involved room ids */
  rooms: string[]
  /** present when the suggestion concerns an existing connector */
  connector_id?: string
  message: string
  rationale: string
  dismissible: true
  /** connector types we'd recommend, where relevant */
  suggestedTypes?: ConnectorType[]
}

const PRIVACY_DOORS: ConnectorType[] = ['hinged', 'pocket']

function nameOf(house: House, id: string): string {
  return house.rooms.find((r) => r.room_id === id)?.interior.name || id
}

/** Unordered room-id pairs that physically share a wall. */
function adjacentPairs(house: House): Array<[HouseRoom, HouseRoom]> {
  const pairs: Array<[HouseRoom, HouseRoom]> = []
  const rooms = house.rooms
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (findSharedWalls(rooms[i], rooms[j]).length > 0) pairs.push([rooms[i], rooms[j]])
    }
  }
  return pairs
}

function connectorsBetween(house: House, aId: string, bId: string) {
  return house.connectors.filter(
    (c) =>
      (c.between[0] === aId && c.between[1] === bId) || (c.between[0] === bId && c.between[1] === aId),
  )
}

function involves(a: RoomType | undefined, b: RoomType | undefined, t: RoomType): boolean {
  return a === t || b === t
}

function isPair(a: RoomType | undefined, b: RoomType | undefined, x: RoomType, y: RoomType): boolean {
  return (a === x && b === y) || (a === y && b === x)
}

/** Suggestion for an ADJACENT pair that currently has NO connector (most specific rule wins). */
function suggestForUnconnectedPair(house: House, a: HouseRoom, b: HouseRoom): AdjacencySuggestion {
  const ta = a.type
  const tb = b.type
  const rooms = [a.room_id, b.room_id]
  const label = `${nameOf(house, a.room_id)} ↔ ${nameOf(house, b.room_id)}`

  // AC1 — bathroom privacy
  if (involves(ta, tb, 'bathroom')) {
    return {
      rule: 'AC1',
      severity: 'suggest',
      rooms,
      message: `Add a private door between ${label}.`,
      rationale: 'Bathrooms need to close — use a hinged or pocket door, not an open connector.',
      dismissible: true,
      suggestedTypes: PRIVACY_DOORS,
    }
  }
  // AC4 — bedroom privacy
  if (involves(ta, tb, 'bedroom')) {
    return {
      rule: 'AC4',
      severity: 'suggest',
      rooms,
      message: `Add a private door between ${label}.`,
      rationale: 'Bedrooms want privacy — a hinged or pocket door is preferred over an open connector.',
      dismissible: true,
      suggestedTypes: PRIVACY_DOORS,
    }
  }
  // AC2 — kitchen ↔ dining
  if (isPair(ta, tb, 'kitchen', 'dining')) {
    return {
      rule: 'AC2',
      severity: 'suggest',
      rooms,
      message: `Open up ${label} for serving.`,
      rationale: 'Kitchen↔dining flows best through a cased / wide opening or a pass-through; a door is optional.',
      dismissible: true,
      suggestedTypes: ['cased_opening', 'wide_opening', 'pass_through'],
    }
  }
  // AC3 — living ↔ dining
  if (isPair(ta, tb, 'living', 'dining')) {
    return {
      rule: 'AC3',
      severity: 'suggest',
      rooms,
      message: `Connect ${label} with open-plan continuity.`,
      rationale: 'Living↔dining reads best as an archway, wide opening, or half-wall — continuity with definition.',
      dismissible: true,
      suggestedTypes: ['archway', 'wide_opening', 'half_wall'],
    }
  }
  // AC5 — foyer/entry ↔ living
  if (isPair(ta, tb, 'foyer', 'living')) {
    return {
      rule: 'AC5',
      severity: 'suggest',
      rooms,
      message: `Frame the sight line from ${label}.`,
      rationale: 'A foyer welcomes into the living room through an archway or cased opening.',
      dismissible: true,
      suggestedTypes: ['archway', 'cased_opening'],
    }
  }
  // AC8 — generic: adjacent but unreachable
  return {
    rule: 'AC8',
    severity: 'suggest',
    rooms,
    message: `${label} are adjacent but not connected.`,
    rationale: 'Add a connector on the shared wall so the rooms are actually reachable — or leave them separate.',
    dismissible: true,
  }
}

/**
 * Evaluate the whole house and return every active suggestion/warning. Pure: it
 * reads the house and reports; it never mutates or blocks.
 */
export function evaluateAdjacency(house: House): AdjacencySuggestion[] {
  const out: AdjacencySuggestion[] = []
  const pairs = adjacentPairs(house)

  // Per-pair rules (no-connector typed suggestions; privacy on open connectors)
  for (const [a, b] of pairs) {
    const conns = connectorsBetween(house, a.room_id, b.room_id)
    if (conns.length === 0) {
      out.push(suggestForUnconnectedPair(house, a, b))
      continue
    }
    // AC1 / AC4 — privacy violated by an OPEN connector on a bathroom/bedroom
    const ta = a.type
    const tb = b.type
    const privacyRoom: RoomType | null = involves(ta, tb, 'bathroom')
      ? 'bathroom'
      : involves(ta, tb, 'bedroom')
        ? 'bedroom'
        : null
    if (privacyRoom) {
      for (const c of conns) {
        if (isOpenConnector(c.type)) {
          out.push({
            rule: privacyRoom === 'bathroom' ? 'AC1' : 'AC4',
            severity: 'warn',
            rooms: [a.room_id, b.room_id],
            connector_id: c.connector_id,
            message: `${connectorInfo(c.type).label} into a ${privacyRoom} offers no privacy.`,
            rationale: `${privacyRoom === 'bathroom' ? 'Bathrooms' : 'Bedrooms'} need to close — switch to a hinged or pocket door.`,
            dismissible: true,
            suggestedTypes: PRIVACY_DOORS,
          })
        }
      }
    }
  }

  // AC9 — any connector narrower than a sensible passage
  for (const c of house.connectors) {
    if (c.width_cm < MIN_PASSAGE_WIDTH) {
      out.push({
        rule: 'AC9',
        severity: 'suggest',
        rooms: [...c.between],
        connector_id: c.connector_id,
        message: `${connectorInfo(c.type).label} is only ${Math.round(c.width_cm)} cm wide.`,
        rationale: `Widen to at least ~${MIN_PASSAGE_WIDTH} cm (32 in) for comfortable passage.`,
        dismissible: true,
      })
    }
  }

  // AC7 — door swing overlaps a fixture
  for (const c of house.connectors) {
    if (!c.swing) continue
    const hits = swingHitsFurniture(c, house)
    if (hits.length > 0) {
      const names = [...new Set(hits.map((h) => h.furniture_name))].join(', ')
      out.push({
        rule: 'AC7',
        severity: 'warn',
        rooms: [...c.between],
        connector_id: c.connector_id,
        message: `Door swing hits ${names}.`,
        rationale: 'Flip the swing, switch to a pocket/sliding door, or relocate the connector.',
        dismissible: true,
        suggestedTypes: ['pocket'],
      })
    }
  }

  // AC6 — many rooms branching off one area → suggest a hallway
  const hasHallway = house.rooms.some((r) => r.type === 'hallway')
  if (!hasHallway) {
    const degree = new Map<string, number>()
    for (const [a, b] of pairs) {
      degree.set(a.room_id, (degree.get(a.room_id) ?? 0) + 1)
      degree.set(b.room_id, (degree.get(b.room_id) ?? 0) + 1)
    }
    for (const [roomId, deg] of degree) {
      if (deg >= 3) {
        out.push({
          rule: 'AC6',
          severity: 'suggest',
          rooms: [roomId],
          message: `${nameOf(house, roomId)} branches to ${deg} rooms.`,
          rationale: 'Add a hallway so several rooms share a circulation path instead of all opening into each other.',
          dismissible: true,
          suggestedTypes: ['hallway_link'],
        })
        break // one hallway nudge is enough
      }
    }
  }

  return out
}
