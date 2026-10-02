"""OPTIONAL deterministic Stage-1 detector — YOLO (e.g. fine-tuned on HomeObjects-3K).

⚠ LICENSING: Ultralytics YOLO is AGPL-3.0 (network-use obligations for a hosted product).
This module is OPT-IN and is NOT imported by the default pipeline. Enable it only after
confirming a license compatible with your deployment (see roomio.txt). It requires
`pip install ultralytics` plus a weights file; otherwise detect_yolo() returns [] and the
caller falls back to the VLM path — so the default install pulls no AGPL dependency.

Why this exists: the detector class names map ~1:1 onto coarse labels, and the SAME closed-set
resolver (classify.py / archetypes.py) maps those to archetype ids — so the contract output is
identical whichever Stage-1 detector runs. Boxes are deterministic and ms-level.
"""
from __future__ import annotations

from typing import Optional

from detect import Detection

# Detector class names → our coarse labels. The closed-set resolver does the rest, so this
# only needs to normalize a few synonyms; unknown classes pass through and resolve downstream.
_YOLO_LABEL_MAP = {
    "couch": "sofa", "sofa": "sofa", "loveseat": "loveseat", "sectional": "sectional",
    "bed": "bed", "chair": "chair", "armchair": "armchair",
    "dining table": "dining table", "diningtable": "dining table", "table": "table",
    "coffee table": "coffee table", "desk": "desk",
    "tv": "tv", "tvmonitor": "tv", "television": "tv",
    "potted plant": "potted plant", "pottedplant": "potted plant", "plant": "potted plant",
    "wardrobe": "wardrobe", "bookcase": "bookcase", "bookshelf": "bookcase",
    "cabinet": "cabinet", "dresser": "dresser", "lamp": "floor lamp", "rug": "rug",
}


def yolo_available() -> bool:
    try:
        import ultralytics  # noqa: F401
        return True
    except Exception:
        return False


def detect_yolo(
    image_path: str,
    width: int,
    height: int,
    weights: Optional[str] = None,
    conf: float = 0.25,
) -> list[Detection]:
    """Run a YOLO detector if available, returning the same Detection list shape as the VLM
    path. Returns [] (never raises) when ultralytics or weights are missing, so the pipeline
    transparently falls back to the VLM detector."""
    if not yolo_available():
        print("[yolo] ultralytics not installed — opt-in detector unavailable (falling back to VLM).")
        return []
    try:
        from ultralytics import YOLO
        model = YOLO(weights or "yolov8n.pt")  # default COCO weights; swap for HomeObjects-3K
        res = model.predict(image_path, conf=conf, verbose=False)[0]
        names = res.names
        out: list[Detection] = []
        for b in res.boxes:
            cls = str(names[int(b.cls)]).lower()
            label = _YOLO_LABEL_MAP.get(cls, cls)
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
            out.append(Detection(label=label, bbox=[x1, y1, x2 - x1, y2 - y1],
                                 confidence=float(b.conf), archetype_hint=None,
                                 raw={"yolo_class": cls}))
        return out
    except Exception as e:
        print(f"[yolo] detection failed ({type(e).__name__}: {e}) — falling back to VLM.")
        return []
