"""test_trace_builder.py — Tests for unified execution_trace data plane.

Covers ≥6 real dispatch event scenarios:
1. Normal dispatch → lease → ack → verifier PASS
2. Dispatch with ack timeout → reassign
3. Dispatch blocked (missing artifacts)
4. Dispatch with evolution mode selection
5. Dispatch with hygiene events (stale pane recovery)
6. Dispatch with cost tracking and retry
7. Conversion from orchestration trace (backward compat)
8. ASI projection multi-dimension output
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

# Ensure harness root is importable
HARNESS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS_ROOT))

from solar_runtime.evidence.trace_builder import (
    ASIProjection,
    ASIProjector,
    AckEvent,
    CostEvent,
    DispatchEvent,
    HygieneEvent,
    LeaseEvent,
    SCHEMA_VERSION,
    TraceBuilder,
    VerifierEvent,
    _now_iso,
)


def _ts(offset_minutes: int = 0) -> str:
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) + timedelta(minutes=offset_minutes)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


# ---------------------------------------------------------------------------
# Test 1: Normal happy-path dispatch → lease → ack → verifier PASS
# ---------------------------------------------------------------------------

def test_normal_dispatch_happy_path():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-001",
        sprint_id="sprint-test-001",
        node_id="S01_requirements",
        operator_id="builder-01",
        task_type="implementation",
        logical_operator="builder_main",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
        dispatch_file="sprints/sprint-test-001.S01.dispatch.md",
        write_scope=["lib/", "tests/"],
    ))
    builder.record_lease(LeaseEvent(
        lease_id="lease-001",
        state="acquired",
        ts=_ts(1),
        ttl_ms=3600000,
    ))
    builder.record_lease(LeaseEvent(
        lease_id="lease-001",
        state="released",
        ts=_ts(30),
        release_reason="completed",
    ))
    builder.record_ack(AckEvent(
        ack_status="ack_start",
        ts=_ts(2),
    ))
    builder.record_ack(AckEvent(
        ack_status="ack_done",
        ts=_ts(28),
        wait_ms=1560000.0,
    ))
    builder.record_verifier(VerifierEvent(
        decision="PASS",
        actor_id="evaluator-01",
        ts=_ts(29),
    ))

    trace = builder.build()

    assert trace["schema_version"] == SCHEMA_VERSION
    assert trace["dispatch_id"] == "dispatch-001"
    assert trace["sprint_id"] == "sprint-test-001"
    assert trace["operator_id"] == "builder-01"
    assert trace["dispatch"]["dispatch_status"] == "dispatched"
    assert trace["lease"]["lease_state"] == "released"
    assert trace["ack"]["ack_status"] == "ack_done"
    assert trace["verifier"]["decision"] == "PASS"
    assert trace["asi"]["verifier_pass"] is True
    assert trace["asi"]["success_rate"] == 1.0
    assert trace["asi"]["evidence_completeness"] >= 0.8
    assert trace["compat"]["dispatch_status"] == "dispatched"
    assert trace["compat"]["verifier_status"] == "PASS"


# ---------------------------------------------------------------------------
# Test 2: Dispatch with ack timeout → operator reassignment
# ---------------------------------------------------------------------------

def test_dispatch_ack_timeout_reassign():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-002",
        sprint_id="sprint-test-002",
        node_id="S03_P0_data_plane",
        operator_id="builder-01",
        task_type="implementation",
        logical_operator="builder_main",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
    ))
    builder.record_lease(LeaseEvent(
        lease_id="lease-002",
        state="acquired",
        ts=_ts(1),
    ))
    builder.record_ack(AckEvent(
        ack_status="timeout",
        ts=_ts(15),
        timeout=True,
        timeout_ms=900000.0,
    ))
    builder.record_hygiene(HygieneEvent(
        state="stale",
        ts=_ts(15),
        detail="ack timeout, pane stale",
    ))
    builder.record_verifier(VerifierEvent(
        decision="FAIL",
        actor_id="evaluator-01",
        ts=_ts(16),
        failure_mode="ack_timeout",
    ))

    trace = builder.build()

    assert trace["asi"]["ack_timeout_rate"] == 1.0
    assert trace["asi"]["verifier_pass"] is False
    assert trace["asi"]["failure_mode"] == "ack_timeout"
    assert trace["asi"]["success_rate"] == 0.0
    assert trace["ack"]["ack_timeout"] is True
    assert trace["verifier"]["decision"] == "FAIL"
    assert len(trace["hygiene"]) == 1
    assert trace["hygiene"][0]["state"] == "stale"
    assert trace["compat"]["ack_status"] == "timeout"


# ---------------------------------------------------------------------------
# Test 3: Dispatch blocked (missing artifacts)
# ---------------------------------------------------------------------------

def test_dispatch_blocked_missing_artifacts():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-003",
        sprint_id="sprint-test-003",
        node_id="S02_architecture",
        operator_id="",
        task_type="implementation",
        logical_operator="",
        dispatch_status="queued",
        dispatch_ts=_ts(0),
        fallback_reason="missing_task_graph",
    ))

    trace = builder.build()

    assert trace["dispatch"]["dispatch_status"] == "queued"
    assert trace["dispatch"]["fallback_reason"] == "missing_task_graph"
    assert trace["lease"]["lease_state"] == "pending"
    assert trace["ack"]["ack_status"] == "pending"
    assert trace["verifier"]["decision"] == "PENDING"
    assert trace["asi"]["success_rate"] == 0.0
    assert trace["asi"]["verifier_pass"] is False


# ---------------------------------------------------------------------------
# Test 4: Dispatch with evolution mode selection
# ---------------------------------------------------------------------------

def test_dispatch_evolution_mode():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-004",
        sprint_id="sprint-test-004",
        node_id="S07_P4_coral_evolution",
        operator_id="evolver-01",
        task_type="evolution",
        logical_operator="evolution_main",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
    ))
    builder.set_mode("evolution")
    builder.set_capsule_id("capsule-tui-recovery-v1")
    builder.set_scheduler_context({
        "mode": "evolution",
        "scheduler_id": "evolution-sched-01",
        "decision_id": "dec-004",
        "confidence": 0.95,
    })
    builder.record_lease(LeaseEvent(
        lease_id="lease-004",
        state="acquired",
        ts=_ts(1),
    ))
    builder.record_verifier(VerifierEvent(
        decision="PASS",
        ts=_ts(20),
    ))

    trace = builder.build()

    assert trace["scheduler_context"]["mode"] == "evolution"
    assert trace["capsule_id"] == "capsule-tui-recovery-v1"
    assert trace["scheduler_context"]["scheduler_id"] == "evolution-sched-01"
    assert trace["asi"]["verifier_pass"] is True


# ---------------------------------------------------------------------------
# Test 5: Dispatch with hygiene events (stale pane recovery)
# ---------------------------------------------------------------------------

def test_dispatch_hygiene_recovery():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-005",
        sprint_id="sprint-test-005",
        node_id="S04_P1_tui_recovery",
        operator_id="builder-02",
        task_type="recovery",
        logical_operator="tui_hygiene",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
    ))
    builder.record_hygiene(HygieneEvent(
        state="dirty",
        ts=_ts(0),
        detail="high token count detected",
    ))
    builder.record_hygiene(HygieneEvent(
        state="recovering",
        ts=_ts(2),
        detail="pane reset initiated",
    ))
    builder.record_hygiene(HygieneEvent(
        state="clean",
        ts=_ts(5),
        detail="pane recovered",
    ))
    builder.record_lease(LeaseEvent(
        lease_id="lease-005",
        state="released",
        ts=_ts(30),
        release_reason="completed",
    ))
    builder.record_ack(AckEvent(
        ack_status="ack_done",
        ts=_ts(28),
    ))
    builder.record_verifier(VerifierEvent(
        decision="PASS",
        ts=_ts(30),
    ))

    trace = builder.build()

    assert len(trace["hygiene"]) == 3
    assert trace["hygiene"][0]["state"] == "dirty"
    assert trace["hygiene"][1]["state"] == "recovering"
    assert trace["hygiene"][2]["state"] == "clean"
    assert trace["asi"]["stuck_pane_rate"] == pytest.approx(1.0 / 3.0, abs=0.01)
    assert trace["asi"]["verifier_pass"] is True


# ---------------------------------------------------------------------------
# Test 6: Dispatch with cost tracking and retry
# ---------------------------------------------------------------------------

def test_dispatch_cost_and_retry():
    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-006",
        sprint_id="sprint-test-006",
        node_id="S05_P2_binding_policy",
        operator_id="builder-03",
        task_type="optimization",
        logical_operator="policy_opt",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
        retry_count=2,
    ))
    builder.record_lease(LeaseEvent(
        lease_id="lease-006",
        state="acquired",
        ts=_ts(1),
    ))
    builder.record_ack(AckEvent(
        ack_status="ack_done",
        ts=_ts(25),
        wait_ms=1440000.0,
    ))
    builder.record_cost(CostEvent(
        quota_pool="premium-gpu",
        quota_used=0.85,
        cost_tokens=125000,
        cost_usd=0.38,
        retry_count=2,
    ))
    builder.record_verifier(VerifierEvent(
        decision="WARNING",
        ts=_ts(26),
        warnings=["evidence_completeness_below_threshold"],
    ))

    trace = builder.build()

    assert trace["cost"]["quota_pool"] == "premium-gpu"
    assert trace["cost"]["cost_usd"] == 0.38
    assert trace["cost"]["cost_tokens"] == 125000
    assert trace["dispatch"]["retry_count"] == 2
    assert trace["asi"]["premium_quota_burn"] == 0.38
    assert trace["asi"]["retry_count"] == 2
    assert trace["verifier"]["decision"] == "WARNING"
    assert len(trace["verifier"]["warnings"]) == 1
    assert trace["asi"]["success_rate"] == 0.3  # WARNING + acquired (not released)


# ---------------------------------------------------------------------------
# Test 7: Conversion from orchestration trace (backward compat)
# ---------------------------------------------------------------------------

def test_from_orchestration_trace():
    orch_trace = {
        "schema_version": "solar.orchestration_trace.v1",
        "trace_id": "trace-abc123",
        "dispatch_id": "dispatch-orch-001",
        "sprint_id": "sprint-orch-test",
        "task_type": "implementation",
        "logical_op": "builder_main",
        "operator_id": "builder-orch-01",
        "surface": "headless",
        "pane_hygiene_state": "clean",
        "created_at": _ts(0),
        "node_id": "S01",
        "capsule_id": "capsule-001",
        "dispatch": {
            "dispatch_status": "completed",
            "dispatch_ts": _ts(0),
            "dispatch_file": "sprints/test.dispatch.md",
            "write_scope": ["lib/"],
        },
        "lease": {
            "lease_id": "lease-orch-001",
            "lease_state": "released",
            "timeline": [
                {"ts": _ts(1), "state": "acquired"},
                {"ts": _ts(30), "state": "released"},
            ],
            "release_reason": "completed",
        },
        "ack": {
            "ack_status": "ack_done",
            "ack_start_ts": _ts(2),
            "ack_done_ts": _ts(28),
            "ack_wait_ms": 1560000.0,
            "timeline": [
                {"ts": _ts(2), "state": "ack_start"},
                {"ts": _ts(28), "state": "ack_done"},
            ],
        },
        "verifier": {
            "decision": "PASS",
            "verifier_actor_id": "eval-01",
        },
        "cost": {"cost_tokens": 50000, "cost_usd": 0.15},
        "hygiene_timeline": [
            {"ts": _ts(0), "state": "clean"},
        ],
    }

    trace = TraceBuilder.from_orchestration_trace(orch_trace)

    assert trace["schema_version"] == SCHEMA_VERSION
    assert trace["dispatch_id"] == "dispatch-orch-001"
    assert trace["sprint_id"] == "sprint-orch-test"
    assert trace["legacy"] == orch_trace  # backward compat
    assert trace["compat"]["dispatch_status"] == "completed"
    assert trace["compat"]["verifier_status"] == "PASS"
    assert trace["asi"]["verifier_pass"] is True
    assert trace["asi"]["evidence_completeness"] >= 0.6  # dispatch+lease+ack+verifier+cost


# ---------------------------------------------------------------------------
# Test 8: ASI projection multi-dimension output
# ---------------------------------------------------------------------------

def test_asi_projection_dimensions():
    asi = ASIProjector.project(
        dispatch=DispatchEvent(
            dispatch_id="d",
            sprint_id="s",
            node_id="n",
            operator_id="op",
            retry_count=1,
        ),
        lease_events=[
            LeaseEvent(lease_id="l1", state="acquired", ts=_ts(0)),
            LeaseEvent(lease_id="l1", state="released", ts=_ts(10)),
        ],
        ack_events=[
            AckEvent(ack_status="ack_done", ts=_ts(9)),
        ],
        hygiene_events=[
            HygieneEvent(state="clean", ts=_ts(0)),
            HygieneEvent(state="clean", ts=_ts(5)),
        ],
        verifier=VerifierEvent(decision="PASS", ts=_ts(11)),
        cost=CostEvent(quota_pool="standard", cost_usd=0.12, cost_tokens=30000),
        timeline_duration_ms=660000,
    )

    d = asi.to_dict()
    assert "success_rate" in d
    assert "verifier_pass" in d
    assert "latency_ms" in d
    assert "premium_quota_burn" in d
    assert "ack_timeout_rate" in d
    assert "stuck_pane_rate" in d
    assert "patch_scope_accuracy" in d
    assert "evidence_completeness" in d
    assert "security_events" in d
    assert "context_pollution_probability" in d
    assert "retry_count" in d

    assert asi.success_rate == 1.0
    assert asi.verifier_pass is True
    assert asi.latency_ms == 660000
    assert asi.premium_quota_burn == 0.12
    assert asi.ack_timeout_rate == 0.0
    assert asi.stuck_pane_rate == 0.0
    assert asi.evidence_completeness == 1.0  # all 5 event types present
    assert asi.retry_count == 1


# ---------------------------------------------------------------------------
# Test 9: Write to disk
# ---------------------------------------------------------------------------

def test_build_and_write(tmp_path):
    os.environ["SOLAR_HARNESS_DIR"] = str(tmp_path)
    try:
        builder = TraceBuilder()
        builder.record_dispatch(DispatchEvent(
            dispatch_id="dispatch-write-test",
            sprint_id="sprint-write",
            node_id="N01",
            operator_id="builder-w",
            task_type="test",
            dispatch_status="dispatched",
            dispatch_ts=_ts(0),
        ))
        builder.record_lease(LeaseEvent(lease_id="l-w", state="acquired", ts=_ts(1)))

        path = builder.build_and_write()

        assert path.exists()
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["schema_version"] == SCHEMA_VERSION
        assert data["dispatch_id"] == "dispatch-write-test"
        assert str(tmp_path) in str(path)
    finally:
        os.environ.pop("SOLAR_HARNESS_DIR", None)


# ---------------------------------------------------------------------------
# Test 10: Schema validation against execution-trace.schema.json
# ---------------------------------------------------------------------------

def test_trace_validates_against_schema():
    try:
        import jsonschema
    except ImportError:
        pytest.skip("jsonschema not installed")

    schema_path = HARNESS_ROOT / "schemas" / "execution-trace.schema.json"
    if not schema_path.exists():
        pytest.skip("execution-trace.schema.json not found")

    schema = json.loads(schema_path.read_text(encoding="utf-8"))

    builder = TraceBuilder()
    builder.record_dispatch(DispatchEvent(
        dispatch_id="dispatch-schema-test",
        sprint_id="sprint-schema",
        node_id="S01",
        operator_id="builder-s",
        task_type="schema_validation",
        dispatch_status="dispatched",
        dispatch_ts=_ts(0),
    ))
    builder.record_lease(LeaseEvent(lease_id="l-s", state="acquired", ts=_ts(1)))
    builder.record_ack(AckEvent(ack_status="ack_done", ts=_ts(2)))
    builder.record_verifier(VerifierEvent(decision="PASS", ts=_ts(3)))

    trace = builder.build()

    jsonschema.validate(trace, schema)


# ---------------------------------------------------------------------------
# Test 11: ModeSelector correctly distinguishes execution vs evolution
# -------------------------------------------------------------------

def test_mode_selector_execution():
    from solar_runtime.optimizer.mode_selector import ExecutionModeSelector, classify_mode

    selector = ExecutionModeSelector()

    # Task with execution hint
    result = selector.select({
        "task_id": "t-exec-001",
        "objective": "implement the trace builder module",
        "mode": "execution",
    })
    assert result.mode == "execution_mode"
    assert "execution" in result.scheduler_context["mode"]
    assert result.confidence > 0.8

    # Quick classify
    assert classify_mode({"task_id": "t-01", "mode": "execution", "objective": "build the module"}) == "execution"


def test_mode_selector_evolution():
    from solar_runtime.optimizer.mode_selector import ExecutionModeSelector, classify_mode

    selector = ExecutionModeSelector()

    # Task with evolution keywords and capsule support
    result = selector.select(
        {"task_id": "t-evo-001", "objective": "evolve the TUI recovery policy"},
        capsule_registry={"mode": {"supports": ["execution", "evolution"]}},
    )
    assert result.mode == "evolution_mode"
    assert result.scheduler_context["mode"] == "evolution"

    # Quick classify with evolution keywords + capsule support
    selector2 = ExecutionModeSelector()
    result2 = selector2.select(
        {"task_id": "t-02", "objective": "optimize policy via evolution"},
        capsule_registry={"mode": {"supports": ["execution", "evolution"]}},
    )
    assert "evolution" in result2.mode
