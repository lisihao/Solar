"""Tests for actor_runtime.py — Submit protocol integration."""
import json
import tempfile
import types
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "lib"))

from actor_runtime import ActorRuntime, SubmitResult
from capability_token import CapabilityToken
from evidence_ledger import NoopMaterializer, RunMaterializer


def _make_actor_config(td: str, actor_ids=("test-actor",)) -> Path:
    actors_dir = Path(td) / "config"
    actors_dir.mkdir(parents=True, exist_ok=True)
    actors = {aid: {"actor_id": aid, "capability_profile": {}, "risk_profile": {}, "cost_profile": {}} for aid in actor_ids}
    actors_data = {"actors": actors}
    cfg = actors_dir / "agent-actors.json"
    cfg.write_text(json.dumps(actors_data))
    return actors_dir / "agent-actors.json"


def _make_runtime(td: str, actor_ids=("test-actor",), materializer=None) -> ActorRuntime:
    profiles_path = _make_actor_config(td, actor_ids)
    return ActorRuntime(
        harness_dir=Path(td),
        mailbox_base=Path(td) / "actors",
        profiles_path=profiles_path,
        run_materializer=materializer,
    )


# ---------------------------------------------------------------------------
# Existing backward-compat tests (must continue to pass)
# ---------------------------------------------------------------------------

def test_submit_returns_lease_and_paths():
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("test-actor",))
        envelope = {"task_id": "t1", "action": "run"}
        result = rt.submit(envelope, actor_id="test-actor", sprint_id="s1", node_id="n1")
        assert result.success
        assert result.lease is not None
        assert result.inbox_path is not None
        assert result.outbox_path is not None
        assert result.evidence_ledger_path is not None
        assert result.scheduler_decision is not None
        print("PASS: submit_returns_lease_and_paths")


def test_submit_writes_mailbox_inbox():
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        envelope = {"task_id": "t1", "action": "build"}
        result = rt.submit(envelope, actor_id="a1", sprint_id="s1", node_id="n1")
        assert result.success
        inbox_path = Path(result.inbox_path)
        assert inbox_path.exists()
        data = json.loads(inbox_path.read_text())
        assert data["task_id"] == "t1"
        print("PASS: submit_writes_mailbox_inbox")


def test_operator_bridge_failure_releases_lease_and_removes_inbox(monkeypatch):
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        monkeypatch.setattr(
            rt,
            "_submit_operator_runtime_bridge",
            lambda **_kwargs: {"status": "failed", "reason": "boom", "error": "bridge down"},
        )

        result = rt.submit({"task_id": "t1", "action": "build"}, actor_id="a1", sprint_id="s1", node_id="n1")

        assert not result.success
        assert "operator_runtime_bridge_failed" in result.error
        lease = rt.broker.get("a1")
        assert lease is not None
        assert lease.state == "READY"
        inbox = Path(td) / "actors" / "a1" / "inbox"
        assert not list(inbox.glob("task-*.json"))


def test_submit_blocks_auth_expired_actor_before_mailbox(monkeypatch):
    fake_runtime = types.SimpleNamespace(
        get_operator_config=lambda actor_id: {"id": actor_id},
        get_operator_runtime_state=lambda actor_id: "auth_expired",
    )
    monkeypatch.setitem(sys.modules, "operator_runtime", fake_runtime)
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))

        result = rt.submit({"task_id": "t1", "action": "build"}, actor_id="a1", sprint_id="s1", node_id="n1")

        assert not result.success
        assert result.error == "actor_runtime_unavailable:auth_expired:a1"
        assert result.scheduler_decision == {
            "rejected_candidates": [
                {"actor_id": "a1", "reason": "runtime_state_blocked", "runtime_state": "auth_expired"}
            ]
        }
        assert rt.broker.get("a1") is None
        assert not list((Path(td) / "actors" / "a1" / "inbox").glob("task-*.json"))


def test_operator_bridge_materializes_dispatch_text(monkeypatch):
    captured = {}

    def fake_submit(payload):
        captured.update(payload)
        return {"status": "submitted", "inbox_path": "/tmp/operator-task.json", "daemon_pid": 123}

    monkeypatch.setitem(sys.modules, "operator_runtime", types.SimpleNamespace(submit=fake_submit))
    monkeypatch.setenv("SOLAR_ACTOR_RUNTIME_OPERATOR_BRIDGE_FORCE", "1")
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt._submit_operator_runtime_bridge(
            actor_id="a1",
            task_id="t1",
            sprint_id="s1",
            node_id="n1",
            task_envelope={
                "task_type": "tests",
                "objective": "Run tests or collect execution evidence.",
                "task_graph_node": {"id": "n1", "goal": "Run tests"},
            },
        )

    assert result["status"] == "submitted"
    assert captured["operator_id"] == "a1"
    assert captured["task_id"] == "t1"
    assert captured["sprint_id"] == "s1"
    assert captured["node_id"] == "n1"
    assert captured["task_type"] == "tests"
    assert "dispatch_text" in captured
    assert "Run tests or collect execution evidence." in captured["dispatch_text"]
    assert "Task Graph Node" in captured["dispatch_text"]


def test_operator_bridge_derives_task_type_from_graph_node(monkeypatch):
    captured = {}

    def fake_submit(payload):
        captured.update(payload)
        return {"status": "submitted", "inbox_path": "/tmp/operator-task.json", "daemon_pid": 123}

    monkeypatch.setitem(sys.modules, "operator_runtime", types.SimpleNamespace(submit=fake_submit))
    monkeypatch.setenv("SOLAR_ACTOR_RUNTIME_OPERATOR_BRIDGE_FORCE", "1")
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt._submit_operator_runtime_bridge(
            actor_id="a1",
            task_id="t1",
            sprint_id="s1",
            node_id="n1",
            task_envelope={
                "objective": "Run tests.",
                "task_graph_node": {"id": "n1", "type": "tests", "goal": "Run tests"},
            },
        )

    assert result["status"] == "submitted"
    assert captured["task_type"] == "tests"


def test_submit_with_capability_token():
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        token = CapabilityToken(
            token_id="tok1", scopes=["file:write"],
            expires_at="2099-01-01T00:00:00Z", actor_id="a1",
        )
        result = rt.submit({"task_id": "t2"}, actor_id="a1", capability_token=token)
        assert result.success
        print("PASS: submit_with_capability_token")


def test_submit_expired_token_fails():
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td)
        token = CapabilityToken(
            token_id="tok-exp", scopes=["file:write"],
            expires_at="2020-01-01T00:00:00Z", actor_id="a1",
        )
        result = rt.submit({"task_id": "t3"}, actor_id="a1", capability_token=token)
        assert not result.success
        assert "capability_token_invalid" in result.error
        print("PASS: submit_expired_token_fails")


def test_no_tmux_in_runtime():
    import actor_runtime
    src = Path(actor_runtime.__file__).read_text()
    assert "tmux send-keys" not in src
    assert "send_keys" not in src
    print("PASS: no_tmux_in_runtime")


# ---------------------------------------------------------------------------
# S03 new tests — materialized run evidence
# ---------------------------------------------------------------------------

def test_submit_materializes_run_dir():
    """submit() success creates runs/<sprint-id>/ with run-manifest.json and scheduler_decision.json."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-mat", "objective": "build something"},
            actor_id="a1",
            sprint_id="sprint-mat",
            node_id="C1",
        )
        assert result.success
        # run_dir must be set
        assert result.run_dir is not None
        run_dir = Path(result.run_dir)
        assert run_dir.exists(), f"run_dir {run_dir} does not exist"
        assert (run_dir / "run-manifest.json").exists(), "run-manifest.json missing"
        assert (run_dir / "scheduler_decision.json").exists(), "scheduler_decision.json missing"
        # Node artifacts
        node_dirs = list((run_dir / "nodes").iterdir())
        assert len(node_dirs) >= 1, "No node directory created"
        node_dir = node_dirs[0]
        assert (node_dir / "task.yaml").exists(), "task.yaml missing"
        assert (node_dir / "operator_snapshot.json").exists(), "operator_snapshot.json missing"
        print("PASS: submit_materializes_run_dir")


def test_submit_jsonl_contains_run_dir():
    """JSONL entry contains run_dir and artifact_refs pointing to existing files."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-jsonl", "objective": "test"},
            actor_id="a1",
            sprint_id="sprint-jsonl",
            node_id="C1",
        )
        assert result.success
        ledger_path = Path(result.evidence_ledger_path)
        assert ledger_path.exists()
        entry = json.loads(ledger_path.read_text().strip().split("\n")[-1])
        assert "run_dir" in entry, "run_dir missing from JSONL entry"
        assert entry["run_dir"] == result.run_dir
        assert "artifact_refs" in entry
        # artifact_refs must point to existing files
        for key, fpath in entry["artifact_refs"].items():
            assert Path(fpath).exists(), f"artifact_refs[{key}]={fpath} does not exist"
        print("PASS: submit_jsonl_contains_run_dir")


def test_submit_run_manifest_schema():
    """run-manifest.json has correct schema_version and required fields."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-schema"},
            actor_id="a1",
            sprint_id="sprint-schema",
            node_id="C1",
        )
        assert result.success
        assert result.run_dir is not None
        manifest = json.loads((Path(result.run_dir) / "run-manifest.json").read_text())
        assert manifest["schema_version"] == "solar.run_manifest.v1"
        assert manifest["dag_id"] == "sprint-schema"
        assert manifest["status"] == "running"
        assert "nodes" in manifest
        assert "artifacts" in manifest
        assert "reviews" in manifest
        print("PASS: submit_run_manifest_schema")


def test_submit_scheduler_decision_schema():
    """scheduler_decision.json has S02 A1 required versioned fields."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-sched"},
            actor_id="a1",
            sprint_id="sprint-sched",
            node_id="C2",
        )
        assert result.success
        assert result.run_dir is not None
        sched = json.loads((Path(result.run_dir) / "scheduler_decision.json").read_text())
        assert sched["schema_version"] == "solar.scheduler_decision.v1"
        assert "decision_id" in sched
        assert "selection_summary" in sched
        assert "artifact_refs" in sched
        assert "replay" in sched
        print("PASS: submit_scheduler_decision_schema")


def test_submit_result_has_run_dir_and_artifact_refs():
    """SubmitResult.to_dict() exposes run_dir and artifact_refs."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-dict"},
            actor_id="a1",
            sprint_id="sprint-dict",
            node_id="C1",
        )
        assert result.success
        d = result.to_dict()
        assert "run_dir" in d
        assert "artifact_refs" in d
        # Old fields still present
        assert "success" in d
        assert "inbox_path" in d
        assert "evidence_ledger_path" in d
        print("PASS: submit_result_has_run_dir_and_artifact_refs")


def test_submit_materialization_failure_is_nonfatal():
    """Materialization I/O failure does not block submit; run_dir is None but success=True."""
    with tempfile.TemporaryDirectory() as td:
        # Use a NoopMaterializer to simulate materialization always failing/returning None
        noop = NoopMaterializer()
        rt = _make_runtime(td, actor_ids=("a1",), materializer=noop)
        result = rt.submit(
            {"task_id": "t-noop"},
            actor_id="a1",
            sprint_id="sprint-noop",
            node_id="C1",
        )
        # Submit should still succeed (materialization failure is non-fatal)
        assert result.success, f"Expected success, got error: {result.error}"
        assert result.run_dir is None, "Expected run_dir to be None with NoopMaterializer"
        assert result.inbox_path is not None, "inbox_path must still be written"
        assert result.evidence_ledger_path is not None
        # JSONL must not have run_dir when materialization produced None
        ledger_path = Path(result.evidence_ledger_path)
        entry = json.loads(ledger_path.read_text().strip().split("\n")[-1])
        assert "run_dir" not in entry, "run_dir should be absent in JSONL when materialization failed"
        print("PASS: submit_materialization_failure_is_nonfatal")


def test_submit_runtime_root_from_harness_dir():
    """runs/ directory is created under harness_dir, not a hardcoded user path."""
    with tempfile.TemporaryDirectory() as td:
        rt = _make_runtime(td, actor_ids=("a1",))
        result = rt.submit(
            {"task_id": "t-root"},
            actor_id="a1",
            sprint_id="sprint-root",
            node_id="C1",
        )
        assert result.success
        assert result.run_dir is not None
        # run_dir must be under td (the test harness root), not under ~/.solar
        assert td in result.run_dir, (
            f"run_dir {result.run_dir!r} is not under test harness dir {td!r}"
        )
        print("PASS: submit_runtime_root_from_harness_dir")


if __name__ == "__main__":
    test_submit_returns_lease_and_paths()
    test_submit_writes_mailbox_inbox()
    test_submit_with_capability_token()
    test_submit_expired_token_fails()
    test_no_tmux_in_runtime()
    test_submit_materializes_run_dir()
    test_submit_jsonl_contains_run_dir()
    test_submit_run_manifest_schema()
    test_submit_scheduler_decision_schema()
    test_submit_result_has_run_dir_and_artifact_refs()
    test_submit_materialization_failure_is_nonfatal()
    test_submit_runtime_root_from_harness_dir()
    print("\n12/12 passed")
