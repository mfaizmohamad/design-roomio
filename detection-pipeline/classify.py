"""Stage 2 — map a detection to a valid closed-set archetype (+ confidence).

Pure-Python resolution by default (no extra model call): trust a valid VLM
archetype hint, else keyword-map the coarse label, else fall back to the
placeholder box. Low-confidence items are demoted to the placeholder per D-4.
An optional VLM `refine` disambiguates generic classes (e.g. which kind of sofa).
The output archetype_id is ALWAYS in the corpus, or None to skip non-furniture.
"""
from __future__ import annotations

from typing import Optional

from archetypes import load_corpus, resolve_label
from config import MIN_ARCHETYPE_CONFIDENCE
from detect import Detection
from vlm import chat_image, extract_json

# Generic coarse labels worth a refine pass (multiple sub-archetypes exist).
_AMBIGUOUS = {"sofa", "couch", "settee", "bed", "table", "chair", "seat", "cabinet"}


def _refine_archetype(image_path: str, det: Detection, model: str) -> Optional[str]:
    """Ask the VLM, given the crop's bbox, to pick the single best corpus name."""
    corpus = load_corpus()
    names = ", ".join(a["name"] for a in corpus.by_id.values())
    x, y, w, h = det.bbox
    prompt = (
        f"In this room photo, focus on the {det.label} located at pixel bounding box "
        f"x={int(x)}, y={int(y)}, width={int(w)}, height={int(h)}.\n"
        f"Pick the SINGLE best match for it, copied verbatim from this list:\n[{names}]\n"
        'Return ONLY JSON: {"archetype": "<one name>", "confidence": <0..1>}'
    )
    data = extract_json(chat_image(model, prompt, image_path) or "")
    if isinstance(data, dict):
        name = data.get("archetype")
        if isinstance(name, str):
            r = resolve_label(name, name)
            return r.archetype_id
    return None


def classify(
    det: Detection,
    image_path: Optional[str] = None,
    model: Optional[str] = None,
    refine: bool = False,
) -> Optional[dict]:
    """Resolve one detection to a proposal dict, or None to skip (non-furniture)."""
    corpus = load_corpus()
    res = resolve_label(det.label, det.archetype_hint)
    if res.archetype_id is None:
        return None  # non-furniture → skip

    archetype_id = res.archetype_id
    conf = max(0.0, min(1.0, det.confidence))

    # Optional second-pass disambiguation for generic classes.
    if (refine and model and image_path and res.method != "vlm-id"
            and (det.label or "").strip().lower() in _AMBIGUOUS):
        refined = _refine_archetype(image_path, det, model)
        if refined and corpus.is_valid(refined):
            archetype_id = refined

    # Confidence shaping by how we got the label.
    if res.method == "keyword":
        conf *= 0.92
    elif res.method == "fallback-box":
        conf = min(conf, 0.40)

    # D-4: low-confidence → placeholder box (still a confirmable suggestion).
    if conf < MIN_ARCHETYPE_CONFIDENCE and archetype_id != corpus.fallback_id:
        archetype_id = corpus.fallback_id

    return {
        "archetype_id": archetype_id,
        "display_label": corpus.display_label(archetype_id),
        "category": corpus.category(archetype_id),
        "detected_label": det.label,
        "confidence": round(conf, 3),
    }


if __name__ == "__main__":
    # offline test: synthetic detections through the resolver
    for label, hint, cf in [("sofa", "3-Seater Sofa", 0.88), ("couch", None, 0.7),
                            ("table", None, 0.6), ("ottoman", None, 0.5),
                            ("door", None, 0.9), ("chair", None, 0.2)]:
        d = Detection(label=label, bbox=[0, 0, 10, 10], confidence=cf, archetype_hint=hint)
        print(f"{label:10s} hint={str(hint):16s} conf={cf} -> {classify(d)}")
