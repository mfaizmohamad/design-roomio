/**
 * House session (Agent C, multi-room) — makes the /multi-room "add rooms" feature
 * usable in the real app. ADDITIVE: it sits on top of Agent A's single-`design`
 * store without modifying it. The editor (`useStore`) always edits ONE room (the
 * active room); this store owns the LIST of rooms and swaps which design is loaded
 * via A's public `loadDesign`, snapshotting the active room first.
 *
 * Reuses /multi-room's room-type taxonomy (bedroom/living/kitchen/bath/…). Each
 * room is a full RoomDesign, so the existing wizard steps (shape/dimensions/
 * openings/style) edit whichever room is active.
 */
import { create } from 'zustand'
import { useStore, newDesign } from '../store'
import { clampWallHeight } from '../units'
import type { RoomDesign, ShapeId, Vec2, Opening } from '../types'
import { presetCorners } from '../geometry/presets'
import { bbox } from '../geometry/walls'
import { defaultOpenings } from '../data/defaultOpenings'
import { layoutHouse } from './houseLayout'
import { ROOM_TYPE_INFO, ROOM_TYPE_LIST, type RoomType } from '../../multi-room/src/index'
// Per-room-type design defaults (distinctive floors + starter furniture) + the furnished flat
// templates. Pure data / single source of truth — see src/data/flatTemplates.ts (+ its test).
import {
  DESIGN_DEFAULTS,
  defaultFurnitureFor,
  buildSceneFromListing,
  applyInferredFinish,
  FLAT_1BHK,
  FLAT_2BHK,
  FLAT_3BHK,
  type FlatSpec,
  type InferredFinish,
} from '../data/flatTemplates'
import { getInferredFinish } from '../data/inferredScenes'
import { LISTING_FLATS, type ReplicaRoom } from '../data/listingFlats'
import { HOME_MAP } from '../data/homes'
import { levelOf, type HouseLevel } from './houseLevels'
import type { FlatListing } from '../data/listings'
import type { SavedDesign, SavedHouse } from '../persistence'
import { useLighting } from '../../lighting/src/store'
import { useHouseView } from './houseViewMode'
import type { CameraView } from '../types'

export interface RoomEntry {
  /** equals the RoomDesign.id of this room */
  id: string
  type: RoomType
  /** snapshot of the room's design (the ACTIVE room's live copy lives in useStore) */
  design: RoomDesign
  /** bbox-center in the house plane (cm); set by drag or the flat template.
   *  Undefined ⇒ the room is auto-arranged into the 2D grid. */
  pos?: { x: number; z: number }
  /** storey index (0 = ground; absent ⇒ 0) — see houseLevels.ts */
  level?: number
}

/** Origin-based rectangle corners (cm); bbox center is at (w/2, l/2). */
function rectCorners(w: number, l: number): Vec2[] {
  return [
    { x: 0, z: 0 },
    { x: w, z: 0 },
    { x: w, z: l },
    { x: 0, z: l },
  ]
}

/**
 * Scale a footprint about its own bbox center so its bounding box becomes w×l.
 * A rectangle stays a rectangle; L/T/U shapes stay proportional (so resizing a
 * non-rect room in the plan view doesn't flatten it into a box).
 */
function scaleCornersTo(corners: Vec2[], w: number, l: number): Vec2[] {
  const bb = bbox(corners)
  const sx = bb.w > 1e-6 ? w / bb.w : 1
  const sz = bb.d > 1e-6 ? l / bb.d : 1
  return corners.map((c) => ({ x: bb.cx + (c.x - bb.cx) * sx, z: bb.cz + (c.z - bb.cz) * sz }))
}

interface HouseSession {
  rooms: RoomEntry[]
  /** id of the room currently loaded in the editor (=== useStore.design.id). */
  activeId: string | null
  /** Stable saved-record id even when the active or first room changes. */
  documentId: string | null
  documentName: string | null
  documentCreatedAt: number | null
  /** Capture all rooms and presentation settings into one legacy-compatible record. */
  snapshotDesign: (view?: CameraView | null) => SavedDesign
  /** Restore a validated saved house, or wrap an older single-room design. */
  loadSavedDesign: (design: SavedDesign) => void

  /** Seed the house from the current single design if it hasn't been initialized. */
  ensureInit: () => void
  /** Capture the editor's live design back into the active room entry. */
  syncActive: () => void
  /** Add a new room of `type` (+ optional shape) and switch to it. Returns its id. */
  addRoom: (type: RoomType, shape?: ShapeId) => string
  /** Load another room into the editor (snapshots the current one first). */
  switchRoom: (id: string) => void
  /** Change a room's functional type (drives naming + suggestion hints). */
  setRoomType: (id: string, type: RoomType) => void
  /** Remove a room (never the last); switches away if it was active. */
  removeRoom: (id: string) => void
  /** Reposition a room in the house plane (drag). Seeds all rooms' positions so
   *  the rest stay put. */
  moveRoom: (id: string, pos: { x: number; z: number }) => void
  /** Resize a room's footprint to w×l (cm) about its house-plane center, then
   *  re-settle neighbours so rooms keep touching without overlapping. Updates the
   *  live editor too when the resized room is the active one. */
  resizeRoom: (id: string, size: { w: number; l: number }) => void
  /** Replace the whole house with a standard Indian 3BHK flat layout. */
  loadFlat1BHK: () => void
  loadFlat2BHK: () => void
  loadFlat3BHK: () => void
  /** Replace the house with a hand-authored replica of a scraped listing's flat
   *  (exact finishes/openings/fixtures from its photos). False if none exists. */
  loadListingFlat: (listingId: string) => boolean
  /** Replace the house with a multi-storey home from the registry
   *  (data/homes): every level's rooms load at once, tagged with their level.
   *  False for an unknown home id. */
  loadHome: (homeId: string) => boolean
  /** id of the registry home currently loaded, or null (drives the selector). */
  homeId: string | null
  /** storeys of the current house, bottom-up; [] = a single ground floor. */
  levels: HouseLevel[]
  /** @internal load replica rooms (listing replica or a home's levels). */
  _loadReplica: (rooms: Array<{ room: ReplicaRoom; level: number }>, levels: HouseLevel[]) => void
  /** Open ANY scraped listing in 3D: a photo-matched replica if one exists (the
   *  replica path, byte-for-byte unchanged), else a generic furnished flat inferred
   *  from the listing's BHK/keywords/rent. Always succeeds (returns true). */
  loadDynamicListing: (listing: FlatListing) => boolean
  /** @internal generic flat-template loader (floors + furnish per type). An
   *  optional inferred finish (from a listing's photos) overlays floor/wall on
   *  eligible rooms; omit it for the plain FLAT_*BHK templates. */
  _loadFlat: (spec: FlatSpec, finish?: InferredFinish | null) => void
  /** The most-recently removed room, kept briefly so it can be restored (Undo). */
  lastRemoved: { entry: RoomEntry; index: number; wasActive: boolean } | null
  /** Restore the last removed room at its original position. */
  undoRemove: () => void
  /** Discard the undo snapshot (after the undo banner times out / is dismissed). */
  dismissUndo: () => void
}

/** Agent A's RoomDesign.roomType subset (suggestion engine). null if not applicable. */
function toDesignRoomType(type: RoomType): RoomDesign['roomType'] | undefined {
  switch (type) {
    case 'bedroom':
      return 'bedroom'
    case 'living':
      return 'living'
    case 'office':
      return 'office'
    default:
      return undefined // kitchen/bath/dining/foyer/hallway: A's engine defaults gracefully
  }
}

function inferType(d: RoomDesign): RoomType {
  const rt = d.roomType
  if (rt === 'bedroom' || rt === 'living' || rt === 'office') return rt
  return 'bedroom'
}

/** A unique, friendly name for a new room ("Kitchen", "Bedroom 2", …). */
function nameForType(type: RoomType, existing: RoomEntry[]): string {
  const base = ROOM_TYPE_INFO[type].label
  const sameType = existing.filter((r) => r.type === type).length
  return sameType === 0 ? base : `${base} ${sameType + 1}`
}

export const useHouse = create<HouseSession>((set, get) => ({
  rooms: [],
  activeId: null,
  documentId: null,
  documentName: null,
  documentCreatedAt: null,
  homeId: null,
  levels: [],
  lastRemoved: null,

  ensureInit: () => {
    const d = useStore.getState().design
    if (get().rooms.length > 0 && get().activeId === d.id) return
    // A new blank room can be opened after a house. Drop that old session or
    // saving the blank room would silently include the previous home's rooms.
    set({ rooms: [{ id: d.id, type: inferType(d), design: d }], activeId: d.id,
      documentId: d.id, documentName: null, documentCreatedAt: d.createdAt,
      homeId: null, levels: [], lastRemoved: null })
  },

  snapshotDesign: (view) => {
    get().ensureInit()
    if (view) useStore.setState((s) => ({ design: { ...s.design, view } }))
    get().syncActive()
    const state = get()
    const active = state.rooms.find((r) => r.id === state.activeId) ?? state.rooms[0]
    // RoomView creates default lights lazily when a room is visited. Seed every
    // room before saving so reopening and then visiting an untouched room does
    // not make the house appear newly edited just by generating its defaults.
    for (const room of state.rooms) {
      useLighting.getState().ensureRoom({
        id: room.id, centerM: [0, 0], wallHeightM: room.design.wallHeight / 100,
      })
    }
    const light = useLighting.getState()
    const lighting: SavedHouse['lighting'] = {
      version: light.version, timeOfDay: light.timeOfDay, northOffsetDeg: light.northOffsetDeg,
      barVisible: light.barVisible, northVisible: light.northVisible, lightMode: light.lightMode,
      sun: light.sun, shadow: light.shadow, rooms: light.rooms, fillScale: light.fillScale,
    }
    const viewState = useHouseView.getState()
    return {
      ...active.design,
      id: state.documentId ?? active.id,
      name: state.documentName ?? active.design.name,
      createdAt: state.documentCreatedAt ?? active.design.createdAt,
      house: {
        version: 1, activeId: active.id, homeId: state.homeId, levels: state.levels,
        rooms: state.rooms, lighting, viewMode: viewState.mode,
        levelFilter: viewState.levelFilter,
      },
    }
  },

  loadSavedDesign: (saved) => {
    if (!saved.house) {
      set({ rooms: [{ id: saved.id, type: inferType(saved), design: saved }],
        activeId: saved.id, documentId: saved.id, documentName: null,
        documentCreatedAt: saved.createdAt, homeId: null, levels: [], lastRemoved: null })
      useStore.getState().loadDesign(saved)
      return
    }
    const house = saved.house
    set({ rooms: house.rooms, activeId: house.activeId, documentId: saved.id,
      documentName: saved.name, documentCreatedAt: saved.createdAt,
      homeId: house.homeId, levels: house.levels, lastRemoved: null })
    useLighting.setState(house.lighting)
    useHouseView.setState({ mode: house.viewMode, levelFilter: house.levelFilter })
    const active = house.rooms.find((r) => r.id === house.activeId)!
    useStore.getState().loadDesign(active.design)
  },

  syncActive: () => {
    const { activeId, rooms } = get()
    if (!activeId) return
    const live = useStore.getState().design
    set({ rooms: rooms.map((r) => (r.id === activeId ? { ...r, design: live } : r)) })
  },

  addRoom: (type, shape = 'rect') => {
    get().ensureInit()
    get().syncActive()
    const corners = presetCorners(shape)
    const base = newDesign(shape)
    const dd = DESIGN_DEFAULTS[type]
    const d: RoomDesign = {
      ...base,
      name: nameForType(type, get().rooms),
      roomType: toDesignRoomType(type),
      corners,
      // a freshly added room also gets a default door + window(s), not a sealed box
      openings: defaultOpenings(corners),
      // distinctive floor + wall so the room reads as its function immediately
      materials: dd ? { wallColor: dd.wall, floorTexture: dd.floor } : base.materials,
    }
    // a new room joins the storey being worked on (the active room's)
    const level = levelOf(get().rooms.find((r) => r.id === get().activeId) ?? {})
    set((s) => ({ rooms: [...s.rooms, { id: d.id, type, design: d, level }], activeId: d.id }))
    useStore.getState().loadDesign(d) // loads into the editor (stage → furnish)
    // Furnish the new room with type-appropriate starter pieces, then snapshot
    // the result back into the room entry so each room type looks distinct.
    const fixtures = defaultFurnitureFor(type, corners, d.openings)
    for (const fx of fixtures) useStore.getState().addFurniture(fx.archetype, fx.x, fx.z, fx.rotation)
    useStore.getState().selectFurniture(null)
    get().syncActive()
    return d.id
  },

  switchRoom: (id) => {
    const { activeId, rooms } = get()
    if (id === activeId) return
    get().syncActive()
    const entry = get().rooms.find((r) => r.id === id)
    if (!entry) return
    set({ activeId: id })
    useStore.getState().loadDesign(entry.design)
  },

  setRoomType: (id, type) =>
    set((s) => ({
      rooms: s.rooms.map((r) =>
        r.id === id ? { ...r, type, design: { ...r.design, roomType: toDesignRoomType(type) } } : r,
      ),
    })),

  removeRoom: (id) => {
    if (get().rooms.length <= 1) return // keep at least one room
    get().syncActive()
    const { rooms, activeId } = get()
    const index = rooms.findIndex((r) => r.id === id)
    if (index < 0) return
    const snapshot = { entry: rooms[index], index, wasActive: id === activeId } // for Undo
    const remaining = rooms.filter((r) => r.id !== id)
    if (snapshot.wasActive) {
      const nextActive = remaining[Math.min(index, remaining.length - 1)]
      set({ rooms: remaining, activeId: nextActive.id, lastRemoved: snapshot })
      useStore.getState().loadDesign(nextActive.design)
    } else {
      set({ rooms: remaining, lastRemoved: snapshot })
    }
  },

  undoRemove: () => {
    const lr = get().lastRemoved
    if (!lr) return
    get().syncActive()
    const rooms = get().rooms.slice()
    rooms.splice(Math.min(lr.index, rooms.length), 0, lr.entry)
    if (lr.wasActive) {
      set({ rooms, activeId: lr.entry.id, lastRemoved: null })
      useStore.getState().loadDesign(lr.entry.design)
    } else {
      set({ rooms, lastRemoved: null })
    }
  },

  dismissUndo: () => set({ lastRemoved: null }),

  moveRoom: (id, pos) => {
    get().syncActive()
    const rooms = get().rooms
    // Seed every room's current laid-out position so the ones we don't move stay put
    // (otherwise un-positioned rooms would re-flow when this one becomes explicit).
    const placed = layoutHouse(rooms.map((r) => ({ design: r.design, pos: r.pos, type: r.type, level: levelOf(r) })))
    const posById = new Map(placed.map((p) => [p.design.id, p.centerCm]))
    const halfOf = (rid: string) => {
      const bb = bbox(rooms.find((r) => r.id === rid)!.design.corners)
      return { hw: bb.w / 2, hd: bb.d / 2 }
    }
    // Target center for every room (moved one = dragged pos; rest = seeded).
    const target = new Map<string, { x: number; z: number }>()
    for (const r of rooms) target.set(r.id, r.id === id ? { x: pos.x, z: pos.z } : { ...(r.pos ?? posById.get(r.id)!) })

    // Push the MOVED room out of any room it overlaps (rooms may touch, never intersect),
    // so dragging one onto another can't leave them overlapping. Min-penetration axis.
    const m = halfOf(id)
    const mp = target.get(id)!
    // rooms on other storeys overlap in plan by design — only push same-level ones
    const lvl = levelOf(rooms.find((r) => r.id === id)!)
    for (let iter = 0; iter < 16; iter++) {
      let bumped = false
      for (const r of rooms) {
        if (r.id === id || levelOf(r) !== lvl) continue
        const o = halfOf(r.id)
        const op = target.get(r.id)!
        const ix = m.hw + o.hw - Math.abs(mp.x - op.x)
        const iz = m.hd + o.hd - Math.abs(mp.z - op.z)
        if (ix > 0.5 && iz > 0.5) {
          if (ix <= iz) mp.x += (mp.x >= op.x ? 1 : -1) * ix
          else mp.z += (mp.z >= op.z ? 1 : -1) * iz
          bumped = true
        }
      }
      if (!bumped) break
    }

    set({
      rooms: rooms.map((r) => {
        const t = target.get(r.id)!
        return { ...r, pos: { x: Math.round(t.x), z: Math.round(t.z) } }
      }),
    })
  },

  resizeRoom: (id, size) => {
    get().syncActive()
    const rooms = get().rooms
    const idx = rooms.findIndex((r) => r.id === id)
    if (idx < 0) return
    const MIN = 120 // cm — keep rooms usable and wall lengths valid
    const w = Math.max(MIN, Math.round(size.w))
    const l = Math.max(MIN, Math.round(size.l))

    // Seed every room's current laid-out center so un-positioned rooms don't reflow.
    const placed = layoutHouse(rooms.map((r) => ({ design: r.design, pos: r.pos, type: r.type, level: levelOf(r) })))
    const seeded = new Map(placed.map((p) => [p.design.id, p.centerCm]))

    // New corners for the target (scaled about its center → shape preserved). The
    // active room's authoritative corners live in the editor store, so patch it too.
    const scaled = scaleCornersTo(rooms[idx].design.corners, w, l)
    if (id === get().activeId) useStore.getState().setCorners(scaled)

    // Half-extents (target uses the NEW size); positions seeded from the layout.
    const half = new Map<string, { hw: number; hd: number }>()
    const pos = new Map<string, { x: number; z: number }>()
    for (const r of rooms) {
      const bb = r.id === id ? { w, d: l } : bbox(r.design.corners)
      half.set(r.id, { hw: bb.w / 2, hd: bb.d / 2 })
      pos.set(r.id, { ...(r.pos ?? seeded.get(r.id)!) })
    }

    // Settle: PIN the resized room and push everything else out of any overlap it
    // now causes, along the min-penetration axis — so rooms keep touching without
    // intersecting (mirrors moveRoom's push, generalised to a fixed anchor).
    for (let iter = 0; iter < 32; iter++) {
      let bumped = false
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          // storeys settle independently (upper rooms sit OVER lower ones)
          if (levelOf(rooms[i]) !== levelOf(rooms[j])) continue
          const a = rooms[i].id
          const b = rooms[j].id
          const pa = pos.get(a)!
          const pb = pos.get(b)!
          const ha = half.get(a)!
          const hb = half.get(b)!
          const ix = ha.hw + hb.hw - Math.abs(pa.x - pb.x)
          const iz = ha.hd + hb.hd - Math.abs(pa.z - pb.z)
          if (ix > 0.5 && iz > 0.5) {
            const aPin = a === id
            const bPin = b === id
            const onX = ix <= iz
            const pen = onX ? ix : iz
            const share = aPin || bPin ? pen : pen / 2
            const dir = onX ? (pa.x >= pb.x ? 1 : -1) : (pa.z >= pb.z ? 1 : -1)
            if (!aPin) { if (onX) pa.x += dir * share; else pa.z += dir * share }
            if (!bPin) { if (onX) pb.x -= dir * share; else pb.z -= dir * share }
            bumped = true
          }
        }
      }
      if (!bumped) break
    }

    set({
      rooms: rooms.map((r) => ({
        ...r,
        design: r.id === id ? { ...r.design, corners: scaled } : r.design,
        pos: { x: Math.round(pos.get(r.id)!.x), z: Math.round(pos.get(r.id)!.z) },
      })),
    })
  },

  loadHome: (homeId) => {
    const home = HOME_MAP[homeId]
    if (!home) return false
    get()._loadReplica(
      home.levels.flatMap((lv, level) => lv.rooms.map((room) => ({ room, level }))),
      home.levels.map(({ label, elevationCm }) => ({ label, elevationCm })),
    )
    // set AFTER _loadReplica, which clears it (every other loader must drop it)
    set({ homeId, documentName: home.title })
    return true
  },

  loadFlat1BHK: () => get()._loadFlat(FLAT_1BHK),
  loadFlat2BHK: () => get()._loadFlat(FLAT_2BHK),
  loadFlat3BHK: () => get()._loadFlat(FLAT_3BHK),

  /**
   * Listing replica: every room carries its own EXACT finishes (photo-matched
   * floor/wall/ceiling), authored openings (sliders/passages/grille windows —
   * autoDoorways off, so layoutHouse cuts nothing extra) and fixed fixtures
   * (granite platforms, fans, geyser) with explicit colors/dims.
   */
  loadListingFlat: (listingId) => {
    const flat = LISTING_FLATS[listingId]
    if (!flat) return false
    get()._loadReplica(flat.rooms.map((room) => ({ room, level: 0 })), [])
    return true
  },

  _loadReplica: (specs, levels) => {
    const entries: RoomEntry[] = specs.map(({ room: r, level }) => {
      const corners = rectCorners(r.w, r.l)
      const base = newDesign('rect')
      const d: RoomDesign = {
        ...base,
        name: r.name,
        roomType: toDesignRoomType(r.type),
        corners,
        openings: r.openings.map((o, i) => ({ ...o, id: `${base.id}_o${i}` })),
        furniture: [],
        materials: {
          wallColor: r.wall,
          floorTexture: r.floor,
          ...(r.wallTexture ? { wallTexture: r.wallTexture } : {}),
        },
        ...(r.ceiling ? { ceiling: r.ceiling } : {}),
        ...(r.wallHeight ? { wallHeight: clampWallHeight(r.wallHeight) } : {}),
        autoDoorways: false,
        // A replica reproduces a REAL listing, not a design-in-progress — the
        // suggestion engine treats it as a curated scene (no necessity flags).
        isReplica: true,
      }
      return { id: d.id, type: r.type, design: d, pos: { x: r.x, z: r.z }, level }
    })
    set({ rooms: entries, activeId: entries[0].id, homeId: null, levels,
      documentId: entries[0].id, documentName: null,
      documentCreatedAt: entries[0].design.createdAt })

    // Fixtures through the editor (the §7 solver snaps them flush), then color/
    // dim overrides, then snapshot back — same loop as _loadFlat.
    specs.forEach(({ room: r }, i) => {
      if (!r.furniture.length) return
      const entry = entries[i]
      useStore.getState().loadDesign(entry.design)
      for (const f of r.furniture) {
        const id = useStore.getState().addFurniture(f.a, f.x, f.z, f.rot)
        const patch: Partial<Pick<import('../types').FurnitureItem, 'color' | 'w' | 'd' | 'h' | 'x' | 'z' | 'assetRef'>> = {}
        if (f.color) patch.color = f.color
        if (f.w) patch.w = f.w
        if (f.d) patch.d = f.d
        if (f.h) patch.h = f.h
        if (f.assetRef) patch.assetRef = f.assetRef
        // addFurniture placed the piece at its CATALOG size and nudged it to fit;
        // once resized to the authored size, put it back where the plan has it.
        // Without this a stair authored smaller than the catalog default was left
        // shoved ~30cm off its stairwell (into the upper room's footprint), which
        // stranded a walker at the top of the flight.
        if (f.w || f.d) {
          patch.x = f.x
          patch.z = f.z
        }
        if (Object.keys(patch).length) useStore.getState().updateFurniture(id, patch)
      }
      useStore.getState().selectFurniture(null)
      const furnished = useStore.getState().design
      set((s) => ({ rooms: s.rooms.map((rm) => (rm.id === entry.id ? { ...rm, design: furnished } : rm)) }))
    })

    // Land on the living room (index 1 — the balcony is first for z-order).
    // Land on the entry storey's living room (homes call it 'Living & Dining').
    const rs = get().rooms.filter((rm) => levelOf(rm) === 0)
    const landing =
      rs.find((rm) => rm.design.name === 'Living Room') ??
      rs.find((rm) => rm.type === 'living') ??
      rs.find((rm) => rm.type === 'bedroom') ??
      rs[0]
    set({ activeId: landing.id })
    useStore.getState().loadDesign(landing.design)
  },

  /**
   * The MVP unlock: open any of the 36 scraped listings in 3D. Replica-first —
   * if the listing has a hand-authored replica, defer to loadListingFlat so the
   * curated flats never regress; otherwise build a furnished flat from the
   * listing's metadata (BHK/keywords/rent) and load it through the same generic
   * pipeline the FLAT_*BHK templates use.
   */
  loadDynamicListing: (listing) => {
    if (LISTING_FLATS[listing.id]) return get().loadListingFlat(listing.id)
    // Overlay finishes inferred OFFLINE from the listing's photos (validated +
    // confidence-gated). Null for listings with no photos / low confidence, in
    // which case the generic template renders unchanged.
    get()._loadFlat(buildSceneFromListing(listing), getInferredFinish(listing.id))
    return true
  },

  /**
   * Generic flat-template loader: builds each room with a DISTINCTIVE floor + wall for its type,
   * FURNISHES it with type-appropriate starter pieces (via the editor + §7 snap solver), snapshots
   * the furnished result back into the room entry, and lands on the first room. Every room reads as
   * its function immediately (kitchen tile + counter/sink/stove, bathroom blue tile + toilet/vanity/
   * shower, bedroom wood + bed, …) instead of identical empty wood boxes.
   */
  _loadFlat: (spec: FlatSpec, finish?: InferredFinish | null) => {
    // 1) Build empty entries with per-type floor + wall applied. When an inferred
    //    finish is supplied (a photo'd listing), overlay it on the eligible rooms
    //    so the scene LOOKS like the listing; ineligible rooms / absent fields /
    //    no finish keep the template defaults (graceful degradation).
    const entries: RoomEntry[] = spec.map((r) => {
      const corners = rectCorners(r.w, r.l)
      const base = newDesign('rect')
      const dd = DESIGN_DEFAULTS[r.type]
      const baseMat = dd
        ? { wall: dd.wall, floor: dd.floor }
        : { wall: base.materials.wallColor, floor: base.materials.floorTexture }
      const mat = applyInferredFinish(r.type, baseMat, finish)
      const d: RoomDesign = {
        ...base,
        name: r.name,
        roomType: toDesignRoomType(r.type),
        corners,
        openings: [], // doorways are cut between adjacent rooms by layoutHouse
        furniture: [],
        materials: { wallColor: mat.wall, floorTexture: mat.floor },
      }
      return { id: d.id, type: r.type, design: d, pos: { x: r.x, z: r.z } }
    })
    set({ rooms: entries, activeId: entries[0].id, homeId: null, levels: [],
      documentId: entries[0].id, documentName: null,
      documentCreatedAt: entries[0].design.createdAt })

    // 2) Furnish each room through the editor so addFurniture()'s §7 solver snaps pieces flush,
    //    then snapshot the furnished design back into its entry. Doorways are cut between adjacent
    //    rooms — compute them UP FRONT (same layout the house view uses) so each room's starter
    //    furniture is placed CLEAR of its doors (a sofa/bed/mirror on a doorway is never real).
    const doorwaysById = new Map<string, Opening[]>()
    for (const pr of layoutHouse(entries.map((e) => ({ design: e.design, pos: e.pos, type: e.type })))) {
      doorwaysById.set(pr.design.id, pr.extraOpenings)
    }
    for (const entry of entries) {
      useStore.getState().loadDesign(entry.design)
      for (const fx of defaultFurnitureFor(entry.type, entry.design.corners, doorwaysById.get(entry.id) ?? [])) {
        useStore.getState().addFurniture(fx.archetype, fx.x, fx.z, fx.rotation)
      }
      useStore.getState().selectFurniture(null)
      const furnished = useStore.getState().design
      set((s) => ({ rooms: s.rooms.map((r) => (r.id === entry.id ? { ...r, design: furnished } : r)) }))
    }

    // 3) Land on the first room.
    const first = get().rooms[0]
    set({ activeId: first.id })
    useStore.getState().loadDesign(first.design)
  },
}))

export { ROOM_TYPE_LIST, ROOM_TYPE_INFO }
export type { RoomType }
