# Agent E — Lighting & Time-of-Day · PROGRESS

Domain: lighting. Code in `/lighting`. Contract: `shared/lighting_schema.json` (v1.0).
Renderer: **R3F** (three 0.169). World units: **meters**. Sun driven by the time bar (no real geo).

## Milestones

- [x] **E0 — Onboard & scaffold.** DONE. Onboarded; schema in /shared; LEARNINGS bootstrapped;
  renderer confirmed (R3F); A/C/B pinged. 19 pure unit tests green.
- [x] **E1 — Default room lights.** DONE + verified. `createDefaultRoomLights` auto-adds ambient
  hemisphere fill + warm ceiling task light per room (`store.ensureRoom`). Editable via
  `LightEditor` (intensity/enable/delete/add-accent) + warm/neutral/cool swatches. No dark box
  (harness mean luma 163 at noon). Screenshots: verify-out/01-noon.png.
- [x] **E2 — Layered lighting.** DONE on E side. ambient + task (+accent) layers; `contract.ts`
  `roomLightingSatisfaction()` predicate ⇒ default room is `{hasLight:true, isLayered:true}`
  (defaults.test.ts). **Pending A** wiring the predicate into the suggestion engine (requested).
- [x] **E3 — Sun + soft shadows.** DONE + verified. `Sun.tsx` = one DirectionalLight, PCFSoft
  (Canvas `shadows`), ortho frustum sized to house + 3 m, bias -0.0004 / normalBias 0.02; clean
  soft shadows, no acne/peter-panning. Tuned values logged in LEARNINGS.md.
- [x] **E4 — Time bar.** DONE + verified. `TimeBar` scrubs `timeOfDay`; sun arcs, shadows sweep
  (25% pixels change 0.25→0.75), warms+dims toward night (dawn mean < noon).
- [x] **E5 — North indicator.** DONE + verified. `NorthIndicator` rotate (±15°/slider) offsets
  azimuth (36% change at 90°), Reverse flips 180° (20% change). Bar + sign toggle independently
  (`LightingControls`); hiding both still renders (mean 163). Default state bar/north off in app.
- [x] **E6 — Multi-room + performance.** DONE + verified. `<LightingRig>` iterates rooms[]; ONE
  global hemisphere + ONE sun (the only shadow caster); room lights `castShadow=false`. `perf.ts`
  invariant: shadow-caster count = 1 regardless of room count (1→30 rooms; multiroom.test.ts).
  2-room harness (`?multi=1`) renders both rooms lit per-room under one sun — verify-out/08-multiroom.png.

## ✅ Acceptance (brief §8) — all met
Furnished room already lit (no dark box) ✓ · editable default light ✓ · warm feels cozier ✓ ·
sun → clean soft shadows ✓ · scrub time bar → sun arcs, shadows sweep, warms at low angle ✓ ·
rotate north → sun swings, reverse flips ✓ · hide controls → still renders ✓ · multi-room lit
per-room, framerate holds (1 shadow caster) ✓. **Verify: `node scripts/verify.mjs` (10/10) +
`npx vitest run` (24/24).** Remaining cross-agent item: A wires `roomLightingSatisfaction` into
the suggestion engine (E2 contract, requested in roomio.txt) + A mounts `<LightingRig>` in RoomView.

- [x] **E7 — Light Mode toggle (human request).** DONE on E side + verified. Global `lightMode`
  flag (store + schema + `furnitureLocked`/`showEditingHints` pure helpers in contract.ts). Toggle
  in `<LightingControls>`; ON ⇒ furniture locked + lock badges + bottom editing hint hidden, OFF ⇒
  default editable (furniture `locked` flags never mutated). Harness demo + verify 16/16, 30 unit
  tests. **A wiring** = 4 lines across FurnitureEditor.tsx + Furnish.tsx (INTEGRATION.md §5);
  **B coordination** = lightMode as shared presentation-lock (REQUEST in roomio.txt).

- [x] **E8 — UX consolidation + sun visualization (human feedback).** DONE + verified in the real app.
  - Replaced the scattered overlays (top-left chips + separate compass + bottom bar + center banner)
    with ONE docked, collapsible **☀ Lighting** panel: header (Light Mode toggle + locked pill),
    Time of day, Sun & North, Room lights.
  - **Sun & North compass** redesigned: N is FIXED (map convention — resolves "compass moves with
    time"); a ☀ marker orbits to show the sun's bearing, moving with time + north.
  - **Visible 3D sun**: a glowing sphere co-located along the sun ray (it IS the DirectionalLight that
    casts shadows/light), moving along its arc as the time bar scrubs.
  - **No-windows notice**: when the sun is on and the room has no window openings, the panel tells the
    user to add a window in Step 3 so sunlight reaches inside (hasWindows prop from RoomView).
  - Lock badges pushed behind the panel (zIndexRange). Verified: app 10/10, harness 16/16, 30 unit tests.

- [x] **E9 — Ceiling/roof + sun enclosure (human request).** DONE + verified.
  - `Ceiling.tsx`: builds the room polygon at wall height. A **shadow roof** (invisible to camera
    via `colorWrite=false`, `castShadow`) permanently blocks the sun from a windowless interior —
    no sun light/shadows inside (wall windows still admit low-angle sun). A **visual ceiling**
    (unlit light surface) + a grid of **amber recessed downlights** (small ceiling lights) reveals
    ONLY when the camera looks UP (interior / flythrough), so it never covers the room or shows as a
    slab during the normal downward orbit. Recessed point lights (capped, non-shadow) keep the room lit.
  - Wired into RoomView (real app, single room) + harness (`?roof`, `?lowcam`). Verified:
    verify-roof (hidden looking down / revealed looking up), app 10/10, 30 unit tests, typecheck clean.

## Architecture decisions
- Same seam pattern as Agent B/C: A owns `RoomView.tsx` and its `<Lights>`; I cannot edit it.
  So I build a **drop-in R3F lighting library** (`<LightingRig>` + UI overlays) + a **faithful
  standalone harness** (a furnished room) to RUN and verify, and request A mount the rig (replace
  `<Lights>`) + the time-bar/north overlay. Until wired, the harness proves it end-to-end.
- Pure, testable cores: `sun.ts` (time→sun pos/intensity/color), `colorTemp.ts` (Kelvin→RGB),
  `defaults.ts` (room→default layered Light[]), `contract.ts` (A's layered-rule predicate).
- Verify like the team: vitest unit tests + headless puppeteer screenshot of the harness.

## Status log
- 2026-06-30: E0 started. Scaffolded /lighting (port 5186), published lighting_schema.json v1.0,
  bootstrapped shared/LEARNINGS.md (renderer facts), posted onboarding + requests to A/C/B.
