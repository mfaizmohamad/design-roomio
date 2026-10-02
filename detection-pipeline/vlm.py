"""Thin, defensive wrapper around the local Ollama vision daemon.

Goals: pick whatever vision model is actually pulled, call it deterministically,
and robustly extract JSON from its reply. Every failure path returns a sentinel
(None / empty) rather than raising into the pipeline — detection is suggestion-only.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Optional

from config import DEFAULT_MODEL, FALLBACK_MODEL, VLM_NUM_CTX


class VLMUnavailable(RuntimeError):
    """Raised only by callers that explicitly require a model and find none."""


@lru_cache(maxsize=1)
def available_models() -> tuple[str, ...]:
    """Names of models currently pulled in the local Ollama, or () if daemon down."""
    try:
        import ollama
        resp = ollama.list()
        models = getattr(resp, "models", None) or resp.get("models", [])
        names = []
        for m in models:
            name = getattr(m, "model", None) or (m.get("model") if isinstance(m, dict) else None) \
                or getattr(m, "name", None) or (m.get("name") if isinstance(m, dict) else None)
            if name:
                names.append(name)
        return tuple(names)
    except Exception:
        return tuple()


def _matches(have: str, want: str) -> bool:
    # tolerate :latest suffix and tag-less requests
    return have == want or have.split(":")[0] == want.split(":")[0] or have.startswith(want)


def pick_model(preferred: Optional[str] = None) -> Optional[str]:
    """First available model among preferred → DEFAULT → FALLBACK → any vision-ish model."""
    have = available_models()
    if not have:
        return None
    wishlist = [m for m in (preferred, DEFAULT_MODEL, FALLBACK_MODEL) if m]
    for want in wishlist:
        for h in have:
            if _matches(h, want):
                return h
    # last resort: any model whose name hints at vision
    for h in have:
        if any(t in h.lower() for t in ("vl", "vision", "llava", "moondream", "qwen2.5vl")):
            return h
    return None


def extract_json(text: str):
    """Pull the first JSON array or object out of a (possibly fenced/chatty) reply."""
    if not text:
        return None
    # strip ```json ... ``` fences
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    candidate = fence.group(1).strip() if fence else text.strip()

    # try the whole thing first
    for attempt in (candidate, text.strip()):
        try:
            return json.loads(attempt)
        except Exception:
            pass

    # fall back to the widest balanced [...] or {...} span
    for open_ch, close_ch in (("[", "]"), ("{", "}")):
        start = candidate.find(open_ch)
        end = candidate.rfind(close_ch)
        if 0 <= start < end:
            blob = candidate[start:end + 1]
            try:
                return json.loads(blob)
            except Exception:
                # tolerate trailing commas
                cleaned = re.sub(r",\s*([}\]])", r"\1", blob)
                try:
                    return json.loads(cleaned)
                except Exception:
                    continue
    return None


def chat_image(model: str, prompt: str, image_path: str,
               temperature: float = 0.0, timeout: Optional[float] = 300.0,
               num_predict: int = 1024) -> Optional[str]:
    """Single-turn vision chat. Returns raw text, or None on any error.

    Timeout is generous (300s) because the first call to a large model (e.g. qwen2.5vl:7b)
    pays a one-time load cost. num_predict is bounded high so a long multi-item JSON list
    isn't truncated into invalid JSON.
    """
    try:
        import ollama
        client = ollama.Client(timeout=timeout) if timeout else ollama.Client()
        resp = client.chat(
            model=model,
            messages=[{"role": "user", "content": prompt, "images": [image_path]}],
            options={"temperature": temperature, "num_predict": num_predict, "num_ctx": VLM_NUM_CTX},
        )
        msg = getattr(resp, "message", None)
        if msg is not None:
            return getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else None)
        return resp["message"]["content"]
    except Exception as e:
        print(f"[vlm] chat_image failed on {model}: {e}")
        return None


if __name__ == "__main__":
    print("available:", available_models())
    print("picked   :", pick_model())
    print("json test:", extract_json('prefix ```json\n[{"a":1,}]\n``` suffix'))
