import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "lib"))

import graph_node_dispatcher as gnd  # noqa: E402


def test_pop_graph_queue_item_removes_advisory_lock(tmp_path, monkeypatch):
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd._task_queue, "QUEUE_DIR", tmp_path / "run" / "queue")
    qdir = tmp_path / "run" / "queue"
    qdir.mkdir(parents=True)
    qf = qdir / "sprint-lock-cleanup.jsonl"
    qf.write_text(
        json.dumps(
            {
                "id": "q1",
                "intent": "graph_node|node_id=N1",
                "priority": 10,
                "enqueued_at": "2026-05-21T00:00:00Z",
                "payload": {"node": {"id": "N1"}},
            }
        )
        + "\n",
        encoding="utf-8",
    )

    item = gnd._pop_graph_queue_item("sprint-lock-cleanup")

    assert item and item["id"] == "q1"
    assert not Path(str(qf) + ".lock").exists()


def test_pop_graph_queue_item_streams_and_compacts_consumed_history(tmp_path, monkeypatch):
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(gnd._task_queue, "QUEUE_DIR", tmp_path / "run" / "queue")
    monkeypatch.setenv("SOLAR_GRAPH_QUEUE_COMPACT_MIN_BYTES", "1")
    monkeypatch.setenv("SOLAR_GRAPH_QUEUE_CONSUMED_RETENTION", "2")
    qdir = tmp_path / "run" / "queue"
    qdir.mkdir(parents=True)
    qf = qdir / "sprint-streaming.jsonl"
    rows = [
        {"id": f"old-{index}", "intent": "graph_node|node_id=old", "consumed": True}
        for index in range(5)
    ]
    rows.extend([
        {"id": "low", "intent": "graph_node|node_id=N1", "priority": 1, "enqueued_at": "2026-01-01T00:00:00Z"},
        {"id": "high", "intent": "graph_node|node_id=N2", "priority": 10, "enqueued_at": "2026-01-02T00:00:00Z"},
    ])
    qf.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    original_read_text = Path.read_text

    def guarded_read_text(path, *args, **kwargs):
        if path == qf:
            raise AssertionError("graph queue must be streamed")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", guarded_read_text)

    item = gnd._pop_graph_queue_item("sprint-streaming")
    retained = [json.loads(line) for line in qf.open(encoding="utf-8")]

    assert item and item["id"] == "high" and item["consumed"] is True
    assert [row["id"] for row in retained] == ["old-3", "old-4", "low", "high"]
    assert not Path(str(qf) + ".lock").exists()
