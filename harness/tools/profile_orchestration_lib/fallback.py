"""Graceful fallback utilities for profile_orchestration_lib.

When S03 lib (lib/compiler_profile, lib/compile_eval, integrations/gepa_optimizer)
is not yet available, all view functions return {available: False, reason: "..."}
instead of raising exceptions or returning 5xx.
"""
from __future__ import annotations

import importlib
import logging
import warnings
from typing import Any

logger = logging.getLogger(__name__)

_S03_AVAILABLE: bool | None = None  # cached


def s03_available() -> bool:
    """Return True if S03 lib is importable. Cached after first call."""
    global _S03_AVAILABLE
    if _S03_AVAILABLE is None:
        try:
            importlib.import_module("lib.compiler_profile.registry")
            _S03_AVAILABLE = True
        except (ImportError, ModuleNotFoundError):
            _S03_AVAILABLE = False
    return _S03_AVAILABLE


def unavailable(reason: str | None = None) -> dict[str, Any]:
    """Return a canonical unavailable envelope for use in view functions."""
    msg = reason or "S03 lib not available (compiler_profile registry not importable)"
    warnings.warn(msg, stacklevel=2)
    logger.warning("profile_orchestration_lib fallback: %s", msg)
    return {"available": False, "reason": msg}
