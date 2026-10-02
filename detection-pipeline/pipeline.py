"""Orchestrates Stage 1→2→3 and emits a schema-valid result dict.

process() NEVER raises: any failure degrades to a valid result with status="error"
and proposals=[] (D-4 / suggestion-only). Output is validated against
shared/detection_schema.json so Agent A can trust every field.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

from classify import classify
from color import crop_region, dominant_color, downscale_max, load_image_rgb, vlm_readable_path
from config import CONTRACT_VERSION, MAX_VLM_IMAGE_DIM, RESULTS_DIR, SCHEMA_PATH
from detect import detect


@lru_cache(maxsize=1)
def _validator():
    try:
        from jsonschema import Draft7Validator
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        return Draft7Validator(schema)
    except Exception as e:
        print(f"[pipeline] schema validator unavailable: {e}")
        return None


def validate_result(result: dict) -> list[str]:
    """Return a list of schema-violation messages ([] == valid / no validator)."""
    v = _validator()
    if v is None:
        return []
    return [f"{'/'.join(str(p) for p in e.path)}: {e.message}" for e in v.iter_errors(result)]


def _error_result(request_id: str, image_path: str, message: str, model: str = "none") -> dict:
    return {
        "version": CONTRACT_VERSION,
        "request_id": request_id,
        "status": "error",
        "error": message,
        "generated_by": "agent_b",
        "model": model,
        "image": {"path": image_path},
        "proposals": [],
    }


def process(
    image_path: str,
    request_id: Optional[str] = None,
    model: Optional[str] = None,
    refine: bool = False,
    validate: bool = True,
    detector: str = "vlm",
) -> dict:
    """Photo path → schema-valid proposal dict. Degrades gracefully on every error."""
    request_id = request_id or Path(image_path).stem
    started = time.perf_counter()
    try:
        image = load_image_rgb(image_path)
        if image is None:
            return _error_result(request_id, image_path, f"could not read image: {image_path}")
        orig_h, orig_w = image.shape[:2]
        # Cap working resolution: 24 MP iPhone photos overflow the VLM context and
        # waste compute. Downscale once and use it for BOTH detection and color so
        # pixel bboxes stay consistent. No-op for images already within the cap.
        image = downscale_max(image, MAX_VLM_IMAGE_DIM)
        H, W = image.shape[:2]
        downscaled = (H != orig_h or W != orig_w)

        # Ollama can't decode HEIC/HEIF/WEBP; hand the detector a re-encoded JPEG
        # when the source isn't directly readable OR we downscaled it (cleaned up
        # below). Color analysis operates on the decoded `image` array directly.
        vlm_path, _vlm_tmp = vlm_readable_path(image_path, image, force_reencode=downscaled)
        try:
            detections, model_used = detect(vlm_path, W, H, model=model, backend=detector)
            if not model_used:
                res = _error_result(request_id, image_path,
                                    "no local vision model available — pull qwen2.5vl:7b or moondream via Ollama")
                res["image"].update({"width": W, "height": H})
                return res

            proposals = []
            for det in detections:
                prop = classify(det, image_path=vlm_path, model=model_used, refine=refine)
                if prop is None:
                    continue  # non-furniture → skip
                crop = crop_region(image, det.bbox)
                color = dominant_color(crop)
                prop.update({
                    "color_hex": color["hex"],
                    "color_name": color["name"],
                    "bbox": [float(v) for v in det.bbox],
                })
                proposals.append(prop)
        finally:
            if _vlm_tmp:
                try:
                    os.unlink(_vlm_tmp)
                except OSError:
                    pass

        result = {
            "version": CONTRACT_VERSION,
            "request_id": request_id,
            "status": "ok",
            "error": None,
            "generated_by": "agent_b",
            "model": model_used,
            "image": {"path": image_path, "width": int(W), "height": int(H)},
            "timing_ms": round((time.perf_counter() - started) * 1000.0, 1),
            "proposals": proposals,
        }
    except Exception as e:  # absolute backstop — never crash a caller
        result = _error_result(request_id, image_path, f"pipeline exception: {type(e).__name__}: {e}",
                               model=model or "unknown")

    if validate:
        problems = validate_result(result)
        if problems:
            print(f"[pipeline] WARNING result for {request_id} failed schema validation: {problems[:5]}")
    return result


def main():
    ap = argparse.ArgumentParser(description="Roomio detection pipeline — one photo → proposals JSON")
    ap.add_argument("image", help="path to a room photo")
    ap.add_argument("--id", dest="request_id", default=None)
    ap.add_argument("--model", default=None, help="override Ollama model (default: auto-pick)")
    ap.add_argument("--refine", action="store_true", help="second VLM pass for ambiguous classes")
    ap.add_argument("--detector", choices=("vlm", "yolo"), default="vlm",
                    help="Stage-1 detector; 'yolo' is opt-in (AGPL) and falls back to VLM")
    ap.add_argument("--out", default=None, help="write result JSON here (default: stdout)")
    ap.add_argument("--save", action="store_true", help="write to shared/results/<id>.result.json")
    args = ap.parse_args()

    result = process(args.image, request_id=args.request_id, model=args.model,
                     refine=args.refine, detector=args.detector)
    text = json.dumps(result, indent=2)
    if args.save:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        out = RESULTS_DIR / f"{result['request_id']}.result.json"
        out.write_text(text, encoding="utf-8")
        print(f"wrote {out}")
    elif args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        print(text)
    problems = validate_result(result)
    print(f"\nstatus={result['status']} proposals={len(result['proposals'])} "
          f"schema_valid={'YES' if not problems else 'NO ' + str(problems[:3])}")


if __name__ == "__main__":
    main()
