"""Attempt Ledger — tools/evidence wrapper for the core attempt_ledger module.

Re-exports the canonical AttemptLedger, AttemptRecord and helpers from
``lib/attempt_ledger.py`` so that callers under ``tools/evidence/`` can
import from the evidence-package path while the single implementation
remains in ``lib/``.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_LIB_MODULE = Path(__file__).resolve().parents[2] / "lib" / "attempt_ledger.py"
_MODULE_NAME = "attempt_ledger_core"


def _load_lib_module():
    if _MODULE_NAME in sys.modules:
        return sys.modules[_MODULE_NAME]
    spec = importlib.util.spec_from_file_location(_MODULE_NAME, str(_LIB_MODULE))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[_MODULE_NAME] = mod
    spec.loader.exec_module(mod)
    return mod


_mod = _load_lib_module()
SCHEMA_VERSION = _mod.SCHEMA_VERSION
VALID_MODES = _mod.VALID_MODES
VALID_STATUSES = _mod.VALID_STATUSES
AttemptLedger = _mod.AttemptLedger
AttemptRecord = _mod.AttemptRecord
get_default_ledger = _mod.get_default_ledger
record_runtime_attempt = _mod.record_runtime_attempt

__all__ = [
    "SCHEMA_VERSION",
    "VALID_MODES",
    "VALID_STATUSES",
    "AttemptLedger",
    "AttemptRecord",
    "get_default_ledger",
    "record_runtime_attempt",
]
