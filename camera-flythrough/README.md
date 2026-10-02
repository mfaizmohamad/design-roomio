# Roomio — Virtual Camera & Flythrough (Agent B)

A client-side Three.js flythrough feature: walk Roomio's room in first person,
author a camera path from a top-down director view (waypoints → Catmull-Rom
spline, or a recorded walk), play the camera along it, and export a smooth
frame-by-frame MP4. **This is real-time engine work on synthetic geometry —
explicitly NOT NeRF / Gaussian-splat / novel-view synthesis.**

## Why a separate harness
The feature must render Agent A's **live React-Three-Fiber scene** (a real
integration seam). Per the isolation contract, Agent B never edits front-end
source and never spins a second renderer inside the app. Instead:

- The engine (`src/engine/`) is framework-agnostic and attaches to a
  `SceneHandle` (`/shared/scene_contract.json`).
- In production, Agent A publishes that handle through a `sceneBus` (mirroring
  the existing `src/three/cameraBus.ts`).
- For development + acceptance, `src/harness/` builds a **faithful furnished
  room** that implements the same `SceneHandle`, so the engine drops onto the
  real scene with zero API change.

## Run the dev harness
```bash
cd camera-flythrough
npm install
npm run dev        # http://localhost:5184  (localhost ⇒ WebCodecs capture works)
```

## Features
| ID | Feature | Core tech |
|----|---------|-----------|
| F1 | First-person walk | PointerLockControls + 2D-footprint collision |
| F2 | Top-down director view + gizmo + POV toggle | 2nd ortho/top camera |
| F3 | Waypoint spline authoring | raycast floor → CatmullRomCurve3, draggable |
| F4 | Walk-and-record path | sample + decimate F1 trajectory |
| F5 | Playback | `getPointAt(t)` + look-ahead, play/pause/scrub |
| F6 | Video capture | canvas-record (WebCodecs), deterministic step loop |

## Shared contracts (`/shared`)
- `camera_path_schema.json` — the path artifact (control points + look-at + timing + fps).
- `scene_contract.json` — the live-scene `SceneHandle` Agent A exposes.

## Tests
```bash
npm test           # collision, curve sampling, decimation, path IO round-trip
```
