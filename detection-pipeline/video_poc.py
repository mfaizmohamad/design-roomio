"""Video POC — prove the pipeline works on frames grabbed from a room walkthrough video.

Extracts evenly-spaced frames from a video, runs the full detection pipeline on each, reports
proposals per frame, and (with --publish) drops the best-furnished frame into shared/requests/
and its result into shared/results/ via the same atomic handoff Agent A consumes. The contract
is identical whether the source is a still photo or a video frame (per roomio.txt).

Usage:
  ./.venv/bin/python video_poc.py <video> [--frames N] [--extract-only] [--publish] [--id NAME]
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import cv2

from config import REQUESTS_DIR, RESULTS_DIR
from pipeline import process, validate_result

OUT = Path(__file__).parent / "tests" / "eval" / "video"


def extract_frames(video: str, n: int, outdir: Path) -> list[str]:
    outdir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        return []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    paths = []
    # sample at the midpoints of n equal segments (skip the very start/end)
    idxs = [int(total * (i + 0.5) / n) for i in range(n)] if total > 0 else []
    for i, fi in enumerate(idxs):
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, fi))
        ok, frame = cap.read()
        if ok and frame is not None:
            p = outdir / f"frame_{i:02d}.jpg"
            cv2.imwrite(str(p), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            paths.append(str(p))
    cap.release()
    return paths


def _atomic_write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def main() -> int:
    ap = argparse.ArgumentParser(description="Run the detection pipeline on frames from a video")
    ap.add_argument("video")
    ap.add_argument("--frames", type=int, default=6)
    ap.add_argument("--extract-only", action="store_true")
    ap.add_argument("--publish", action="store_true",
                    help="copy the best frame to shared/requests/ and write its result to shared/results/")
    ap.add_argument("--id", default="video-poc")
    args = ap.parse_args()

    frames = extract_frames(args.video, args.frames, OUT)
    if not frames:
        print("could not extract frames")
        return 1
    print(f"extracted {len(frames)} frames from {Path(args.video).name}")
    if args.extract_only:
        for f in frames:
            print("  ", f)
        return 0

    best = None
    for f in frames:
        r = process(f)
        valid = not validate_result(r)
        n = len(r["proposals"])
        labels = ", ".join(f"{p['display_label']}({p['color_name']})" for p in r["proposals"])
        print(f"  {Path(f).name}: status={r['status']} valid={valid} items={n}  {labels}")
        if best is None or n > len(best[1]["proposals"]):
            best = (f, r)

    if args.publish and best:
        frame_path, _ = best
        rid = args.id
        dest = REQUESTS_DIR / f"{rid}.jpg"
        REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.copyfile(frame_path, dest)
        _atomic_write_json(REQUESTS_DIR / f"{rid}.request.json",
                           {"request_id": rid, "image_path": f"shared/requests/{rid}.jpg",
                            "source": f"video frame from {Path(args.video).name}"})
        # reprocess against the published path so image.path points into shared/
        result = process(str(dest), request_id=rid)
        _atomic_write_json(RESULTS_DIR / f"{rid}.result.json", result)
        print(f"\npublished best frame -> shared/requests/{rid}.jpg")
        print(f"published result     -> shared/results/{rid}.result.json "
              f"({len(result['proposals'])} proposals, status={result['status']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
