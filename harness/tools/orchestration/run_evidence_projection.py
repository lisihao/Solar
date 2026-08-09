"""tools/orchestration/run_evidence_projection.py — Mirror of lib/orchestration/run_evidence_projection.py.

Delegates entirely to the lib implementation so tools/ and lib/ stay in sync.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_LIB = Path(__file__).resolve().parents[2] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

_IMPL_PATH = _LIB / "orchestration" / "run_evidence_projection.py"
_SPEC = importlib.util.spec_from_file_location("solar_lib_run_evidence_projection", _IMPL_PATH)
if _SPEC is None or _SPEC.loader is None:
    raise ImportError(f"cannot load run evidence projection implementation: {_IMPL_PATH}")
_IMPL = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_IMPL)

_EXPORTS = (
    "DEGRADE_LEGACY_JSONL_ONLY",
    "DEGRADE_RUN_DIR_MISSING",
    "DEGRADE_MANIFEST_PARTIAL",
    "DEGRADE_MANIFEST_CORRUPT",
    "DEGRADE_SCRUB_FAILURE",
    "DEGRADE_CONCURRENT_NODES",
    "DEGRADE_SECRET_REDACTED",
    "_SOLAR_IR_AVAILABLE",
    "_TASK_STATUS_TO_EXECUTION_STATE",
    "project_run_evidence",
    "project_run_evidence_for_node",
    "project_node_to_execution_ir",
    "project_ledger_to_evidence_ir",
    "project_task_graph_to_ir",
)
globals().update({name: getattr(_IMPL, name) for name in _EXPORTS})

__all__ = list(_EXPORTS)
