"""verifier.py — Deterministic verifier / fixture replay for S04 acceptance.

Covers activation, dispatch, operator evidence, status UI projection,
and negative control: pane text claiming completion without verifier evidence
must NOT pass.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from .trace_model import (
    DispatchStatus,
    OrchestrationTrace,
    PaneHygieneState,
    VerifierDecision,
)
from .trace_writer import TraceWriter, _resolve_harness_dir
from .dispatch_trace import emit_dispatch_trace, emit_blocked_trace
from .operator_evidence import OperatorEvidenceRecorder
from .status_projection import StatusProjection


class OrchestrationVerifier:
    """Deterministic verifier that replays fixtures and checks acceptance criteria."""

    def __init__(self, harness_dir: Path | None = None) -> None:
        self.harness_dir = _resolve_harness_dir(harness_dir)
        self.results: list[dict[str, Any]] = []

    def verify_node(
        self,
        sprint_id: str,
        node_id: str,
        *,
        expected_trace_fields: dict[str, Any] | None = None,
        expected_acceptance: list[str] | None = None,
    ) -> dict[str, Any]:
        """Verify a single node's acceptance against its traces.

        Returns a verdict dict with:
        - node_id, decision (PASS/FAIL/WARNING), checks, missing_evidence
        """
        traces_dir = self.harness_dir / "traces" / "orchestration"
        traces: list[dict[str, Any]] = []
        if traces_dir.exists():
            for tf in traces_dir.glob("*.json"):
                try:
                    data = json.loads(tf.read_text(encoding="utf-8"))
                    if data.get("sprint_id") == sprint_id and data.get("node_id") == node_id:
                        traces.append(data)
                except Exception:
                    continue

        checks: list[dict[str, Any]] = []
        missing: list[str] = []

        if not traces:
            return {
                "node_id": node_id,
                "decision": "FAIL",
                "checks": [{"name": "trace_exists", "passed": False, "detail": "no traces found"}],
                "missing_evidence": ["execution_trace"],
            }

        # Check 1: Dispatch trace exists
        has_dispatch = any(
            t.get("dispatch", {}).get("dispatch_status") in {"dispatched", "active", "completed"}
            for t in traces
        )
        checks.append({
            "name": "dispatch_trace",
            "passed": has_dispatch,
            "detail": "dispatch trace with valid status" if has_dispatch else "no dispatch trace",
        })
        if not has_dispatch:
            missing.append("dispatch_trace")

        # Check 2: Lease timeline
        has_lease = any(
            len(t.get("lease", {}).get("timeline", [])) >= 1
            for t in traces
        )
        checks.append({
            "name": "lease_timeline",
            "passed": has_lease,
            "detail": "lease timeline present" if has_lease else "no lease timeline",
        })
        if not has_lease:
            missing.append("lease_timeline")

        # Check 3: Ack timeline
        has_ack = any(
            len(t.get("ack", {}).get("timeline", [])) >= 1
            for t in traces
        )
        checks.append({
            "name": "ack_timeline",
            "passed": has_ack,
            "detail": "ack timeline present" if has_ack else "no ack timeline",
        })
        if not has_ack:
            missing.append("ack_timeline")

        # Check 4: Verifier evidence (not just prose)
        has_verifier = any(
            t.get("verifier", {}).get("decision") in {"PASS", "FAIL", "WARNING"}
            for t in traces
        )
        checks.append({
            "name": "verifier_evidence",
            "passed": has_verifier,
            "detail": "verifier decision recorded" if has_verifier else "no verifier evidence",
        })
        if not has_verifier:
            missing.append("verifier_evidence")

        # Check 5: Expected trace fields (if provided)
        if expected_trace_fields:
            for key, expected_value in expected_trace_fields.items():
                found = False
                for t in traces:
                    actual = t.get(key)
                    if actual == expected_value:
                        found = True
                        break
                    # Check nested keys
                    if "." in key:
                        parts = key.split(".")
                        val: Any = t
                        for part in parts:
                            if isinstance(val, dict):
                                val = val.get(part)
                            else:
                                val = None
                                break
                        if val == expected_value:
                            found = True
                            break
                checks.append({
                    "name": f"field:{key}",
                    "passed": found,
                    "detail": f"{key}={expected_value}" if found else f"expected {key}={expected_value}",
                })
                if not found:
                    missing.append(f"field:{key}")

        # Determine overall decision
        all_passed = all(c["passed"] for c in checks)
        decision = "PASS" if all_passed else ("WARNING" if has_dispatch else "FAIL")

        result = {
            "node_id": node_id,
            "decision": decision,
            "checks": checks,
            "missing_evidence": missing,
        }
        self.results.append(result)
        return result

    def negative_control(self, pane_output: str) -> dict[str, Any]:
        """Negative control: pane output claims completion but has no verifier evidence.

        Must NOT pass even if pane output says "completed" or "done".
        """
        has_completion_claim = any(
            kw in pane_output.lower()
            for kw in ["completed", "done", "passed", "implemented", "✅"]
        )
        # No verifier evidence → must not pass
        return {
            "node_id": "negative_control",
            "decision": "FAIL" if has_completion_claim else "PENDING",
            "checks": [
                {
                    "name": "pane_claim_detected",
                    "passed": has_completion_claim,
                    "detail": "pane claims completion" if has_completion_claim else "no completion claim",
                },
                {
                    "name": "verifier_evidence",
                    "passed": False,
                    "detail": "no execution trace or verifier evidence — pane text alone is insufficient",
                },
            ],
            "missing_evidence": ["execution_trace", "verifier_evidence"],
            "verdict": "pane_text_does_not_equal_pass",
        }

    def verify_acceptance_coverage(
        self, sprint_id: str, acceptance_ids: list[str]
    ) -> dict[str, Any]:
        """Verify all acceptance IDs are covered by at least one fixture or trace."""
        covered: list[str] = []
        uncovered: list[str] = []

        for aid in acceptance_ids:
            found = any(
                aid in str(r) for r in self.results
            )
            if found:
                covered.append(aid)
            else:
                uncovered.append(aid)

        return {
            "total": len(acceptance_ids),
            "covered": covered,
            "uncovered": uncovered,
            "all_covered": len(uncovered) == 0,
        }


def replay_fixture(
    *,
    fixture_name: str,
    sprint_id: str,
    node_id: str,
    harness_dir: Path | None = None,
) -> dict[str, Any]:
    """Replay a named fixture scenario and return the trace + verifier result.

    Fixtures: ready_activation, blocked_missing_task_graph, dispatch_trace,
    lease_timeline, ack_timeline, bad_pane_reassign, ui_projection.
    """
    hd = _resolve_harness_dir(harness_dir)
    writer = TraceWriter(harness_dir=hd)

    if fixture_name == "ready_activation":
        trace = emit_dispatch_trace(
            dispatch_id=f"fixture-ready-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder",
            target_role="builder_main",
            harness_dir=hd,
        )
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "blocked_missing_task_graph":
        trace = emit_blocked_trace(
            dispatch_id=f"fixture-blocked-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            blocked_reason="missing_task_graph",
            harness_dir=hd,
        )
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "dispatch_trace":
        trace = emit_dispatch_trace(
            dispatch_id=f"fixture-dispatch-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder",
            target_role="builder_main",
            required_capabilities=["testing", "python"],
            preferred_model="sonnet",
            write_scope=["tests/"],
            harness_dir=hd,
        )
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "lease_timeline":
        trace = emit_dispatch_trace(
            dispatch_id=f"fixture-lease-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder",
            target_role="builder_main",
            harness_dir=hd,
        )
        recorder = OperatorEvidenceRecorder(trace, writer)
        recorder.lease_acquire("fixture-lease-001", ttl_ms=3600000)
        recorder.lease_release("completed")
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "ack_timeline":
        trace = emit_dispatch_trace(
            dispatch_id=f"fixture-ack-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder",
            target_role="builder_main",
            harness_dir=hd,
        )
        recorder = OperatorEvidenceRecorder(trace, writer)
        recorder.ack_start()
        recorder.ack_done()
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "bad_pane_reassign":
        trace = emit_dispatch_trace(
            dispatch_id=f"fixture-reassign-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder-01",
            target_role="builder_main",
            harness_dir=hd,
        )
        recorder = OperatorEvidenceRecorder(trace, writer)
        recorder.ack_timeout()
        recorder.record_reassign("fixture-builder-02", "ack_timeout")
        return {"trace_id": trace.trace_id, "fixture": fixture_name}

    elif fixture_name == "ui_projection":
        emit_dispatch_trace(
            dispatch_id=f"fixture-ui-{node_id}",
            sprint_id=sprint_id,
            node_id=node_id,
            task_type="fixture",
            logical_op="fixture",
            operator_id="fixture-builder",
            target_role="builder_main",
            harness_dir=hd,
        )
        projection = StatusProjection(harness_dir=hd)
        result = projection.project_sprint(sprint_id)
        return {"projection": result, "fixture": fixture_name}

    else:
        return {"error": f"unknown fixture: {fixture_name}"}
