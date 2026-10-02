"""Offline test suite for the Roomio detection pipeline (Agent B).

Runs with the stdlib only (no pytest, no Ollama model required) — these tests cover
the deterministic contract guarantees: closed-set ids, graceful fallback, color
naming, bbox coercion, schema validity, and atomic file handoff. The VLM path is
exercised separately by smoke_vlm.py once a vision model is pulled.

Run:  ./.venv/bin/python -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # import sibling modules

from archetypes import load_corpus, resolve_label  # noqa: E402
from classify import classify  # noqa: E402
from color import dominant_color, nearest_name, crop_region, _hex_to_rgb  # noqa: E402
from config import MIN_ARCHETYPE_CONFIDENCE  # noqa: E402
from detect import Detection, _coerce_bbox, parse_detections  # noqa: E402
from detect_yolo import detect_yolo, yolo_available  # noqa: E402
from pipeline import process, validate_result  # noqa: E402


class TestCorpus(unittest.TestCase):
    def test_loads_and_fallback_valid(self):
        c = load_corpus()
        # Corpus is JSON-driven and grows as Agent A extends the catalog (23 → 91 → …),
        # so assert a sensible floor rather than an exact count that drifts.
        self.assertGreaterEqual(len(c.valid_ids), 23)
        self.assertTrue(c.is_valid(c.fallback_id))
        self.assertEqual(c.fallback_id, "misc-box")

    def test_closed_set_guarantee(self):
        c = load_corpus()
        labels = ["sofa", "couch", "sectional", "loveseat", "recliner", "bed", "king bed",
                  "coffee table", "dining table", "round table", "side table", "nightstand",
                  "chair", "office chair", "armchair", "accent chair", "wardrobe", "bookshelf",
                  "tv unit", "tv", "dresser", "cabinet", "rug", "floor lamp", "lamp",
                  "potted plant", "desk", "ottoman", "stool", "bench", "spaceship", "xyzzy", ""]
        for label in labels:
            r = resolve_label(label)
            self.assertTrue(r.archetype_id is None or c.is_valid(r.archetype_id),
                            f"{label!r} -> off-corpus id {r.archetype_id!r}")

    def test_non_furniture_skipped(self):
        for label in ["door", "window", "wooden door", "person", "mirror", "curtain",
                      "vase", "painting", "clock"]:
            self.assertIsNone(resolve_label(label).archetype_id, f"{label} should skip")

    def test_representative_mappings(self):
        cases = {"couch": "sofa-3", "loveseat": "sofa-love", "L-shaped sectional": "sofa-sectional",
                 "king bed": "bed-king", "coffee table": "table-coffee", "office chair": "chair-office",
                 "bookshelf": "storage-bookcase", "tv stand": "storage-tv", "rug": "decor-rug",
                 "potted plant": "decor-plant", "ottoman": "misc-box"}
        for label, expected in cases.items():
            self.assertEqual(resolve_label(label).archetype_id, expected, label)


class TestClassify(unittest.TestCase):
    def test_low_confidence_demotes_to_box(self):
        d = Detection(label="chair", bbox=[0, 0, 10, 10], confidence=0.10)
        out = classify(d)
        self.assertEqual(out["archetype_id"], "misc-box")

    def test_vlm_name_hint_trusted(self):
        d = Detection(label="sofa", bbox=[0, 0, 10, 10], confidence=0.9, archetype_hint="L-Shaped Sectional")
        self.assertEqual(classify(d)["archetype_id"], "sofa-sectional")

    def test_non_furniture_returns_none(self):
        d = Detection(label="door", bbox=[0, 0, 10, 10], confidence=0.9)
        self.assertIsNone(classify(d))

    def test_confidence_in_range(self):
        for cf in (0.0, 0.3, 0.5, 1.0):
            d = Detection(label="sofa", bbox=[0, 0, 10, 10], confidence=cf)
            out = classify(d)
            if out:
                self.assertGreaterEqual(out["confidence"], 0.0)
                self.assertLessEqual(out["confidence"], 1.0)


class TestColor(unittest.TestCase):
    def test_named_swatches(self):
        cases = {"#8a9a7b": "sage green", "#5c4033": "walnut brown",
                 "#2b3a55": "navy", "#f5efd9": "cream", "#b7b2a8": "greige"}
        for hexv, name in cases.items():
            self.assertEqual(nearest_name(_hex_to_rgb(hexv)), name, hexv)

    def test_dominant_rejects_white_background(self):
        # mostly white image with a sage-green block in the center
        img = np.full((100, 100, 3), 250, dtype=np.uint8)
        img[30:70, 30:70] = _hex_to_rgb("#8a9a7b")
        out = dominant_color(img)
        self.assertNotIn(out["name"], ("white", "off-white"))
        self.assertIn("green", out["name"])

    def test_prefers_chromatic_object_over_pale_neutral_background(self):
        # ~60% pale-gray wall/clutter, ~40% dark walnut wood → should name the wood, not the gray
        # (mirrors the china-cabinet / cluttered-coffee-table cases from the qwen eval).
        img = np.full((100, 100, 3), _hex_to_rgb("#cccccc"), dtype=np.uint8)
        img[:, :40] = _hex_to_rgb("#4e342e")  # dark brown column
        out = dominant_color(img)
        self.assertLess(sum(out["rgb"]), 350, f"expected dark wood, got {out}")

    def test_degenerate_crop_safe(self):
        self.assertIsInstance(dominant_color(np.zeros((0, 0, 3), dtype=np.uint8))["hex"], str)
        self.assertIsInstance(dominant_color(np.full((1, 1, 3), 120, dtype=np.uint8))["hex"], str)

    def test_crop_region_clamps(self):
        img = np.zeros((50, 80, 3), dtype=np.uint8)
        crop = crop_region(img, [-10, -10, 1000, 1000])  # out of bounds → clamped
        self.assertEqual(crop.shape[:2], (50, 80))


class TestBBox(unittest.TestCase):
    def test_normalized_to_pixels(self):
        self.assertEqual(_coerce_bbox([0.1, 0.2, 0.5, 0.4], 1000, 1000), [100.0, 200.0, 500.0, 400.0])

    def test_xyxy_corners_detected(self):
        # [x1,y1,x2,y2] with x2+x1 > 1.3*W → treated as corners
        out = _coerce_bbox([700, 100, 950, 600], 1000, 800)
        self.assertEqual(out, [700.0, 100.0, 250.0, 500.0])

    def test_clamped_to_image(self):
        out = _coerce_bbox([900, 700, 500, 500], 1000, 800)
        self.assertLessEqual(out[0] + out[2], 1000)
        self.assertLessEqual(out[1] + out[3], 800)

    def test_garbage_rejected(self):
        self.assertIsNone(_coerce_bbox([1, 2], 100, 100))
        self.assertIsNone(_coerce_bbox("nope", 100, 100))


class TestParseDetections(unittest.TestCase):
    def test_parses_list_and_skips_garbage(self):
        data = [
            {"label": "sofa", "archetype": "Loveseat", "bbox": [10, 20, 100, 80], "confidence": 0.8},
            {"label": "", "archetype": "none"},                 # empty → dropped
            "garbage",                                           # non-dict → dropped
            {"label": "plant", "bbox": [0.1, 0.1, 0.2, 0.2], "confidence": 0.5},
        ]
        dets = parse_detections(data, 1000, 1000)
        self.assertEqual(len(dets), 2)
        self.assertEqual(dets[0].label, "sofa")

    def test_wrapped_object(self):
        dets = parse_detections({"items": [{"label": "rug", "bbox": [0, 0, 10, 10]}]}, 100, 100)
        self.assertEqual(len(dets), 1)


class TestPipelineContract(unittest.TestCase):
    def test_missing_image_is_schema_valid_error(self):
        r = process("/does/not/exist.jpg", request_id="t1")
        self.assertEqual(r["status"], "error")
        self.assertEqual(validate_result(r), [])
        self.assertEqual(r["proposals"], [])

    def test_schema_example_validates(self):
        schema = json.loads(Path(__file__).resolve().parent.parent.parent
                            .joinpath("shared/detection_schema.json").read_text())
        self.assertEqual(validate_result(schema["examples"][0]), [])

    def test_assembled_proposals_are_all_valid_ids(self):
        # simulate detections → classify → ensure every emitted id is in the corpus
        c = load_corpus()
        dets = [Detection(label=l, bbox=[0, 0, 10, 10], confidence=0.8)
                for l in ["sofa", "coffee table", "potted plant", "tv", "ottoman", "spaceship"]]
        for d in dets:
            out = classify(d)
            if out:
                self.assertTrue(c.is_valid(out["archetype_id"]))


class TestYoloOptional(unittest.TestCase):
    def test_unavailable_degrades_to_empty(self):
        # ultralytics is not a default dependency: the opt-in detector must return [] (never raise)
        # so the pipeline can transparently fall back to the VLM path.
        if yolo_available():
            self.skipTest("ultralytics installed; fallback path not exercised")
        self.assertEqual(detect_yolo("tests/fixtures/whatever.jpg", 100, 100), [])


class TestWatcherAtomic(unittest.TestCase):
    def test_atomic_write_no_tmp_left(self):
        import tempfile
        from watcher import _atomic_write_json
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "x.result.json"
            _atomic_write_json(p, {"version": "1.0", "ok": True})
            self.assertTrue(p.exists())
            self.assertFalse(p.with_suffix(p.suffix + ".tmp").exists())
            self.assertEqual(json.loads(p.read_text())["version"], "1.0")

    def test_one_shot_ignores_settle_window(self):
        # A just-dropped file is skipped by the continuous settle window but MUST be picked up in
        # one-shot mode (settle=0) — regression for --once silently processing nothing.
        import tempfile
        import watcher
        with tempfile.TemporaryDirectory() as td:
            orig = watcher.REQUESTS_DIR
            watcher.REQUESTS_DIR = Path(td)
            try:
                (Path(td) / "fresh.jpg").write_bytes(b"\xff\xd8\xff\xe0fake")
                self.assertEqual(len(watcher._pending_images(reprocess=True, settle=10.0)), 0)
                self.assertEqual(len(watcher._pending_images(reprocess=True, settle=0.0)), 1)
            finally:
                watcher.REQUESTS_DIR = orig


class TestEdgeCases(unittest.TestCase):
    """The suggestion layer must degrade gracefully on bad input — never raise."""

    def test_corrupt_image_degrades_to_error(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "broken.jpg"
            p.write_bytes(b"not a real jpeg " * 8)  # undecodable
            r = process(str(p), request_id="broken")
            self.assertEqual(r["status"], "error")
            self.assertEqual(validate_result(r), [])
            self.assertEqual(r["proposals"], [])

    def test_empty_proposals_ok_is_schema_valid(self):
        # a frame with no detectable furniture → status ok, proposals [] (mirrors a transition frame)
        r = {"version": "1.0", "request_id": "x", "status": "ok", "error": None,
             "generated_by": "agent_b", "model": "qwen2.5vl:7b", "proposals": []}
        self.assertEqual(validate_result(r), [])

    def test_watcher_ignores_non_image_files(self):
        import tempfile
        import watcher
        with tempfile.TemporaryDirectory() as td:
            orig = watcher.REQUESTS_DIR
            watcher.REQUESTS_DIR = Path(td)
            try:
                (Path(td) / "notes.txt").write_text("hi")
                (Path(td) / "a.request.json").write_text("{}")
                self.assertEqual(watcher._pending_images(reprocess=True, settle=0.0), [])
            finally:
                watcher.REQUESTS_DIR = orig

    def test_sidecar_request_id_override(self):
        import tempfile
        import watcher
        with tempfile.TemporaryDirectory() as td:
            orig = watcher.REQUESTS_DIR
            watcher.REQUESTS_DIR = Path(td)
            try:
                img = Path(td) / "img123.jpg"
                img.write_bytes(b"\xff\xd8\xff\xe0")
                (Path(td) / "img123.request.json").write_text(json.dumps({"request_id": "custom-id"}))
                rid, _ = watcher._request_id_and_image(img)
                self.assertEqual(rid, "custom-id")
            finally:
                watcher.REQUESTS_DIR = orig


if __name__ == "__main__":
    unittest.main(verbosity=2)
