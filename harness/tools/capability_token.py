"""capability_token.py — Re-export from lib/capability_token.py.

The authoritative implementation lives in lib/capability_token.py.
This stub ensures compatibility for callers that import from tools/.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_LIB_PATH = Path(__file__).resolve().parent.parent / "lib" / "capability_token.py"
_SPEC = importlib.util.spec_from_file_location("_solar_lib_capability_token", _LIB_PATH)
if _SPEC is None or _SPEC.loader is None:  # pragma: no cover - broken install
    raise ImportError(f"cannot load capability token implementation from {_LIB_PATH}")

_mod = importlib.util.module_from_spec(_SPEC)
sys.modules.setdefault("_solar_lib_capability_token", _mod)
_SPEC.loader.exec_module(_mod)
CapabilityToken = _mod.CapabilityToken
PolicyDecision = _mod.PolicyDecision
