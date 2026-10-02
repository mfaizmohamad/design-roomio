# Roomio agent orientation

Read this ONCE instead of re-grepping the tree every run. Roomio is a React +
Vite + TypeScript + React-Three-Fiber app (the 3D room designer) with a small
Express + Postgres backend. Paths below are verified against the current tree.

## Where things live

| You're touching… | Go to |
| --- | --- |
| Furniture 3D models / meshes | `src/three/Furniture3D.tsx` |
| Store + all actions (zustand; `window.__roomio` in dev) | `src/store.ts` |
| Furniture mount / wall-placement / collision | `src/three/mount.ts` |
| Wizard steps (shape → dims → openings → style → furnish) | `src/wizard/` (`Step1Shape.tsx` … `Furnish.tsx`, `Wizard.tsx`) |
| Catalog data (archetypes: sizes, categories) | `src/data/archetypes.catalog.json` |
| Listing→3D replicas (photo-matched flats + camera shots) | `src/data/listingFlats.ts`; launcher `src/listingFlatLauncher.ts` |
| Listings page (browse flats, "3D view" tab) | `src/wizard/Listings.tsx` |
| Plan → 3D home (multi-room homes registry) | `src/data/homes/` — follow `docs/home-authoring-pipeline.md` |
| Persona presets | `src/data/personas.json` (loaded via `loadPreset`) |
| Suggestions engine (what to add next) | `src/suggestions/` (`engine.ts`, `roles.ts`) |
| Persistence + `coerceDesign` (schema-tolerant load) | `src/persistence.ts` |
| Toasts / error surfaces | `src/toast.ts`, `src/Toasts.tsx`, `src/ErrorBoundary.tsx` |
| Deep-link / stage routing (`?stage/?preset/?listing/?seed/?shape`) | `src/App.tsx` (parsed ~L39–L155) |
| Multi-room / whole-house | `src/three/houseSession.ts`, `src/three/houseViewMode.ts`, `src/three/RoomView.tsx` |
| Backend (Express app factory / port binder / auth / db) | `server/app.js`, `server/index.js`, `server/auth.js`, `server/db.js` |
| Build islands (own package.json + tests) | `camera-flythrough/ lighting/ multi-room/ persistence/ rendering/ texturing/` |
| Detection pipeline (Python) | `detection-pipeline/` (tests via `npm run test:py`) |
| Developer SaaS research / Embercrest pilot / furniture photos | `docs/developer-saas/README.md` → `HANDOFF.md` and implementation specifications |

## Run & verify FAST

1. **Bootstrap the worktree in seconds (skip `npm install`):**
   `npm run bootstrap:worktree` — symlinks node_modules for root + every island
   from the main checkout. (Only run `npm install` if the source is missing.)
2. **Drive a route + get screenshot / console errors / render verdict:**
   `npm run verify:route -- '/?stage=furnish&seed=1'` (or `verify:smoke` for the
   curated set). Reuse a running server with `BASE=http://localhost:5180`.
3. **Deep-link URLs** (bypass the wizard): `?stage=step1|step2|step3|step4|furnish`,
   `?preset=<genre_id>` (e.g. `gamer`, `biophilic`), `?listing=<id>` (replica),
   `?seed=1`, `?shape=l|u`.
4. **Write your own check in 3 lines** with the harness (see
   `docs/verify-harness.md`):
   ```js
   import { withDevServer, withBrowser, openPage, shoot, assertRenderQuality } from '../scripts/lib/harness.mjs'
   await withDevServer(async ({ url }) => withBrowser(async (b) => {
     const { page, critical } = await openPage(b, `${url}/?stage=furnish&seed=1`, { waitForCanvas: true, settleMs: 3500 })
     console.log(assertRenderQuality(await shoot(page, 'verify-out/x.png')), critical())
   }))
   ```
   The dev store is `window.__roomio.getState()` (actions like `addFurnitureCentered`,
   `updateFurniture`, `loadPreset`, `undo`/`redo`, `fitView`).

## Green bar (must pass before committing)

```
npm run typecheck      # tsc -b --noEmit
npm test               # full vitest workspace (root + all islands)
npm run build          # tsc -b && vite build
```
Backend/e2e (need :5181 + Postgres): `npm run check:auth`, `npm run check:detect`.
`npm run test:server` (server suite), `npm run test:py` (Python).

## Gotchas (don't relearn these — see `shared/LEARNINGS.md`)

- **Never drive a long-running HMR'd dev server via in-page `import('/src/...')`** —
  you get a duplicate zustand store and silently drive the wrong app. Spawn a
  FRESH server per script (the harness does this).
- **Entry bundle must stay engine-free** — the ONLY route into three/R3F is
  `React.lazy(() => import('./wizard/Wizard'))` in `App.tsx`. A static
  three/@react-three import from an entry-reachable module re-merges the ~1 MB
  engine into first load.
- **SwiftShader headless is slow** — give WebGL long settles; the path tracer's
  first sample needs ~20s.
- **Listings page scrolls an inner container, not `window`** — below-fold
  `loading=lazy` images read as broken unless you scroll the container.
- **A commit must build against COMMITTED code**, not your working-tree soup —
  `git stash` others' work (or use a clean worktree) and confirm your branch
  builds ALONE against current main.
