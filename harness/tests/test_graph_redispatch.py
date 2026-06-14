import json
from pathlib import Path

from harness.lib import graph_redispatch as gr


def test_redispatch_preserves_archived_eval_failure_evidence(monkeypatch, tmp_path):
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(gr, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gr, "EVENTS_FILE", tmp_path / "events.jsonl")
    monkeypatch.setattr(gr, "HUMAN_REVIEW_QUEUE", tmp_path / "human-review.jsonl")
    monkeypatch.setattr(gr, "NOTIFY_SCRIPT", tmp_path / "missing-notify.sh")

    def fake_set_node_status(graph, node_id, status, pane=None, dispatch_id=None, allow_reopen_failed=False):
        graph["node_results"][node_id]["status"] = status
        for node in graph["nodes"]:
            if node["id"] == node_id:
                node["status"] = status

    monkeypatch.setattr(gr.gs, "set_node_status", fake_set_node_status)

    eval_json = sprints / "sprint-one.N1-eval.json"
    eval_json.write_text(
        json.dumps(
            {
                "verdict": "FAIL",
                "summary": "scope proof failed",
                "failed_conditions": ["SCOPE", "EVIDENCE"],
                "errors": [{"cond": "SCOPE", "severity": "high"}],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    graph = {
        "sprint_id": "sprint-one",
        "nodes": [{"id": "N1", "status": "failed"}],
        "node_results": {
            "N1": {
                "status": "failed",
                "eval_json": eval_json.name,
                "artifacts": {"eval_json": eval_json.name},
            }
        },
    }

    result = gr.redispatch_failed_nodes(graph, max_retry=2, limit=5, apply=True)

    assert result["redispatched"] == [{"node_id": "N1", "retry": 1, "fail_summary": "scope proof failed"}]
    assert not eval_json.exists()
    archives = list(sprints.glob("sprint-one.N1-eval.json.redispatched-*"))
    assert len(archives) == 1
    evidence = graph["nodes"][0]["last_failure_evidence"]
    assert evidence["summary"] == "scope proof failed"
    assert evidence["eval_json_archive"] == str(archives[0])
    assert evidence["failed_conditions"] == ["SCOPE", "EVIDENCE"]
    assert evidence["errors"] == [{"cond": "SCOPE", "severity": "high"}]
