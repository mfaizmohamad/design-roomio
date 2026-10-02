# Roomio — Build Progress

IKEA-style interior room designer. React + Vite + TypeScript + React Three Fiber + Zustand.
Architecture = blueprint3d-lineage **scene graph** (walls / floor / openings / furniture as
addressable nodes) authored through a 4-step wizard + furnish stage. Collision/snapping (§7)
and clamped-resize archetypes are built bespoke (no planner repo ships them).

Dev server: `npm run dev` → http://localhost:5180/

## Legend: ✅ done · 🚧 in progress · ⬜ next/todo

## roomio.txt feed (from user) — all addressed
- "keep working for next 4 hours" → iterating autonomously, no pausing.
- "make sure everything is scalable in long term" → data-driven catalogs, pure decoupled
  geometry/collision modules, single serializable scene-graph store, versioned persistence, clean layers.
- #3 furniture lock toggle → DONE (panel button + 3D floating toolbar + lock badge).
- #4 login + Postgres session storage → DONE (Express+pg server :5181, Vite /api proxy, auth store, repository).
- #5 resize doors/windows → DONE (Step 3 "Adjust opening" width/height/sill, clamped).
- #6 PR + test cases (spawn test agent) → tests DONE (87 vitest), PR in progress.
- #9 saved positions not preserved on reopen → FIXED (data round-trips exact; now also persist+restore camera view).
- #10 lock button not visible → FIXED (3D toolbar lock + panel lock button).
- Coordinating with Agent B (detection pipeline) via source/roomio.txt comms log; archetype + schema contract acked.

## Catalog expansion + guardrails (roomio.txt #12/#13)
- Catalog is now JSON-driven: src/data/archetypes.catalog.json (one-file-extensible). archetypes.ts
  validates/normalizes it (clamps min<=default<=max, coerces unknown model/category).
- Grown from 23 → 77+ archetypes: more sofas (2-seater, U/chesterfield/mid-century/sleeper/daybed/chaise),
  beds (twin/full/cal-king/bunk/platform/crib), tables+desks (console/oval/bar/writing/office/L/standing),
  chairs+stools+benches+ottomans (lounge/wingback/rocking/folding/gaming/bar-stool/counter/step/dining-bench/
  entry-bench/ottoman/pouf/beanbag), storage (nightstand/sideboard/chest/shoe/filing/media/shelving/cube/
  ladder/bar-cart/armoire), decor (runner+round rugs, table/arc lamps, potted tree, flatscreen TVs, floor mirror).
- 6 new parametric model kinds in Furniture3D: tv, desk, ottoman, stool, bench, mirror — all render verified.
- Every archetype has REAL-WORLD absolute min/max (cm) guardrails for W/D/H (e.g. queen bed can't go below ~150cm).
- A research agent is verifying/refining dims vs IKEA/standards; shared/archetypes.json sync + Agent B ping pending.

## Detection-in-UI (Agent B integration)
- Building per Agent B's spec: server POST/GET /api/detect (shared/requests + shared/results) + a
  "Scan a room photo" confirm-dropdown flow. Two real fixtures (living-room-demo, video-apartment) to demo.

## Backend / infra
- server/ : Express + pg (port 5181), Postgres `roomio` db. Auth (signup/login/logout/me, cookie sessions),
  per-user designs (GET/POST/DELETE). `cd server && npm install && npm start`.
- Vite proxies /api → :5181. Front-end: src/auth.ts (store), src/api.ts (client), src/repository.ts
  (server-when-authed / localStorage-as-guest). Run: `npm run dev` (front-end) + server.
- Tests: `npm test` (167 vitest), `npm run check:browser` (puppeteer e2e), scripts/auth-check.mjs (auth e2e).

## Persona Rooms & Smart Suggestions (Agent A brief: Roomio_Persona_Rooms_Brief_AgentA.pdf)
Two linked features, both grounded in REAL Pinterest pins (frequency = the signal), never intuition.
- ✅ **A0** Preset + rule schemas + "Start from a style that's you" entry point (StartScreen → StyleStart picker).
      Schemas published to shared/persona_preset_schema.json + shared/rule_schema.json (v1.0).
- ✅ **A1** Pinterest research pass — all 10 genres tallied (recurring furniture/colors/materials/decor/lighting/layout)
      with provenance, via 10 parallel deep-research agents. Provenance lives in each preset's `pinterest_sources[]`.
- ✅ **A2/A3** All 10 presets built end-to-end (src/data/personas.json): bachelor, couple, family (life-stage) +
      anime_otaku, gamer, sports (interest) + afrohemian, neo_deco, celestial, biophilic (aesthetic). Each loads a
      fully-furnished, fully-editable room (shape+dims, wall/floor materials, placed archetypes, decor, style note).
      Built from existing corpus ids only; unmodeled items → closest archetype / recolored placeholder + roomio.txt
      REQUEST -> ASSET. Screenshot-verified anime/family/biophilic/neo-deco render on-vibe.
- ✅ **A4** Suggestion engine (src/suggestions/engine.ts) + data-driven seed rulebook R1-R12 (src/data/rules.json).
      Re-evaluates on every scene change (useMemo over design); dismissible advisory cards with one-tap Add; never
      blocks/auto-applies. Two tiers, necessity ranked above polish. A functional `roles` layer (roles.ts) keeps
      rules corpus-agnostic.
- ✅ **A5** Genre-aware rules layered on universal ones (anime→display shelf, gamer→desk, sports→big screen,
      bachelor→bar, biophilic→more plants, neo_deco→statement mirror).
- ✅ **A6** Provenance recorded per preset; placeholder asset gaps consolidated as REQUEST -> ASSET in roomio.txt.
- Tests: 80 new vitest (64 persona + 16 engine) incl. P-5 (all 10 presets pass engine w/ no necessity gaps) and the
      §8 acceptance scenarios (anime/family delete-rug→polish, delete-lights→necessity).
- Verify deep-links: `/?preset=<genre_id>` loads a persona straight into furnish (e.g. ?preset=anime_otaku).

### Follow-up (human feedback): vertical placement + alignment
- ✅ **Mount system** (`src/three/mount.ts`, `archetypes.mount`): pieces are floor | wall | surface. Wall pieces
      (TV, mirror, wall-shelf) and surface pieces (table lamp) are exempt from footprint collision and lifted —
      a TV/lamp rests ON the console/desk beneath it, or a TV mounts at ~107cm / shelf ~130cm on a bare wall.
      So objects can stack (TV on media unit) and hang on walls (mirror). Additive front-end render hint; detection
      ids unaffected.
- ✅ **Wall-attach warnings**: dismissible "Placement warnings" group below the suggestions; flags a wall piece left
      floating mid-room with one-tap "Move to wall" (`store.snapToWall`). A TV resting on a console is exempt.
- ✅ **Alignment**: all 10 preset layouts re-authored from interior-design alignment research (anchor-&-align,
      centered axes, symmetric pairs, coffee↔sofa 45cm, rug overhang, TV-on-console, bed centered + flanking
      nightstands) — no more scattered placement. 177 vitest green; live e2e verified the warning + move-to-wall flow.

## Milestones
- ✅ **M0** Scaffold, scene-graph store, 6 shape presets, 3D viewport (walls+floor), dev server up
- ✅ **M1** Step 1 shape picker · Step 2 dims: typed lengths + ft/cm toggle + live 3D drag handles + dim labels
- ✅ **M2** Step 3 doors/windows (place/move/delete snapped to walls, real wall holes) · Step 4 wall color + floor texture
- ✅ **M3** Furnish: archetype catalog, place/move/rotate/resize-clamped/recolor
- ✅ **M4** Collision & snapping (clamp+slide, snap flush, soft overlap warn) — verified with 7/7 unit tests
- ✅ **M5** Save / reopen designs (localStorage gallery + JSON import/export)
- 🚧 **Polish** match IKEA reference fidelity, edge cases, roomio.txt items — ongoing

## Acceptance checklist — ALL CORE ITEMS MET ✅ (now polishing)
- ✅ Step 1: room shape presets (Rect, L, T, U, Cut, Beveled) with live 3D preview
- ✅ Step 2: draggable/typed wall dimensions with ft/cm toggle (3D handles + dim labels + typed inputs)
- ✅ Step 3: place/move/delete doors & windows snapped to walls (real holes cut)
- ✅ Step 4: wall color + floor texture material swap
- ✅ Furnish: place/move/rotate/resize (clamped) + recolor furniture archetypes
- ✅ Furniture cannot clip through walls; slides and snaps flush — verified (7/7 §7 tests)
- ✅ Save and reopen a design (localStorage + JSON)
- 🚧 UI polish visibly comparable to IKEA reference — strong; continuing to refine

## Listing-replica flats (listings → photoreal 3D)
Rebuild a REAL scraped listing's flat in the renderer from its photos. First replica: the Kothrud
2BHK (₹40k, listing 4550925665232147) — glossy grey-veined marble floors, open parallel kitchen with
black-granite platforms + marble-clad walls, dark-aluminum sliders to a full-width balcony (teak
deck, dark plank ceiling + round downlight), black grille windows, brown wooden doors, ceiling fans.
- **Data**: src/data/listingFlats.ts (`LISTING_FLATS` keyed by listing id) — per-room finishes,
  EXPLICIT openings (both sides of a shared wall; far side `bare: true` so frames don't z-fight),
  fixed fixtures. `autoDoorways: false` opts replica rooms out of layoutHouse's auto doorway cutting.
- **Loader**: houseSession.loadListingFlat(id); launcher src/listingFlatLauncher.ts also sets a
  bright-daylight preset (timeOfDay .35, north 115°, maxElevation 45°, exposure 1.3, IBL 0.8).
- **Entry points**: "🏠 View in 3D" button on listing cards (?stage=listings) + `?listing=<id>`
  deep link (auth-bypassing, like ?preset).
- **Engine additions** (all additive): FloorTexture roughness/veined/reflect (glossy marble via
  MeshReflectorMaterial — data-driven, both render sites share FloorMaterial.tsx); wall cladding
  `materials.wallTexture` (WallMaterial.tsx, uv-continuous across door/window cuts); per-room
  `ceiling` spec (plank texture + single downlight, lighting/Ceiling.tsx — fade now time-based);
  Opening `frameColor`/`leafColor`/`bare` + new styles slider/passage/windowGrille/windowRail;
  `fan` model kind + decor-ceiling-fan/bath-geyser archetypes (ceiling/high-wall mounts in mount.ts);
  dark counter tint ⇒ bare polished-granite platform; MaterialEnhancer `__roomioNoEnv` opt-out;
  HouseView now renders real OpeningMesh frames (not just holes) for authored openings.
- **Second replica**: Andheri West PG (listing 4551035318554515) — furnished boys' flat: cream-yellow
  walls, glossy white vitrified tiles (`glossy-white-tile`), wenge wardrobes + single beds, red/black
  galley kitchen with `white-tile` cladding + black fridge + maroon washer, double-sharing hall with
  slider to a railed balcony, dusty-pink entry door, white + maroon fans. All from existing engine
  features — a replica is now pure data.
- **Generic shoot pipeline**: each replica carries photo-matched `shots` (world-space cameras, house
  or room mode) in its data. `node scripts/shoot-listing-replica.mjs [listingId]` shoots one or ALL
  replicas; it spawns its OWN dev server (port 5191) so the module graph is always fresh — a long-
  running HMR'd server serves `?t=`-versioned modules and the script's in-page imports would create
  duplicate zustand stores (the app silently ignores everything the script does). The cameraBus view
  applier lifts OrbitControls' maxPolarAngle AND minDistance when a scripted pose exceeds them.
  Sheets: docs/screenshots/listing-replica-comparison.png (Kothrud) + listing-replica-andheri-
  comparison.png. 275 tests green (listingFlats.test.ts loops every replica: tiling/no-overlap,
  real ids, opening fit + bare pairing).
- **Third replica**: Malad East 1BHK (listing 4551037518554295, Sethiya Imperial Heights) — fully
  furnished: ivory marble floors (`ivory-marble`), white L-kitchen with auto black-granite top +
  `speckle-tile` walls + sliding window, utility passage (maroon floral fridge, dark washer, wall
  basin + geyser), bedroom (wenge wardrobe/bed, vanity + mirror, brown flush doors), dark slate-tile
  bathroom. Sheet: docs/screenshots/listing-replica-malad-comparison.png.
- **Realism upgrades this round**: light/colored kitchen cabinets now get a polished BLACK granite
  slab automatically (matches every reference photo; near-black tints keep the bare-granite platform);
  new `speckled` FloorTexture flag (terrazzo-fleck wall tile) + `ivory-marble` glossy floor.
- **Fourth replica — first SINGLE-ROOM listing**: Oshiwara single occupancy (4551033371888043, ₹32k)
  — a ListingFlat with ONE room renders in the single-room view (ceiling + downlights + fan). New
  parametric assets built for it: `curtain` (rod + gathered blackout panels + tiebacks + white
  sheer, hangs at lintel height), `ladderShelf` (open étagère with decor), `ac` (wall split unit,
  mounts near ceiling) — archetype ids decor-curtain / decor-ladder-shelf / decor-ac. Blush bedding
  via bed tint (duvet = shade(color, 1.18)). Sheet: docs/screenshots/listing-replica-oshiwara-
  comparison.png.
- **Daily-scale pipeline**: `npm run replicas` shoots every replica + defaults; per-listing QA sheet
  auto-written to public/renders/<id>/compare.html (photos vs renders, from the `shots` photo
  indexes). Adding a listing = ONE data entry in listingFlats.ts (rooms/finishes/openings/furniture/
  shots) → `npm run replicas` → open compare.html. No engine edits needed for typical flats.
- **"3D renders" view**: the listings top bar has an All listings | 🏠 3D renders switch. The
  renders view shows ONLY the replica listings as render cards (pipeline renders from
  public/renders/<id>/, shot label + n/N cycle control, replica title chip); clicking a card opens
  that flat in the interactive 3D view (openListingFlat). Normal listings are untouched.
  `node scripts/shoot-listing-replica.mjs` writes straight to public/renders so the cards refresh
  with the pipeline (a `defaults` mode also shoots generic 1/2/3BHK template overviews for future use).

## Current cycle notes
- Foundation modules complete: types, store, presets, walls geometry, units, materials,
  openings + archetype catalogs, procedural floor textures, Room/RoomView 3D, wizard shell.
- Parallel subagents building: `collision.ts`, `Furniture3D.tsx`, `Openings3D.tsx` (persistence.ts ✅ done).
- Verified Step 1 render via headless Chrome screenshot — matches reference well.

## Next up
1. Integrate Furniture3D + Openings3D + collision + persistence as agents land.
2. Step 2 interactive wall-drag handles in 3D.
3. Step 3 opening placement overlay (click wall to add, drag to move, trash to delete).
4. Furnish stage wiring (drag-in, transform gizmo, recolor, clamped resize) + collision.
5. Save/reopen UI on the Start screen.
