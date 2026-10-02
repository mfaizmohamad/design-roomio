"""Stage 1 — detect furniture regions with bounding boxes (VLM path).

Uses a local Ollama vision model with a constrained prompt that asks for, per item:
a coarse label, the single best closed-set archetype (verbatim from the corpus),
a pixel bbox, and a confidence. Coordinates are coerced robustly (normalized vs.
pixel, xywh vs. xyxy). Returns a list of Detection objects; [] on any failure.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from archetypes import load_corpus
from vlm import chat_image, extract_json, pick_model


@dataclass
class Detection:
    label: str                       # coarse noun, e.g. "sofa"
    bbox: list                       # [x, y, w, h] in pixels (top-left origin)
    confidence: float = 0.5
    archetype_hint: Optional[str] = None  # VLM's proposed corpus name/id (may be None)
    raw: dict = field(default_factory=dict)


def _allowed_names() -> list[str]:
    return [a["name"] for a in load_corpus().by_id.values()]


def build_prompt(width: int, height: int) -> str:
    names = ", ".join(_allowed_names())
    return (
        "You are a furniture detector for an interior-design app.\n"
        f"The image is a room photo, {width} pixels wide and {height} pixels tall.\n"
        "List every distinct, clearly visible furniture item. For EACH item return an object:\n"
        '  "label":      a short generic noun for the object (e.g. "sofa", "coffee table", "potted plant").\n'
        '  "archetype":  the SINGLE best match copied VERBATIM from this list, or "none" if nothing fits:\n'
        f"                [{names}]\n"
        '  "bbox":       [x, y, w, h] in PIXELS, top-left origin, inside the image bounds.\n'
        '  "confidence": a number from 0.0 to 1.0.\n'
        "Rules:\n"
        "- DO include these decor items — they ARE wanted: area rugs/carpets under furniture, "
        "floor lamps, and potted plants / large houseplants.\n"
        "- DO include large storage even when it looks like a cabinet, sideboard, hutch, or china "
        "cabinet — map it to the closest type above (Wardrobe, Bookcase, TV Unit, or Dresser).\n"
        "- List EVERY chair individually, even several identical chairs around one table.\n"
        "- Do NOT include doors, windows, walls, floors, ceilings, people, table lamps, wall art / "
        "picture frames, mirrors, curtains, ceiling lights or fans, or small clutter "
        "(books, cushions, vases, dishes, electronics).\n"
        "- One object per physical piece. Merge obvious duplicates.\n"
        "- If unsure of the exact type, still give your best generic label and set a low confidence.\n"
        "Return ONLY a JSON array of these objects. No prose, no markdown."
    )


def _coerce_bbox(raw, width: int, height: int) -> Optional[list]:
    """Normalize a model bbox into pixel [x, y, w, h], clamped to the image."""
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        return None
    try:
        a, b, c, d = (float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3]))
    except (TypeError, ValueError):
        return None

    # normalized 0..1 → pixels
    if max(a, b, c, d) <= 1.0 and (c <= 1.0 and d <= 1.0):
        a, b, c, d = a * width, b * height, c * width, d * height

    x, y, w, h = a, b, c, d
    # looks like [x1, y1, x2, y2] (corners) rather than [x, y, w, h]?
    if (c > a and d > b) and (c <= width + 2 and d <= height + 2) and (a + c > width * 1.3 or b + d > height * 1.3):
        x, y, w, h = a, b, c - a, d - b

    if w <= 0 or h <= 0:
        return None
    # clamp
    x = max(0.0, min(float(width - 1), x))
    y = max(0.0, min(float(height - 1), y))
    w = max(1.0, min(float(width) - x, w))
    h = max(1.0, min(float(height) - y, h))
    return [round(x, 1), round(y, 1), round(w, 1), round(h, 1)]


def parse_detections(data, width: int, height: int) -> list[Detection]:
    if isinstance(data, dict):
        # tolerate {"items": [...]} / {"furniture": [...]} / {"objects": [...]}
        for key in ("items", "furniture", "objects", "detections", "results"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            data = [data]
    if not isinstance(data, list):
        return []

    out: list[Detection] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or item.get("name") or item.get("object") or "").strip()
        arch = item.get("archetype") or item.get("type")
        if isinstance(arch, str) and arch.strip().lower() in ("none", "", "null", "n/a"):
            arch = None
        bbox = _coerce_bbox(item.get("bbox") or item.get("box") or item.get("bounding_box"), width, height)
        if not label and not arch:
            continue
        if bbox is None:
            bbox = [0.0, 0.0, float(width), float(height)]  # whole image fallback
        try:
            conf = float(item.get("confidence", item.get("score", 0.5)))
        except (TypeError, ValueError):
            conf = 0.5
        conf = max(0.0, min(1.0, conf))
        out.append(Detection(label=label or str(arch), bbox=bbox, confidence=conf,
                             archetype_hint=(str(arch) if arch else None), raw=item))
    return out


def detect(image_path: str, width: int, height: int, model: Optional[str] = None,
           backend: str = "vlm") -> tuple[list[Detection], str]:
    """Run Stage-1 detection. Returns (detections, model_used). model_used='' if no detector.

    backend='vlm' (default) uses the Ollama VLM. backend='yolo' tries the opt-in deterministic
    YOLO detector and transparently falls back to the VLM path if it is unavailable/empty.
    """
    if backend == "yolo":
        from detect_yolo import detect_yolo
        ydets = detect_yolo(image_path, width, height)
        if ydets:
            return ydets, "yolo"
        # unavailable or nothing found → fall through to the VLM path

    chosen = pick_model(model)
    if not chosen:
        return [], ""
    text = chat_image(chosen, build_prompt(width, height), image_path)
    if not text:
        return [], chosen
    data = extract_json(text)
    if data is None:
        print(f"[detect] could not parse JSON from model reply (first 200 chars): {text[:200]!r}")
        return [], chosen
    return parse_detections(data, width, height), chosen


if __name__ == "__main__":
    import sys
    from color import load_image_rgb
    if len(sys.argv) < 2:
        print("usage: python detect.py <image_path>")
        raise SystemExit(2)
    img = load_image_rgb(sys.argv[1])
    if img is None:
        print("could not load image")
        raise SystemExit(1)
    H, W = img.shape[:2]
    dets, used = detect(sys.argv[1], W, H)
    print(f"model={used} image={W}x{H} detections={len(dets)}")
    for d in dets:
        print(f"  {d.label!r:24s} arch={d.archetype_hint!r:22s} conf={d.confidence:.2f} bbox={d.bbox}")
