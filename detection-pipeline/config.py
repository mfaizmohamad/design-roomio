"""Central paths + constants for the Roomio detection pipeline (Agent B).

Everything is resolved relative to this file so the pipeline runs from any CWD.
Only ever reads/writes inside /detection-pipeline and /shared (isolation rule).
"""
from __future__ import annotations

from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent          # .../roomio/detection-pipeline
REPO_ROOT = PKG_DIR.parent                          # .../roomio
SHARED_DIR = REPO_ROOT / "shared"

REQUESTS_DIR = SHARED_DIR / "requests"
RESULTS_DIR = SHARED_DIR / "results"
SCHEMA_PATH = SHARED_DIR / "detection_schema.json"
ARCHETYPES_PATH = SHARED_DIR / "archetypes.json"
PALETTE_PATH = PKG_DIR / "palette" / "colors.json"

CONTRACT_VERSION = "1.0"

# Vision models (local, via Ollama). Primary = strong structured-output VLM;
# fallback = tiny model just to validate plumbing / when primary isn't pulled.
DEFAULT_MODEL = "qwen2.5vl:7b"
FALLBACK_MODEL = "moondream"

# Accepted request image extensions. (.heic/.heif decode via pillow-heif; see color.py.)
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif")

# Confidence below which a detection is demoted to the placeholder box.
MIN_ARCHETYPE_CONFIDENCE = 0.30

# Cap the longest side of the image handed to the VLM. Huge photos (e.g. 24 MP
# iPhone HEIC) produce too many vision tokens and overflow the model context;
# detection runs on the downscaled copy and color crops use the same array.
MAX_VLM_IMAGE_DIM = 1536

# Ollama context window for a vision request. The closed-set prompt embeds the
# full archetype-name list, so headroom above the 4096 default avoids overflow.
VLM_NUM_CTX = 8192
