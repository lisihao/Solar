"""asi_components — Per-policy ASI builders and aggregator.

Six builders, one per compiler-profile policy slot:
  intake, requirement_ir, contract_compiler,
  dag_compiler, evidence, handoff

Each builder returns a dict with:
  signals        — list[str]  observed positive/neutral signals
  errors         — list[str]  observed problems / missing items
  score_breakdown — dict[str, float]  sub-dimension scores
  diagnostics    — dict[str, Any]     raw evidence used for scoring

The aggregator ``build_component_asi`` collects all six and enforces
MAX_ASI_BYTES = 65536 with a JSON-safe truncation strategy.
"""
from __future__ import annotations

import json
from typing import Any

from .intake import build_intake_asi
from .requirement_ir import build_requirement_ir_asi
from .contract_compiler import build_contract_compiler_asi
from .dag_compiler import build_dag_compiler_asi
from .evidence import build_evidence_asi
from .handoff import build_handoff_asi

MAX_ASI_BYTES: int = 65536

_POLICY_SLOTS = (
    "intake",
    "requirement_ir",
    "contract_compiler",
    "dag_compiler",
    "evidence",
    "handoff",
)

__all__ = [
    "build_component_asi",
    "MAX_ASI_BYTES",
    "build_intake_asi",
    "build_requirement_ir_asi",
    "build_contract_compiler_asi",
    "build_dag_compiler_asi",
    "build_evidence_asi",
    "build_handoff_asi",
]


def build_component_asi(
    artifacts: dict[str, Any],
    traces: dict[str, Any],
    profile: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Build all six per-policy ASI component dicts and return as an aggregate.

    Parameters
    ----------
    artifacts : dict
        Compiled requirement artifacts (requirement_ir, contracts, dag, …).
    traces : dict
        Planner/builder/evaluator traces from the compilation run.
    profile : dict
        The compiler profile that was used for the compilation.

    Returns
    -------
    dict with exactly six keys (one per policy slot).
    Each value has keys: signals, errors, score_breakdown, diagnostics.

    The total serialised payload is truncated to MAX_ASI_BYTES (65536 bytes)
    if necessary; a ``"__truncated__": True`` flag is injected at top level
    when truncation occurs.
    """
    result: dict[str, Any] = {
        "intake": build_intake_asi(artifacts, traces, profile),
        "requirement_ir": build_requirement_ir_asi(artifacts, traces, profile),
        "contract_compiler": build_contract_compiler_asi(artifacts, traces, profile),
        "dag_compiler": build_dag_compiler_asi(artifacts, traces, profile),
        "evidence": build_evidence_asi(artifacts, traces, profile),
        "handoff": build_handoff_asi(artifacts, traces, profile),
    }

    # Enforce byte budget
    encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_ASI_BYTES:
        result = _truncate_to_budget(result)

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _truncate_to_budget(result: dict[str, Any]) -> dict[str, Any]:
    """Progressively truncate diagnostics and signals to fit within MAX_ASI_BYTES."""
    result["__truncated__"] = True

    # First pass: shorten diagnostics (most verbose field)
    for slot in _POLICY_SLOTS:
        if slot not in result:
            continue
        diag = result[slot].get("diagnostics", {})
        if isinstance(diag, dict):
            result[slot]["diagnostics"] = {
                k: str(v)[:256] for k, v in list(diag.items())[:10]
            }
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(encoded) <= MAX_ASI_BYTES:
            return result

    # Second pass: shorten signals lists
    for slot in _POLICY_SLOTS:
        if slot not in result:
            continue
        sigs = result[slot].get("signals", [])
        if isinstance(sigs, list) and len(sigs) > 5:
            result[slot]["signals"] = sigs[:5] + ["… truncated"]
        encoded = json.dumps(result, ensure_ascii=False).encode("utf-8")
        if len(encoded) <= MAX_ASI_BYTES:
            return result

    # Hard truncation: drop diagnostics entirely
    for slot in _POLICY_SLOTS:
        if slot in result:
            result[slot]["diagnostics"] = {"__truncated__": True}

    return result
