"""Stage 3 — dominant color of a region (OpenCV + scikit-learn k-means).

Crop the bbox, sample the central area (furniture usually fills the box center),
cluster pixels in CIELAB, discard low-coverage near-white / near-black background
clusters, take the dominant remaining centroid, and name it by nearest palette match.
Returns both a hex and a human name ("sage green"). Pure/CPU — no model needed.
"""
from __future__ import annotations

import json
import os
import tempfile
from functools import lru_cache
from typing import Optional

os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")  # quiet imread warnings on bad paths
import cv2
import numpy as np
from sklearn.cluster import KMeans

from config import PALETTE_PATH

# iPhone photos are HEIC/HEIF. Register the PIL opener when the plugin is installed
# so load_image_rgb() can decode them by content; if it's absent we degrade to prior
# behavior (HEIC simply won't decode) rather than crash.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:
    pass


# ───────────────────────────── palette ─────────────────────────────
def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _rgb_to_hex(rgb) -> str:
    r, g, b = (int(max(0, min(255, round(v)))) for v in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def _rgb_to_lab(rgb_arr: np.ndarray) -> np.ndarray:
    """rgb_arr: (N,3) uint8/float in 0..255 RGB -> (N,3) CIELAB float."""
    arr = np.asarray(rgb_arr, dtype=np.uint8).reshape(-1, 1, 3)
    lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    return lab


@lru_cache(maxsize=1)
def _palette():
    data = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
    names = [c["name"] for c in data["colors"]]
    rgbs = np.array([_hex_to_rgb(c["hex"]) for c in data["colors"]], dtype=np.uint8)
    labs = _rgb_to_lab(rgbs)
    return names, rgbs, labs


def nearest_name(rgb) -> str:
    """Nearest palette name to an RGB triple, by CIE76 ΔE in LAB."""
    names, _, labs = _palette()
    lab = _rgb_to_lab(np.array([rgb], dtype=np.uint8))[0]
    d = np.linalg.norm(labs - lab, axis=1)
    return names[int(np.argmin(d))]


# ───────────────────────────── extraction ─────────────────────────────
def crop_region(image_rgb: np.ndarray, bbox) -> np.ndarray:
    """bbox = [x, y, w, h] in pixels (top-left origin). Clamped to image bounds."""
    h_img, w_img = image_rgb.shape[:2]
    x, y, w, h = bbox
    x0 = int(max(0, min(w_img - 1, round(x))))
    y0 = int(max(0, min(h_img - 1, round(y))))
    x1 = int(max(x0 + 1, min(w_img, round(x + w))))
    y1 = int(max(y0 + 1, min(h_img, round(y + h))))
    return image_rgb[y0:y1, x0:x1]


def _is_background(rgb, lab) -> bool:
    """Near-white or near-black + low-chroma clusters are usually wall/floor/shadow."""
    L, a, b = lab
    chroma = float(np.hypot(a - 128.0, b - 128.0))  # OpenCV LAB centers a/b at 128
    if L >= 232 and chroma < 18:   # near white
        return True
    if L <= 30 and chroma < 18:    # near black
        return True
    return False


def dominant_color(
    crop_rgb: np.ndarray,
    k: int = 5,
    min_coverage: float = 0.06,
    center_inset: float = 0.12,
    max_dim: int = 140,
) -> dict:
    """Return {hex, name, rgb, coverage} for the dominant non-background color.

    Robust to tiny/empty crops; never raises on a degenerate region.
    """
    fallback = {"hex": "#b7b2a8", "name": "greige", "rgb": [183, 178, 168], "coverage": 0.0}
    if crop_rgb is None or crop_rgb.size == 0:
        return fallback

    img = crop_rgb
    h, w = img.shape[:2]

    # central inset: bias toward the object, away from surrounding wall/floor
    if min(h, w) > 8 and center_inset > 0:
        iy, ix = int(h * center_inset), int(w * center_inset)
        sub = img[iy:h - iy, ix:w - ix]
        if sub.size > 0:
            img = sub
        h, w = img.shape[:2]

    # downsample for speed
    scale = max_dim / float(max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))),
                         interpolation=cv2.INTER_AREA)

    pixels = img.reshape(-1, 3).astype(np.float32)
    n = len(pixels)
    if n == 0:
        return fallback
    if n < 8:  # too few pixels to cluster meaningfully
        mean_rgb = pixels.mean(axis=0)
        return {"hex": _rgb_to_hex(mean_rgb), "name": nearest_name(mean_rgb),
                "rgb": [int(v) for v in mean_rgb.round()], "coverage": 1.0}

    kk = int(min(k, max(2, n // 4), len(np.unique(pixels, axis=0))))
    kk = max(1, kk)
    km = KMeans(n_clusters=kk, n_init=4, max_iter=50, random_state=0)
    labels = km.fit_predict(pixels)
    centers = km.cluster_centers_  # RGB
    counts = np.bincount(labels, minlength=kk).astype(float)
    fracs = counts / counts.sum()
    labs = _rgb_to_lab(centers)

    order = np.argsort(-fracs)  # largest first

    def _chroma(i: int) -> float:
        return float(np.hypot(labs[i][1] - 128.0, labs[i][2] - 128.0))

    def _light_neutral(i: int) -> bool:
        # pale gray/greige (e.g. a wall, lace cloth, or papers behind/atop furniture)
        return labs[i][0] >= 190.0 and _chroma(i) < 14.0

    # Candidates = non-background clusters above the coverage floor, largest first.
    candidates = [int(i) for i in order
                  if not _is_background(centers[i], labs[i]) and fracs[i] >= min_coverage]
    if not candidates:
        # Crop really is white/black (e.g. a white sofa) → largest cluster so we still name it.
        best = int(order[0])
    else:
        best = candidates[0]
        # Rescue: if the dominant cluster is a PALE neutral (likely a wall, lace cloth, or papers
        # behind/atop the object, not the object itself), prefer the largest cluster that is NOT a
        # pale neutral (a darker or chromatic surface) when it has meaningful coverage. This
        # recovers dark-wood furniture (cabinets, cluttered coffee tables) buried under light
        # surroundings, while leaving genuinely white/pale items alone (then no alternative exists).
        if _light_neutral(best):
            alt = [i for i in candidates if not _light_neutral(i) and fracs[i] >= 0.15]
            if alt:
                best = max(alt, key=lambda i: fracs[i])

    rgb = centers[best]
    return {
        "hex": _rgb_to_hex(rgb),
        "name": nearest_name(rgb),
        "rgb": [int(v) for v in np.round(rgb)],
        "coverage": round(float(fracs[best]), 3),
    }


def load_image_rgb(path: str) -> Optional[np.ndarray]:
    """Decode an image to an RGB ndarray, honoring EXIF orientation. None on failure."""
    try:
        from PIL import Image, ImageOps
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            return np.asarray(im)
    except Exception:
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        if bgr is None:
            return None
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


# Image formats Ollama's built-in loader (stb_image) decodes directly. Anything
# else (HEIC/HEIF, WEBP, …) must be re-encoded before we hand it to the VLM.
_VLM_SAFE_FORMATS = {"JPEG", "JPG", "PNG", "BMP", "GIF"}


def downscale_max(rgb: np.ndarray, max_dim: int) -> np.ndarray:
    """Downscale an RGB array so its longest side is <= max_dim (no-op if already)."""
    h, w = rgb.shape[:2]
    longest = max(h, w)
    if max_dim <= 0 or longest <= max_dim:
        return rgb
    scale = max_dim / float(longest)
    return cv2.resize(
        rgb,
        (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
        interpolation=cv2.INTER_AREA,
    )


def vlm_readable_path(
    image_path: str, rgb: np.ndarray, force_reencode: bool = False
) -> tuple[str, Optional[str]]:
    """Return (path_to_hand_the_VLM, temp_path_to_delete_or_None).

    Ollama cannot read HEIC/HEIF/WEBP. We detect the source format by CONTENT
    (the upload server names every request `.jpg` regardless of bytes); when it
    isn't directly readable — or when the caller downscaled the working image
    (`force_reencode`) — we re-encode the already-decoded `rgb` array to a temp
    JPEG. `rgb` is the pipeline's working image, so VLM pixel bboxes line up with
    the crops used for color. The caller deletes the returned temp path.
    """
    if not force_reencode:
        fmt = None
        try:
            from PIL import Image
            with Image.open(image_path) as im:
                fmt = (im.format or "").upper()
        except Exception:
            fmt = None
        if fmt in _VLM_SAFE_FORMATS:
            return image_path, None
    tmp = tempfile.NamedTemporaryFile(prefix="roomio_vlm_", suffix=".jpg", delete=False)
    tmp.close()
    cv2.imwrite(tmp.name, cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    return tmp.name, tmp.name


if __name__ == "__main__":
    # synthetic self-test: solid swatches should name sensibly
    for name, hexv in [("sage", "#8a9a7b"), ("walnut", "#5c4033"), ("navy", "#2b3a55"),
                       ("cream", "#f5efd9"), ("charcoal", "#3a3d42"), ("greige", "#b7b2a8")]:
        rgb = _hex_to_rgb(hexv)
        swatch = np.full((60, 60, 3), rgb, dtype=np.uint8)
        d = dominant_color(swatch)
        print(f"{name:10s} {hexv} -> {d['name']:14s} {d['hex']} cov={d['coverage']}")
