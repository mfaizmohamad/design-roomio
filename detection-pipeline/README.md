# Roomio — Furniture Detection Pipeline (Agent B)

A **local, open-source** service that turns a room photo into **schema-valid furniture
proposals** — each detected piece mapped to one of Roomio's existing archetype categories,
with a confidence and a dominant color — for the front-end (Agent A) to show as confirmable
dropdowns.

> **Suggestion-only.** Nothing is auto-added. Wrong or uncertain output degrades to a
> placeholder the user re-picks — never a crash, never a blocked flow.

Runs fully offline via [Ollama](https://ollama.com). Lives entirely in `/detection-pipeline`
and talks to the front-end only through files in `/shared` (never by importing code).

---

## Architecture — 3 decoupled stages

```
 room photo ──► detect.py ──► classify.py ──► color.py ──► pipeline.py ──► result JSON
              (Stage 1)      (Stage 2)        (Stage 3)    (orchestrate)   (shared/results/)
              VLM boxes      closed-set       k-means       schema-valid
              + labels       archetype id     dominant      + never raises
                             + fallback        color
```

| Stage | File | What it does |
|-------|------|--------------|
| 1 Detect | `detect.py` | One constrained VLM call (Ollama) → per item: coarse label, a best-guess archetype, a pixel bbox, a confidence. Robust JSON + bbox coercion (normalized↔pixel, xywh↔xyxy, clamped). |
| 2 Classify | `classify.py` + `archetypes.py` | Maps each detection to a **valid `archetype_id`** from `shared/archetypes.json`. Trusts a valid VLM hint, else keyword-resolves the label, else falls back to `misc-box`. Non-furniture (doors, windows, people, clutter) is skipped. Low-confidence → `misc-box` (D-4). Optional `--refine` second VLM pass disambiguates generic classes. |
| 3 Color | `color.py` | Crops the bbox, samples the center, k-means in CIELAB, discards near-white/near-black background clusters, names the dominant centroid by nearest palette match (`palette/colors.json`). Returns `#hex` + a human name (e.g. "sage green"). |
| — Orchestrate | `pipeline.py` | Runs 1→2→3, assembles the result, **validates it against `shared/detection_schema.json`**, and **never raises** (any failure → `status:"error"`, `proposals:[]`). |
| — Serve | `watcher.py` | Polls `shared/requests/`, runs the pipeline, writes `shared/results/<id>.result.json` via atomic `.tmp`+rename. |

**Closed-set guarantee:** the pipeline only ever emits an `archetype_id` that exists in
`shared/archetypes.json`. Anything else becomes `misc-box`. This is enforced in Python, not
trusted from the model.

---

## Setup

Requires Python 3.11+ and a running Ollama daemon.

```bash
cd detection-pipeline
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# pull a vision model (primary; ~6 GB). moondream (~1.7 GB) validates plumbing.
ollama pull qwen2.5vl:7b
ollama pull moondream        # optional lightweight fallback
```

The pipeline auto-selects the best available model: `qwen2.5vl:7b` → `moondream` → any
vision-capable model installed. Override with `--model`.

---

## Run

**As a service (the normal mode — pairs with Agent A's request/result flow):**

```bash
./.venv/bin/python watcher.py            # poll forever
./.venv/bin/python watcher.py --once     # process pending then exit
./.venv/bin/python watcher.py --model qwen2.5vl:7b --refine
```

Agent A drops `shared/requests/<id>.<ext>` (+ optional `shared/requests/<id>.request.json`
sidecar `{request_id, image_path}`) and reads `shared/results/<id>.result.json`.

**One-shot on a single photo:**

```bash
./.venv/bin/python pipeline.py path/to/room.jpg            # prints JSON
./.venv/bin/python pipeline.py path/to/room.jpg --save     # writes to shared/results/
./.venv/bin/python pipeline.py path/to/room.jpg --refine   # extra VLM disambiguation pass
```

---

## The contract (`/shared`)

- **`shared/detection_schema.json`** — the published result contract (JSON-Schema, draft-07).
  Authored here, consumed by Agent A. **Stable**: its shape is not changed without announcing
  in `roomio.txt` and waiting for Agent A to ack. `additionalProperties: true` everywhere, so
  additive fields never break the consumer.
- **`shared/archetypes.json`** — the closed label set, **owned by Agent A** (mirror of
  `src/data/archetypes.ts`), the single source of truth for valid `archetype_id` values.
- **`shared/requests/`**, **`shared/results/`** — runtime channels (gitignored payloads).

Result shape (abridged):

```jsonc
{
  "version": "1.0", "request_id": "living-01", "status": "ok",
  "generated_by": "agent_b", "model": "qwen2.5vl:7b",
  "image": { "path": "...", "width": 1280, "height": 859 }, "timing_ms": 4210,
  "proposals": [
    { "archetype_id": "sofa-love", "display_label": "Loveseat", "category": "sofa",
      "detected_label": "couch", "confidence": 0.82,
      "color_hex": "#b08d57", "color_name": "camel", "bbox": [120, 360, 540, 280] }
  ]
}
```

`bbox` is pixel `[x, y, w, h]`, top-left origin, in the source image's coordinate space
(see `image.width/height`).

---

## Tests

```bash
./.venv/bin/python -m unittest discover -s tests -v
```

The offline suite (`tests/test_pipeline.py`, stdlib only — no model needed) covers the
deterministic guarantees: closed-set ids, graceful fallback, low-confidence demotion, color
naming, background rejection, bbox coercion, schema validity of OK/error results, and atomic
file handoff. The VLM path is smoke-tested separately once a vision model is pulled.

---

## Decisions & licensing

- **VLM path** (`qwen2.5vl:7b`, Apache-2.0) is the default for boxes + classification;
  `moondream` is the lightweight plumbing-validation fallback.
- **Ultralytics YOLO is AGPL-3.0** (network-use obligations for a hosted product). The optional
  YOLO + HomeObjects-3K fast detector is therefore **deferred** and gated behind an explicit
  opt-in; the default pipeline stays on the permissively-licensed VLM path. See `roomio.txt`.

## Isolation

All code lives under `/detection-pipeline`; the contract lives under `/shared`; coordination
happens in `roomio.txt`. This service never edits the front-end and never imports its code.
The Python venv is local to this folder.
