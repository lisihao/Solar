"""Governance events view — reads compile_eval governance log or signals.jsonl."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .fallback import s03_available, unavailable

HARNESS_DIR = Path.home() / ".solar" / "harness"
SIGNALS_JSONL = HARNESS_DIR / "state" / "profile-orchestration" / "signals.jsonl"
GOVERNANCE_LOG = HARNESS_DIR / "state" / "profile-orchestration" / "governance.jsonl"

_GOV_TYPES = {"profile_promoted", "profile_canary", "profile_rolled_back",
               "profile_rejected", "profile_candidate_proposed"}


def _read_jsonl(path: Path, limit: int) -> list[dict]:
    if not path.exists():
        return []
    results: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in reversed(lines[-500:]):
            try:
                ev = json.loads(line)
            except Exception:
                continue
            etype = str(ev.get("type") or ev.get("event") or "")
            if any(t in etype for t in _GOV_TYPES) or etype.startswith("profile_"):
                results.append({
                    "ts": str(ev.get("ts") or ev.get("timestamp") or ""),
                    "type": etype,
                    "profile_id": str(ev.get("profile_id") or ""),
                    "digest": str(ev.get("digest") or ""),
                    "actor": str(ev.get("actor") or ""),
                    "reason": str(ev.get("reason") or ""),
                    "evidence": ev.get("evidence") or {},
                })
                if len(results) >= limit:
                    break
    except Exception:
        pass
    return list(reversed(results))


def _from_s03_lib(limit: int) -> list[dict]:
    import sys
    lib_dir = str(HARNESS_DIR / "lib")
    if lib_dir not in sys.path:
        sys.path.insert(0, lib_dir)
    from lib.compile_eval.governance import list_events  # type: ignore
    raw = list_events(limit=limit)
    if not isinstance(raw, list):
        return []
    return [
        {
            "ts": str(e.get("ts") or ""),
            "type": str(e.get("type") or ""),
            "profile_id": str(e.get("profile_id") or ""),
            "digest": str(e.get("digest") or ""),
            "actor": str(e.get("actor") or ""),
            "reason": str(e.get("reason") or ""),
            "evidence": e.get("evidence") or {},
        }
        for e in raw
    ]


def get_governance_events(limit: int = 50) -> dict[str, Any]:
    """Return governance events. Falls back to signals.jsonl when S03 absent."""
    if s03_available():
        try:
            events = _from_s03_lib(limit)
            return {"available": True, "events": events}
        except Exception as exc:
            return {"available": False, "reason": f"S03 lib error: {exc}", "events": []}

    events = _read_jsonl(GOVERNANCE_LOG, limit) or _read_jsonl(SIGNALS_JSONL, limit)
    if events:
        return {"available": True, "events": events, "source": "state_cache"}
    return {**unavailable(), "events": []}
