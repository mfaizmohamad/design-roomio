# Agent H — Photo Texture Mapping · PROGRESS

Domain: take a user's furniture photo → detect+crop its surface (reusing Agent B) → turn the
crop into a seamless, de-lit tiling PBR material (albedo + roughness + normal) → apply it to the
matching archetype's material **slot** with world-space tiling + user scale/rotation.
Suggestion-with-confirm (preview → accept → revert). Persist via Agent C (a reference, not bytes).

Sandbox: code only in `/texturing`. Other writable: `/shared`, `roomio.txt`, `LEARNINGS.md`.
Commit own paths — Agent D merges. Never edit others' source. Port **5189** (G rendering took 5188).

Re-read `roomio.txt` + `shared/LEARNINGS.md` each cycle; update this file; append status to roomio.txt.

---

## Milestones

### H0 — Onboard · ✅ DONE (2026-07-01)
- ✅ Read brief, roomio.txt (all), LEARNINGS.md.
- ✅ Confirmed the two hard dependencies (see below) via a 6-reader investigation.
- ✅ Scaffolded `/texturing` (pkg/vite/tsconfig/vitest/harness; mirrors sibling sandboxes).
- ✅ Published the contract: `shared/texture_schema.json` (v1.0) + `shared/pbr_conventions.json` (v1.0-draft).
- ✅ TS mirror: `src/contract.ts` (+ green `contract.test.ts`).
- ✅ Onboarding entry + REQUESTs (→B, →A, →G, →C) posted to roomio.txt; Agent H section added to LEARNINGS.md.

**Dependency confirmations (the two that gate everything):**
1. **Detection (Agent B) — reuse, no edit.** Every detection proposal already carries
   `bbox` = pixel `[x,y,w,h]` in the result's downscaled-image space + `image.width/height`.
   Agent H crops the surface patch **client-side** (canvas) from bbox + the user's original
   photo — zero changes to B's pipeline. (B's schema is a published, ack-gated API.)
2. **UV maps — already satisfied for the whole corpus.** Every furniture mesh in
   `src/three/Furniture3D.tsx` is a Three.js **primitive** (box/cylinder/sphere/cone/torus),
   which auto-generate a `uv` attribute, and uses **`meshStandardMaterial`** (accepts
   map/roughnessMap/normalMap). The documented "no UV → only dots" failure **cannot occur**
   on the current corpus. The real concern is uniform **world-space tiling scale**
   (box UVs are 0..1 regardless of size) → solved by the floor's `repeat = areaCm/100`
   precedent; **triplanar/box-projection** is the safety net for the anisotropically-scaled
   freestanding tub + open-ended lamp cone.

### H1 — UV audit + triplanar fallback so every asset can take a texture · ✅ DONE (world-space tiling + triplanar fallback, harness-verified)
- Catalogue the per-`ModelKind` UV reality (done in roomio.txt; formalize as a table/test).
- World-space tiling helper: `texture.repeat = worldDimCm / repeat_cm` (mirror floor).
- Triplanar/box-projection fallback (onBeforeCompile or a small shader) for non-uniform meshes.
- DoD: every archetype takes a test texture with NO dots/stretching (verified per kind).

### H2 — T1 detect + crop a clean surface patch (via B) → target archetype · ✅ DONE (crop+bbox math node-tested; front-end seam → INTEGRATION.md)
- Persist the uploaded image (close ScanRoom's discard gap, H-owned).
- Surface `image.width/height` on the DetectionResult type (additive, type-only).
- Client-side crop: normalize bbox by result image dims → scale to natural canvas → drawImage;
  auto-pick a clean, flat, evenly-lit central sub-patch (avoid edges/seams/shadows/highlights).
- DoD: a photo yields a clean material patch + the real archetype id.

### H3 — T2 seamless tiling + de-light + derive albedo/roughness/normal · ✅ DONE (adversarial-reviewed)
- Seamless tile (offset-blend / feathered seam) on pixel arrays (pure, node-testable).
- De-light: flatten large-scale illumination (homomorphic / high-pass) → true albedo (sRGB).
- Roughness (from luminance/contrast → per-material band) + normal (height-from-luminance,
  +Y tangent-space). Assemble `MeshStandardMaterial { map, roughnessMap, normalMap }`.
- DoD: patch becomes a tiling PBR material that responds to light.

### H4 — T3 apply to slot + user scale/rotation + preview/accept/revert · ✅ DONE (harness verified 9/9)
- Apply to the target material slot (default 'body' = primary surface). Expose repeat_cm + rotation.
- Preview (transient store field, like `overlapIds`/`lightMode`) → accept (`updateFurniture`,
  undo-coalesced) → revert to default. Suggestion-with-confirm, never auto-applied irreversibly.
- DoD: user's fabric/wood wraps onto the asset, adjustable, reverts.

### H5 — Persistence (via C) + polish + new-asset UV rule in LEARNINGS.md · ✅ DONE (asset store + round-trip; IndexedDB + sharing GC are app-side seams)
- Additive `FurnitureItem.texture?: AppliedTexture`; bytes in a content-addressed asset store
  (`roomio.asset.<sha256>`) behind C's StorageAdapter shape (IndexedDB for large blobs).
- Round-trip test (texture survives save → JSON → migrate → load).
- DoD: textures survive save/reload; new-asset UV + named-slot rule recorded in LEARNINGS.md.

---

## Acceptance (brief §8)
Upload a fabric-sofa photo → B locates it → crop a clean fabric patch → tiles seamlessly, de-lit,
albedo+roughness+normal derived → applied to the 3-seater's fabric slot (no stretching/dots,
responds to room lighting) → user adjusts tiling scale+rotation, previews, accepts, reverts →
repeat with wood on a table → an archetype that lacked UVs gets them (or triplanar) → texture
survives save/reload via C.

## Open coordination (non-blocking; sensible defaults in use)
- **A**: optional `userData.role` tags on builder meshes (so a slot ≠ 'body' is precise); review
  the additive `FurnitureItem.texture?` field + the mount seam for applying maps.
- **B**: read-only confirm that `image.width/height` always equals the bbox coordinate space.
- **C**: bless the `roomio.asset.<hash>` namespace + asset lifecycle (sharing/export/GC).
- **G**: ratify `shared/pbr_conventions.json` (color space, +Y normals, AO via SSAO not baked).
