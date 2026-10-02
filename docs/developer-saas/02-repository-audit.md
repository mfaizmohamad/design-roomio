# Repository audit for the developer product

Inspected 2026-09-29 against working-tree HEAD
`63330c7217b2497a2883bb40a3b8dcaceaa8a9bc` on
`fix/wall-seams-dimension-review`, including its pre-existing uncommitted changes.
This is an integration audit, not a claim that all existing behavior was exercised.

## What is worth keeping

Roomio has a useful browser renderer, parametric furniture, placement/collision
logic, multiple rooms and levels, camera tours, lighting, tests, and a small
authenticated backend. It can become the editor/viewer inside a developer product.
The fastest credible path extends those parts and completes their integration.

| Area | Observed implementation | Consequence for the plan |
| --- | --- | --- |
| Embercrest | `src/data/homes/embercrest.ts`, home registry, `src/homeLauncher.ts`; `?home=embercrest` route | Use it as a controlled pilot fixture; obtain source approval before customer publication. |
| Whole home | `src/three/houseSession.ts` owns rooms, active room, positions, levels; the main store edits one room | Save an atomic snapshot of the whole home, including the active room's live state. |
| Saving | `src/wizard/Wizard.tsx` `onSave` passes one `RoomDesign` to `src/repository.ts`; backend `designs.data` is per user | The normal Save button is not a demonstrated durable duplex/project save. Fix this before buyer configurations or publishing. |
| Existing envelope | `persistence/src/envelope/types.ts`, migrations, tests, `shared/save_envelope_schema.json` already describe house + lighting + revisions + sharing | Reuse/adapt this work. Do not invent a third incompatible save format. Its integration with the main multi-level session still needs proving. |
| Furniture | `src/types.ts` `FurnitureItem` stores archetype, dimensions, color, x/z and Y rotation; `Furniture3D.tsx` builds primitives | Add versioned mesh references and metadata while retaining procedural models as fallback. |
| Mounting | `src/three/mount.ts` derives height/support from catalog archetypes; stairs also drive walkable surfaces | Imported pieces require explicit mount/support semantics. Never replace architectural stairs with an arbitrary generated mesh. |
| Photos | `src/wizard/ScanRoom.tsx`, `src/detect.ts`, Python detection pipeline | Existing result is a catalog suggestion, not a product-specific 3D reconstruction. |
| Upload execution | `/api/detect` uses local request/result files and a separate watcher | Production requires a deployed worker, durable storage, job state, quotas and ownership. Existing limits are valuable but not an asset service. |
| Auth | Express sessions, bcrypt, per-user ownership, rate/body limits, origin guard, migrations | Extend existing security controls; organizations, memberships and scoped authorization were not found in audited schema/routes. |
| Business workflow | Audited routes cover auth/designs/detection; no project publication, unit inventory, lead delivery or subscription entities | These are product work, not configuration switches. |
| Viewer UX | Stored `verify-out/builder-all-floors.png` shows a room editor, room removal, render settings, colliders and floor controls | Build a buyer-facing presentation shell with a small number of useful actions. The image is an existing artifact, not a fresh device test. |
| Deployment | `docs/LAUNCH_PLAN.md` records public-data, hosting, detection, observability and backup work | Inspect and reuse its beads before filing duplicates. Do not assume historic statuses are current. |

## Specific implementation traps

1. **Save success can mean only the active room was saved.** Snapshot `syncActive`
   semantics, all room positions, level elevations, lighting, asset versions and
   camera bookmarks into one document. Reopen after a fresh browser session and
   compare the complete home. A local-only snapshot is not a published link.
2. **Room data has competing taxonomies.** Main `RoomDesign.roomType` is narrower
   than the multi-room taxonomy. Preserve the `RoomEntry.type` mapping; avoid
   silently relabeling kitchens or bathrooms while migrating.
3. **Current coercion is too permissive for new public content.**
   `src/persistence.ts` checks several scalars but casts furniture/opening arrays;
   the server validates only a small part of a design. Add bounded, nested server
   validation for the new schema. Migrate legacy data without silently deleting it.
4. **Replica status is not geometric validation.** `placementWarnings` currently
   returns no warnings for replicas. `coerceDesign` also does not retain
   `isReplica`. Record/reconcile that round-trip behavior, but never use the flag
   to bypass a new publication validator or certify furniture fit.
5. **Coordinate spaces must remain explicit.** Domain dimensions/positions are
   centimeters; renderer meshes use meters. Furniture is centered in X/Z, rests
   at local Y=0 and faces +Z. House room centers, room-local polygon origins,
   storey elevation and house recentering are separate transforms. Refer to
   `HouseView.tsx`, `houseLayout.ts`, `houseLevels.ts`, `coords.ts` before editing.
6. **Source sizes are not clear room measurements.** The current review says
   polygons use wall center lines. An architect must resolve wall thickness,
   inner faces, voids and clear dimensions before a fit guarantee can exist.
7. **New render code must preserve lazy loading.** `scripts/size-check.mjs` sets
   120 KiB eager JS, 340 KiB maximum chunk and 1100 KiB total JS gzip budgets.
   The rulebook's approximate 600 KB refers to the 3D path, not just the shell.
   Do not put GLTF loaders, decoders or generation SDKs into the eager graph.

## Embercrest source integrity

The existing review references `Duplex.pptx` slide 1, A&B floor-plan pages 4–5,
flat 504. That original file was not independently inspected in this pass.
It records 17 named spaces with printed footprints; the stored builder screenshot
shows 20 room entries, including additional circulation spaces. Do not mistake
room-entry count for a source verification count.

Carry an evidence register with source revision, page, dimension convention,
reviewer and sign-off for each space. Resolve 12 cm assumed walls, 3 m assumed
storeys, double-height living/stairs, upper voids, balcony curves, openings and
50 mm sunken areas. Retain the existing review's distinction between 148.57 m²
carpet and 173.42 m² including balconies; neither a polygon sum nor the old
“1867 sq ft carpet” label is a substitute for approved project data.

## Boundaries of this assignment

Only research documents were authored. No existing source edits, private listing
records, source photos, build islands or dependencies were intentionally changed.
No production account, model generation, contract, or public release was created.
Verification results and environment limitations are in [HANDOFF.md](HANDOFF.md).
