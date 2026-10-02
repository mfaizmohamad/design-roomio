# Agent H — Photo Texture Mapping · INTEGRATION

How to wire the `/texturing` drop-in into the live Roomio app. All heavy logic lives in
`/texturing/src`; the app changes are small + additive. **No edits to others' source are
required from H** — this lists the seams for Agent D (merge) / Agent A (owns the types +
Furniture3D) to apply, on the same human-authorized in-app basis B/C/E/G used.

Everything below is verified: 62/62 node tests + 9/9 headless browser checks (`npm run verify`).

---

## What H ships (import from `/texturing/src`)

| Module | Purpose |
|---|---|
| `pipeline/compose.ts` `composeTexture()` | photo + B's bbox → seamless, de-lit `{albedo, roughness, normal}` images |
| `r3f/createTexture.ts` `composedToTextureSet()` | those images → `THREE.CanvasTexture`s (correct color spaces, flipY=true) |
| `r3f/applyTexture.ts` `applyTextureToGroup()` | bind maps to the right slot meshes; returns `{ restore() }` (reversible) |
| `r3f/slot.ts` | slot targeting (role tags if present; else lightness heuristic) |
| `store/assetStore.ts` + `store/persist.ts` | content-addressed asset store + `buildAppliedTexture()` (references, not bytes) |
| `contract.ts` | `AppliedTexture`, `Slot`, conventions (mirror of `shared/texture_schema.json`) |

---

## Seam 1 — additive type on FurnitureItem (Agent A, `src/types.ts`, 1 line)

```ts
export interface FurnitureItem {
  // …existing fields…
  /** photo-derived texture (additive; old designs simply lack it). See shared/texture_schema.json. */
  texture?: import('../../texturing/src/contract').AppliedTexture
}
```
Round-trips through C's persistence verbatim (confirmed — coerce passes `interior` through;
`updateFurniture` spread-merges). Set/clear via the existing `updateFurniture(id, { texture })`
(undo-coalesced, so accept/revert are single undo steps).

## Seam 2 — the crop (H2, Agent A front-end, `src/wizard/ScanRoom.tsx` + `src/detect.ts`)

Agent B already emits everything needed; **no change to B**. Two H-owned front-end gaps:

1. **Keep the uploaded image.** `ScanRoom.onFileChange` reads the photo into a throwaway
   dataURL. Lift the `File`/dataURL into state (or the store) keyed by `request_id` so the crop
   step can reuse the user's **original full-res** photo after proposals arrive.
2. **Surface the result image dims.** Add to `DetectionResult` (type-only, additive — the
   server already returns it):
   ```ts
   image?: { width: number; height: number; path?: string }
   ```
   Then crop client-side: `composeTexture(originalRGBA, { bbox: proposal.bbox, resultW: image.width, resultH: image.height })`
   (`crop.ts` normalizes B's downscaled-space bbox onto the original canvas).

> Sample fixtures (`SAMPLE_IDS`) have no browser-side original. Either disable
> texture-from-sample, or add a read-only `GET /shared/requests/<id>` route (server change, not B).

## Seam 3 — apply to the live mesh (Agent A, `src/three/Furniture3D.tsx` / `FurnitureEditor.tsx`)

`applyTextureToGroup(group, …)` traverses a furniture group and textures the slot meshes on a
**cloned** material (default preserved for revert). To call it on the in-app scene:

- Give `FurnitureModel`'s outer `<group>` (Furniture3D.tsx ~L1113) a ref, or the per-item group
  in `FurnitureEditor.tsx` (~L180). Then on a textured item, call `applyTextureToGroup(groupRef,
  { slot: item.texture.slot, itemColorHex: item.color, itemDimsCm: {w,d,h}, repeatCm, rotationDeg,
  maps })`.
- **useMemo rebuild caveat:** `FurnitureModel` rebuilds materials on `[model,w,d,h,color]` change,
  dropping applied maps. Re-apply in a `useEffect` keyed on those + `item.texture` (the harness
  does the equivalent). *(Cleaner long-term: thread a `texture` prop into the Box/Cyl helpers so
  maps are part of the memoized material — an A-side refactor.)*
- **Optional precise slots:** tag builder meshes with `userData.role` ('body'|'cushion'|'wood'|
  'metal'|'glass'|'accent') and the heuristic is bypassed. Without tags, the lightness heuristic
  already targets body+cushions and skips legs/metal/glass (verified).

## Seam 4 — persistence (Agent C)

- Encode the three maps with `imageToDataUrl` (browser PNG) → `buildAppliedTexture(composed,
  assetStore, imageToDataUrl, { slot, archetypeId })` stores bytes in `roomio.asset.<sha256>` and
  returns the small `AppliedTexture` (references) to put on `item.texture`.
- On load, `resolveMaps(item.texture, assetStore)` → re-create CanvasTextures → re-apply.
- Back the asset store with **IndexedDB** in-app (large blobs); the `StorageAdapter` interface is
  unchanged. GC orphans via `assetStore.gc(keepSet)` on design/item delete (C's `repository.remove`).
- **Sharing/export:** a `.roomio` export or view-link references assetIds the recipient lacks —
  decide: inline referenced bytes into the export, or degrade to `item.color`. (Open with C.)

## Seam 5 — rendering coexistence (Agent G — already aligned)

H sets **only** `material.map/roughnessMap/normalMap` + their colorSpace/wrap/repeat and keeps the
material `MeshStandard`. G's `MaterialEnhancer` sets `envMapIntensity`/emissive — no clobber. Maps
follow `shared/pbr_conventions.json` (G-ratified): albedo sRGB, data maps linear, +Y normals, no
aoMap (G's N8AO does contact AO). **Open Q to G:** the re-enhance trigger when a texture is applied
at runtime (so envMapIntensity re-applies to a freshly-textured mesh).

## UI

Host a "🪡 Texture this item" control in the `ItemEditor` panel (`src/wizard/Furnish.tsx`, under
the Colour section) — upload/scan → preview (transient store field, like `overlapIds`/`lightMode`)
→ Accept (`updateFurniture`) / Revert. The `/texturing` harness (`npm run dev`, port 5189) is the
reference implementation of this flow.
