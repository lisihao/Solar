"""asi_mapper.py — Evidence Ledger → ASI payload mapper v2.

Converts Solar Harness evidence ledger entries into the structured ASI
(Agent Scoring Interface) payload format consumed by the GEPA offline
optimiser pipeline.

This module provides a **typed, dataclass-based** layer on top of the
legacy ``asi_adapter.py`` dict-based interface.  The old module continues
to work unchanged; this mapper adds:

- ``AsiPayload`` dataclass with 12 fields per design §5.2
- ``evidence_completeness`` computed from 11 required fields
- ``<missing>`` sentinel for absent required fields
- ``missing_evidence`` list tracking which fields are missing

Zero dependency on the ``gepa`` package — stdlib only.

Public API
----------
AsiMapper(registry, schema_version)  — mapper instance
    .from_evidence_entry(entry)      — dict → AsiPayload
    .from_run_dir(run_dir)           — Path  → AsiPayload

EvidenceFieldRegistry                — field name registry with allowlist
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MISSING_SENTINEL: str = "<missing>"
"""Sentinel value placed in fields whose source data is absent."""

SCHEMA_VERSION_DEFAULT: str = "solar.gepa.asi.v2"

# The 11 required fields that form the evidence completeness denominator.
# evidence_completeness itself is the 12th field but is computed, not sourced.
REQUIRED_FIELDS: Tuple[str, ...] = (
    "verifier_decision",
    "test_log",
    "benchmark_report",
    "patch_scope",
    "runtime_sec",
    "quota_used",
    "failure_mode",
    "operator_trace_summary",
    "unsupported_claim",
    "false_benchmark",
    "safety_violation",
)

# Mapping from evidence ledger source fields → AsiPayload target fields.
# Each entry maps (source_key_or_keys, target_field, transform_fn).
_SOURCE_TO_ASI: Dict[str, str] = {
    "verification_results": "verifier_decision",
    "effect_summary": "test_log",
    "guard_results": "benchmark_report",
    "capsule_plan_ir": "patch_scope",
    "physical_plan_ir": "runtime_sec",
    "resolved_bindings": "quota_used",
    "scheduler_decision": "failure_mode",
    "plan_artifacts": "operator_trace_summary",
    "capability_capsule_id": "unsupported_claim",
    "capsule_kind": "false_benchmark",
    "dag_ref": "safety_violation",
}

# Source key whose presence in the entry determines "field is populated".
_SOURCE_KEYS_FOR_REQUIRED: Dict[str, str] = {
    "verifier_decision": "verification_results",
    "test_log": "effect_summary",
    "benchmark_report": "guard_results",
    "patch_scope": "capsule_plan_ir",
    "runtime_sec": "physical_plan_ir",
    "quota_used": "resolved_bindings",
    "failure_mode": "scheduler_decision",
    "operator_trace_summary": "plan_artifacts",
    "unsupported_claim": "capability_capsule_id",
    "false_benchmark": "capsule_kind",
    "safety_violation": "dag_ref",
}


# ---------------------------------------------------------------------------
# Supporting dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TestLogSummary:
    """Summary of test outcomes from a run."""
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    error_codes: Tuple[str, ...] = ()


@dataclass(frozen=True)
class BenchmarkDelta:
    """Delta between baseline and current benchmark measurements."""
    baseline: Optional[float] = None
    current: Optional[float] = None
    delta_pct: Optional[float] = None


@dataclass(frozen=True)
class PatchScope:
    """Scope descriptor for a candidate patch."""
    files_touched: Tuple[str, ...] = ()
    lines_added: int = 0
    lines_removed: int = 0
    scope_type: str = "unknown"


@dataclass(frozen=True)
class QuotaUsage:
    """Quota/resource usage metrics."""
    tokens_used: int = 0
    cost_usd: float = 0.0
    walltime_sec: float = 0.0


@dataclass(frozen=True)
class OperatorCall:
    """Record of a single operator invocation during the run."""
    operator: str = ""
    target: str = ""
    duration_sec: float = 0.0
    success: bool = True


class FailureMode(Enum):
    """Failure classification for an optimization run."""
    NONE = "NONE"
    TIMEOUT = "TIMEOUT"
    EXCEPTION = "EXCEPTION"
    POLICY_REJECT = "POLICY_REJECT"
    VERIFIER_FAIL = "VERIFIER_FAIL"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# AsiPayload — the 12-field dataclass per design §5.2
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AsiPayload:
    """Structured ASI payload with 12 fields per design §5.2.

    The 11 required fields (all except ``evidence_completeness``) determine
    the completeness score.  Missing fields are filled with ``<missing>``
    sentinel and listed in ``missing_evidence``.

    Fields
    ------
    verifier_decision : str | None
        Verdict from the verifier subprocess (pass/fail/error).
    test_log : TestLogSummary
        Summary counts of test outcomes.
    benchmark_report : BenchmarkDelta | None
        Delta between baseline and current benchmark.
    patch_scope : PatchScope | None
        Scope of the candidate patch.
    runtime_sec : float | None
        Wall-clock runtime in seconds.
    quota_used : QuotaUsage | None
        Token / cost / time usage metrics.
    failure_mode : FailureMode
        Classified failure mode (NONE if successful).
    operator_trace_summary : list[OperatorCall]
        Ordered list of operator invocations.
    evidence_completeness : float
        Fraction of 11 required fields present, in [0.0, 1.0].
    unsupported_claim : bool
        Whether any unsupported claim was detected.
    false_benchmark : bool
        Whether a false benchmark improvement was detected.
    safety_violation : bool
        Whether a safety violation was detected.
    missing_evidence : list[str]
        Names of required fields whose source data was absent.
    raw_artifacts : dict
        Original source data dict.
    """
    verifier_decision: Optional[str] = None
    test_log: Optional[TestLogSummary] = None
    benchmark_report: Optional[BenchmarkDelta] = None
    patch_scope: Optional[PatchScope] = None
    runtime_sec: Optional[float] = None
    quota_used: Optional[QuotaUsage] = None
    failure_mode: FailureMode = FailureMode.NONE
    operator_trace_summary: List[OperatorCall] = field(default_factory=list)
    evidence_completeness: float = 0.0
    unsupported_claim: bool = False
    false_benchmark: bool = False
    safety_violation: bool = False
    missing_evidence: List[str] = field(default_factory=list)
    raw_artifacts: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dict (recursively converts dataclasses)."""
        def _convert(obj: Any) -> Any:
            if isinstance(obj, (TestLogSummary, BenchmarkDelta, PatchScope,
                                QuotaUsage, OperatorCall, AsiPayload)):
                return {k: _convert(v) for k, v in obj.__dict__.items()}
            if isinstance(obj, FailureMode):
                return obj.value
            if isinstance(obj, (list, tuple)):
                return [_convert(item) for item in obj]
            if isinstance(obj, dict):
                return {k: _convert(v) for k, v in obj.items()}
            return obj
        return _convert(self)


# ---------------------------------------------------------------------------
# EvidenceFieldRegistry
# ---------------------------------------------------------------------------

class EvidenceFieldRegistry:
    """Registry of known evidence ledger fields with required allowlist.

    Parameters
    ----------
    required_fields:
        Tuple of field names considered required for completeness scoring.
    source_to_asi:
        Mapping from evidence ledger source keys to ASI payload field names.
    """

    def __init__(
        self,
        required_fields: Sequence[str] = REQUIRED_FIELDS,
        source_to_asi: Optional[Dict[str, str]] = None,
    ) -> None:
        self.required_fields: Tuple[str, ...] = tuple(required_fields)
        self.source_to_asi: Dict[str, str] = dict(source_to_asi or _SOURCE_TO_ASI)

    def is_required(self, field_name: str) -> bool:
        return field_name in self.required_fields

    def completeness_denominator(self) -> int:
        return len(self.required_fields)


# ---------------------------------------------------------------------------
# AsiMapper — the main mapper class
# ---------------------------------------------------------------------------

class AsiMapper:
    """Map evidence ledger entries to typed AsiPayload objects.

    Parameters
    ----------
    registry:
        Field registry defining the required allowlist and source→target mapping.
    schema_version:
        Version tag embedded in the output for downstream compatibility checks.
    """

    def __init__(
        self,
        registry: Optional[EvidenceFieldRegistry] = None,
        schema_version: str = SCHEMA_VERSION_DEFAULT,
    ) -> None:
        self.registry = registry or EvidenceFieldRegistry()
        self.schema_version = schema_version

    # ---- public API -------------------------------------------------------

    def from_evidence_entry(self, entry: Dict[str, Any]) -> AsiPayload:
        """Convert a single evidence ledger entry to an AsiPayload.

        Missing required fields are set to ``<missing>`` sentinel (or None
        for typed fields) and recorded in ``missing_evidence``.

        Parameters
        ----------
        entry:
            A dict loaded from a JSONL evidence ledger file produced by
            ``tools.evidence_ledger.EvidenceLedger.write_run_entry``.
        """
        # Track missing based on source data presence, not extracted defaults
        missing: List[str] = []
        for asi_field, source_key in _SOURCE_KEYS_FOR_REQUIRED.items():
            src_val = entry.get(source_key)
            if src_val is None or (isinstance(src_val, str) and not src_val.strip()):
                missing.append(asi_field)

        verifier_decision = self._extract_verifier_decision(entry)
        test_log = self._extract_test_log(entry)
        benchmark_report = self._extract_benchmark_report(entry)
        patch_scope = self._extract_patch_scope(entry)
        runtime_sec = self._extract_runtime_sec(entry)
        quota_used = self._extract_quota_used(entry)
        failure_mode = self._extract_failure_mode(entry)
        operator_trace = self._extract_operator_trace(entry)
        unsupported_claim = self._extract_unsupported_claim(entry)
        false_benchmark = self._extract_false_benchmark(entry)
        safety_violation = self._extract_safety_violation(entry)

        # Completeness = (present required fields) / (total required fields)
        denom = self.registry.completeness_denominator()
        present_count = denom - len(missing)
        completeness = present_count / denom if denom > 0 else 0.0
        completeness = max(0.0, min(1.0, completeness))

        return AsiPayload(
            verifier_decision=verifier_decision,
            test_log=test_log,
            benchmark_report=benchmark_report,
            patch_scope=patch_scope,
            runtime_sec=runtime_sec,
            quota_used=quota_used,
            failure_mode=failure_mode,
            operator_trace_summary=operator_trace,
            evidence_completeness=completeness,
            unsupported_claim=unsupported_claim,
            false_benchmark=false_benchmark,
            safety_violation=safety_violation,
            missing_evidence=missing,
            raw_artifacts=dict(entry),
        )

    def from_run_dir(self, run_dir: Path) -> AsiPayload:
        """Build an AsiPayload from artifacts in a per-node run directory.

        Looks for known artifact files (``result.json``, ``snapshot.json``,
        ``scheduler_decision.json``, ``task.log``, ``handoff.md``) and maps
        their contents to ASI payload fields.
        """
        run_dir = Path(run_dir)
        combined_entry: Dict[str, Any] = {"run_dir": str(run_dir)}

        json_artifacts: List[Tuple[str, str]] = [
            ("result.json", "result"),
            ("snapshot.json", "snapshot"),
            ("scheduler_decision.json", "scheduler_decision"),
        ]
        text_artifacts: List[str] = ["task.log", "handoff.md"]

        for filename, key in json_artifacts:
            path = run_dir / filename
            if path.is_file():
                try:
                    with open(path, encoding="utf-8") as fh:
                        combined_entry[key] = json.load(fh)
                except (OSError, json.JSONDecodeError) as exc:
                    logger.warning("asi_mapper: could not read %s: %s", path, exc)

        for filename in text_artifacts:
            path = run_dir / filename
            if path.is_file():
                combined_entry[filename] = str(path)

        return self.from_evidence_entry(combined_entry)

    # ---- field extractors (private) --------------------------------------

    @staticmethod
    def _extract_verifier_decision(entry: Dict[str, Any]) -> Optional[str]:
        vr = entry.get("verification_results")
        if isinstance(vr, dict):
            return vr.get("verifier_decision") or vr.get("decision")
        if isinstance(vr, str):
            return vr
        result = entry.get("result")
        if isinstance(result, dict):
            status = result.get("status")
            if isinstance(status, str):
                return status
        return None

    @staticmethod
    def _extract_test_log(entry: Dict[str, Any]) -> Optional[TestLogSummary]:
        es = entry.get("effect_summary")
        if isinstance(es, dict):
            return TestLogSummary(
                passed=int(es.get("passed", es.get("pass", 0)) or 0),
                failed=int(es.get("failed", es.get("fail", 0)) or 0),
                skipped=int(es.get("skipped", es.get("skip", 0)) or 0),
                error_codes=tuple(es.get("error_codes") or []),
            )
        return None

    @staticmethod
    def _extract_benchmark_report(entry: Dict[str, Any]) -> Optional[BenchmarkDelta]:
        gr = entry.get("guard_results")
        if isinstance(gr, dict):
            return BenchmarkDelta(
                baseline=gr.get("baseline"),
                current=gr.get("current"),
                delta_pct=gr.get("delta_pct"),
            )
        if isinstance(gr, list) and gr:
            first = gr[0] if isinstance(gr[0], dict) else {}
            return BenchmarkDelta(
                baseline=first.get("baseline"),
                current=first.get("current"),
                delta_pct=first.get("delta_pct"),
            )
        return None

    @staticmethod
    def _extract_patch_scope(entry: Dict[str, Any]) -> Optional[PatchScope]:
        cpi = entry.get("capsule_plan_ir")
        if isinstance(cpi, dict):
            return PatchScope(
                files_touched=tuple(cpi.get("files_touched") or []),
                lines_added=int(cpi.get("lines_added", 0) or 0),
                lines_removed=int(cpi.get("lines_removed", 0) or 0),
                scope_type=str(cpi.get("scope_type", "unknown")),
            )
        return None

    @staticmethod
    def _extract_runtime_sec(entry: Dict[str, Any]) -> Optional[float]:
        ppi = entry.get("physical_plan_ir")
        if isinstance(ppi, dict):
            rt = ppi.get("runtime_sec") or ppi.get("walltime_sec")
            if rt is not None:
                return float(rt)
        result = entry.get("result")
        if isinstance(result, dict):
            rt = result.get("runtime_sec")
            if rt is not None:
                return float(rt)
        return None

    @staticmethod
    def _extract_quota_used(entry: Dict[str, Any]) -> Optional[QuotaUsage]:
        rb = entry.get("resolved_bindings")
        if isinstance(rb, dict):
            return QuotaUsage(
                tokens_used=int(rb.get("tokens_used", 0) or 0),
                cost_usd=float(rb.get("cost_usd", 0.0) or 0.0),
                walltime_sec=float(rb.get("walltime_sec", 0.0) or 0.0),
            )
        return None

    @staticmethod
    def _extract_failure_mode(entry: Dict[str, Any]) -> FailureMode:
        sd = entry.get("scheduler_decision")
        if isinstance(sd, dict):
            reason = sd.get("risk_reason") or ""
            error = sd.get("error") or ""
            status = str(sd.get("status", "")).upper()
            if "TIMEOUT" in status or "timeout" in reason.lower():
                return FailureMode.TIMEOUT
            if "POLICY" in status or "policy" in reason.lower():
                return FailureMode.POLICY_REJECT
            if "EXCEPTION" in status or error:
                return FailureMode.EXCEPTION
            if "VERIFIER" in status or "verifier" in reason.lower():
                return FailureMode.VERIFIER_FAIL
        result = entry.get("result")
        if isinstance(result, dict):
            status = str(result.get("status", "")).upper()
            if "TIMEOUT" in status:
                return FailureMode.TIMEOUT
            if "EXCEPTION" in status:
                return FailureMode.EXCEPTION
            if "POLICY" in status:
                return FailureMode.POLICY_REJECT
            if "VERIFIER" in status:
                return FailureMode.VERIFIER_FAIL
        return FailureMode.NONE

    @staticmethod
    def _has_scheduler_decision(entry: Dict[str, Any]) -> bool:
        sd = entry.get("scheduler_decision")
        return isinstance(sd, dict) and bool(sd)

    @staticmethod
    def _extract_operator_trace(entry: Dict[str, Any]) -> List[OperatorCall]:
        pa = entry.get("plan_artifacts")
        if isinstance(pa, dict):
            ops = pa.get("operator_trace") or pa.get("operators")
            if isinstance(ops, list):
                return [
                    OperatorCall(
                        operator=str(o.get("operator", "")),
                        target=str(o.get("target", "")),
                        duration_sec=float(o.get("duration_sec", 0.0) or 0.0),
                        success=bool(o.get("success", True)),
                    )
                    for o in ops if isinstance(o, dict)
                ]
        return []

    @staticmethod
    def _extract_unsupported_claim(entry: Dict[str, Any]) -> bool:
        cc = entry.get("capability_capsule_id")
        if isinstance(cc, str):
            return "unsupported" in cc.lower()
        return False

    @staticmethod
    def _extract_false_benchmark(entry: Dict[str, Any]) -> bool:
        ck = entry.get("capsule_kind")
        if isinstance(ck, str):
            return "false_benchmark" in ck.lower() or "false-benchmark" in ck.lower()
        return False

    @staticmethod
    def _extract_safety_violation(entry: Dict[str, Any]) -> bool:
        dr = entry.get("dag_ref")
        if isinstance(dr, str):
            return "safety_violation" in dr.lower()
        return False


# ---------------------------------------------------------------------------
# Module-level convenience (matches old asi_adapter API shape)
# ---------------------------------------------------------------------------

def compute_evidence_completeness(payload: AsiPayload) -> float:
    """Compute evidence completeness from an AsiPayload.

    Returns the payload's own ``evidence_completeness`` field, which is
    always in ``[0.0, 1.0]``.
    """
    return payload.evidence_completeness
