"""Tests for B2_execution_trace_ledger: ExecutionTraceLedger + EventLedger/EvidenceLedger bridges.

Sprint: sprint-20260530-请为-solar-harness-开一个新的-p0-总体架构升级单-正式命名为-s03-core-runtime
Node: B2_execution_trace_ledger
Gate: G2-trace

Acceptance criteria verified here:
  [AC1] Execution Trace covers all required fields:
        dispatch_id / logical_op / capsule_id / operator_id / surface /
        lease / ack / failure / verifier / cost / duration /
        patch_scope / artifact_completeness
  [AC2] trace can append/read/replay and rebuild derived status
  [AC3] tests include positive and negative (missing-field) controls
"""
from __future__ import annotations

import json
import tempfile
import uuid
from pathlib import Path

import pytest

from tools.core_runtime_trace import (
    ExecutionTrace,
    ExecutionTraceLedger,
    ExecutionTraceError,
    dispatch_event_to_trace,
)
from tools.event_ledger import EventLedger
from tools.evidence_ledger import EvidenceLedger
from tools.runtime_interfaces import SurfaceType


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture()
def trace_ledger(tmp_dir: Path) -> ExecutionTraceLedger:
    return ExecutionTraceLedger(base_dir=str(tmp_dir))


def _make_trace(**overrides) -> ExecutionTrace:
    """Build a minimal valid ExecutionTrace with optional field overrides."""
    defaults = dict(
        dispatch_id="dispatch-abc-001",
        logical_op="execution_trace_runtime",
        operator_id="operator-sonnet-builder-1",
        surface=SurfaceType.HEADLESS.value,
        sprint_id="sprint-test-001",
        node_id="B2_execution_trace_ledger",
    )
    defaults.update(overrides)
    return ExecutionTrace(**defaults)


# ---------------------------------------------------------------------------
# AC1 — Field coverage
# ---------------------------------------------------------------------------

class TestExecutionTraceFieldCoverage:
    """Verify that ExecutionTrace carries all required + optional trace fields."""

    def test_required_fields_present(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(
            capsule_id="cap-abc-001",
            lease={"lease_id": "L001", "acquired_at": "2026-06-06T00:00:00Z",
                   "expires_at": "2026-06-06T01:00:00Z"},
            ack={"ack_id": "ack-001", "acknowledged_at": "2026-06-06T00:00:01Z",
                 "status": "acknowledged"},
            failure=None,
            verifier="verifier-eval-001",
            cost=0.002,
            duration=1234.5,
            patch_scope={
                "files_added": ["tools/core_runtime_trace.py"],
                "files_modified": ["tools/event_ledger.py"],
                "files_deleted": [],
            },
            artifact_completeness=True,
        )
        trace_id = trace_ledger.append(trace)
        record = trace_ledger.read(trace_id)
        assert record is not None
        # All acceptance criteria fields present and correct
        assert record["dispatch_id"] == "dispatch-abc-001"
        assert record["logical_op"] == "execution_trace_runtime"
        assert record["capsule_id"] == "cap-abc-001"
        assert record["operator_id"] == "operator-sonnet-builder-1"
        assert record["surface"] == SurfaceType.HEADLESS.value
        assert record["lease"]["lease_id"] == "L001"
        assert record["ack"]["status"] == "acknowledged"
        assert record["failure"] is None
        assert record["verifier"] == "verifier-eval-001"
        assert record["cost"] == pytest.approx(0.002)
        assert record["duration"] == pytest.approx(1234.5)
        assert record["patch_scope"]["files_added"] == ["tools/core_runtime_trace.py"]
        assert record["artifact_completeness"] is True

    def test_all_surface_types_accepted(self, trace_ledger: ExecutionTraceLedger) -> None:
        for surface in SurfaceType:
            trace = _make_trace(
                dispatch_id=f"dispatch-{surface.value}",
                surface=surface.value,
            )
            tid = trace_ledger.append(trace)
            record = trace_ledger.read(tid)
            assert record["surface"] == surface.value

    def test_optional_fields_default_to_none(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace()
        tid = trace_ledger.append(trace)
        record = trace_ledger.read(tid)
        assert record["capsule_id"] is None
        assert record["lease"] is None
        assert record["ack"] is None
        assert record["failure"] is None
        assert record["verifier"] is None
        assert record["cost"] is None
        assert record["duration"] is None
        assert record["patch_scope"] is None
        assert record["artifact_completeness"] is None

    def test_failure_field_recorded(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(failure="operator_timeout")
        tid = trace_ledger.append(trace)
        record = trace_ledger.read(tid)
        assert record["failure"] == "operator_timeout"


# ---------------------------------------------------------------------------
# AC2 — append / read / replay / rebuild_status
# ---------------------------------------------------------------------------

class TestAppendReadReplay:
    """Verify append, read, replay are functional and idempotent."""

    def test_append_returns_trace_id(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace()
        tid = trace_ledger.append(trace)
        assert tid == trace.trace_id

    def test_read_returns_none_for_missing(self, trace_ledger: ExecutionTraceLedger) -> None:
        assert trace_ledger.read("nonexistent-id") is None

    def test_read_after_append(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(dispatch_id="dispatch-read-test")
        tid = trace_ledger.append(trace)
        record = trace_ledger.read(tid)
        assert record is not None
        assert record["dispatch_id"] == "dispatch-read-test"
        assert record["schema_version"] == "v1"

    def test_replay_empty_sprint(self, trace_ledger: ExecutionTraceLedger) -> None:
        result = trace_ledger.replay("sprint-does-not-exist")
        assert result == []

    def test_replay_multiple_traces_ordered(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-replay-test"
        ids = []
        for i in range(3):
            t = _make_trace(
                dispatch_id=f"dispatch-{i:03d}",
                sprint_id=sid,
                node_id=f"node-{i}",
            )
            ids.append(trace_ledger.append(t))
        records = trace_ledger.replay(sid)
        assert len(records) == 3
        # All trace_ids accounted for
        returned_ids = [r["trace_id"] for r in records]
        for tid in ids:
            assert tid in returned_ids

    def test_replay_is_idempotent(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-idempotent"
        _make_trace(sprint_id=sid)
        t = _make_trace(sprint_id=sid)
        trace_ledger.append(t)
        r1 = trace_ledger.replay(sid)
        r2 = trace_ledger.replay(sid)
        assert r1 == r2

    def test_replay_isolates_sprints(self, trace_ledger: ExecutionTraceLedger) -> None:
        t1 = _make_trace(sprint_id="sprint-A", dispatch_id="d-A")
        t2 = _make_trace(sprint_id="sprint-B", dispatch_id="d-B")
        trace_ledger.append(t1)
        trace_ledger.append(t2)
        r_a = trace_ledger.replay("sprint-A")
        r_b = trace_ledger.replay("sprint-B")
        assert len(r_a) == 1 and r_a[0]["dispatch_id"] == "d-A"
        assert len(r_b) == 1 and r_b[0]["dispatch_id"] == "d-B"

    def test_jsonl_mirror_written(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(sprint_id="sprint-jsonl")
        trace_ledger.append(trace)
        jsonl_path = trace_ledger._jsonl_path
        assert jsonl_path.exists()
        lines = jsonl_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) >= 1
        obj = json.loads(lines[-1])
        assert obj["dispatch_id"] == trace.dispatch_id


class TestRebuildStatus:
    """Verify rebuild_status derives correct per-node status from trace sequence."""

    def test_rebuild_empty_sprint(self, trace_ledger: ExecutionTraceLedger) -> None:
        result = trace_ledger.rebuild_status("sprint-empty")
        assert result == {}

    def test_rebuild_passed_node(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-pass"
        t = _make_trace(sprint_id=sid, node_id="B2", artifact_completeness=True)
        trace_ledger.append(t)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "passed"
        assert state["B2"]["artifact_completeness"] is True
        assert state["B2"]["failure"] is None

    def test_rebuild_failed_node(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-fail"
        t = _make_trace(sprint_id=sid, node_id="B2", failure="timeout")
        trace_ledger.append(t)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "failed"
        assert state["B2"]["failure"] == "timeout"

    def test_rebuild_incomplete_node(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-incomplete"
        t = _make_trace(sprint_id=sid, node_id="B2", artifact_completeness=False)
        trace_ledger.append(t)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "incomplete"

    def test_rebuild_dispatched_default_status(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-dispatched"
        t = _make_trace(sprint_id=sid, node_id="B2")
        trace_ledger.append(t)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "dispatched"

    def test_rebuild_last_trace_wins(self, trace_ledger: ExecutionTraceLedger) -> None:
        """If a node is dispatched then fails, final status should be failed."""
        sid = "sprint-rebuild-last-wins"
        # First trace: dispatched
        t1 = _make_trace(sprint_id=sid, node_id="B2")
        trace_ledger.append(t1)
        # Second trace: failed
        t2 = _make_trace(sprint_id=sid, node_id="B2", failure="operator_error",
                         dispatch_id="dispatch-round2")
        trace_ledger.append(t2)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "failed"

    def test_rebuild_multiple_nodes(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-multi"
        t_b2 = _make_trace(sprint_id=sid, node_id="B2", artifact_completeness=True,
                            dispatch_id="d-B2")
        t_b3 = _make_trace(sprint_id=sid, node_id="B3", failure="missing_dep",
                            dispatch_id="d-B3")
        trace_ledger.append(t_b2)
        trace_ledger.append(t_b3)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["status"] == "passed"
        assert state["B3"]["status"] == "failed"

    def test_rebuild_preserves_trace_metadata(self, trace_ledger: ExecutionTraceLedger) -> None:
        sid = "sprint-rebuild-meta"
        t = _make_trace(
            sprint_id=sid, node_id="B2",
            dispatch_id="disp-meta-001",
            operator_id="op-sonnet-1",
            artifact_completeness=True,
        )
        trace_ledger.append(t)
        state = trace_ledger.rebuild_status(sid)
        assert state["B2"]["dispatch_id"] == "disp-meta-001"
        assert state["B2"]["operator_id"] == "op-sonnet-1"
        assert state["B2"]["last_trace_id"] == t.trace_id


# ---------------------------------------------------------------------------
# AC3 — Negative controls (missing required fields)
# ---------------------------------------------------------------------------

class TestNegativeFieldControls:
    """Verify that missing required fields are rejected before any write."""

    def test_missing_dispatch_id_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(dispatch_id="")
        with pytest.raises(ValueError, match="dispatch_id"):
            trace_ledger.append(trace)

    def test_missing_logical_op_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(logical_op="")
        with pytest.raises(ValueError, match="logical_op"):
            trace_ledger.append(trace)

    def test_missing_operator_id_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(operator_id="")
        with pytest.raises(ValueError, match="operator_id"):
            trace_ledger.append(trace)

    def test_missing_surface_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(surface="")
        with pytest.raises(ValueError, match="surface"):
            trace_ledger.append(trace)

    def test_invalid_surface_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace(surface="not_a_valid_surface")
        with pytest.raises(ValueError, match="Invalid surface"):
            trace_ledger.append(trace)

    def test_duplicate_trace_id_raises(self, trace_ledger: ExecutionTraceLedger) -> None:
        trace = _make_trace()
        trace_ledger.append(trace)
        with pytest.raises(ExecutionTraceError, match="duplicate trace_id"):
            trace_ledger.append(trace)

    def test_failed_write_does_not_appear_in_replay(
        self, trace_ledger: ExecutionTraceLedger
    ) -> None:
        """When validation fails, the trace must not appear in subsequent replay."""
        bad_trace = _make_trace(dispatch_id="")
        try:
            trace_ledger.append(bad_trace)
        except ValueError:
            pass
        result = trace_ledger.replay(bad_trace.sprint_id)
        assert all(r["trace_id"] != bad_trace.trace_id for r in result)


# ---------------------------------------------------------------------------
# dispatch_event_to_trace bridge
# ---------------------------------------------------------------------------

class TestDispatchEventToTrace:
    """Verify the EventLedger → ExecutionTrace bridge function."""

    def test_basic_event_converts(self) -> None:
        event = {
            "event_id": "evt-001",
            "event_type": "dispatch_started",
            "sprint_id": "sprint-bridge-001",
            "node_id": "B2",
            "actor": "coordinator",
            "payload": {
                "dispatch_id": "disp-bridge-001",
                "logical_op": "test_op",
                "operator_id": "op-abc",
                "surface": SurfaceType.TUI.value,
            },
        }
        trace = dispatch_event_to_trace(event)
        assert trace.dispatch_id == "disp-bridge-001"
        assert trace.logical_op == "test_op"
        assert trace.operator_id == "op-abc"
        assert trace.surface == SurfaceType.TUI.value
        assert trace.sprint_id == "sprint-bridge-001"
        assert trace.node_id == "B2"

    def test_event_without_dispatch_id_falls_back_to_event_id(self) -> None:
        event = {
            "event_id": "evt-fallback",
            "event_type": "dispatch_started",
            "sprint_id": "sprint-fb",
            "actor": "coordinator",
            "payload": {
                "logical_op": "op",
                "operator_id": "op-x",
                "surface": SurfaceType.HEADLESS.value,
            },
        }
        trace = dispatch_event_to_trace(event)
        assert trace.dispatch_id == "evt-fallback"

    def test_append_from_event(self, trace_ledger: ExecutionTraceLedger) -> None:
        event = {
            "event_id": "evt-002",
            "event_type": "dispatch_completed",
            "sprint_id": "sprint-from-event",
            "node_id": "B2",
            "actor": "builder",
            "payload": {
                "dispatch_id": "disp-from-event",
                "logical_op": "execution_trace_runtime",
                "operator_id": "op-builder",
                "surface": SurfaceType.HEADLESS.value,
                "artifact_completeness": True,
            },
        }
        tid = trace_ledger.append_from_event(event)
        record = trace_ledger.read(tid)
        assert record is not None
        assert record["artifact_completeness"] is True


# ---------------------------------------------------------------------------
# EventLedger extensions (read / get_node_events)
# ---------------------------------------------------------------------------

class TestEventLedgerExtensions:
    """Verify the new read() and get_node_events() methods added to EventLedger."""

    def test_read_existing_event(self, tmp_dir: Path) -> None:
        ledger = EventLedger(base_dir=str(tmp_dir / "events"))
        eid = ledger.append({
            "event_type": "state_transition",
            "sprint_id": "sprint-ev-read",
            "node_id": "B2",
            "actor": "coordinator",
            "payload": {"from": "pending", "to": "dispatched"},
        })
        record = ledger.read(eid)
        assert record is not None
        assert record["event_type"] == "state_transition"
        assert record["payload"]["from"] == "pending"

    def test_read_nonexistent_returns_none(self, tmp_dir: Path) -> None:
        ledger = EventLedger(base_dir=str(tmp_dir / "events"))
        assert ledger.read("does-not-exist") is None

    def test_get_node_events_returns_correct_subset(self, tmp_dir: Path) -> None:
        ledger = EventLedger(base_dir=str(tmp_dir / "events2"))
        sid = "sprint-node-filter"
        ledger.append({"event_type": "e", "sprint_id": sid, "node_id": "B2", "actor": "a"})
        ledger.append({"event_type": "e", "sprint_id": sid, "node_id": "B3", "actor": "a"})
        ledger.append({"event_type": "e", "sprint_id": sid, "node_id": "B2", "actor": "b"})

        b2_events = ledger.get_node_events(sid, "B2")
        assert len(b2_events) == 2
        assert all(e["node_id"] == "B2" for e in b2_events)

        b3_events = ledger.get_node_events(sid, "B3")
        assert len(b3_events) == 1

    def test_get_node_events_empty_for_missing_node(self, tmp_dir: Path) -> None:
        ledger = EventLedger(base_dir=str(tmp_dir / "events3"))
        ledger.append({
            "event_type": "e", "sprint_id": "s", "node_id": "B2", "actor": "a"
        })
        result = ledger.get_node_events("s", "nonexistent")
        assert result == []


# ---------------------------------------------------------------------------
# EvidenceLedger extensions (trace_id + write_trace_ref)
# ---------------------------------------------------------------------------

class TestEvidenceLedgerTraceIntegration:
    """Verify EvidenceLedger.write_run_entry trace_id + write_trace_ref."""

    def test_write_run_entry_with_trace_id(self, tmp_dir: Path) -> None:
        ledger = EvidenceLedger(ledger_dir=tmp_dir / "evidence")
        path = ledger.write_run_entry(
            task_id="task-001",
            sprint_id="sprint-ev-001",
            node_id="B2",
            actor_id="op-sonnet",
            logical_operator="execution_trace_runtime",
            scheduler_decision={"selected_actor": "op-sonnet"},
            trace_id="trace-abc-001",
        )
        content = Path(path).read_text(encoding="utf-8")
        lines = [json.loads(l) for l in content.strip().splitlines()]
        entry = next((l for l in lines if l.get("event_type") == "run_dispatched"), None)
        assert entry is not None
        assert entry["execution_trace_id"] == "trace-abc-001"

    def test_write_run_entry_without_trace_id_omits_field(self, tmp_dir: Path) -> None:
        ledger = EvidenceLedger(ledger_dir=tmp_dir / "evidence2")
        path = ledger.write_run_entry(
            task_id="task-002",
            sprint_id="sprint-ev-002",
            node_id="B3",
            actor_id="op-sonnet",
            logical_operator="attempt_ledger_runtime",
            scheduler_decision={"selected_actor": "op-sonnet"},
        )
        content = Path(path).read_text(encoding="utf-8")
        lines = [json.loads(l) for l in content.strip().splitlines()]
        entry = lines[0]
        assert "execution_trace_id" not in entry

    def test_write_trace_ref(self, tmp_dir: Path) -> None:
        ledger = EvidenceLedger(ledger_dir=tmp_dir / "evidence3")
        path = ledger.write_trace_ref(
            sprint_id="sprint-ref-001",
            node_id="B2",
            trace_id="trace-ref-001",
            dispatch_id="disp-001",
            operator_id="op-builder",
            logical_operator="execution_trace_runtime",
            status="passed",
        )
        content = Path(path).read_text(encoding="utf-8")
        lines = [json.loads(l) for l in content.strip().splitlines()]
        ref = next(
            (l for l in lines if l.get("event_type") == "execution_trace_ref"), None
        )
        assert ref is not None
        assert ref["execution_trace_id"] == "trace-ref-001"
        assert ref["dispatch_id"] == "disp-001"
        assert ref["status"] == "passed"

    def test_trace_ref_and_run_entry_in_same_ledger_file(self, tmp_dir: Path) -> None:
        """Both run_entry and trace_ref land in the same sprint JSONL."""
        ledger = EvidenceLedger(ledger_dir=tmp_dir / "evidence4")
        sid = "sprint-combined"
        ledger.write_run_entry(
            task_id="task-c",
            sprint_id=sid,
            node_id="B2",
            actor_id="op-x",
            logical_operator="op",
            scheduler_decision={},
            trace_id="trace-combined",
        )
        ledger.write_trace_ref(
            sprint_id=sid,
            node_id="B2",
            trace_id="trace-combined",
            dispatch_id="disp-combined",
        )
        ledger_dir = tmp_dir / "evidence4"
        jsonl_path = ledger_dir / f"{sid}.jsonl"
        lines = [json.loads(l) for l in jsonl_path.read_text().strip().splitlines()]
        types = {l["event_type"] for l in lines}
        assert "run_dispatched" in types
        assert "execution_trace_ref" in types


# ---------------------------------------------------------------------------
# No hardcoded secrets / paths
# ---------------------------------------------------------------------------

class TestNoHardcodedSecrets:
    """Scan the module source for hardcoded secrets or absolute user paths."""

    _SECRET_PATTERNS = [
        "api_key", "token", "password", "secret", "credential",
        "sk-", "ghp_", "AKIA",
    ]

    def _load_source(self, module_path: str) -> str:
        with open(module_path, encoding="utf-8") as f:
            return f.read()

    def _check_no_secrets(self, source: str) -> None:
        lower = source.lower()
        for pattern in self._SECRET_PATTERNS:
            if pattern.lower() in lower:
                matches = [
                    line.strip()
                    for line in source.splitlines()
                    if pattern.lower() in line.lower()
                    and not line.strip().startswith("#")
                    and not line.strip().startswith('"""')
                    and "secret_patterns" not in line
                    and "SECRET_" not in line
                    and "secret_key_re" not in line.lower()
                    and "no_secrets" not in line.lower()
                    and "check_no_secrets" not in line.lower()
                    and "SECRET_VALUE_RE" not in line
                    and "SECRET_KEY_RE" not in line
                    and '"secret"' not in line
                    and "'secret'" not in line
                ]
                for match in matches:
                    pytest.fail(
                        f"Potential hardcoded secret pattern '{pattern}' found: {match}"
                    )

    def test_core_runtime_trace_no_secrets(self) -> None:
        import tools.core_runtime_trace as m
        self._check_no_secrets(m.__file__)

    def test_no_absolute_user_paths_in_core_trace(self) -> None:
        import tools.core_runtime_trace as m
        source = self._load_source(m.__file__)
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or '"""' in stripped:
                continue
            assert "/Users/" not in stripped and "/home/" not in stripped, (
                f"Absolute user path in source: {stripped}"
            )
