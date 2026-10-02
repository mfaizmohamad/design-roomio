# Mounting Roomio lighting in the app (for Agent A / Agent D)

Agent E's lighting ships as a **drop-in R3F library** in `/lighting/src`. It replaces the local
`Lights()` in `src/three/RoomView.tsx` with `<LightingRig>` and adds a DOM control overlay.
Same import style A already uses for B's `sceneBus` (`import … from '../../camera-flythrough/…'`).

No schema of A's changes. `RoomDesign` is untouched. Lighting state is held in E's own store.

## 1) Replace the local `<Lights>` inside the `<Canvas>`

In `src/three/RoomView.tsx`:

```diff
- import { OrbitControls, ContactShadows } from '@react-three/drei'
+ import { OrbitControls } from '@react-three/drei'
+ import { LightingRig } from '../../lighting/src/r3f/LightingRig'
+ import { useLighting } from '../../lighting/src/store'
```

Delete the local `function Lights() { … }` and swap its usage:

```diff
-      <Lights />
+      <LightingRig houseHalfExtentM={radius / 2} />
```

`radius` is already computed in `RoomView` (`Math.max(b.w, b.d, 300) / 100`, meters). The sun's
orthographic shadow frustum is sized from `houseHalfExtentM` (+3 m margin) so shadows don't clip.
You can keep `<ContactShadows>` for extra grounding or drop it — the sun now casts real shadows.

## 2) Make sure each room has default lights (Pillar 1: never a dark box)

When a design loads / a room is created, register it once so it gets the default ambient + ceiling:

```ts
// in a small effect, e.g. inside RoomView when design.id / corners change:
useEffect(() => {
  const b = bbox(design.corners)            // cm
  useLighting.getState().ensureRoom({
    id: design.id,
    centerM: [0, 0],                          // room is centered on bbox center (coords.ts)
    wallHeightM: design.wallHeight / 100,
  })
}, [design.id])
```

For a multi-room **House** (Agent C), call `ensureRoom` per `room` using its `footprint` to set
`centerM` (world meters) and pass the whole-house half-extent to `<LightingRig houseHalfExtentM=…/>`.

## 3) Render the time-bar / north controls (DOM, OUTSIDE the Canvas)

```tsx
import { LightingControls } from '../../lighting/src/ui/LightingControls'
// …next to the Canvas, in the app chrome:
<LightingControls roomId={design.id} />
```

Bar + north default to **off** (pleasant mid-day angle, `timeOfDay` 0.55). They toggle independently.

## 4) Satisfy A's "layered lighting" suggestion rules (E2 contract)

A's engine derives the `light` role from **lamp furniture** (`roles.ts: model==='lamp'`). A room E
lights has real ambient+task lights but no lamp furniture, so it still trips R1 / single-overhead.
Fix: consult E's predicate before firing those rules:

```ts
import { roomLightingSatisfaction } from '../../lighting/src/contract'
const lit = roomLightingSatisfaction(useLighting.getState().rooms[roomId]?.lights)
// lit.hasLight (>=1 light) and lit.isLayered (>=1 task AND ambient fill)
// -> skip "No light source" when lit.hasLight; skip "Only one light source" when lit.isLayered
```

(Pure function, no React/three import — safe to import into the engine. Tell E if you want a
different signature and it'll match.)

## 5) Light Mode — lock furniture + hide editing hints (E7, user-requested)

The **💡 Light Mode** toggle lives in `<LightingControls>` (mounted in step 3) and flips the
global `lightMode` flag in E's store. While it's on, the user is playing with light, so the
layout must not move and the editing hints disappear. Wire A's two read sites — no per-item
mutation, so turning it off returns furniture to its default state automatically.

**`src/three/FurnitureEditor.tsx`** — treat a piece as locked when Light Mode is on:

```diff
+ import { furnitureLocked } from '../../lighting/src/contract'
+ import { useLighting } from '../../lighting/src/store'
  // …inside the component:
+ const lightMode = useLighting((s) => s.lightMode)

  const onMoveDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    selectFurniture(item.id)
-   if (item.locked) return // pinned: select only, ignore drag
+   if (furnitureLocked(item, lightMode)) return // pinned OR Light Mode: select only
    …
  }
```
Apply the same guard to the rotate/resize handlers, and hide the rotate/resize knobs when
`furnitureLocked(item, lightMode)` (they already hide on `item.locked`). Optionally show a 🔒
badge on each piece while `lightMode`.

**`src/wizard/Furnish.tsx`** — hide the bottom hint in Light Mode:

```diff
+ import { showEditingHints } from '../../lighting/src/contract'
+ import { useLighting } from '../../lighting/src/store'
+ const lightMode = useLighting((s) => s.lightMode)
  …
-      <p className="hint">
-        Click a piece to add it, then drag, rotate, resize and recolor it. Furniture snaps to walls
-        and won't pass through them.
-      </p>
+      {showEditingHints(lightMode) && (
+        <p className="hint">
+          Click a piece to add it, then drag, rotate, resize and recolor it. Furniture snaps to walls
+          and won't pass through them.
+        </p>
+      )}
```

`furnitureLocked` / `showEditingHints` are pure (no React/three import) — safe anywhere.
Behavior is proven in E's harness: `/lighting/verify-out/07b-lightmode-on.png`.

## 6) Flythrough coordination (Agent B)

Light Mode is the shared "presentation lock". Either (a) entering the flythrough sets
`useLighting.getState().setLightMode(true)` and restores it on exit, or (b) the flythrough just
checks `lightMode` so walking and furniture-editing never fight over the pointer. Posted as
REQUEST → AGENT-B in roomio.txt; no camera-path schema change.

## Verify after wiring
- `cd lighting && npx vitest run` (24 tests) and `node scripts/verify.mjs` (10 headless checks).
- In the app: open a furnished room — it's lit with soft sun shadows; switch a light to warm;
  show + scrub the time bar (sun arcs, shadows sweep); show + rotate/reverse north; hide controls.
