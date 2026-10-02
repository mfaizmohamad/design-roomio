"""VLM smoke test — run the full pipeline on real photos when a vision model is available.

Skips cleanly (exit 0) when no model is pulled, so offline/CI stays green. When a model IS
present it asserts the hard guarantees on real output: schema-valid, status ok|error, and
every emitted archetype_id is in the corpus (closed-set).

Run:  ./.venv/bin/python smoke_vlm.py [image ...]
      (defaults to tests/fixtures/*.jpg)
"""
from __future__ import annotations

import glob
import sys
from pathlib import Path

from archetypes import load_corpus
from pipeline import process, validate_result
from vlm import pick_model


def main() -> int:
    model = pick_model()
    if not model:
        print("[smoke] no vision model pulled — skipping VLM smoke test (offline OK).")
        return 0

    imgs = sys.argv[1:] or sorted(glob.glob(str(Path(__file__).parent / "tests" / "fixtures" / "*.jpg")))
    if not imgs:
        print("[smoke] no fixtures found (download some into tests/fixtures/, or pass paths).")
        return 0

    corpus = load_corpus()
    print(f"[smoke] model={model}  images={len(imgs)}")
    failures = 0
    for img in imgs:
        r = process(img, model=model)
        problems = validate_result(r)
        bad_ids = [p["archetype_id"] for p in r["proposals"] if not corpus.is_valid(p["archetype_id"])]
        clean = (not problems) and (not bad_ids) and r["status"] in ("ok", "error")
        flag = "OK " if clean else "FAIL"
        print(f"\n=== [{flag}] {Path(img).name} === status={r['status']} model={r['model']} "
              f"items={len(r['proposals'])} {r.get('timing_ms', '?')}ms")
        for p in r["proposals"]:
            print(f"    {p['display_label']:20s} ({p['archetype_id']:15s}) conf={p['confidence']:.2f}  "
                  f"{p['color_name']} {p['color_hex']}  <- detected '{p.get('detected_label')}'")
        if not clean:
            failures += 1
            print("    PROBLEMS:", (problems[:3] or None), "| off-corpus ids:", (bad_ids or None))

    print(f"\n[smoke] {len(imgs) - failures}/{len(imgs)} clean")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
