"""resolver.py — Auditable active profile resolution with precedence chain.

This is the tools/ mirror of lib.compiler_profile.resolver.
It re-exports the canonical implementation from lib.
"""
from __future__ import annotations

# Import canonical implementation from lib
import importlib
import sys
from pathlib import Path

_lib_dir = str(Path(__file__).resolve().parent.parent.parent / "lib")
if _lib_dir not in sys.path:
    sys.path.insert(0, _lib_dir)

from compiler_profile.resolver import (  # noqa: E402
    BUILTIN_DEFAULT_PROFILE_ID,
    ResolutionTrace,
    RuntimeMetadata,
    resolve_active_profile,
)

__all__ = [
    "resolve_active_profile",
    "RuntimeMetadata",
    "ResolutionTrace",
    "BUILTIN_DEFAULT_PROFILE_ID",
]
