"""Build an evaluation manifest: run the pipeline on photos, dump each proposal's crop, and
write a manifest the (workflow) verifier agents consume to judge accuracy against the pixels.

Usage:  ./.venv/bin/python eval_runner.py [img ...]   (defaults to tests/fixtures/*.jpg)
Outputs: tests/eval/<stem>/{full.jpg, crop_<i>.jpg, result.json}, tests/eval/manifest.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

from color import crop_region, load_image_rgb
from pipeline import process

OUT = Path(__file__).parent / "tests" / "eval"
_KEEP = ("archetype_id", "display_label", "category", "detected_label",
         "confidence", "color_hex", "color_name", "bbox")


def main() -> int:
    args = sys.argv[1:]
    imgs = args or [str(p) for p in sorted((Path(__file__).parent / "tests" / "fixtures").glob("*.jpg"))]
    if not imgs:
        print("no images")
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for img in imgs:
        stem = Path(img).stem
        d = OUT / stem
        d.mkdir(exist_ok=True)
        r = process(img)
        (d / "result.json").write_text(json.dumps(r, indent=2), encoding="utf-8")
        rgb = load_image_rgb(img)
        if rgb is not None:
            cv2.imwrite(str(d / "full.jpg"), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        entry = {"image": img, "full": str(d / "full.jpg"), "status": r["status"],
                 "model": r["model"], "timing_ms": r.get("timing_ms"), "proposals": []}
        for i, p in enumerate(r["proposals"]):
            cp = d / f"crop_{i}.jpg"
            if rgb is not None:
                crop = crop_region(rgb, p["bbox"])
                if crop.size:
                    cv2.imwrite(str(cp), cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
            entry["proposals"].append({"idx": i, "crop": str(cp), **{k: p[k] for k in _KEEP}})
        manifest.append(entry)
        print(f"  {stem}: {r['status']} {len(r['proposals'])} proposals ({r.get('timing_ms')}ms)")
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    n = sum(len(m["proposals"]) for m in manifest)
    print(f"wrote {OUT / 'manifest.json'} — {len(manifest)} images, {n} proposals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
