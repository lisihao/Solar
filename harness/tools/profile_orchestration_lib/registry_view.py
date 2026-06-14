"""Profile registry view — reads compiler_profile registry or falls back gracefully."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fallback import s03_available, unavailable

HARNESS_DIR = Path.home() / ".solar" / "harness"
STATE_REGISTRY = HARNESS_DIR / "state" / "profile-orchestration" / "registry.json"


def _load_state_registry() -> list[dict]:
    """Read locally cached registry snapshot written by autopilot hooks."""
    if not STATE_REGISTRY.exists():
        return []
    try:
        data = json.loads(STATE_REGISTRY.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("profiles", [])
    except Exception:
        pass
    return []


def _from_s03_lib() -> list[dict]:
    """Attempt to read live registry from S03 compiler_profile lib."""
    import sys
    lib_dir = str(HARNESS_DIR / "lib")
    if lib_dir not in sys.path:
        sys.path.insert(0, lib_dir)
    from lib.compiler_profile.registry import list_profiles  # type: ignore
    raw = list_profiles()
    if not isinstance(raw, list):
        return []
    return [
        {
            "id": str(p.get("id") or p.get("profile_id") or ""),
            "version": str(p.get("version") or ""),
            "digest": str(p.get("digest") or ""),
            "active": bool(p.get("active")),
            "owner": str(p.get("owner") or ""),
            "created_at": str(p.get("created_at") or ""),
        }
        for p in raw
    ]


def get_registry() -> dict[str, Any]:
    """Return profile registry. Falls back to state cache when S03 lib absent."""
    if s03_available():
        try:
            profiles = _from_s03_lib()
            return {"available": True, "profiles": profiles}
        except Exception as exc:
            return {"available": False, "reason": f"S03 lib error: {exc}", "profiles": []}

    cached = _load_state_registry()
    if cached:
        return {"available": True, "profiles": cached, "source": "state_cache"}
    return {**unavailable(), "profiles": []}
