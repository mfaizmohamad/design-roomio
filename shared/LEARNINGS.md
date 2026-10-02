# Roomio — Shared LEARNINGS

Curated, cross-agent reference. **Agent D curates this**; any agent may append a dated note under
their section, but D dedupes/resolves on each cycle. Distinct from `source/roomio.txt` (the
transactional comms log) — this is the deduped, resolved knowledge base. Read at the start of every cycle.

Agents: **A** = interiors / presets / suggestions · **B** = detection + camera/flythrough ·
**C** = multi-room house/connectors + persistence (feature 2) · **E** = lighting & time-of-day ·
**F** = QA / dedup · **D** = coordinator. Tags like `[affects: A,B]` mark who must care.

---

## Schemas & Contracts

- **`shared/archetypes.json` is the single source of truth for archetype ids** — owned by Agent A,
  auto-generated from `src/data/archetypes.ts` → `archetypes.catalog.json`. **91 ids** (grew additively
  from 23). Fallback id is **`misc-box`** (Placeholder Box). Any producer (B's classifier, C's essentials,
  A's presets) must emit/reference **only** ids from this file. A pings the log on every add/rename. `[affects: A,B,C]`
- **Additive-only schema evolution.** Every contract change so far is new *optional* fields, never a
  reshape — consumers never break. E.g. `RoomDesign.view`, `roomType`, `personaGenre`; archetype `mount`
  (floor|wall|surface, front-end render hint, does NOT affect detection ids); lighting `lightMode`.
  Keep new fields optional + announce in the log before relying on them. `[affects: A,B,C,E]`
- **Contract versions in flight (all v1.0):** `detection_schema` (LOCKED), `camera_path_schema`,
  `scene_contract`, `house_schema`, `persona_preset_schema`, `rule_schema`, `lighting_schema`,
  `save_envelope_schema`, `render_schema` (G), `texture_schema` (H), `pbr_conventions` (H+G, ratified). `[affects: all]`
- **`detection_schema` v1.0 is LOCKED** — shape won't change without an announce + ack. `status="error"`
  with `proposals:[]` is valid (no crash); consumers validate leniently (`additionalProperties: true`). `[affects: A,B]`
- **`house_schema` v1.0 WRAPS, never forks, `RoomDesign`** — `HouseRoom.interior: RoomDesign` verbatim.
  Backward compat mandatory: a bare `RoomDesign` (single-room save) loads as a one-room house, empty
  connectors. `interior` is opaque-but-required; C's wall-cutting needs `corners[]` (cm polygon),
  `openings[]`, `wallHeight`, `wallThickness`. Room placement = `rooms[].footprint {x,z,rotation,w,l}` (cm). `[affects: A,C,E]`
- **`save_envelope_schema` v1.0 (C, feature 2) composes the FULL scene with no redundancy:**
  `scene.house` (house_schema, already embeds A's RoomDesign at `rooms[].interior`) +
  `scene.lighting` (E's LightingState, keyed by room_id, `null`⇒E's defaults, treated as **opaque
  pass-through** — stored/returned byte-for-byte, unknown future fields survive round-trip) +
  `design_id/name/createdAt/updatedAt/rev/thumbnail/share`. `migrateToEnvelope(json)` migrates a bare
  RoomDesign, a bare House, and A's localStorage design-map forward; returns null (never throws) on junk. `[affects: A,C,E]`
- **⚠ UNRESOLVED — two `RoomType` taxonomies.** A's interior `RoomDesign.roomType`
  (`living|bedroom|studio|family|office|den`, drives the suggestion engine) vs C's house-level
  `HouseRoom.type` (`bedroom|living|kitchen|bathroom|dining|office|foyer|hallway`). Both additive/optional
  (no build conflict), but a C "kitchen" room's wrapped interior can't carry a meaningful `roomType`.
  **Reconcile** (superset union, or explicit map). Note E keys lighting by House `room_id` (not roomType),
  so E is unaffected. `[affects: A,C]`
- **Lighting↔suggestion-engine seam (resolved-by-contract):** A's engine fires R1 "no light source" off
  *lamp furniture* count (`roles.ts model==='lamp'`), but E lights rooms with renderer lights (not lamps).
  E exports a pure predicate `roomLightingSatisfaction(roomId) ⇒ {hasLight,isLayered}` from
  `/lighting/src/contract.ts`; A's engine should consult it (import or mirror) so an E-lit room passes
  R1 + the single-overhead rule. `[affects: A,E]`

## Scene / Rendering (CONFIRMED — applies to everyone)

- **Renderer is React-Three-Fiber**, NOT plain Three.js. Deps `three ^0.169`, `@react-three/fiber ^8.17`,
  `@react-three/drei ^9.114`. `Canvas`/camera/`OrbitControls(makeDefault)` in `src/three/RoomView.tsx`. `[affects: all]`
- **World units are METERS.** Design space is centimeters; `src/three/coords.ts` `makeFrame()` converts
  cm→m and centers the room on its bbox center (`toWorld = (x-cx)/100`). Keep the cm↔m boundary explicit. `[affects: all]`
- **`<Canvas shadows flat>`:** `shadows`(bare) ⇒ `PCFSoftShadowMap`; `flat` ⇒ `NoToneMapping`, so colors
  render ~as authored and **light intensities are legacy (non-physical) units** — tune to THIS renderer, do
  not copy physically-based-units tutorials. `gl={{preserveDrawingBuffer:true}}` is set (B needs it for
  WebCodecs frame capture — don't remove). Camera fov 40, near 0.1, far 200. Scene background `#cdccc9`. `[affects: A,B,E]`
- **Port shared geometry read-only; do NOT import across packages** (the convention before `shared/lib`,
  still true for non-trivial math). B (collision), C (wall/opening + house coercion), E (coords), and
  C-persistence (RoomDesign/House type mirrors in `src/scene/slices.ts`) all COPY A's logic into their own
  package to keep **zero build coupling**. Cost = drift risk — re-sync when the source changes (owner pings). `[affects: all]`
- **Connectors are just `Opening`s on a shared wall, applied to BOTH rooms.** Openings carry
  `{wallId, t∈0..1, width, height, sill}`; `buildWallParts` subtracts the rectangular holes. Multi-room
  helpers (consume read-only via `multi-room/src/index.ts`): `toWorld`, `worldCorners`, `worldWalls`
  (wall world a→b + normal), `connectorWorldPoint`, `openingsForRoom`. `[affects: A,C,E]`
- **Walk collision order: resolve furniture before walls** (wall = hard constraint). `[affects: B]`
- **Scene seam = `sceneBus`** (mirror of `src/three/cameraBus.ts`): module-level handle,
  `setSceneHandle()`/`getSceneHandle()`, no React. **STATUS (cycle 2): NOW WIRED into the app by B** —
  `src/three/sceneBus.ts` + `src/three/Flythrough.tsx` (`<SceneBridge/>` inside the Canvas builds
  `getColliders()` from the live store; `<FlythroughHud/>` DOM overlay) + `<SceneBridge/>` added to
  `RoomView.tsx`. The engine adds only a `flythrough-overlay` group, removed on teardown. For cross-room,
  `getColliders()` must AGGREGATE every room's walls+furniture and treat connector openings as walkable gaps. `[affects: A,B,C]`
- **Mounting & stacking (A):** archetypes carry `mount = floor|wall|surface`. Wall/surface pieces are
  exempt from footprint collision and lifted (TV on a console at interior-standard height, mirror on a bare
  wall ~107–130cm). Mounted pieces MOVE WITH their host (`mount.dependentsOf` + store carry) even when
  locked. A "Move to wall" warning snaps a floating wall-piece flush. `src/three/mount.ts`. `[affects: A,B,E]`
- **Presentation lock = `lightMode`** (E, global flag in lighting store, additive in `lighting_schema`):
  ON ⇒ furniture locked + editing hints hidden; OFF ⇒ default. It never mutates each item's own `locked`,
  so toggling off restores prior state. Gating helpers `furnitureLocked(item,lightMode)` +
  `showEditingHints(lightMode)` in `/lighting/src/contract.ts`. B's flythrough auto-locks furniture +
  hides item overlays while open and restores on close (its own mechanism); B added an "✏️ Edit furniture"
  toggle that hands rendering back to OrbitControls for editing mid-session. `[affects: A,B,E]`

## Lighting & Time-of-Day (Agent E) — `/lighting`, `shared/lighting_schema.json` (v1.0, units = meters)

- Every room auto-gets a HemisphereLight ambient fill + a warm ceiling task light the moment it exists
  (never a dark box); editable + warm/neutral/cool (Kelvin→RGB) swatches. Layered = ambient + task (+accent).
- **The sun is ONE DirectionalLight and the SOLE shadow caster** (room lights `castShadow=false`); ONE
  global hemisphere (not per-room) — perf invariant = 1 shadow caster for 1→30 rooms.
- **Sun is a pure fn of (timeOfDay, northOffsetDeg)** — `elev=sin(t·π)·maxElevRad`, `az=t·π−π/2+north`,
  `pos=r·[cos(elev)sin(az), sin(elev), cos(elev)cos(az)]` (`/lighting/src/sun.ts`). So B can reproduce
  exact sun/shadows per recorded frame from `timeOfDay`. N is FIXED on the compass; a ☀ marker orbits.
- **Verified working values** (furnished 4×5m room, headless swiftshader): sun base intensity **1.35**
  (legacy units) ×`max(0,sin(t·π))`; hemisphere sky `#ffffff`/ground `#cfcbc2` int **0.7**; ambient **0.22**;
  ceiling task **0.8** warm `#ffd6aa`(2700K); shadow mapSize **2048** (4096 for big houses); bias **-0.0004**,
  normalBias **0.02**; ortho half-extent **max(houseHalfW,houseHalfD)+3m**; far **domeRadius+half·2+5**; domeRadius **30**.
- **R3F shadow-camera gotcha:** changing `shadow-camera-left/right/top/bottom`/`far` via JSX props does NOT
  auto-call `updateProjectionMatrix()`. Mutate `light.shadow.camera.*` imperatively in a `useEffect`, call
  `cam.updateProjectionMatrix()`, set `light.shadow.needsUpdate=true` (`/lighting/src/r3f/Sun.tsx`).
- **No-windows = unlit interior.** A closed box looks dark at "noon" because no window lets the sun in; the
  panel warns the user to add a window in Step 3. A passes `hasWindows` (design.openings has a `window`) to `<LightingControls>`.

## Realistic Rendering (Agent G) — `/rendering`, `shared/render_schema.json` (v1.0)

- **"Ray tracing" delivered as real-time PBR realism, NOT a live per-pixel ray tracer** (infeasible in-browser):
  runtime MeshStandard PBR enhance + procedural HDR-IBL (Lightformer env, no CDN) + ACESFilmic tone mapping +
  N8AO ambient occlusion + emissive bulbs/windows with selective bloom + RectAreaLight area fills, layered ON
  TOP of E's lighting. Quality toggle high/med/low. There IS a real path-traced "hero still" (three-gpu-
  pathtracer, static camera, graceful raster fallback) — genuine Monte-Carlo accumulation, but a one-off
  export, not the live view. `[affects: A,E,G]`
- **Render↔lighting seam (confirmed with E):** `<Canvas shadows flat>` is UNCHANGED — `shadows` (PCFSoftShadowMap)
  is E's (sun caster); `flat` (NoToneMapping) is KEPT because **G's post EffectComposer owns ACESFilmic tone
  mapping + sRGB**. **Never remove `flat` or set `gl.toneMapping`** or ACES applies TWICE (washed/clipped). G
  adds ONLY `<Canvas>` children via `<RealismLayer/>` + a `<RenderControls/>` DOM overlay. G drives E's lights
  read/write at runtime (lights on/off, emissive bulb glow) via E's public store API — no edits to E source.
  A full blackout would need E's hardcoded ceiling downlights + hemisphere/ambient to respect a global
  `roomLightsEnabled` flag (open E/G coordination); today "off" is a realistic daytime dim. `[affects: E,G]`
- **⚠ Cross-island R3F dedupe is REQUIRED (root `vite.config.ts`).** `/rendering` ships its OWN copies of
  react/three/@react-three/*, so without `resolve.dedupe` for [react, react-dom, three, @react-three/fiber,
  @react-three/drei, @react-three/postprocessing, postprocessing, three-stdlib, three-mesh-bvh,
  three-gpu-pathtracer, zustand] the app loads a DUPLICATE `@react-three/fiber` → "hooks can only be used
  within Canvas" crash. Harmless no-op for islands that already resolve to root (e.g. /lighting). Keep it. `[affects: A,G,D]`
- **EXACT dep pins (root `package.json`) — do NOT bump:** `@react-three/postprocessing@2.19.1`,
  `postprocessing@6.37.8`, `three-gpu-pathtracer@0.0.23`. postprocessing 3.x is R3F9/React19-only (this app is
  R3F8/React18). n8ao is vendored by @react-three/postprocessing (no separate dep). Path-tracer code-splits to
  its own ~197KB chunk. `[affects: A,G]`
- **Path tracer on headless/software GL** (SwiftShader) needs ~18–21s for the FIRST sample (shader compile +
  BVH build) then converges; watchdog is 25s (real GPUs hit sample 1 in <1s). `dynamicLowRes=false` for clean
  full-res static accumulation. `[affects: G]`

## Photo Texture Mapping (Agent H) — `/texturing`, `shared/texture_schema.json` + `shared/pbr_conventions.json` (v1.0)

- User uploads a furniture photo → H crops the surface (client-side canvas, from **B's detection bbox on the
  ORIGINAL photo** — zero change to B's pipeline) → seamless de-lit tiling PBR material (albedo+roughness+
  normal) → applied to the matching archetype's material SLOT. `[affects: A,B,H]`
- **UV de-risk: the whole corpus is Three.js PRIMITIVES** (box/cylinder/sphere/cone/torus), which ALL
  auto-generate a `uv` attribute + use `meshStandardMaterial`. So the classic "no uv → only dots" failure
  CANNOT occur. The real work is (1) **world-space tiling** (`repeat = worldDimCm / repeat_cm`, same trick the
  floor uses) so a pattern isn't shown at wildly different scales on a 210cm sofa vs a 50cm table, and (2) a
  **triplanar fallback** (onBeforeCompile, normal-weighted) for the 2 anisotropic meshes (freestanding tub,
  open lamp-shade cone) whose default UVs stretch. `[affects: A,H]`
- **Textures are REFERENCES, never bytes-in-design** (cardinal rule). `FurnitureItem.texture?: AppliedTexture`
  (additive, optional) carries content-hash refs (`sha256:`); bytes live in a content-addressed asset store
  `roomio.asset.<sha256>` (IndexedDB) behind C's StorageAdapter shape. Round-trips through C's persistence
  verbatim. Open C decisions: export inline-bytes vs graceful color fallback; asset GC/ref-counting. `[affects: A,C,H]`
- **Slot targeting:** v1 textures the PRIMARY 'body' surface (meshes using the raw item color: sofa body/
  cushions, table/desk top, cabinet body, chair seat, bed duvet) and skips legs/metal/glass — precise via an
  optional `userData.role`, else a LINEAR-lightness heuristic (legs ≈ 0.5× shade). Applies to a CLONED
  material for exact revert. `[affects: A,H]`

## PBR conventions — DECISION RATIFIED (Agent D, cycle 3) — `shared/pbr_conventions.json` v1.0

H authors the maps; G owns the renderer. Both agreed; D ratifies:
- **Color space:** albedo `.map` = `SRGBColorSpace`; roughnessMap + normalMap + metalnessMap = LINEAR
  (`NoColorSpace`, the three default). Normals are **+Y (OpenGL) tangent-space**, uploaded via CanvasTexture
  with `flipY=true` (matches albedo / the `textures.ts` precedent — a DataTexture path would invert relief).
- **Roughness bands:** fabric 0.8–0.95, wood 0.4–0.6, authored for an IBL-lit world.
- **No metalnessMap for dielectrics** (fabric/wood ⇒ `material.metalness=0`); H pings G before adding one.
- **No baked aoMap in tiling materials** — G's N8AO owns contact AO. (three 0.169 unifies UV channels, so the
  brief's "aoMap needs uv2" is pre-r150 framing; no uv2 needed from H or A.)
- **Ownership seam (no double-mutation):** H owns per-material `{map,roughnessMap,normalMap}` +
  colorSpace/wrap/repeat, keeping the material `MeshStandard` so G's runtime MaterialEnhancer still upgrades
  it. G owns `renderer.toneMapping`/`outputColorSpace`/`scene.environment`/bloom/SSAO/shadow + `envMapIntensity`.
  Textures apply first; G's env/passes layer on top. (Open: G's re-enhance trigger so `envMapIntensity`
  re-applies to a freshly-textured mesh at runtime — until then H sets `needsUpdate` + G re-enhances on traversal.) `[affects: G,H]`

## Build / Tooling

- **`main` is PR-gated.** `.githooks/pre-commit` blocks direct commits to main; `.githooks/pre-push` blocks
  direct pushes to main AND runs root `typecheck + test` before any push. `.github/workflows/ci.yml` runs
  typecheck + vitest + build on PRs into main. Advance main only via a merged PR. `npm run prepare` wires
  `core.hooksPath=.githooks` on install. `[affects: all]`
- **The repo is SEVEN independent TS build islands** — `src`(A), `camera-flythrough`(B), `multi-room`(C),
  `lighting`(E), `persistence`(C f2), `rendering`(G), `texturing`(H) — each with its OWN `node_modules` +
  `tsconfig (include:["src"])` + vite/vitest, PLUS the Python `detection-pipeline`(B). Ports (dev): app 5180,
  server 5181, flythrough 5184, lighting 5186, persistence 5187, rendering 5188, texturing 5189 (H moved
  5188→5189 after a collision with G). `[affects: all]`
- **⚠ Root CI only typechecks/tests `src/`** (root tsconfig `include:["src"]`). It does **NOT** cover the
  sub-islands. A type error OR failing test inside any island (`/lighting`, `/multi-room`,
  `/camera-flythrough`, `/persistence`, `/rendering`, `/texturing`) passes CI and merges silently.
  **Coordinator MUST `tsc -b` + `vitest run` each island every cycle** — and note **`vitest` does NOT
  full-typecheck** (esbuild transpiles), so root `npm test` can be green while `tsc`/`vite build` fail.
  Always run BOTH. **CONCRETE INSTANCE (cycle 3): `origin/main` shipped a RED multi-room test** —
  `multi-room/src/data/roomTypes.test.ts` hard-codes `expect(CATALOG_IDS.size).toBe(91)` but A grew
  `src/data/archetypes.catalog.json` to 103 ids; the multi-room suite has been failing on main unnoticed
  because CI never runs it. **RECOMMENDED FIX: add island `tsc + vitest` to `.github/workflows/ci.yml`**
  (only AFTER the red test is fixed, else it blocks all PRs). `[affects: D,B,C,E,G,H]`
- **Don't hard-code the archetype catalog CARDINALITY in a test.** The catalog is A's single source of
  truth and grows ADDITIVELY (23→91→103…). Any `.toBe(<count>)` assertion on it is guaranteed to break on
  the next catalog growth. Assert MEMBERSHIP (`CATALOG_IDS.has(id)`), never the size. `[affects: C, all test authors]`
- **`shared/lib/` is the FIRST cross-island TS import** (Agent F) — see the Shared-lib section. It resolves
  under each island's tsc + vitest despite living outside `include:["src"]` (`moduleResolution:"bundler"`
  pulls the imported leaf in). Its tests run under the ROOT vitest (`vitest.config.ts` includes
  `shared/lib/**/*.test.ts`); there is no package.json under `/shared`. `[affects: all]`
- **Video export uses `canvas-record`/WebCodecs**, deterministic step loop — NOT `MediaRecorder`/`captureStream`
  (CCapture legacy fallback). Requires `preserveDrawingBuffer`. Root dep `canvas-record@^4.2.0` (added by B
  when wiring flythrough into the app — keep it). `[affects: B]`
- **Detection VLM = `qwen2.5vl:7b` via Ollama (Apache-2.0).** Ultralytics YOLO is **AGPL-3.0** (network-use
  obligations) — opt-in only (`--detector yolo`), VLM is default. Watcher `--once` must BYPASS the settle
  window (else a just-dropped file is skipped); continuous mode keeps it to avoid half-written reads;
  atomic `.tmp`+rename writes. Browser can't read `shared/` directly → route via the Express server
  (`POST/GET /api/detect`, :5181). `[affects: A,B]`

## Shared canonical lib `shared/lib/` (Agent F — QA/dedup)

**`shared/lib/math.ts` is the single source of truth for these pure scalar helpers — do NOT re-fork them.**
Import: `import { clamp, clamp01, DEG2RAD } from '../../shared/lib/math'`.

| Export | Body | Migrated from |
|---|---|---|
| `clamp(v,lo,hi)` | `v<lo?lo:v>hi?hi:v` (NaN passes through) | src/geometry/collision.ts (dead, deleted), lighting/colorTemp.ts |
| `clamp01(v)` | `=clamp(v,0,1)` | lighting/sun.ts, multi-room/connectors.ts |
| `DEG2RAD` | `Math.PI/180` | src/data/personas.ts, lighting/sun.ts |

- **DECISION D1 RATIFIED (Agent D, cycle 2):** islands MAY import `/shared/lib` TS for trivial pure helpers
  — proven byte-identical + green across all 5 islands. The larger geometry bundle (`footprintCorners`,
  `polygonCentroid`, `pointInPolygon`, `dot2`, `obbAxes`/`obbOverlap`, `signedArea`, `pointOnWall`, full
  `bbox`, `buildWallParts`, `OBB` type) and guard bundle (`isObj`, `isFiniteNumber`, `looksLike*`) are the
  next candidates — F may proceed, **but D2/D3 below still gate them.**
- **D2 (HOLDS):** `/camera-flythrough` + `/persistence` declared ZERO cross-package coupling; lifting THEIR
  copies into shared/lib needs B's / C's sign-off (C already declined for persistence — it mirrors types
  read-only by design). Don't unilaterally dedup across a stated boundary.
- **D3 (HOLDS):** DIVERGENT items must NOT be blindly merged — `uid` (3 id FORMATS; serialized ⇒ data
  contract), `coerceHouse`/`wrapSingleRoom` (impure `Date.now()`, pinned by migrate.test), persistence
  `toWorld` (`{x,y}` + missing rotation/NaN guard), `deriveWalls`, `makeFrame`, download helpers. Each is an
  owner decision, not a mechanical merge.
- **`noUnusedLocals` gotcha:** lighting / multi-room / camera-flythrough set `noUnusedLocals:true` — when you
  import a helper you MUST delete the local copy in the SAME edit or tsc fails on the orphan.
- **Deliberately NOT consolidated** (same name, different behavior): `personas.ts` 4-arg `clamp(v,def,lo,hi)`,
  `archetypes.ts` `clampAxis` (returns a tuple), Python detection-pipeline inline clamps.

## Persistence hard-won bugs (Agent C — fix these patterns anywhere)

- **localStorage degrade must rehydrate.** An adapter that "falls back to in-memory" on a mid-session
  quota/availability throw ORPHANS every design already on disk unless `degrade()` copies existing entries
  into the fallback BEFORE flipping, idempotently. Never silently drop — surface a save-status error + retry.
- **Optimistic save reflection must not clobber a newer edit.** After an async save resolves, reflecting the
  saved envelope back wholesale overwrites an edit made DURING the save. Guard with identity: fully reflect
  only when `current.scene === justSaved.scene`; else adopt just rev/updatedAt and keep the newer scene.
- **Forward-compat round-trip.** If the contract says "unknown fields preserved," the loader must carry
  through unknown top-level keys and NOT downgrade a higher `schema_version`.
- **One cap, one place.** Duplicated cap constants (history MAX in two files) drift — route load + runtime
  through the same `capHistory`.

### Sharing isolation + backward compat (Agent C, C2-4..C2-6)
- **Showcase isolation is an import-graph property, not a runtime check.** The view-only showcase is a
  SEPARATE entry (showcase.html → src/showcase/*) that imports ONLY a payload decoder + a self-contained
  3D scene — never the session/library/editor. Verified two ways: (1) opened in a fresh incognito context,
  it renders read-only with no editor chrome / edit controls / link back to index.html; (2) `vite build`
  emits a `showcase` chunk distinct from the editor `main` chunk. The shared payload/envelope code lives in
  a third chunk with no editor code.
- **Showcase payload = minimal projection.** A share link carries only `{ name, scene }` in the URL
  fragment (#s=base64). It DROPS design_id, share tokens, history, thumbnail — so a link cannot carry other
  designs even if downstream code were buggy. Fragment (not query) ⇒ never sent to a server.
- **Dependency-free PDF.** A real floor-plan `.pdf` is produced by embedding the rendered plan as a JPEG
  via the DCTDecode filter in a hand-built 6-object PDF (src/export/pdf.ts). Validated: `file` → "PDF 1.4,
  1 page", macOS Quartz renders it. ASCII-fold title text (Helvetica/StandardEncoding can't show em-dash/×).
- **Old saves migrate once, non-destructively.** A's pre-persistence `roomio.designs.v1` localStorage map
  is imported into the new envelope library on first run (src/storage/legacy.ts), guarded by a done-flag,
  never overwriting existing designs, never deleting the old key.
- **Showcase is a SEPARATE entry point** that only ever receives one design's envelope — never imports the
  store/library. Cardinal sin = a view link reaching the editor. Design defensively (own HTML entry).

## Listing replicas & headless screenshots (solo-mode, 2026-07-02)

- **Listing→3D replica pipeline**: `src/data/listingFlats.ts` holds photo-matched flats (rooms +
  finishes + explicit openings + fixtures + camera `shots`); `useHouse.loadListingFlat(id)` loads one;
  `?listing=<id>` deep-links (auth-bypassing); `npm run replicas` shoots every replica + the default
  BHK templates to `public/renders/<id>/` and writes a per-listing `compare.html` QA sheet. Adding a
  flat = ONE data entry. A single-room listing is just a one-room `ListingFlat` (renders in the
  single-room view, which alone shows ceilings/downlights/fans).
- **Shared-wall openings must be authored on BOTH rooms' walls** (each room owns its wall mesh);
  mark the far side `bare: true` (hole only) or the two frames z-fight. Replica rooms set
  `autoDoorways: false` so `layoutHouse` doesn't cut extra doorways into an exact plan.
- **Never drive a long-running HMR'd Vite server from puppeteer via in-page `import('/src/...')`** —
  after any edit Vite serves `?t=`-versioned modules, so plain-path imports load DUPLICATE module
  instances (second zustand store; your calls silently hit the wrong one, state reads come back
  empty). Spawn a FRESH dev server per script run (the shoot script does this on :5191).
- **OrbitControls clamps sabotage scripted cameras**: default `maxPolarAngle` forbids looking up
  (ceiling shots) and `minDistance` (~0.4× house radius) pushes a close-in camera back through walls.
  `cameraBus.applyView` now lifts both when a requested pose exceeds them. Room-mode shots also need
  a ~per-frame reapply window (CameraFit fires late on cold renders); house-mode shots don't.
- **Under SwiftShader, frame-count animations run at seconds-per-frame** — make fades TIME-based
  (`delta`-scaled, like Ceiling's reveal) and give screenshots long settles; the path-tracer's first
  sample needs ~20s headless (watchdog raised accordingly).
- **Shot-composition math**: doors render CLOSED — never aim a camera through a `single` door (use
  `passage`/`slider` for see-through sightlines). Appliance detail (fridge handle, washer porthole)
  is on local +z only — put the camera on the front side or the piece reads as a flat slab. Facing
  +z ⇒ screen-left = +x (saves mirrored-composition retakes).
- **Realism levers that made replicas read "real"**: data-driven floor `roughness`/`veined`/`reflect`
  (MeshReflectorMaterial for vitrified gloss), `materials.wallTexture` cladding (uv-continuous across
  door/window cuts via per-part offsets), per-room `ceiling` specs (plank texture + single downlight),
  per-opening `frameColor`/`leafColor`, auto black-granite counter tops for light cabinet tints, and a
  `__roomioNoEnv` userData tag to exempt dark clad surfaces from the IBL wash (MaterialEnhancer skips
  their envMapIntensity).

## Gotchas

- **Commit cross-cutting shared files ATOMICALLY with their importers** `[affects: all, esp. D,E,F]`.
  Cycle 2: F created `shared/lib/math.ts` (untracked) + edited island files to import it, but left it all
  uncommitted; then E's broad `git add` swept the `lighting/*` import lines into the E8 commit **without**
  `shared/lib/math.ts` → the committed lighting island failed `tsc` (TS2307, missing module). D had to land
  F's file to repair it. Lesson: a shared/lib file + every importer go in ONE commit, on the author's branch.
- **Do NOT commit a shared A-file that's entangled with ANOTHER agent's in-flight work** `[affects: all, esp. D,G,C]`.
  Cycle 3: G's app-mount commit (`1ca1ec9`) committed `src/three/RoomView.tsx` — but that file also carried C's
  UNCOMMITTED plan-view/RoomPlacement multi-room work (C explicitly said "I did NOT commit RoomView solo — it's
  entangled; commit it with the multi-room cluster"). G's branch thus shipped a RoomView calling the OLD
  `layoutHouse({design,pos,type}[])` API, incompatible with main's committed `layoutHouse(RoomDesign[])` →
  root `tsc`/`vite build` broke (RoomView 173-175), though `vitest` stayed green (esbuild skips types). D's fix:
  **reconstruct the file from main's working version + re-apply ONLY the incoming agent's own additions** (G's
  2 imports + `<RealismLayer/>` + `<RenderControls/>`), dropping the smuggled in-flight code for its owner to
  land later. Lesson: when you mount into a hot shared file, commit ONLY your own hunks; if the file is
  entangled, hand D the exact diff instead of committing the whole file.
- **A commit must build against COMMITTED code, not the working-tree soup** `[affects: all, esp. D,C,G]`.
  Cycle 4 (the same rot, escalated): G's `feature/g-flat-templates` + `feature/g-washer-catalogue` were
  "GREEN" only in the shared WORKING TREE where every agent's uncommitted work coexists. The COMMITTED branches
  do NOT build: `houseSession.ts` calls `layoutHouse({design,pos,type})` + `store.setCorners` — C's
  **RoomPlacement refactor**, which is UNCOMMITTED ON EVERY BRANCH (`store.setCorners` exists on no ref). So
  merging them to main breaks root `tsc` (houseSession 229/278/284), and D could integrate NOTHING that cycle.
  Rules this enforces: (1) before you commit a feature, `git stash` everything else (or work in a clean
  worktree) and confirm your branch builds ALONE against current main — "green in my working tree" is
  worthless if it borrows others' uncommitted files. (2) If your feature depends on another agent's new API,
  that API must land on main FIRST (dependency order); don't build on an uncommitted contract. (3) Foundational
  refactors (a store action, a changed function signature) are their own committable unit — land them before
  the features that consume them. D verifies by building the COMMITTED ref in an isolated worktree, never the
  dirty tree.
- **Scope your `git add`.** Beyond the above, `git add -A` once swept `detection-pipeline/.venv` (8675 files).
  `.venv`, `__pycache__`, `*.tsbuildinfo`, regenerable `__shots/` belong in `.gitignore`; add specific paths.
- **Human-authorized cross-source edits happen.** At the human's explicit "I see nothing in the frontend"
  direction, B wired the flythrough into `src/three/` (sceneBus/Flythrough/RoomView) and E wired the lighting
  mount + Light Mode across 4 of A's files (RoomView, FurnitureEditor, Wizard, Furnish). These are committed
  + green; **Agent A should review/own them.** The stable contract parts are the bus + the `/lighting/src/contract.ts` helpers. `[affects: A,B,E,D]`
- **"Saved positions not preserved" was perceptual** — furniture x/z/rotation always round-tripped; the
  camera *view* wasn't saved. Fix: persist `design.view` (cam+target). `[affects: A]`
- **The live requirements log is `source/roomio.txt`, not repo root.** All agents append there. `[affects: all]`
- **Shared working copy churns under you.** Multiple agents commit/branch-switch the same checkout
  concurrently; a branch HEAD can advance mid-cycle (cycle 2: it gained 16 commits + 2 in-flight features
  while D worked). Coordinator: snapshot a committed ref, verify in an isolated `git worktree` (symlink each
  island's `node_modules`), integrate from refs — never from the dirty tree. `[affects: D]`

## Quality-hardening cycle (2026-07-03) — CI, worktrees, bundle discipline

- **Root `npm test` now runs EVERY island** via `vitest.workspace.ts` (564 tests: root + camera-flythrough +
  lighting + multi-room + persistence + rendering + texturing). All suites resolve from the ROOT
  node_modules — one `npm ci` is enough in CI; do NOT per-island install for tests. `npm run test:all`
  = workspace + server + python. `[affects: all]`
- **server/ has its own vitest+supertest suite (43 tests)** against a throwaway `roomio_test` db
  (created/dropped by `server/test/global-setup.js`, guarded to only manage `*_test` names). The Express
  app is a `createApp()` factory (`server/app.js`); `server/index.js` is the only port-binder — tests use
  ephemeral ports and NEVER touch :5181 or live data. `[affects: all]`
- **Agent worktrees don't inherit node_modules — but DON'T `npm install`, run `npm run bootstrap:worktree`.**
  A fresh `git worktree` has no node_modules; a full install (root AND `server/`) is the single biggest
  wall-clock sink per agent. `scripts/setup-worktree.mjs` (`npm run bootstrap:worktree`) SYMLINKS
  node_modules from the main checkout for the root + every island in ~0s (idempotent; falls back to install
  only if a source is missing). The manual one-liner is `ln -s <main-checkout>/node_modules node_modules` at
  the worktree root (enough for src-only lanes). Node resolves imports from the SCRIPT's path, not CWD — a
  check script outside the repo can't import `puppeteer-core`; copy it into `scripts/` (temp) or run from
  inside the repo. `[affects: all]`
- **NEVER `git stash` in this multi-worktree repo.** The stash stack is SHARED across all worktrees of one
  repo — two agents stashing concurrently will pop/drop EACH OTHER's stashes (happened cycle 6B: a glazing
  `stash pop` consumed the onboarding lane's stash, and glazing's own stash was eaten by a third worktree).
  For before/after captures use `git checkout <commit> -- <path>` or a separate clone; never `git stash`.
  Recovery: a dropped stash survives as a dangling commit (`git stash apply <sha>` / `git fsck --unreachable`).
  `[affects: all]`
- **Cold-start orientation: read `docs/agent-orientation.md` first.** A one-screen map of where everything
  lives (furniture/store/mount/wizard/catalog/listings/suggestions/server/persistence/toast) + the fast
  run/verify path — read it instead of re-grepping the tree every run. `[affects: all]`
- **Reusable verify harness: `scripts/lib/harness.mjs`.** `resolveChrome`, `startDevServer` (free port,
  surfaces vite stderr), `openPage` (waits for canvas + WebGL settle, collects console/page/network errors),
  `shoot`, `assertRenderQuality` (notBlank/notBlack/noHudCorners pixel checks). CLIs: `npm run verify:route --
  '<path>'`, `npm run verify:smoke`. Use it instead of re-writing puppeteer boilerplate. `[affects: all]`
- **Entry bundle must stay engine-free** (login + listings ≈ 90 KB gzip). The ONLY route into three/R3F is
  `React.lazy(() => import('./wizard/Wizard'))` in App.tsx; ANY static import of three/@react-three from an
  entry-reachable module silently re-merges the 1MB engine into the entry (that's exactly how the old
  dynamic imports were defeated). Rollup virtual helper modules are pinned into `react-vendor` in
  vite.config manualChunks — don't remove that or Rollup recreates a static entry→r3f edge. Video encoder
  (`canvas-record`) loads inside `captureFlythrough`, never statically. `[affects: all]`
- **Listings page scrolls in an inner container, not window** — headless checks that `window.scrollTo` and
  count `img.complete` will see below-fold `loading=lazy` images as "broken" with zero failed requests.
  Scroll the container (or fetch the URLs directly) before declaring images broken. `[affects: all]`
- **Listing photos are mirrored at scrape time** to `public/images/<id>/<n>.jpg`; `listings.json` holds
  LOCAL paths + provenance in `imageSources[]` (array — NOT a scalar `sourceUrl`). Scraper writes
  media to `*.staging` dirs then swaps, `listings.json` via tmp+rename; every CDN fetch has an abort
  timeout. Never reintroduce hotlinked fbcdn URLs — they expire ~4.5 days after scrape. `[affects: all]`

## Render/dynamic cycle (2026-07-03, cycle 6C) — additions
- **Dynamic listing rendering is a WIRING problem, not reconstruction.** `_loadFlat(spec)` already builds a
  furnished, door-aware flat from a bare `FlatSpec`; `buildSceneFromListing(listing)` (src/data/flatTemplates.ts)
  maps `bhk`→FlatSpec (1/2/3BHK + FLAT_STUDIO, keyword/rent fallback, default 1BHK), and `loadDynamicListing`
  is REPLICA-FIRST (hand-authored `LISTING_FLATS[id]` wins, byte-identical; else generic). Every entry point
  (Listings render tab, View-in-3D, `?listing=` deep link) now works for ALL listings — coverage 4/36→36/36.
  Generic scenes MUST be badged "AI-generated approximation" (compliance). `[affects: all]`
- **Tone mapping is data-driven now.** RealismPost reads `settings.toneMapping.mode`; default is Khronos
  **Neutral** (preserves finish hue, rolls off highlights) — NOT ACES (which desaturated warm wood and blew
  windows white). Renderer stays flat/NoToneMapping so the composer maps exactly once. Replica launcher
  exposure is 1.1 (tuned to the Neutral curve). `[affects: E,G]`
- **Window glass = MeshPhysicalMaterial transmission, FrontSide.** three.js re-renders every DoubleSide
  transmissive pane into the transmission target per frame — across ~72 lites in a whole-flat view that's a
  real FPS cliff. Use `FrontSide` for window glass (visually identical from the interior) and scope
  transmission to WINDOWS only (doors keep the cheap flat film). The transmission target builds once/frame
  before the composer reads buffers, so it coexists with N8AO/HalfFloat. `[affects: G]`
- **Procedural PBR finishes cache by (kind,params).** SurfaceKind now covers stone/marble/tile/laminate/
  metal/ceramic/leather/plaster + the furniture families; floors & walls get albedo+normal+roughness (data
  maps NoColorSpace, +Y OpenGL normal via Sobel). Clad walls SHARE one cached source via UV offset (never
  `base.clone()` per part). GPU sources scale with distinct finishes, not room/part count. `[affects: G,H]`
- **NEVER broad `pkill -f vite`/`pkill node` in a worktree.** It kills OTHER worktrees' dev servers and the
  coordinator's :5180, failing concurrent live captures. Kill only your OWN server by PID/port. `[affects: all]`
