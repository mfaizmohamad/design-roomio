"""Closed-set archetype corpus + label resolution (Stage 2 support).

The corpus is the closed label set, mirrored from Agent A in shared/archetypes.json.
This module is the single gate that GUARANTEES we only ever emit a valid archetype_id:
anything uncertain or off-corpus resolves to the fallback (misc-box), and clearly
non-furniture labels (doors, windows, people, decor clutter) resolve to None (skipped).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

from config import ARCHETYPES_PATH


@dataclass(frozen=True)
class Corpus:
    by_id: dict          # id -> {id, category, name, default_color_hex}
    fallback_id: str
    category_labels: dict  # category id -> label

    @property
    def valid_ids(self) -> frozenset:
        return frozenset(self.by_id)

    def is_valid(self, archetype_id: Optional[str]) -> bool:
        return archetype_id in self.by_id

    def display_label(self, archetype_id: str) -> str:
        return self.by_id.get(archetype_id, {}).get("name", archetype_id)

    def category(self, archetype_id: str) -> str:
        return self.by_id.get(archetype_id, {}).get("category", "misc")

    def default_color(self, archetype_id: str) -> str:
        return self.by_id.get(archetype_id, {}).get("default_color_hex", "#b7b2a8")


@lru_cache(maxsize=1)
def load_corpus() -> Corpus:
    data = json.loads(ARCHETYPES_PATH.read_text(encoding="utf-8"))
    by_id = {a["id"]: a for a in data["archetypes"]}
    fallback = data.get("fallback_id", "misc-box")
    if fallback not in by_id:  # defensive: never point fallback at a missing id
        fallback = next(iter(by_id))
    cat_labels = {c["id"]: c["label"] for c in data.get("categories", [])}
    return Corpus(by_id=by_id, fallback_id=fallback, category_labels=cat_labels)


# ── Deterministic keyword → archetype rules (Stage-2 fallback, no model call) ──
# Ordered most-specific → most-generic; first hit wins. Substring match on a
# normalized label. These encode "which corpus archetype does this coarse word
# most likely mean", not the corpus itself.
_RULES: list[tuple[tuple[str, ...], str]] = [
    # --- Sofas ---
    (("l-shaped", "l shaped", "sectional", "corner sofa", "corner couch"), "sofa-sectional"),
    (("loveseat", "love seat", "two-seater", "two seater", "2-seater", "2 seater"), "sofa-love"),
    (("recliner", "reclining"), "sofa-recliner"),
    (("sofa", "couch", "settee", "divan"), "sofa-3"),

    # --- Beds --- (specific sizes before generic "bed")
    (("king bed", "king-size", "king size", "super king"), "bed-king"),
    (("queen bed", "queen-size", "queen size", "double bed"), "bed-queen"),
    (("single bed", "twin bed", "twin-size", "twin size"), "bed-single"),
    (("bed", "mattress", "headboard"), "bed-queen"),

    # --- Tables --- (specific before generic; desk/ottoman have no corpus match)
    (("coffee table", "cocktail table", "centre table", "center table"), "table-coffee"),
    (("round dining", "round table"), "table-round"),
    (("dining table",), "table-dining"),
    (("side table", "end table", "nightstand", "night stand", "bedside table", "bedside"), "table-side"),
    (("desk", "writing table", "study table", "workstation"), "misc-box"),
    (("table",), "table-coffee"),

    # --- Chairs --- (specific before generic)
    (("office chair", "desk chair", "task chair", "swivel chair", "gaming chair", "computer chair"), "chair-office"),
    (("armchair", "arm chair", "wingback", "wing chair"), "chair-arm"),
    (("accent chair", "lounge chair", "occasional chair", "club chair"), "chair-accent"),
    (("dining chair", "side chair", "kitchen chair"), "chair-dining"),
    (("stool", "bar stool", "ottoman", "pouffe", "pouf", "footstool", "bench", "banquette"), "misc-box"),
    (("chair", "seat", "armchair"), "chair-dining"),

    # --- Storage ---
    (("wardrobe", "armoire", "closet", "almirah"), "storage-wardrobe"),
    (("bookcase", "bookshelf", "book shelf", "bookshelves", "shelving", "shelves", "shelf", "etagere", "étagère"), "storage-bookcase"),
    (("tv unit", "tv stand", "tv console", "tv cabinet", "media console", "media unit", "media center",
      "media centre", "entertainment center", "entertainment centre", "entertainment unit"), "storage-tv"),
    (("dresser", "chest of drawers", "drawers", "chest", "sideboard", "buffet", "credenza",
      "console table", "console"), "storage-dresser"),
    (("cabinet", "cupboard"), "storage-dresser"),
    (("tv", "television", "flat screen", "flatscreen"), "storage-tv"),  # bare TV → suggest the unit; user confirms

    # --- Decor ---
    (("floor lamp", "standing lamp", "torchiere", "torchere"), "decor-lamp"),
    (("rug", "carpet", "area rug", "runner rug", "floor mat"), "decor-rug"),
    (("lamp", "lantern"), "decor-lamp"),
    (("potted plant", "houseplant", "plant pot", "planter", "flowerpot", "flower pot",
      "fern", "palm tree", "succulent", "plant"), "decor-plant"),
]

# Clearly NOT furniture in Roomio's corpus → never propose (skip entirely).
# Openings (door/window) are handled by the front-end's Step 3, not here.
_NON_FURNITURE: frozenset = frozenset({
    "door", "doorway", "window", "windows", "wall", "floor", "ceiling", "roof",
    "person", "people", "human", "man", "woman", "child", "baby", "dog", "cat", "pet",
    "painting", "picture", "photo", "photograph", "poster", "artwork", "art", "frame",
    "wall art", "mirror", "clock", "curtain", "curtains", "drape", "drapes", "blind",
    "blinds", "fan", "ceiling fan", "radiator", "fireplace", "chandelier", "pendant",
    "pendant light", "sconce", "ceiling light", "spotlight", "vent", "outlet", "switch",
    "monitor", "screen", "laptop", "computer", "keyboard", "mouse", "phone", "remote",
    "book", "books", "magazine", "vase", "bottle", "cup", "mug", "bowl", "plate", "tray",
    "cushion", "pillow", "throw", "blanket", "towel", "basket", "box", "candle",
    "decoration", "ornament", "sculpture", "statue", "window sill", "windowsill",
    "kitchen", "sink", "stove", "oven", "refrigerator", "fridge", "microwave",
    "staircase", "stairs", "column", "pillar", "beam",
})


def _normalize(label: str) -> str:
    s = (label or "").strip().lower()
    s = re.sub(r"[_/]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s


@dataclass
class Resolution:
    archetype_id: Optional[str]   # None => skip (not corpus furniture)
    method: str                   # vlm-id | vlm-name | keyword | fallback-box | skip
    note: str = ""


def resolve_label(label: str, vlm_archetype: Optional[str] = None) -> Resolution:
    """Resolve a coarse detector label (and an optional VLM-proposed archetype id/name)
    to a valid archetype_id, the fallback box, or None (skip)."""
    corpus = load_corpus()
    norm = _normalize(label)

    # 1) Trust an explicit, valid archetype id from the VLM.
    if vlm_archetype and corpus.is_valid(vlm_archetype):
        return Resolution(vlm_archetype, "vlm-id")

    # 2) VLM may return a display name instead of an id ("3-Seater Sofa").
    if vlm_archetype:
        vlm_norm = _normalize(vlm_archetype)
        for aid, a in corpus.by_id.items():
            if _normalize(a["name"]) == vlm_norm:
                return Resolution(aid, "vlm-name")

    # 3) Explicit non-furniture → skip (openings, people, clutter, fixtures).
    if norm in _NON_FURNITURE:
        return Resolution(None, "skip", f"non-furniture label '{label}'")
    # token-level non-furniture catch (e.g. "wooden door", "glass window")
    tokens = set(norm.split())
    if tokens & {"door", "window", "person", "mirror", "curtain", "painting", "clock"}:
        return Resolution(None, "skip", f"non-furniture label '{label}'")

    # 4) Keyword rules on the coarse label.
    for keywords, aid in _RULES:
        if any(k in norm for k in keywords):
            if corpus.is_valid(aid):
                return Resolution(aid, "keyword")
            return Resolution(corpus.fallback_id, "fallback-box", f"mapped id '{aid}' not in corpus")

    # 5) Unknown but plausibly furniture → placeholder box (confirmable, never a crash).
    return Resolution(corpus.fallback_id, "fallback-box", f"no rule for '{label}'")


if __name__ == "__main__":
    c = load_corpus()
    print(f"corpus: {len(c.valid_ids)} ids, fallback={c.fallback_id}")
    for test in ["sofa", "couch", "L-shaped sectional", "loveseat", "king bed", "bed",
                 "coffee table", "dining table", "office chair", "armchair", "chair",
                 "wardrobe", "bookshelf", "tv stand", "tv", "dresser", "rug", "floor lamp",
                 "potted plant", "desk", "ottoman", "door", "window", "person", "vase",
                 "spaceship", "wooden door"]:
        r = resolve_label(test)
        lbl = c.display_label(r.archetype_id) if r.archetype_id else "—(skip)"
        print(f"  {test:22s} -> {str(r.archetype_id):16s} [{r.method}] {lbl}")
