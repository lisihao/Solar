#!/usr/bin/env python3
"""Compatibility entry point for the canonical APO plan compiler."""
import sys
from pathlib import Path


_CANONICAL = Path(__file__).resolve().parents[1] / "lib" / "apo_plan_compiler.py"
if str(_CANONICAL.parent) not in sys.path:
    sys.path.insert(0, str(_CANONICAL.parent))
globals()["__file__"] = str(_CANONICAL)
exec(compile(_CANONICAL.read_bytes(), str(_CANONICAL), "exec"), globals(), globals())
