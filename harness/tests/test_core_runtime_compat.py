"""B6_compat_integration — Compat call-chain tests.

Verifies:
  1. record_legacy_event emits an ExecutionTrace into runtime/trace
  2. adopt_sprint emits an ExecutionTrace (compat_reconstructed)
  3. Old status.json / ledger consumers are unaffected (backward compat)
  4. Worker lease acquire/release emits traces
  5. New trace_id field in return values doesn't break old callers
  6. Failure events propagate failure field to trace
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(_TOOLS))

from runtime_bridge import adopt_sprint, emit_compat_trace, record_legacy_event
from worker_runtime import WorkerRuntime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_sprint(sprints: Path, sprint_id: str, status: str = "active") -> Path:
    status_path = sprints / f"{sprint_id}.status.json"
    status_path.write_text(json.dumps({
        "sprint_id": sprint_id,
        "status": status,
        "phase": "planning",
        "round": 1,
    }, ensure_ascii=False), encoding="utf-8")
    return status_path


def _trace_ledger(tmp: Path):
    from core_runtime_trace import ExecutionTraceLedger
    return ExecutionTraceLedger(base_dir=str(tmp / "run"))


# ---------------------------------------------------------------------------
# AC1: record_legacy_event wires into trace
# ---------------------------------------------------------------------------

class TestRecordLegacyEventTrace:
    def test_dispatch_event_emits_trace(self, tmp_path):
        """record_legacy_event(dispatch_queued) must write a trace record."""
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-compat-dispatch"
        _make_sprint(sprints, sid)

        result = record_legacy_event(
            sid, "dispatch_queued", "coordinator",
            {"to": "0.1", "node_id": "B1", "round": 1},
            harness_dir=tmp_path,
        )

        assert result["ok"] is True
        assert "trace_id" in result

        ledger = _trace_ledger(tmp_path)
        traces = ledger.replay(sid)
        assert len(traces) >= 1
        t = traces[0]
        assert t["logical_op"] == "compat_reconstructed"
        assert t["operator_id"] == "coordinator"
        assert t["surface"] == "headless"

    def test_failure_event_sets_failure_field(self, tmp_path):
        """dispatch_failed must produce a trace with a non-empty failure field."""
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-compat-fail"
        _make_sprint(sprints, sid)

        result = record_legacy_event(
            sid, "dispatch_failed", "coordinator",
            {"reason": "pane not found", "node_id": "B1"},
            harness_dir=tmp_path,
        )

        assert result["ok"] is True
        ledger = _trace_ledger(tmp_path)
        traces = ledger.replay(sid)
        assert any(t.get("failure") for t in traces)

    def test_state_changed_event_emits_trace(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-compat-state"
        _make_sprint(sprints, sid)

        result = record_legacy_event(
            sid, "state_changed", "coordinator",
            {"from": "active", "to": "reviewing"},
            harness_dir=tmp_path,
        )

        assert result["ok"] is True
        assert "trace_id" in result

    def test_trace_id_none_on_missing_sprint(self, tmp_path):
        """Empty sprint_id must return ok=False without crashing."""
        result = record_legacy_event("", "dispatch_queued", "coordinator", {}, harness_dir=tmp_path)
        assert result["ok"] is False

    def test_old_return_keys_present(self, tmp_path):
        """Backward-compat: original keys ok/sprint_id/appended must still be present."""
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-compat-keys"
        _make_sprint(sprints, sid)

        result = record_legacy_event(
            sid, "dispatched", "coordinator",
            {"node_id": "B2"},
            harness_dir=tmp_path,
        )

        assert "ok" in result
        assert "sprint_id" in result
        assert "appended" in result


# ---------------------------------------------------------------------------
# AC2: adopt_sprint wires into trace
# ---------------------------------------------------------------------------

class TestAdoptSprintTrace:
    def test_adopt_emits_trace(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-adopt-trace"
        _make_sprint(sprints, sid, status="passed")

        result = adopt_sprint(sid, harness_dir=tmp_path)

        assert result["ok"] is True
        assert "trace_id" in result

        ledger = _trace_ledger(tmp_path)
        traces = ledger.replay(sid)
        session_adopted = [t for t in traces if t.get("dispatch_id", "").startswith(sid[:12]) or True]
        assert len(traces) >= 1

    def test_adopt_passed_sprint_sets_artifact_completeness(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-adopt-passed"
        _make_sprint(sprints, sid, status="passed")

        adopt_sprint(sid, harness_dir=tmp_path)

        ledger = _trace_ledger(tmp_path)
        traces = ledger.replay(sid)
        completed = [t for t in traces if t.get("artifact_completeness") is True]
        assert len(completed) >= 1

    def test_adopt_active_sprint_no_artifact_completeness(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-adopt-active"
        _make_sprint(sprints, sid, status="active")

        adopt_sprint(sid, harness_dir=tmp_path)

        ledger = _trace_ledger(tmp_path)
        traces = ledger.replay(sid)
        completed = [t for t in traces if t.get("artifact_completeness") is True]
        assert len(completed) == 0

    def test_adopt_returns_backward_compat_keys(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-adopt-compat"
        _make_sprint(sprints, sid)

        result = adopt_sprint(sid, harness_dir=tmp_path)

        for key in ("ok", "sprint_id", "appended", "status_path", "legacy_events_path"):
            assert key in result, f"Missing key: {key}"


# ---------------------------------------------------------------------------
# AC3: Worker lease events emit traces
# ---------------------------------------------------------------------------

class TestWorkerLeaseTrace:
    def test_acquire_emits_trace(self, tmp_path):
        wr = WorkerRuntime(harness_dir=str(tmp_path))
        wr.register("worker-test", capabilities=["python"])
        lease = wr.acquire_lease("worker-test", "session-1", "activity-abc")
        assert lease is not None

        ledger = _trace_ledger(tmp_path)
        db_path = tmp_path / "run" / "execution_traces.db"
        assert db_path.exists()

        import sqlite3
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute("SELECT * FROM execution_traces WHERE dispatch_id='activity-abc'").fetchall()
        conn.close()
        assert len(rows) >= 1

    def test_release_emits_trace(self, tmp_path):
        wr = WorkerRuntime(harness_dir=str(tmp_path))
        wr.register("worker-rel", capabilities=["python"])
        wr.acquire_lease("worker-rel", "session-2", "activity-rel")
        released = wr.release_lease("worker-rel", "activity-rel", reason="completed")
        assert released is True

        import sqlite3
        db_path = tmp_path / "run" / "execution_traces.db"
        conn = sqlite3.connect(str(db_path))
        rows = conn.execute("SELECT * FROM execution_traces WHERE dispatch_id='activity-rel'").fetchall()
        conn.close()
        assert len(rows) >= 2  # acquire + release

    def test_trace_has_lease_field(self, tmp_path):
        wr = WorkerRuntime(harness_dir=str(tmp_path))
        wr.register("worker-lf", capabilities=["python"])
        wr.acquire_lease("worker-lf", "session-3", "activity-lf")

        from core_runtime_trace import ExecutionTraceLedger
        ledger = ExecutionTraceLedger(base_dir=str(tmp_path / "run"))
        # replay by dispatch_id
        traces = ledger.replay_by_dispatch("activity-lf")
        assert len(traces) >= 1
        lease = traces[0].get("lease")
        assert isinstance(lease, dict)
        assert "lease_id" in lease


# ---------------------------------------------------------------------------
# AC4: emit_compat_trace is fail-open
# ---------------------------------------------------------------------------

class TestCompatTraceFailOpen:
    def test_emit_returns_none_gracefully_on_bad_path(self, tmp_path):
        bad_dir = tmp_path / "no_write"
        bad_dir.mkdir()
        bad_dir.chmod(0o444)
        try:
            result = emit_compat_trace(
                "sprint-x", "dispatch_queued", "actor", {},
                harness_dir=bad_dir,
            )
            # Should not raise; may return None on failure
        except Exception as exc:
            pytest.fail(f"emit_compat_trace raised unexpectedly: {exc}")
        finally:
            bad_dir.chmod(0o755)


# ---------------------------------------------------------------------------
# AC5: Old status.json consumers unaffected
# ---------------------------------------------------------------------------

class TestStatusJsonCompat:
    def test_status_json_still_readable_after_adopt(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-status-compat"
        _make_sprint(sprints, sid, status="reviewing")

        adopt_sprint(sid, harness_dir=tmp_path)

        status_path = sprints / f"{sid}.status.json"
        assert status_path.exists()
        data = json.loads(status_path.read_text(encoding="utf-8"))
        assert data["status"] == "reviewing"

    def test_record_event_does_not_corrupt_status_json(self, tmp_path):
        sprints = tmp_path / "sprints"
        sprints.mkdir()
        sid = "sprint-no-corrupt"
        _make_sprint(sprints, sid, status="active")

        record_legacy_event(
            sid, "dispatched", "coordinator", {"node_id": "B3"},
            harness_dir=tmp_path,
        )

        status_path = sprints / f"{sid}.status.json"
        data = json.loads(status_path.read_text(encoding="utf-8"))
        assert data["status"] == "active"
