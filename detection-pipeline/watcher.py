"""Watches shared/requests/ and writes shared/results/ (atomic handoff with Agent A).

Flow (brief §6.2): A drops shared/requests/<id>.<ext> (+ optional <id>.request.json);
we run the pipeline and write shared/results/<id>.result.json via .tmp + os.replace,
so A never reads a half-written file. Idempotent: an image is (re)processed only when
no fresh result exists. Per-request failures still emit an error result and never stop
the loop.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Optional

from config import IMAGE_EXTS, REQUESTS_DIR, RESULTS_DIR
from pipeline import process

# Ignore files written within the last N seconds (still being copied in).
SETTLE_SECONDS = 0.8


def _result_path(request_id: str) -> Path:
    return RESULTS_DIR / f"{request_id}.result.json"


def _atomic_write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2), encoding="utf-8")
    os.replace(tmp, path)  # atomic on POSIX


def _request_id_and_image(p: Path) -> tuple[str, str]:
    """Resolve (request_id, image_path) honoring an optional <id>.request.json sidecar."""
    request_id = p.stem
    image_path = str(p)
    sidecar = p.with_name(f"{p.stem}.request.json")
    if sidecar.exists():
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
            request_id = str(meta.get("request_id", request_id))
            ip = meta.get("image_path")
            if ip:
                cand = Path(ip)
                if not cand.is_absolute():
                    cand = (REQUESTS_DIR.parent.parent / ip)  # relative to repo root
                if cand.exists():
                    image_path = str(cand)
        except Exception:
            pass
    return request_id, image_path


def _pending_images(reprocess: bool, settle: float = SETTLE_SECONDS) -> list[Path]:
    if not REQUESTS_DIR.exists():
        return []
    now = time.time()
    out = []
    for p in sorted(REQUESTS_DIR.iterdir()):
        if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
            continue
        try:
            if settle > 0 and now - p.stat().st_mtime < settle:
                continue  # still settling (guards against reading a half-written file)
        except OSError:
            continue
        rid, _ = _request_id_and_image(p)
        res = _result_path(rid)
        if not reprocess and res.exists() and res.stat().st_mtime >= p.stat().st_mtime:
            continue  # already have a fresh result
        out.append(p)
    return out


def handle_one(p: Path, model: Optional[str], refine: bool, detector: str = "vlm") -> dict:
    rid, image_path = _request_id_and_image(p)
    t0 = time.perf_counter()
    try:
        result = process(image_path, request_id=rid, model=model, refine=refine, detector=detector)
    except Exception as e:  # process() shouldn't raise, but never let the loop die
        result = {
            "version": "1.0", "request_id": rid, "status": "error",
            "error": f"watcher caught: {type(e).__name__}: {e}", "generated_by": "agent_b",
            "model": model or "unknown", "image": {"path": image_path}, "proposals": [],
        }
    _atomic_write_json(_result_path(rid), result)
    dt = (time.perf_counter() - t0) * 1000.0
    print(f"[watcher] {rid}: status={result.get('status')} "
          f"proposals={len(result.get('proposals', []))} ({dt:.0f}ms) -> {_result_path(rid).name}")
    return result


def run_once(model: Optional[str], refine: bool, reprocess: bool, detector: str = "vlm",
             settle: float = SETTLE_SECONDS) -> int:
    # In one-shot mode (settle=0) we process every complete pending file immediately; in
    # continuous mode we let files settle first to avoid reading a half-written copy.
    pending = _pending_images(reprocess, settle=settle)
    for p in pending:
        handle_one(p, model, refine, detector)
    return len(pending)


def watch(interval: float, model: Optional[str], refine: bool, reprocess: bool, detector: str = "vlm") -> None:
    REQUESTS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[watcher] polling {REQUESTS_DIR} every {interval}s — drop an image to process. Ctrl-C to stop.")
    first = True
    while True:
        try:
            n = run_once(model, refine, reprocess and first, detector)
            first = False
            if n == 0:
                time.sleep(interval)
        except KeyboardInterrupt:
            print("\n[watcher] stopped.")
            return
        except Exception as e:
            print(f"[watcher] loop error (continuing): {e}")
            time.sleep(interval)


def main():
    ap = argparse.ArgumentParser(description="Roomio detection watcher (requests/ -> results/)")
    ap.add_argument("--once", action="store_true", help="process all pending then exit")
    ap.add_argument("--interval", type=float, default=1.5, help="poll interval seconds")
    ap.add_argument("--model", default=None, help="override Ollama model")
    ap.add_argument("--refine", action="store_true", help="second VLM pass for ambiguous classes")
    ap.add_argument("--detector", choices=("vlm", "yolo"), default="vlm",
                    help="Stage-1 detector; 'yolo' is opt-in (AGPL) and falls back to VLM")
    ap.add_argument("--reprocess", action="store_true", help="ignore existing results")
    args = ap.parse_args()
    if args.once:
        # one-shot: caller dropped files deliberately, so don't wait out the settle window
        n = run_once(args.model, args.refine, args.reprocess, args.detector, settle=0.0)
        print(f"[watcher] processed {n} pending request(s).")
    else:
        watch(args.interval, args.model, args.refine, args.reprocess, args.detector)


if __name__ == "__main__":
    main()
