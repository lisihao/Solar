"""asi_adapter.py — Evidence Ledger → ASI payload adapter.

Converts Solar Harness evidence ledger entries (from tools/evidence_ledger.py)
into the structured ASI (Agent Scoring Interface) payload format consumed by
the GEPA offline optimiser pipeline.

This module has **zero dependency on the gepa package** — it works entirely
with plain Python standard library types.

Public API
----------
from_evidence_entry(entry)         — single JSONL entry → ASI payload dict
from_run_dir(run_dir)              — run directory → ASI payload dict
evidence_completeness(asi_payload) — float in [0.0, 1.0]

ASI payload structure
---------------------
All three functions return a dict with four top-level keys:

    {
        "verified_facts":  {field_name: value, ...},   # present, non-None
        "derived_metrics": {metric_name: value, ...},  # computed metrics
        "missing_evidence": [field_name, ...],          # None / absent fields
        "raw_artifacts":   {...},                       # original source data
    }
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Public key constants (consumed by downstream modules like replay_suite,
# objectives, and the integration pipeline in N4)
# ---------------------------------------------------------------------------

VERIFIED_FACTS_KEY: str = "verified_facts"
DERIVED_METRICS_KEY: str = "derived_metrics"
MISSING_EVIDENCE_KEY: str = "missing_evidence"
RAW_ARTIFACTS_KEY: str = "raw_artifacts"

# ---------------------------------------------------------------------------
# Field registry
# ---------------------------------------------------------------------------

# All top-level fields recognised in the evidence ledger entry schema.
# Enumerated in the same order as tools/evidence_ledger.py's write_run_entry.
_ALL_LEDGER_FIELDS: Tuple[str, ...] = (
    # Core identity — always written
    "event_type",
    "timestamp",
    "task_id",
    "sprint_id",
    "node_id",
    "actor_id",
    "logical_operator",
    # Scheduling
    "scheduler_decision",
    # Per-node paths
    "per_node",
    # Report target
    "final_report_target",
    # Optional enrichment (conditionally written)
    "dag_ref",
    "context_packet_id",
    "capability_capsule_id",
    "capsule_kind",
    "resolved_bindings",
    "effect_summary",
    "guard_results",
    "verification_results",
    "capsule_plan_ir",
    "physical_plan_ir",
    "plan_artifacts",
)

# Subset used as the denominator for evidence_completeness().
# Includes all optional enrichment fields so that a "fully enriched" entry
# scores 1.0 and a minimal (core-only) entry scores proportionally lower.
_COMPLETENESS_FIELDS: Tuple[str, ...] = _ALL_LEDGER_FIELDS

# Artifact filenames looked up inside a per-node run directory.
_RUN_JSON_ARTIFACTS: Tuple[Tuple[str, str], ...] = (
    ("result.json", "result"),
    ("snapshot.json", "snapshot"),
    ("scheduler_decision.json", "scheduler_decision"),
)
_RUN_TEXT_ARTIFACTS: Tuple[str, ...] = ("task.log", "handoff.md")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_present(value: Any) -> bool:
    """Return True when *value* carries substantive evidence.

    None and whitespace-only strings are treated as absent; every other value
    (including empty dicts, empty lists, False, 0) is treated as present.
    """
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def _scheduler_metrics(sched: Dict[str, Any]) -> Dict[str, Any]:
    """Derive metrics from a ``scheduler_decision`` dict."""
    return {
        "score_factor_count": len(sched.get("score_factors") or {}),
        "penalty_count": len(sched.get("penalties") or {}),
        "rejection_count": len(sched.get("rejected_candidates") or []),
        "selected_actor": sched.get("selected_actor"),
        "has_quota_reason": sched.get("quota_reason") is not None,
        "has_risk_reason": sched.get("risk_reason") is not None,
        "has_context_affinity_reason": sched.get("context_affinity_reason") is not None,
    }


def _empty_scheduler_metrics() -> Dict[str, Any]:
    return {
        "score_factor_count": 0,
        "penalty_count": 0,
        "rejection_count": 0,
        "selected_actor": None,
        "has_quota_reason": False,
        "has_risk_reason": False,
        "has_context_affinity_reason": False,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def from_evidence_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a single evidence ledger entry to an ASI payload.

    Handles both fully-populated entries and partial entries that are missing
    optional fields.  Missing fields appear in ``missing_evidence``; they do
    not raise exceptions.

    Parameters
    ----------
    entry:
        A dict loaded from a JSONL evidence ledger file produced by
        ``tools.evidence_ledger.EvidenceLedger.write_run_entry``.

    Returns
    -------
    dict
        Keys: ``verified_facts``, ``derived_metrics``, ``missing_evidence``,
        ``raw_artifacts``.
    """
    verified: Dict[str, Any] = {}
    missing: List[str] = []

    for field in _ALL_LEDGER_FIELDS:
        value = entry.get(field)
        if _is_present(value):
            verified[field] = value
        else:
            missing.append(field)

    sched = entry.get("scheduler_decision")
    if isinstance(sched, dict) and sched:
        sched_metrics = _scheduler_metrics(sched)
    else:
        sched_metrics = _empty_scheduler_metrics()

    derived: Dict[str, Any] = {
        **sched_metrics,
        "has_capability_capsule": _is_present(entry.get("capability_capsule_id")),
        "has_guard_results": _is_present(entry.get("guard_results")),
        "has_verification_results": _is_present(entry.get("verification_results")),
        "has_effect_summary": _is_present(entry.get("effect_summary")),
        "has_resolved_bindings": _is_present(entry.get("resolved_bindings")),
        "has_plan_artifacts": _is_present(entry.get("plan_artifacts")),
        "has_capsule_plan_ir": _is_present(entry.get("capsule_plan_ir")),
        "has_physical_plan_ir": _is_present(entry.get("physical_plan_ir")),
    }

    return {
        VERIFIED_FACTS_KEY: verified,
        DERIVED_METRICS_KEY: derived,
        MISSING_EVIDENCE_KEY: missing,
        RAW_ARTIFACTS_KEY: entry,
    }


def from_run_dir(run_dir: Path) -> Dict[str, Any]:
    """Build an ASI payload from artifacts in a per-node run directory.

    Looks for known artifact files (``result.json``, ``snapshot.json``,
    ``scheduler_decision.json``, ``task.log``, ``handoff.md``) inside
    *run_dir*.  Files that do not exist or cannot be parsed are silently
    added to ``missing_evidence`` rather than raising.

    Parameters
    ----------
    run_dir:
        Path to a per-node run directory, e.g.
        ``~/.solar/harness/run/{sprint_id}/{node_id}/``.

    Returns
    -------
    dict
        Same four-key ASI payload.  When *run_dir* does not exist or contains
        no recognised artifacts, all artifact keys are absent and
        ``missing_evidence`` lists them all.
    """
    run_dir = Path(run_dir)

    raw: Dict[str, Any] = {"run_dir": str(run_dir)}
    verified: Dict[str, Any] = {"run_dir": str(run_dir)}
    missing: List[str] = []

    # JSON artifacts
    for filename, key in _RUN_JSON_ARTIFACTS:
        path = run_dir / filename
        if path.is_file():
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
                raw[key] = data
                verified[key] = data
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("asi_adapter: could not read %s: %s", path, exc)
                missing.append(key)
        else:
            missing.append(key)

    # Text artifacts — presence noted, content not loaded into memory
    for filename in _RUN_TEXT_ARTIFACTS:
        path = run_dir / filename
        if path.is_file():
            raw[filename] = str(path)
            verified[filename] = str(path)
        else:
            missing.append(filename)

    # Derived metrics
    sched_data = raw.get("scheduler_decision")
    if isinstance(sched_data, dict) and sched_data:
        sched_metrics = _scheduler_metrics(sched_data)
    else:
        sched_metrics = _empty_scheduler_metrics()

    json_keys = [k for _, k in _RUN_JSON_ARTIFACTS]
    derived: Dict[str, Any] = {
        **sched_metrics,
        "artifact_count": sum(1 for k in json_keys if k in raw),
        "has_result": "result" in raw,
        "has_snapshot": "snapshot" in raw,
        "has_scheduler_decision": "scheduler_decision" in raw,
        "has_log": "task.log" in raw,
        "has_handoff": "handoff.md" in raw,
    }

    return {
        VERIFIED_FACTS_KEY: verified,
        DERIVED_METRICS_KEY: derived,
        MISSING_EVIDENCE_KEY: missing,
        RAW_ARTIFACTS_KEY: raw,
    }


def evidence_completeness(asi_payload: Dict[str, Any]) -> float:
    """Calculate evidence completeness for an ASI payload.

    Completeness is the fraction of *_COMPLETENESS_FIELDS* that appear in
    ``verified_facts``.  The denominator is fixed so scores are comparable
    across payloads produced by both :func:`from_evidence_entry` and
    :func:`from_run_dir`.

    Parameters
    ----------
    asi_payload:
        A dict as returned by :func:`from_evidence_entry` or
        :func:`from_run_dir`.

    Returns
    -------
    float
        A value in ``[0.0, 1.0]``.  Returns ``0.0`` if ``_COMPLETENESS_FIELDS``
        is empty or if *asi_payload* has no ``verified_facts``.
    """
    if not _COMPLETENESS_FIELDS:
        return 0.0
    verified = asi_payload.get(VERIFIED_FACTS_KEY) or {}
    present = sum(1 for f in _COMPLETENESS_FIELDS if f in verified)
    return present / len(_COMPLETENESS_FIELDS)
