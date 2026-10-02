# Agent C — Multi-Room & Connectors · PROGRESS

Domain: **"the house."** Expand Roomio from a single room to a connected multi-room
floor plan. The `House` schema **wraps** Agent A's `RoomDesign` (`room.interior`) —
it never replaces it. Everything optional: a single bedroom stays a complete, valid
design, and old single-room saves still load.

Isolation: all code in `/multi-room`; I also write `/shared` + `roomio.txt`. I never
edit Agent A's or Agent B's source. Common logic lives in single modules
(`src/geometry`, `src/util`, `src/data`) — no redundant copies.

## Milestones (brief §9)

| ID | Deliverable | Status |
|----|-------------|--------|
| **C0** | Read brief + roomio.txt; onboard; scaffold `/multi-room`; align schema with A; publish `shared/house_schema.json` | ✅ done |
| **C1** | Multi-room model: add/position multiple rooms; wrap A's room model; old single-room file loads | ✅ done |
| **C2** | Room typing + per-type essentials (incl. kitchen/bathroom) | ✅ done |
| **C3** | Connectors on shared walls (hinged door + cased opening); opening cut in both rooms | ✅ done |
| **C4** | Full connector set + door swing/arc + swing-overlap warning (AC7) | ✅ done |
| **C5** | Adjacency suggestion rules (AC1–AC9), dismissible | ✅ done |
| **C6** | Kitchen work-triangle/zone + bathroom clearance guidance; asset requests; polish | ✅ done |

**Acceptance**: `src/acceptance.test.ts` runs the brief's full done-bar as one
end-to-end scenario (single bedroom → +living via cased opening → +kitchen w/
work-triangle guidance → archway-into-bathroom privacy warning → living↔dining
archway → door-swing-hits-fixture warning → save/reload + old single-room file
opens). **49/49 tests green, typecheck clean.**

## Module map (common logic lives in single homes — no redundant copies)

- `src/interior.ts` — Agent A's `RoomDesign` ported **read-only** (mirror of
  `src/types.ts`; re-sync if A pings a change). Zero build coupling.
- `src/geometry/` — the single home for shared geometry:
  - `walls.ts` — `deriveWalls` + `buildWallParts` (the wall/opening cutting reused
    for connectors), ported read-only from A.
  - `obb.ts` — furniture OBB math (corners, point-in, segment-in, SAT overlap),
    ported read-only from A's `collision.ts` (exact convention).
  - `placement.ts` — room→world transforms + `findSharedWalls` / `areAdjacent`.
  - `swing.ts` — door swing arcs + `swingHitsFurniture` (AC7).
- `src/util/id.ts` — single id minter.
- `src/types.ts` — `House` / `HouseRoom` / `Connector` / `Footprint` schema.
- `src/house.ts` — `createHouse`, `wrapSingleRoom`, `roomFromInterior`, `addRoom`,
  `moveRoom`, `footprintFromInterior`.
- `src/persistence.ts` — `coerceHouse` / `loadHouseJSON` / `saveHouseJSON`. Loads
  (1) a House, (2) a bare RoomDesign → one-room house, (3) A's design-map.
- `src/connectors.ts` — `placeConnector`, `suggestPlacement`, `connectorOpenings`
  (cuts the hole in BOTH rooms), `openingsForRoom`, `wallPartsWithConnectors`.
- `src/adjacency.ts` — `evaluateAdjacency` → dismissible AC1–AC9 suggestions.
- `src/kitchen.ts` — work-triangle + island + zone guidance.
- `src/bathroom.ts` — fixture clear-floor checks + privacy guidance.
- `src/data/` — single data tables: `roomTypes.ts` (taxonomy + essentials),
  `connectorTypes.ts` (connector taxonomy + dims), `assetRequests.ts` (asset gaps).
- `src/index.ts` — public API barrel.
- `shared/house_schema.json` (v1.0) — published contract for A & B.

## Verify

```
cd multi-room
npm install
npm run typecheck   # clean
npm test            # vitest
```

## Coordination

- `roomio.txt`: onboarding + schema DECISION + REQUEST → A (confirm RoomDesign wrap)
  + REQUEST → B (house_schema published for cross-room camera) posted.
- Connector = an `Opening` on a shared wall, cut in both rooms via A's `buildWallParts`.
