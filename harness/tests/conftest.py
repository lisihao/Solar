"""Conftest for research tests.

The survey quality gates need the real ``research.evaluator.audit_sources``.
Older tests used a module stub to break an import cycle, but that silently
disabled source-authority checks for the survey finalizer.
"""

from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

import pytest

_HARNESS_LIB = str(Path(__file__).resolve().parents[1] / "lib")
if _HARNESS_LIB not in sys.path:
    sys.path.insert(0, _HARNESS_LIB)

try:
    importlib.import_module("research.evaluator")
except Exception:
    if "research.evaluator" not in sys.modules:
        _mod = types.ModuleType("research.evaluator")
        _mod.audit_sources = lambda *a, **k: {}
        sys.modules["research.evaluator"] = _mod


@pytest.fixture(autouse=True)
def _isolate_operator_cooldown_db(monkeypatch, tmp_path):
    """Never let a test write operator cooldown evidence into the live ledger."""
    db_path = tmp_path / "operator-cooldowns.sqlite"
    monkeypatch.setenv("SOLAR_OPERATOR_COOLDOWN_DB", str(db_path))
    cooldown_db = importlib.import_module("operator_cooldown_db")
    monkeypatch.setattr(cooldown_db, "DEFAULT_DB_PATH", db_path)
