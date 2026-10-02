# Camera Flythrough — Progress (Agent B, work-stream 2)

Client-side Three.js virtual camera + flythrough for Roomio. **Not NeRF** — the
scene is synthetic Three.js geometry; this is real-time engine work.

Milestones map to the brief (§9). Each is independently testable.

| Milestone | Deliverable | Status |
|-----------|-------------|--------|
| **C0** | Scaffold `/camera-flythrough`; confirm A's renderer (R3F); publish `camera_path_schema.json` + `scene_contract.json`; log intent + scene-mount request | ✅ done |
| **C1** | F1 first-person walk + collision (PointerLockControls, WASD, ~1.6 m eye, wall+furniture footprint blocking) | ✅ done |
| **C2** | F2 top-down director view + camera gizmo + one-tap POV toggle | ✅ done |
| **C3** | F3 waypoint spline authoring (raycast floor, CatmullRomCurve3, draggable, per-point look-at + timing) | ✅ done |
| **C4** | F5 playback along path (getPointAt + look-ahead, play/pause/scrub, previewable POV) | ✅ done |
| **C5** | F6 frame-by-frame video export (canvas-record / WebCodecs, deterministic step loop, MP4 download) | ✅ done |
| **C6** | F4 walk-and-record path + JSON save/reload + polish | ⬜ todo |

## Renderer fact (C0)
Agent A's app is **React Three Fiber** (`@react-three/fiber` ^8 + `@react-three/drei` ^9,
`three` ^0.169). Canvas/camera/OrbitControls live in `src/three/RoomView.tsx`. World
units = meters, room centered on bbox center (`src/three/coords.ts`). `preserveDrawingBuffer`
is already enabled on the GL context — good for frame capture. There is already a decoupling
"bus" precedent: `src/three/cameraBus.ts`.

## Integration seam
The engine attaches to the **live scene** via `/shared/scene_contract.json` — a `SceneHandle`
published by a `sceneBus` that Agent A adds (mirroring `cameraBus.ts`). Until that lands, the
engine is developed + verified against a **faithful local harness** (`src/harness/`) that
implements the same `SceneHandle` over a furnished room using the same presets/collision/coords
math, so the engine drops onto the real scene with no API change. Requested from Agent A in
`source/roomio.txt`.

## Architecture
```
src/
  contract/        SceneHandle + CameraPath TS mirrors of the /shared schemas
  engine/          framework-agnostic Three.js modules (F1–F6), attach to a SceneHandle
  harness/         standalone dev bench: furnished room implementing SceneHandle + UI
tests/             vitest for pure logic (collision, curve sampling, decimation, path IO)
```

## Acceptance (brief §8) — all pass on the dev harness
| ID | Requirement | Evidence |
|----|-------------|----------|
| C-1 | Walk first-person at eye height | F1 · `verify-walk` |
| C-2 | Walking collides with walls/furniture | F1 · 8 headings stay legal + 7 collision unit tests |
| C-3 | Top-down director + camera gizmo | F2 · `verify-director` (shot 03) |
| C-4 | One-tap POV toggle | F2 · `verify-director` round-trips |
| C-5 | Drop/drag waypoints → smooth spline | F3 · `verify-path` threads every pt to 0.00 cm |
| C-6 | Per-point look-at + dwell | F3 · exported into CameraPath |
| C-7 | Record a manual walk as the path | F4 · `verify-record` 26 samples → 6 pts |
| C-8 | Plays smoothly (constant speed, look-ahead), play/pause/scrub | F5 · step ratio 1.006; 8 playback unit tests |
| C-9 | Path persists as JSON (save/reload/share) | F4/F5 · JSON + localStorage round-trip identical; 8 pathIO tests |
| C-10 | Smooth downloadable video (frame-by-frame, not realtime) | F6 · 60-frame H.264 MP4 downloads (ffprobe-verified) |
| C-11 | All code in /camera-flythrough; scene via contract; no front-end edits | isolation honored; only /camera-flythrough + /shared + roomio.txt touched |
| C-12 | Decisions/requests logged with `[AGENT-B]` | source/roomio.txt |

**Verification:** `npm test` (28 unit tests) + `npm run verify` (7 headless suites, needs `npm run dev`).
Screenshots in `scripts/__shots/`. The one open external dependency is the **live scene mount**
(Agent A's `sceneBus`, requested in roomio.txt) — the engine attaches to it with zero API change.

## Decisions log
- **C0** Path stored in **world meters** (camera consumes directly; room only recenters on
  shape change). Collision in **design cm** (reuses the front-end's exact footprint math).
- **C0** Video capture via **canvas-record (WebCodecs)** per brief; deterministic step loop, no
  MediaRecorder/captureStream. CCapture.js legacy fallback only.
