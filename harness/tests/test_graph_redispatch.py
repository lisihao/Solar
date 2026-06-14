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


def test_redispatch_archives_eval_markdown_too(monkeypatch, tmp_path):
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

    (sprints / "sprint-one.N1-eval.json").write_text('{"verdict":"FAIL"}', encoding="utf-8")
    (sprints / "sprint-one.N1-eval.md").write_text("# Eval\n\nFAIL\n", encoding="utf-8")
    graph = {
        "sprint_id": "sprint-one",
        "nodes": [{"id": "N1", "status": "failed", "artifacts": {"eval_md": "sprint-one.N1-eval.md"}}],
        "node_results": {
            "N1": {
                "status": "failed",
                "eval_json": "sprint-one.N1-eval.json",
                "artifacts": {"eval_json": "sprint-one.N1-eval.json", "eval_md": "sprint-one.N1-eval.md"},
            }
        },
    }

    result = gr.redispatch_failed_nodes(graph, max_retry=2, limit=5, apply=True)

    assert result["redispatched"][0]["node_id"] == "N1"
    assert not (sprints / "sprint-one.N1-eval.json").exists()
    assert not (sprints / "sprint-one.N1-eval.md").exists()
    assert list(sprints.glob("sprint-one.N1-eval.json.redispatched-*"))
    md_archives = list(sprints.glob("sprint-one.N1-eval.md.redispatched-*"))
    assert md_archives
    assert graph["nodes"][0]["last_failure_evidence"]["eval_md_archive"] == str(md_archives[0])


def test_redispatch_skips_accepted_repair_even_when_raw_result_failed(monkeypatch, tmp_path):
    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(gr, "SPRINTS_DIR", sprints)
    graph = {
        "sprint_id": "sprint-one",
        "nodes": [
            {"id": "N1", "status": "failed"},
            {"id": "N2", "status": "pending", "depends_on": ["N1"]},
        ],
        "node_results": {
            "N1": {
                "status": "failed",
                "repair_status": "accepted",
                "repaired_by": "N1R-EVAL",
                "completion_gate_required": True,
                "completion_gate": {
                    "status": "completed",
                    "verdict": {
                        "trigger": "post_result",
                        "status": "passed",
                        "verdict_id": "verdict-repair",
                        "covered_result_id": "result-repair",
                    },
                },
                "result_id": "result-repair",
            }
        },
        "node_repairs": {
            "N1": {
                "status": "accepted",
                "repair_node_id": "N1R-EVAL",
                "original_status": "failed",
            }
        },
    }

    result = gr.redispatch_failed_nodes(graph, max_retry=2, limit=5, apply=True)

    assert result["failed_total"] == 0
    assert result["redispatched"] == []
    assert graph["nodes"][0]["status"] == "failed"
    assert graph["node_results"]["N1"]["repair_status"] == "accepted"
