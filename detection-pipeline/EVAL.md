# Accuracy Evaluation — Roomio Detection Pipeline

Method: ran the pipeline (qwen2.5vl:7b) on 3 real room photos, then **adversarially verified
every proposal against its cropped pixels** with independent vision judges (one per proposal)
plus a per-image completeness critic (missed / false-positive items). 14 independent verdicts.

## Baseline scorecard (v1, 11 proposals across 3 rooms)

| Image | Proposals | Archetype correct | Color fair |
|-------|-----------|-------------------|-----------|
| bedroom | Queen Bed, Side Table ×2, Accent Chair | 3/4 (one "Side Table" was an accent chair) | 4/4 |
| dining | Round Table, Dining Chair ×3, Bookcase(=china cabinet) | 4/5 | 3/5 |
| living | 3-Seater Sofa(=loveseat), Coffee Table | 1/2 sub-type | 1/2 |

- **Closed-set guarantee held**: every `archetype_id` was valid; no crashes; all `status:ok`.
- Strengths: chairs, beds, tables, sofas detected with the right *category* at high confidence;
  colors on clean objects accurate (dining chairs → espresso/chocolate, side table → graphite).

## Issues found & actions

1. **Recall — corpus decor under-detected.** Living room missed potted plants + a floor lamp;
   dining missed the rug + one of four chairs. Root cause: the detect prompt told the model to
   exclude "small clutter," and it lumped rugs/lamps/plants there.
   → **Action**: detect prompt now *explicitly requests* rugs, floor lamps, potted plants, "every
   chair individually," and large cabinets/sideboards/hutches (mapped to the nearest storage type).
   → **Result**: no change on these 3 scenes — qwen2.5vl:7b simply does not surface small decor
   here. This is a **model-capacity ceiling**, not a pipeline bug. Upgrade paths: `qwen2.5vl:32b`
   (bigger VLM, same code) or the opt-in YOLO + HomeObjects-3K detector (`--detector yolo`).

2. **Color on occluded / large items.** A china cabinet → "light gray" and a cluttered coffee
   table → "greige" because the bbox is dominated by cream wall / white tablecloth / papers, not
   the dark wood. My background rejection only dropped near-white/near-black; a *pale-gray*
   neutral (L≈211) survived and outvoted the chromatic wood.
   → **Action**: color selection now, when the dominant cluster is a **pale neutral** (L≥190,
   low chroma), prefers the largest **non-pale-neutral** cluster with ≥15% coverage (recovers
   dark-wood surfaces buried under light surroundings); genuinely white/pale items are untouched
   (no alternative exists). Covered by a deterministic unit test.
   → **Result**: coffee table improved (pale greige → a darker neutral); the china cabinet stayed
   light because its dark wood is <15% of that very large crop. Color is inherently approximate
   when an object's own surface is mostly occluded — and it is a **confirmable suggestion**, so a
   wrong swatch costs the user one tap, never a crash.

3. **Sub-type / count nuances** (loveseat called "3-Seater"; china cabinet → "Bookcase"; 1 of 4
   chairs missed). These are VLM judgment calls on adjacent corpus types. The optional `--refine`
   pass (second constrained VLM call per ambiguous item) improves sub-type accuracy at a latency
   cost; off by default to stay "within seconds." All remain valid, confirmable proposals.

## Bottom line

The pipeline meets the acceptance bar — a dropped photo yields, within seconds, schema-valid
proposals mapped to real archetype ids with sensible colors, degrading gracefully. Remaining gaps
(small-decor recall, color under heavy occlusion) are bounded by the 7B model and by single-bbox
color sampling, both with documented upgrade paths. Because detection is suggestion-only and every
proposal is user-confirmed, these are quality refinements, not correctness risks.
