"""Pareto frontier view — reads GEPA optimizer output or falls back gracefully."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fallback import s03_available, unavailable

HARNESS_DIR = Path.home() / ".solar" / "harness"
STATE_PARETO = HARNESS_DIR / "state" / "profile-orchestration" / "pareto.json"


def _load_state_pareto() -> list[dict]:
    if not STATE_PARETO.exists():
        return []
    try:
        data = json.loads(STATE_PARETO.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("candidates", [])
    except Exception:
        pass
    return []


def _from_s03_lib(frontier: str) -> list[dict]:
    import sys
    lib_dir = str(HARNESS_DIR / "lib")
    if lib_dir not in sys.path:
        sys.path.insert(0, lib_dir)
    from integrations.gepa_optimizer.pareto import get_frontier  # type: ignore
    raw = get_frontier(frontier=frontier)
    if not isinstance(raw, list):
        return []
    return [
        {
            "candidate_id": str(c.get("candidate_id") or ""),
            "profile_id": str(c.get("profile_id") or ""),
            "scores": c.get("scores") or {},
            "side_info": c.get("side_info") or {},
            "hard_fail": bool(c.get("hard_fail")),
        }
        for c in raw
    ]


def get_pareto(frontier: str = "current") -> dict[str, Any]:
    """Return Pareto frontier candidates. Falls back to state cache when S03 absent."""
    if s03_available():
        try:
            candidates = _from_s03_lib(frontier)
            return {"available": True, "candidates": candidates}
        except Exception as exc:
            return {"available": False, "reason": f"S03 lib error: {exc}", "candidates": []}

    cached = _load_state_pareto()
    if cached:
        return {"available": True, "candidates": cached, "source": "state_cache"}
    return {**unavailable(), "candidates": []}
