import importlib.util
import json
import sys
from pathlib import Path


def _load_dispatcher():
    module_path = Path(__file__).resolve().parents[1] / "lib" / "graph_node_dispatcher.py"
    spec = importlib.util.spec_from_file_location("graph_node_dispatcher_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_operator_pool_submit_guard_blocks_active_pm_task(tmp_path):
    mod = _load_dispatcher()
    mod.HARNESS_DIR = tmp_path

    sprint_id = "sprint-duplicate-guard"
    node_id = "S12"
    graph_path = tmp_path / "sprints" / f"{sprint_id}.task_graph.json"
    graph_path.parent.mkdir(parents=True)
    graph_path.write_text(
        json.dumps(
            {
                "sprint_id": sprint_id,
                "nodes": [{"id": node_id, "status": "pending"}],
            }
        )
    )

    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    (inbox / f"pm-{sprint_id}-{node_id}-active.json").write_text(
        json.dumps(
            {
                "task_id": f"pm-{sprint_id}-{node_id}-active",
                "sprint_id": sprint_id,
                "node_id": node_id,
                "status": "submitted",
                "operator_id": "mini-builder-1",
            }
        )
    )

    guard = mod._operator_pool_submit_guard(
        sprint_id, node_id, str(graph_path), "dispatch-a"
    )

    assert not guard["ok"]
    assert guard["reason"] == "active_pm_task_exists"


def test_operator_pool_submit_guard_only_reads_matching_node_records(tmp_path, monkeypatch):
    mod = _load_dispatcher()
    mod.HARNESS_DIR = tmp_path
    inbox = tmp_path / "run" / "pm-inbox"
    inbox.mkdir(parents=True)
    for idx in range(250):
        (inbox / f"pm-unrelated-{idx}-N1-deadbeef.json").write_text("not-json")
    target = inbox / "pm-sprint-target-S12-active.json"
    target.write_text(
        json.dumps(
            {
                "task_id": target.stem,
                "sprint_id": "sprint-target",
                "node_id": "S12",
                "status": "queued",
            }
        )
    )
    original_read = mod._read_json_file_safe
    reads = []

    def counted_read(path):
        reads.append(path)
        return original_read(path)

    monkeypatch.setattr(mod, "_read_json_file_safe", counted_read)

    guard = mod._operator_pool_submit_guard("sprint-target", "S12", "/tmp/graph.json", "dispatch-a")

    assert guard["reason"] == "active_pm_task_exists"
    assert reads == [target]


def test_latest_operator_result_only_parses_matching_node_results(tmp_path, monkeypatch):
    mod = _load_dispatcher()
    mod.HARNESS_DIR = tmp_path
    root = tmp_path / "run" / "operator-results" / "builder-1"
    root.mkdir(parents=True)
    for idx in range(100):
        unrelated = root / f"pm-sprint-unrelated-N1-{idx}" / "result.json"
        unrelated.parent.mkdir()
        unrelated.write_text("not-json")
    target = root / "pm-sprint-target-S12-active" / "result.json"
    target.parent.mkdir()
    target.write_text(
        json.dumps(
            {
                "task_id": target.parent.name,
                "sprint_id": "sprint-target",
                "node_id": "S12",
                "operator_id": "builder-1",
                "status": "completed",
                "finished_at": "2026-08-10T12:00:00Z",
            }
        )
    )
    original_read = mod._read_json_file_safe
    reads = []

    def counted_read(path):
        reads.append(path)
        return original_read(path)

    monkeypatch.setattr(mod, "_read_json_file_safe", counted_read)

    result = mod._latest_operator_result_for("sprint-target", "S12")

    assert result and result["status"] == "completed"
    assert reads == [target]


def test_operator_pool_submit_claim_is_atomic(tmp_path):
    mod = _load_dispatcher()
    mod.HARNESS_DIR = tmp_path

    sprint_id = "sprint-claim-guard"
    node_id = "S12"

    first = mod._try_operator_pool_submit_claim(
        sprint_id, node_id, "dispatch-a"
    )
    second = mod._try_operator_pool_submit_claim(
        sprint_id, node_id, "dispatch-b"
    )
    mod._release_operator_pool_submit_claim(first)
    third = mod._try_operator_pool_submit_claim(
        sprint_id, node_id, "dispatch-c"
    )

    assert first["ok"], first
    assert not second["ok"]
    assert second["reason"] == "node_submit_claim_exists"
    assert third["ok"], third
