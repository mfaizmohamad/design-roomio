# Detection Pipeline — Progress (Agent B)

Local, open-source furniture-detection pipeline for Roomio. Photo (or video frame) → schema-valid
JSON proposals (archetype + confidence + dominant color), handed to the front-end via `/shared`.
Suggestion-only, fully local via Ollama, isolated from Agent A's front-end.

Last updated: 2026-06-30 (cycle 3)

## Milestones — all complete ✅

| ID | Deliverable | Status |
|----|-------------|--------|
| B0 | Scaffold + publish schema v1.0; log intent | ✅ |
| B1 | Ollama VLM call working on one photo | ✅ (moondream plumbing → qwen2.5vl:7b) |
| B2 | Closed-set classifier → valid archetype id + confidence + fallback | ✅ |
| B3 | k-means dominant-color stage per region | ✅ |
| B4 | `pipeline.py` end-to-end + schema-valid output | ✅ |
| B5 | `watcher.py` + atomic file handoff (requests/ → results/) | ✅ |
| B6 | README, tests, optional YOLO/HomeObjects fast path | ✅ |
| — | Final acceptance + accuracy tuning (qwen2.5vl:7b) | ✅ PASSED |
| — | Video POC (frame → detection) per human request | ✅ |

## Acceptance — PASSED
Dropped 3 real room photos (living/bedroom/dining) → each yields, within seconds, a schema-valid
`result.json` with real archetype ids, sensible per-item colors, graceful fallback, every id in the
corpus, no crashes. Adversarially verified (14 independent vision judges); see `EVAL.md`.

Real result files published to `shared/results/` for Agent A to wire the confirm UI:
- `living-room-demo.result.json` (photo: 3-Seater Sofa, Coffee Table)
- `video-apartment.result.json` (best frame of a real-estate walkthrough VIDEO: round table,
  3 dining chairs, wardrobe, bookcase) — proves the video POC.

## What's here
- Stages: `detect.py` (VLM + opt-in `--detector yolo`), `classify.py`+`archetypes.py` (closed-set
  resolver, `misc-box` fallback, low-conf demotion), `color.py` (k-means CIELAB + background &
  pale-neutral rejection), `pipeline.py` (orchestrate, schema-validate, never raises),
  `watcher.py` (atomic handoff, sidecar, `--once` processes complete drops immediately).
- Tools: `eval_runner.py` (accuracy manifest), `video_poc.py` (video → frames → proposals → publish),
  `smoke_vlm.py` (live VLM smoke).
- Docs/tests: `README.md`, `EVAL.md`, `tests/fixtures.md`, **26/26 offline tests green**.

## Known limits (documented; suggestion-only so confirmable, not blocking)
- qwen2.5vl:7b under-detects small decor on busy scenes → upgrade path: `qwen2.5vl:32b` (drop-in)
  or opt-in YOLO+HomeObjects (`--detector yolo`).
- Color is approximate when an object's surface is mostly occluded (clutter/tablecloth) or the box
  is very large; pale-neutral rescue mitigates the common wall/cloth case.

## Coordination state
- Schema v1.0 LOCKED & confirmed by Agent A. `shared/archetypes.json` owned by Agent A (mirror of
  `src/data/archetypes.ts`); they ping on changes.
- Agent A shipped #3/#4/#5/#9/#10 and is opening a combined v2 PR (front-end + this pipeline);
  default combined is fine on my side.
- Ready for end-to-end integration test whenever Agent A wires the confirm UI.

## Isolation (self-audit) — clean
All code under `/detection-pipeline`; contract under `/shared`; comms in `roomio.txt`. No commit of
mine touched any front-end file. Python venv local + gitignored.
