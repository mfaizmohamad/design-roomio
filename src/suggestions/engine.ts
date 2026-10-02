import type { RoomDesign, FurnitureItem, Vec2, RoomType } from '../types'
import { ARCHETYPE_MAP, mountOf } from '../data/archetypes'
import { rolesOf, countRole, hasRole, type Role } from './roles'
import { restsOnSurface, isCeilingHung, WALL_ATTACH_THRESHOLD_CM } from '../three/mount'
import rawRules from '../data/rules.json'

// ───────────────────────────────────────────────────────────────────────────
// Design-suggestion engine.
//
// Checks a room against the data-driven rulebook (data/rules.json) and returns
// dismissible, advisory suggestions. Two tiers — necessity (functional gaps) and
// polish (documented design principles). Necessity always ranks above polish.
// Re-run on every scene change; never auto-applies anything.
// ───────────────────────────────────────────────────────────────────────────

export type Tier = 'necessity' | 'polish'

type Trigger =
  | { kind: 'absent_role'; role: Role; room_types?: RoomType[] }
  | { kind: 'role_without_role'; have: Role; missing: Role; room_types?: RoomType[] }
  | { kind: 'role_count_between'; role: Role; min: number; max: number }
  | { kind: 'count_role_below'; role: Role; min: number }
  | { kind: 'absent_archetype'; archetype_id: string }
  | { kind: 'no_focal_point' }
  | { kind: 'all_seating_wall_hugged'; threshold_cm: number; room_types?: RoomType[] }
  | { kind: 'density_over'; ratio: number }
  | { kind: 'color_overload'; max_clusters: number }

export interface Rule {
  rule_id: string
  tier: Tier
  priority: number
  trigger: Trigger
  suggest_archetype: string
  message: string
  rationale: string
  genre_scope: string[]
}

export interface Suggestion {
  rule_id: string
  tier: Tier
  priority: number
  message: string
  rationale: string
  /** archetype the one-tap Add will drop (empty string = advisory only, no Add) */
  suggest_archetype: string
  suggest_name: string
}

export const RULES: Rule[] = (rawRules as Rule[]).filter(
  (r) => r && r.rule_id && r.trigger && (r.tier === 'necessity' || r.tier === 'polish'),
)

// ── geometry helpers (self-contained; cm) ──────────────────────────────────

function polygonArea(corners: Vec2[]): number {
  let a = 0
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length
    a += corners[i].x * corners[j].z - corners[j].x * corners[i].z
  }
  return Math.abs(a) / 2
}

function distToSegment(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz || 1
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cz = a.z + t * dz
  return Math.hypot(px - cx, pz - cz)
}

function distToNearestWall(item: FurnitureItem, corners: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < corners.length; i++) {
    const j = (i + 1) % corners.length
    best = Math.min(best, distToSegment(item.x, item.z, corners[i], corners[j]))
  }
  return best
}

// ── color analysis (for the 60-30-10 / color-overload rule) ─────────────────

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s, l }
}

/** Count distinct *saturated* hue families among the room's colors. */
function distinctStrongHues(design: RoomDesign): number {
  const colors = [
    design.materials.wallColor,
    ...design.furniture
      // rugs/plants/wall art read as texture, not part of the core color story
      .filter((f) => {
        const a = ARCHETYPE_MAP[f.archetype]
        return a && a.model !== 'rug' && a.model !== 'plant'
      })
      .map((f) => f.color),
  ]
  const buckets = new Set<number>()
  for (const c of colors) {
    const hsl = hexToHsl(c)
    if (!hsl) continue
    // ignore near-neutrals (low saturation) and near-black/near-white
    if (hsl.s < 0.22 || hsl.l < 0.08 || hsl.l > 0.93) continue
    buckets.add(Math.round(hsl.h / 30)) // 12 coarse hue families
  }
  return buckets.size
}

// ── focal point ─────────────────────────────────────────────────────────────

function hasFocalPoint(design: RoomDesign): boolean {
  const f = design.furniture
  if (hasRole(f, 'focal_candidate')) return true
  const rt = design.roomType ?? 'living'
  if ((rt === 'bedroom' || rt === 'studio') && hasRole(f, 'bed')) return true
  return false
}

// ── trigger evaluation ───────────────────────────────────────────────────────

function triggerFires(t: Trigger, design: RoomDesign): boolean {
  const f = design.furniture
  const rt: RoomType = design.roomType ?? 'living'
  switch (t.kind) {
    case 'absent_role':
      if (t.room_types && !t.room_types.includes(rt)) return false
      return !hasRole(f, t.role)
    case 'role_without_role':
      if (t.room_types && !t.room_types.includes(rt)) return false
      return hasRole(f, t.have) && !hasRole(f, t.missing)
    case 'role_count_between': {
      const n = countRole(f, t.role)
      return n >= t.min && n <= t.max
    }
    case 'count_role_below':
      return countRole(f, t.role) < t.min
    case 'absent_archetype':
      return !f.some((it) => it.archetype === t.archetype_id)
    case 'no_focal_point':
      // only meaningful once the room has *something* in it
      return f.length > 0 && !hasFocalPoint(design)
    case 'all_seating_wall_hugged': {
      if (t.room_types && !t.room_types.includes(rt)) return false
      const seats = f.filter((it) => rolesOf(it.archetype).has('seating'))
      if (seats.length === 0) return false
      // fire only when EVERY seat hugs a wall (no floating conversation zone)
      return seats.every((s) => {
        const halfExtent = Math.max(s.w, s.d) / 2
        return distToNearestWall(s, design.corners) - halfExtent <= t.threshold_cm
      })
    }
    case 'density_over': {
      const floor = polygonArea(design.corners)
      if (floor <= 0) return false
      let footprint = 0
      for (const it of f) {
        const a = ARCHETYPE_MAP[it.archetype]
        // rugs lie flat; TVs/mirrors hang on walls — none block traffic
        if (a && (a.model === 'rug' || a.model === 'tv' || a.model === 'mirror')) continue
        footprint += it.w * it.d
      }
      return footprint / floor > t.ratio
    }
    case 'color_overload':
      return distinctStrongHues(design) > t.max_clusters
    default:
      return false
  }
}

function genreInScope(rule: Rule, genre: string | undefined): boolean {
  if (rule.genre_scope.includes('all')) return true
  return !!genre && rule.genre_scope.includes(genre)
}

const TIER_RANK: Record<Tier, number> = { necessity: 0, polish: 1 }

/**
 * Evaluate a room against the rulebook. Returns suggestions sorted necessity-first,
 * then by ascending priority. Pure — safe to call on every scene change.
 */
export function evaluate(design: RoomDesign): Suggestion[] {
  const genre = design.personaGenre
  // A listing replica is a faithful reproduction of a REAL flat, not a
  // design-in-progress. Suppress necessity flags on it — they'd red-flag a
  // curated real scene as broken ("No bed", "Nowhere to sit", "No light
  // source") and the engine genuinely can't assess it fairly: real flats light
  // rooms with ceiling fixtures the role layer doesn't model, an unfurnished
  // listing is empty by design (not a design gap), and service rooms (kitchen/
  // bath/hallway/balcony) collapse to 'living' since RoomType can't name them.
  // Polish tips still surface as gentle, optional styling ideas.
  const replica = design.isReplica === true
  const out: Suggestion[] = []
  for (const rule of RULES) {
    if (replica && rule.tier === 'necessity') continue
    if (!genreInScope(rule, genre)) continue
    if (!triggerFires(rule.trigger, design)) continue
    out.push({
      rule_id: rule.rule_id,
      tier: rule.tier,
      priority: rule.priority,
      message: rule.message,
      rationale: rule.rationale,
      suggest_archetype: rule.suggest_archetype,
      suggest_name: ARCHETYPE_MAP[rule.suggest_archetype]?.name ?? '',
    })
  }
  out.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      a.priority - b.priority ||
      a.rule_id.localeCompare(b.rule_id),
  )
  return out
}

/** True if the room has any unmet *necessity* gap (used to validate presets). */
export function hasNecessityGap(design: RoomDesign): boolean {
  return evaluate(design).some((s) => s.tier === 'necessity')
}

// ── placement warnings (per-item) ────────────────────────────────────────────

export interface PlacementWarning {
  /** stable key for dismissal */
  key: string
  itemId: string
  name: string
  message: string
}

/** cm — a wall-mounted piece whose center is farther than this from any wall is
 *  "floating". Shared with three/mount.ts so warning + elevation stay in sync. */
const WALL_ATTACH_THRESHOLD = WALL_ATTACH_THRESHOLD_CM

/**
 * Per-item placement warnings, shown below the design suggestions. Currently:
 * wall-mounted pieces (TV, mirror, floating shelf) that aren't against a wall —
 * dismissible, with a one-tap "Move to wall".
 */
export function placementWarnings(design: RoomDesign): PlacementWarning[] {
  // Replica scenes are hand-authored to match listing photos — every wall piece
  // is deliberately placed. Don't second-guess a faithful reproduction.
  if (design.isReplica === true) return []
  const out: PlacementWarning[] = []
  for (const f of design.furniture) {
    if (mountOf(f.archetype) !== 'wall') continue
    // a TV/mirror resting on a console or desk is legitimately placed, even mid-room
    if (restsOnSurface(f, design.furniture)) continue
    // a fan / chandelier hangs from the ceiling — mid-room is where it belongs
    if (isCeilingHung(f.archetype)) continue
    // A mezzanine is attached by its BACK edge; its deck depth legitimately puts
    // the centre well past the threshold, so measure from the back edge instead.
    const reach = ARCHETYPE_MAP[f.archetype]?.model === 'mezzanine' ? f.d / 2 : 0
    if (distToNearestWall(f, design.corners) - reach > WALL_ATTACH_THRESHOLD) {
      out.push({
        key: `wall-${f.id}`,
        itemId: f.id,
        name: f.name,
        message: `“${f.name}” isn’t against a wall — wall pieces look best mounted on one.`,
      })
    }
  }
  return out
}
