import { create } from 'zustand'
import type {
  RoomDesign,
  ShapeId,
  Vec2,
  Wall,
  Opening,
  OpeningStyle,
  FurnitureItem,
} from './types'
import type { Unit } from './units'
import { clampWallLength, clampWallHeight, MAX_WALL_CM } from './units'
import { presetCorners } from './geometry/presets'
import { deriveWalls, bbox, signedArea, safeInteriorPoint } from './geometry/walls'
import { resolveFurniture } from './geometry/collision'
import { OPENING_MAP } from './data/openings'
import { ARCHETYPE_MAP, isMounted, mountOf } from './data/archetypes'
import { dependentsOf, findWallSpawn, floorFallbackSpawn, isCeilingHung } from './three/mount'
import { DEFAULT_WALL_COLOR, DEFAULT_FLOOR } from './data/materials'
import { toRoomDesign, type PersonaPreset } from './data/personas'

export type Stage = 'start' | 'step1' | 'step2' | 'step3' | 'step4' | 'furnish' | 'listings'

export const WIZARD_STEPS: Stage[] = ['step1', 'step2', 'step3', 'step4']

export function uid(prefix = 'id'): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function newDesign(shape: ShapeId = 'rect'): RoomDesign {
  const now = Date.now()
  return {
    id: uid('room'),
    name: 'Untitled room',
    unit: 'ft',
    shape,
    corners: presetCorners(shape),
    wallHeight: 270,
    wallThickness: 12,
    openings: [],
    materials: { wallColor: DEFAULT_WALL_COLOR, floorTexture: DEFAULT_FLOOR },
    furniture: [],
    createdAt: now,
    updatedAt: now,
  }
}

interface DesignStore {
  stage: Stage
  design: RoomDesign
  walls: Wall[]
  selectedOpeningId: string | null
  selectedFurnitureId: string | null
  /** the door/window style armed for placement (Step 3) */
  placingStyle: OpeningStyle | null
  /** transient: id of furniture currently flagged as overlapping another */
  overlapIds: string[]
  /** transient: rule_ids the user has dismissed this session (suggestion engine) */
  dismissedSuggestions: string[]

  /** bump to ask the 3D view to refit the camera to the room */
  fitNonce: number
  fitView: () => void

  // ---- undo / redo ----
  past: RoomDesign[]
  future: RoomDesign[]
  /** true while a pointer-drag gesture is in flight (suppresses per-tick history) */
  interacting: boolean
  pushHistory: () => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void

  // ---- navigation ----
  setStage: (s: Stage) => void
  next: () => void
  back: () => void

  // ---- step 1 / shape ----
  setShape: (id: ShapeId) => void

  // ---- step 2 / dimensions ----
  setUnit: (u: Unit) => void
  dragWallPerp: (wallId: string, deltaCm: number) => void
  setWallLength: (wallId: string, lengthCm: number) => void
  /** Replace the whole footprint polygon (undoable). Used by the whole-house
   *  plan view to resize the active room; rejects degenerate/inverted polygons. */
  setCorners: (corners: Vec2[]) => void
  setWallHeight: (cm: number) => void

  // ---- step 3 / openings ----
  setPlacingStyle: (style: OpeningStyle | null) => void
  addOpening: (style: OpeningStyle, wallId: string, t: number) => void
  moveOpening: (id: string, wallId: string, t: number) => void
  updateOpening: (id: string, patch: Partial<Pick<Opening, 'width' | 'height' | 'sill'>>) => void
  removeOpening: (id: string) => void
  selectOpening: (id: string | null) => void

  // ---- step 4 / materials ----
  setWallColor: (hex: string) => void
  setFloor: (id: string) => void

  // ---- furnish ----
  addFurniture: (archetypeId: string, x: number, z: number, rotation?: number) => string
  /** add an item at a guaranteed-interior point of the room */
  addFurnitureCentered: (archetypeId: string) => string
  updateFurniture: (id: string, patch: Partial<FurnitureItem>) => void
  removeFurniture: (id: string) => void
  selectFurniture: (id: string | null) => void
  setOverlaps: (ids: string[]) => void
  /** snap an item flush against the nearest wall (used by the wall-attach warning) */
  snapToWall: (id: string) => void

  // ---- suggestion engine ----
  dismissSuggestion: (ruleId: string) => void

  // ---- design meta / persistence ----
  setName: (name: string) => void
  loadDesign: (d: RoomDesign) => void
  loadPreset: (preset: PersonaPreset) => void
  resetDesign: (shape?: ShapeId) => void
}

function touch(d: RoomDesign): RoomDesign {
  return { ...d, updatedAt: Date.now() }
}

const HISTORY_LIMIT = 80
// snapshot captured at the start of a drag gesture (module-scoped, not reactive)
let gestureSnap: RoomDesign | null = null
let lastCoalesceTs = 0

export const useStore = create<DesignStore>((set, get) => ({
  stage: 'start',
  fitNonce: 0,
  fitView: () => set({ fitNonce: get().fitNonce + 1 }),
  past: [],
  future: [],
  interacting: false,
  design: newDesign('rect'),
  walls: deriveWalls(presetCorners('rect')),
  selectedOpeningId: null,
  selectedFurnitureId: null,
  placingStyle: null,
  overlapIds: [],
  dismissedSuggestions: [],

  pushHistory: () =>
    set((s) => ({ past: [...s.past, s.design].slice(-HISTORY_LIMIT), future: [] })),
  beginGesture: () => {
    gestureSnap = get().design
    set({ interacting: true })
  },
  endGesture: () => {
    const snap = gestureSnap
    gestureSnap = null
    const cur = get().design
    if (snap && snap !== cur) {
      set((s) => ({ past: [...s.past, snap].slice(-HISTORY_LIMIT), future: [], interacting: false }))
    } else {
      set({ interacting: false })
    }
  },
  undo: () => {
    const s = get()
    if (!s.past.length) return
    const prev = s.past[s.past.length - 1]
    set({
      design: prev,
      walls: deriveWalls(prev.corners),
      past: s.past.slice(0, -1),
      future: [s.design, ...s.future].slice(0, HISTORY_LIMIT),
      interacting: false,
      selectedFurnitureId: null,
      selectedOpeningId: null,
      overlapIds: [],
    })
    gestureSnap = null
  },
  redo: () => {
    const s = get()
    if (!s.future.length) return
    const next = s.future[0]
    set({
      design: next,
      walls: deriveWalls(next.corners),
      future: s.future.slice(1),
      past: [...s.past, s.design].slice(-HISTORY_LIMIT),
      interacting: false,
      selectedFurnitureId: null,
      selectedOpeningId: null,
      overlapIds: [],
    })
    gestureSnap = null
  },

  setStage: (s) => set({ stage: s }),
  next: () => {
    const { stage } = get()
    const i = WIZARD_STEPS.indexOf(stage)
    if (i >= 0 && i < WIZARD_STEPS.length - 1) set({ stage: WIZARD_STEPS[i + 1] })
    else if (stage === 'step4') set({ stage: 'furnish' })
  },
  back: () => {
    const { stage } = get()
    const i = WIZARD_STEPS.indexOf(stage)
    if (i > 0) set({ stage: WIZARD_STEPS[i - 1] })
    else if (stage === 'furnish') set({ stage: 'step4' })
    else if (stage === 'step1') set({ stage: 'start' })
  },

  setShape: (id) => {
    get().pushHistory()
    const corners = presetCorners(id)
    const design = touch({
      ...get().design,
      shape: id,
      corners,
      openings: [], // openings invalidated by new wall topology
    })
    set({ design, walls: deriveWalls(corners), selectedOpeningId: null })
  },

  setUnit: (u) => set({ design: touch({ ...get().design, unit: u }) }),

  dragWallPerp: (wallId, deltaCm) => {
    const { design } = get()
    const walls = get().walls
    const wall = walls.find((w) => w.id === wallId)
    if (!wall) return
    const corners = design.corners.map((c) => ({ ...c }))
    const i = wall.index
    const j = (i + 1) % corners.length
    corners[i].x += wall.nx * deltaCm
    corners[i].z += wall.nz * deltaCm
    corners[j].x += wall.nx * deltaCm
    corners[j].z += wall.nz * deltaCm
    applyCorners(set, get, corners)
  },

  setWallLength: (wallId, lengthCm) => {
    const { design, walls } = get()
    const wall = walls.find((w) => w.id === wallId)
    if (!wall) return
    // Clamp to the real-world wall range: min keeps the wall usable, max (30 m)
    // keeps the footprint framable so a typo like 999999 can't blank the view.
    const target = clampWallLength(lengthCm)
    const delta = target - wall.length
    if (Math.abs(delta) < 0.5) return
    const corners = design.corners.map((c) => ({ ...c }))
    const n = corners.length
    const ux = wall.dirX
    const uz = wall.dirZ
    // Move corner Q (index i+1) and the contiguous downstream chain whose
    // connecting walls are perpendicular to u, by u*delta. Keeps rectilinear
    // shapes rectilinear (closing wall stays parallel to u).
    const start = (wall.index + 1) % n
    const moved = new Set<number>()
    let k = start
    for (let steps = 0; steps < n - 1; steps++) {
      moved.add(k)
      const nextIdx = (k + 1) % n
      // direction of wall leaving k
      const ax = corners[nextIdx].x - corners[k].x
      const az = corners[nextIdx].z - corners[k].z
      const len = Math.hypot(ax, az) || 1
      const dot = (ax / len) * ux + (az / len) * uz
      // stop once the leaving wall is parallel to u (it will absorb the change)
      if (Math.abs(dot) > 0.7) break
      k = nextIdx
    }
    for (const idx of moved) {
      corners[idx].x += ux * delta
      corners[idx].z += uz * delta
    }
    // validate: keep winding (no inversion), reasonable min size, and a framable
    // max footprint (guards the L-shape chain case where a clamped wall could
    // still push the bbox past the ceiling).
    const next = signedArea(corners)
    const prev = signedArea(design.corners)
    if (Math.sign(next) !== Math.sign(prev) || Math.abs(next) < 1000) return
    if (!withinMaxFootprint(corners)) return
    get().pushHistory()
    applyCorners(set, get, corners)
  },

  setCorners: (corners) => {
    if (corners.length < 3) return
    // reject degenerate polygons (min area guard mirrors setWallLength)
    if (Math.abs(signedArea(corners)) < 1000) return
    // reject an over-large footprint so a bad resize can't blank the view
    if (!withinMaxFootprint(corners)) return
    get().pushHistory()
    applyCorners(set, get, corners)
  },

  setWallHeight: (cm) => {
    const now = Date.now()
    if (now - lastCoalesceTs > 600) get().pushHistory()
    lastCoalesceTs = now
    set({ design: touch({ ...get().design, wallHeight: clampWallHeight(cm) }) })
  },

  setPlacingStyle: (style) => set({ placingStyle: style }),
  addOpening: (style, wallId, t) => {
    const def = OPENING_MAP[style]
    if (!def) return
    get().pushHistory()
    const op: Opening = {
      id: uid('op'),
      kind: def.kind,
      style,
      wallId,
      t: Math.min(0.95, Math.max(0.05, t)),
      width: def.width,
      height: def.height,
      sill: def.sill,
    }
    set({
      design: touch({ ...get().design, openings: [...get().design.openings, op] }),
      selectedOpeningId: op.id,
    })
  },
  moveOpening: (id, wallId, t) =>
    set({
      design: touch({
        ...get().design,
        openings: get().design.openings.map((o) =>
          o.id === id ? { ...o, wallId, t: Math.min(0.97, Math.max(0.03, t)) } : o,
        ),
      }),
    }),
  updateOpening: (id, patch) => {
    const now = Date.now()
    if (now - lastCoalesceTs > 600) get().pushHistory()
    lastCoalesceTs = now
    const { design, walls } = get()
    set({
      design: touch({
        ...design,
        openings: design.openings.map((o) => {
          if (o.id !== id) return o
          const wall = walls.find((w) => w.id === o.wallId)
          const maxW = wall ? wall.length * 0.96 : 400
          const next = { ...o, ...patch }
          next.width = Math.max(40, Math.min(maxW, next.width))
          next.height = Math.max(40, Math.min(design.wallHeight - 5, next.height))
          next.sill = Math.max(0, Math.min(design.wallHeight - next.height, next.sill))
          return next
        }),
      }),
    })
  },
  removeOpening: (id) => {
    get().pushHistory()
    set({
      design: touch({
        ...get().design,
        openings: get().design.openings.filter((o) => o.id !== id),
      }),
      selectedOpeningId: get().selectedOpeningId === id ? null : get().selectedOpeningId,
    })
  },
  selectOpening: (id) => set({ selectedOpeningId: id }),

  setWallColor: (hex) => {
    const now = Date.now()
    if (now - lastCoalesceTs > 600) get().pushHistory()
    lastCoalesceTs = now
    set({ design: touch({ ...get().design, materials: { ...get().design.materials, wallColor: hex } }) })
  },
  setFloor: (id) => {
    const now = Date.now()
    if (now - lastCoalesceTs > 600) get().pushHistory()
    lastCoalesceTs = now
    set({ design: touch({ ...get().design, materials: { ...get().design.materials, floorTexture: id } }) })
  },

  addFurniture: (archetypeId, x, z, rotation = 0) => {
    const a = ARCHETYPE_MAP[archetypeId]
    if (!a) return ''
    get().pushHistory()
    const base: FurnitureItem = {
      id: uid('f'),
      archetype: a.id,
      category: a.category,
      name: a.name,
      x,
      z,
      // Start from the caller's intended orientation (e.g. a sofa's back to its wall). The §7
      // solver keeps/refines this — its rotation snap only fires when already ~wall-parallel, so
      // passing the correct facing here is what makes a back-to-wall piece actually snap flush.
      rotation,
      w: a.w,
      d: a.d,
      h: a.h,
      color: a.color,
    }
    const st = get()
    // wall/surface-mounted pieces sit above floor furniture, so they're exempt
    // from footprint collision (and floor pieces ignore them too).
    const others = isMounted(a.id)
      ? []
      : st.design.furniture.filter((f) => !isMounted(f.archetype))
    // clamp the placement inside the walls using the verified §7 solver
    const r = resolveFurniture(base, { x, z }, st.walls, others, st.design.corners, {
      wallThickness: st.design.wallThickness,
    })
    const item = { ...base, x: r.x, z: r.z, rotation: r.rotation }
    set({
      design: touch({ ...st.design, furniture: [...st.design.furniture, item] }),
      selectedFurnitureId: item.id,
    })
    return item.id
  },
  addFurnitureCentered: (archetypeId) => {
    const st = get()
    const corners = st.design.corners
    const p = safeInteriorPoint(corners)
    // Wall-mounted pieces (TV / mirror / wall shelf …) spawn ATTACHED to the
    // nearest wall with a free span at their mount height — never floating
    // mid-room — avoiding door/window holes and other wall pieces.
    // Ceiling-hung pieces (fan / chandelier) are the exception: pinned to a wall
    // a chandelier dangles against the plaster, so they take the interior spawn.
    const a = ARCHETYPE_MAP[archetypeId]
    if (a && a.mount === 'wall' && !isCeilingHung(a.id)) {
      const probe: FurnitureItem = {
        id: 'probe',
        archetype: a.id,
        category: a.category,
        name: a.name,
        x: p.x,
        z: p.z,
        rotation: 0,
        w: a.w,
        d: a.d,
        h: a.h,
        color: a.color,
      }
      const spot = findWallSpawn(probe, st.walls, st.design.openings, st.design.furniture, {
        wallThickness: st.design.wallThickness,
        preferPoint: p,
      })
      if (spot) return get().addFurniture(archetypeId, spot.x, spot.z, spot.rotation)
      // every wall span is taken (e.g. fully glazed walls) → floor-stand the
      // piece near the closest wall; the placement warning takes over from there.
      const fb = floorFallbackSpawn(probe, st.walls, p, st.design.wallThickness)
      if (fb) return get().addFurniture(archetypeId, fb.x, fb.z, fb.rotation)
    }
    // floor / surface pieces: stagger successive additions so they don't stack
    const n = st.design.furniture.length
    const off = 40
    const px = p.x + ((n % 3) - 1) * off
    const pz = p.z + ((Math.floor(n / 3) % 3) - 1) * off
    return get().addFurniture(archetypeId, px, pz)
  },
  updateFurniture: (id, patch) => {
    // during a drag gesture the snapshot covers history; otherwise (panel
    // resize/recolor) coalesce rapid edits into a single undo step.
    if (!get().interacting) {
      const now = Date.now()
      if (now - lastCoalesceTs > 600) get().pushHistory()
      lastCoalesceTs = now
    }
    const cur = get().design
    const host = cur.furniture.find((f) => f.id === id)
    const movesHost =
      !!host &&
      !isMounted(host.archetype) &&
      (patch.x !== undefined || patch.z !== undefined || patch.rotation !== undefined)

    // Carry any mounted pieces resting on this host (a lamp on a table, a TV on a
    // console) along with it — translating and rotating them by the same delta so
    // they stay put on their surface. Dependents follow even when locked.
    let carried: Record<string, { x: number; z: number; rotation: number }> | null = null
    if (movesHost) {
      const deps = dependentsOf(host, cur.furniture)
      if (deps.length) {
        const newX = patch.x ?? host.x
        const newZ = patch.z ?? host.z
        const newRot = patch.rotation ?? host.rotation
        const dRot = newRot - host.rotation
        const cos = Math.cos(dRot)
        const sin = Math.sin(dRot)
        carried = {}
        for (const d of deps) {
          const ox = d.x - host.x
          const oz = d.z - host.z
          carried[d.id] = {
            // rotate the offset by dRot (world Y-rotation, matching footprint mapping)
            x: newX + ox * cos + oz * sin,
            z: newZ - ox * sin + oz * cos,
            rotation: d.rotation + dRot,
          }
        }
      }
    }

    set({
      design: touch({
        ...cur,
        furniture: cur.furniture.map((f) => {
          if (f.id === id) return { ...f, ...patch }
          if (carried && carried[f.id]) return { ...f, ...carried[f.id] }
          return f
        }),
      }),
    })
  },
  removeFurniture: (id) => {
    get().pushHistory()
    set({
      design: touch({
        ...get().design,
        furniture: get().design.furniture.filter((f) => f.id !== id),
      }),
      selectedFurnitureId: get().selectedFurnitureId === id ? null : get().selectedFurnitureId,
    })
  },
  selectFurniture: (id) => set({ selectedFurnitureId: id }),
  setOverlaps: (ids) => set({ overlapIds: ids }),
  snapToWall: (id) => {
    const st = get()
    const item = st.design.furniture.find((f) => f.id === id)
    const walls = st.walls
    if (!item || !walls.length) return
    // Wall-mounted pieces use the span-aware placement, so "Move to wall" never
    // parks a TV over a door/window hole or on top of another wall piece.
    if (mountOf(item.archetype) === 'wall') {
      const spot = findWallSpawn(item, walls, st.design.openings, st.design.furniture, {
        wallThickness: st.design.wallThickness,
        preferPoint: { x: item.x, z: item.z },
      })
      if (spot) {
        get().pushHistory()
        const r = resolveFurniture({ ...item, rotation: spot.rotation }, spot, walls, [], st.design.corners, {
          wallThickness: st.design.wallThickness,
        })
        set({
          design: touch({
            ...get().design,
            furniture: get().design.furniture.map((f) =>
              f.id === id ? { ...f, x: r.x, z: r.z, rotation: r.rotation } : f,
            ),
          }),
        })
        return
      }
    }
    // find the nearest wall to the item's center
    let best = walls[0]
    let bestDist = Infinity
    for (const w of walls) {
      const bx = w.a.x + w.dirX * w.length
      const bz = w.a.z + w.dirZ * w.length
      const len2 = (bx - w.a.x) ** 2 + (bz - w.a.z) ** 2 || 1
      let t = ((item.x - w.a.x) * (bx - w.a.x) + (item.z - w.a.z) * (bz - w.a.z)) / len2
      t = Math.max(0, Math.min(1, t))
      const cx = w.a.x + t * (bx - w.a.x)
      const cz = w.a.z + t * (bz - w.a.z)
      const d = Math.hypot(item.x - cx, item.z - cz)
      if (d < bestDist) {
        bestDist = d
        best = w
      }
    }
    // project center along the wall, then offset inward so the back sits flush
    const tang = (item.x - best.a.x) * best.dirX + (item.z - best.a.z) * best.dirZ
    const tClamped = Math.max(item.w / 2, Math.min(best.length - item.w / 2, tang))
    const px = best.a.x + best.dirX * tClamped
    const pz = best.a.z + best.dirZ * tClamped
    const inset = st.design.wallThickness / 2 + item.d / 2 + 1
    const proposed = { x: px + best.nx * inset, z: pz + best.nz * inset }
    const rotation = Math.atan2(best.nx, best.nz) // front faces inward
    get().pushHistory()
    const r = resolveFurniture({ ...item, rotation }, proposed, walls, [], st.design.corners, {
      wallThickness: st.design.wallThickness,
    })
    set({
      design: touch({
        ...get().design,
        furniture: get().design.furniture.map((f) =>
          f.id === id ? { ...f, x: r.x, z: r.z, rotation: r.rotation } : f,
        ),
      }),
    })
  },

  dismissSuggestion: (ruleId) =>
    set((s) =>
      s.dismissedSuggestions.includes(ruleId)
        ? s
        : { dismissedSuggestions: [...s.dismissedSuggestions, ruleId] },
    ),

  setName: (name) => set({ design: touch({ ...get().design, name }) }),
  loadDesign: (d) => {
    gestureSnap = null
    set({
      design: d,
      walls: deriveWalls(d.corners),
      stage: 'furnish',
      selectedOpeningId: null,
      selectedFurnitureId: null,
      past: [],
      future: [],
      interacting: false,
      dismissedSuggestions: [],
      // refit the camera to the loaded room so the saved layout is framed
      // exactly the same way every time it's reopened
      fitNonce: get().fitNonce + 1,
    })
  },
  loadPreset: (preset) => {
    gestureSnap = null
    const d = toRoomDesign(preset)
    set({
      design: d,
      walls: deriveWalls(d.corners),
      stage: 'furnish',
      selectedOpeningId: null,
      selectedFurnitureId: null,
      past: [],
      future: [],
      interacting: false,
      dismissedSuggestions: [],
      fitNonce: get().fitNonce + 1,
    })
  },
  resetDesign: (shape = 'rect') => {
    const d = newDesign(shape)
    gestureSnap = null
    set({
      design: d,
      walls: deriveWalls(d.corners),
      stage: 'step1',
      selectedOpeningId: null,
      selectedFurnitureId: null,
      past: [],
      future: [],
      interacting: false,
      dismissedSuggestions: [],
    })
  },
}))

/** True when the polygon's bounding box fits within the framable wall max on
 *  both axes. Shared guard so no corner mutation (typed length, plan resize, or
 *  a live wall drag) can grow the room past the point where it blanks the view. */
function withinMaxFootprint(corners: Vec2[]): boolean {
  const bb = bbox(corners)
  return bb.w <= MAX_WALL_CM && bb.d <= MAX_WALL_CM
}

function applyCorners(
  set: (partial: Partial<DesignStore>) => void,
  get: () => DesignStore,
  corners: Vec2[],
) {
  // Final safety net for callers without a pre-check (e.g. dragWallPerp): never
  // apply an over-large footprint that would push the room out of the viewport.
  if (!withinMaxFootprint(corners)) return
  set({
    design: touch({ ...get().design, corners }),
    walls: deriveWalls(corners),
  })
}

// expose the store for debugging / interaction tests in dev
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  ;(window as unknown as { __roomio?: typeof useStore }).__roomio = useStore
}

// convenience selectors
export const useDesign = () => useStore((s) => s.design)
export const useWalls = () => useStore((s) => s.walls)
export { bbox }
