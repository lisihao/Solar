#!/usr/bin/env python3
"""Compatibility entry point for the canonical ActorRuntime implementation.

Historically this file duplicated ``lib/actor_runtime.py`` and could import a
different failure-fingerprint or APO module depending on ``sys.path`` order.
Execute the canonical source in this module namespace so legacy imports retain
normal monkeypatch behavior while all callers share one implementation.
"""
import sys
from pathlib import Path


_CANONICAL = Path(__file__).resolve().parents[1] / "lib" / "actor_runtime.py"
if str(_CANONICAL.parent) not in sys.path:
    sys.path.insert(0, str(_CANONICAL.parent))
globals()["__file__"] = str(_CANONICAL)
exec(compile(_CANONICAL.read_bytes(), str(_CANONICAL), "exec"), globals(), globals())
