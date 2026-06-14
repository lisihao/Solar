#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

HARNESS_LIB = Path(__file__).resolve().parent.parent.parent / "lib"
sys.path.insert(0, str(HARNESS_LIB))


def test_node_verdict_refreshes_requirement_coverage_artifacts(tmp_path, monkeypatch):
    import graph_node_dispatcher as gnd

    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(gnd, "SPRINTS_DIR", sprints)
    monkeypatch.setattr(gnd, "HARNESS_DIR", tmp_path)

    sid = "sprint-test-coverage-refresh"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {
                "id": "N1",
                "goal": "Implement first slice",
                "depends_on": [],
                "acceptance": ["slice one exists"],
                "status": "reviewing",
                "requirement_ids": ["REQ-001"],
            },
            {
                "id": "N2",
                "goal": "Implement second slice",
                "depends_on": ["N1"],
                "acceptance": ["slice two exists"],
                "status": "pending",
                "requirement_ids": ["REQ-001"],
            },
        ],
        "node_results": {},
        "gate_results": {},
    }
    (sprints / f"{sid}.task_graph.json").write_text(json.dumps(graph), encoding="utf-8")
    (sprints / f"{sid}.status.json").write_text(json.dumps({"sprint_id": sid, "status": "active"}), encoding="utf-8")
    (sprints / f"{sid}.requirement_ir.json").write_text(
        json.dumps(
            {
                "id": "req-test",
                "requirements": [
                    {
                        "id": "REQ-001",
                        "source_text": "All planned slices are delivered.",
                        "success_criteria": ["both nodes done"],
                        "verification_method": "task_graph_closeout",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    stale_trace = {
        "schema_version": "solar.requirement_trace.v1",
        "requirement_ir_id": "req-test",
        "sprint_id": sid,
        "items": [{"requirement_id": "REQ-001", "mapped_nodes": ["R1", "R2"], "final_status": "missing"}],
    }
    (sprints / f"{sid}.requirement_trace.json").write_text(json.dumps(stale_trace), encoding="utf-8")
    (sprints / f"{sid}.finalized").write_text("", encoding="utf-8")

    monkeypatch.setattr(gnd, "release_lease", lambda *a, **kw: {"released": False})
    monkeypatch.setattr(gnd, "_mark_parent_sprint_passed_if_ready", lambda *a, **kw: False)

    eval_json = sprints / f"{sid}.N1-eval.json"
    eval_json.write_text(json.dumps({"verdict": "PASS"}), encoding="utf-8")

    result = gnd.node_verdict(
        str(sprints / f"{sid}.task_graph.json"),
        "N1",
        "pass",
        eval_json=str(eval_json),
        dispatch_downstream=False,
    )

    trace = json.loads((sprints / f"{sid}.requirement_trace.json").read_text(encoding="utf-8"))
    coverage = json.loads((sprints / f"{sid}.coverage_report.json").read_text(encoding="utf-8"))
    verdict = json.loads((sprints / f"{sid}.acceptance_verdict.json").read_text(encoding="utf-8"))

    assert result["ok"] is True
    assert result["coverage_refresh"]["ok"] is True
    assert trace["items"][0]["mapped_nodes"] == ["N1", "N2"]
    assert coverage["summary"]["partial"] == 1
    assert verdict["verdict"] == "FAIL"
    assert not (sprints / f"{sid}.finalized").exists()


def test_requirement_coverage_uses_scheduler_state_and_accepted_repairs(tmp_path, monkeypatch):
    tools_dir = Path(__file__).resolve().parent.parent.parent / "tools"
    sys.path.insert(0, str(tools_dir))

    import requirement_coverage as rc

    sprints = tmp_path / "sprints"
    sprints.mkdir()
    monkeypatch.setattr(rc, "HARNESS_DIR", tmp_path)

    sid = "sprint-test-state-backed-coverage"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "S1", "status": "passed", "requirement_ids": ["REQ-000"]},
            {"id": "S2", "status": "failed", "requirement_ids": ["REQ-001"]},
            {"id": "S3", "status": "passed", "requirement_ids": ["REQ-001"]},
            {"id": "S4", "status": "reviewing", "requirement_ids": ["REQ-000"]},
        ],
    }
    state = {
        "schema_version": "solar.task_graph_state.v1",
        "sprint_id": sid,
        "node_results": {
            "S1": {"status": "passed"},
            "S2": {"status": "failed", "repair_status": "accepted", "repaired_by": "S2R-EVAL2"},
            "S3": {"status": "passed"},
            "S4": {"status": "passed"},
        },
        "node_repairs": {
            "S2": {
                "status": "accepted",
                "node_id": "S2",
                "original_status": "failed",
                "repair_node_id": "S2R-EVAL2",
            }
        },
        "gate_results": {},
    }
    (sprints / f"{sid}.task_graph.json").write_text(json.dumps(graph), encoding="utf-8")
    (sprints / f"{sid}.task_dag.state.json").write_text(json.dumps(state), encoding="utf-8")
    (sprints / f"{sid}.requirement_ir.json").write_text(
        json.dumps(
            {
                "id": "req-test",
                "requirements": [
                    {
                        "id": "REQ-000",
                        "source_text": "All graph work closes out.",
                        "success_criteria": ["all nodes effective-passed"],
                        "verification_method": "task_graph_closeout",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    bundle = rc.evaluate_sid(sid, sprints_dir=sprints, write=True)

    assert bundle["coverage_report"]["summary"]["coverage_ratio"] == 1.0
    assert bundle["coverage_report"]["summary"]["graph_complete"] is True
    assert bundle["requirement_trace"]["items"][0]["mapped_nodes"] == ["S1", "S4", "S2", "S3"]
    assert bundle["acceptance_verdict"]["verdict"] == "PASS"


def test_requirement_coverage_keeps_parent_failed_when_review_decision_fails(tmp_path, monkeypatch):
    tools_dir = Path(__file__).resolve().parent.parent.parent / "tools"
    sys.path.insert(0, str(tools_dir))

    import requirement_coverage as rc

    sprints = tmp_path / "sprints"
    sprints.mkdir()

    sid = "sprint-test-review-fail"
    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "S1", "status": "passed", "requirement_ids": ["REQ-000"]},
            {
                "id": "S4",
                "type": "review",
                "status": "passed",
                "requirement_ids": ["REQ-000"],
                "validation": [{"kind": "artifact", "target": "review_decision.yaml", "required": True}],
            },
        ],
    }
    (sprints / f"{sid}.task_graph.json").write_text(json.dumps(graph), encoding="utf-8")
    (sprints / f"{sid}.task_dag.state.json").write_text(
        json.dumps(
            {
                "schema_version": "solar.task_graph_state.v1",
                "sprint_id": sid,
                "node_results": {"S1": {"status": "passed"}, "S4": {"status": "passed"}},
                "node_repairs": {},
                "gate_results": {},
            }
        ),
        encoding="utf-8",
    )
    (sprints / f"{sid}.requirement_ir.json").write_text(
        json.dumps(
            {
                "id": "req-test",
                "requirements": [
                    {
                        "id": "REQ-000",
                        "source_text": "All graph work closes out.",
                        "success_criteria": ["all nodes effective-passed"],
                        "verification_method": "task_graph_closeout",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (sprints / f"{sid}.S4-review_decision.yaml").write_text(
        "schema_version: solar.review_decision.v1\nverdict: FAIL\n",
        encoding="utf-8",
    )

    bundle = rc.evaluate_sid(sid, sprints_dir=sprints, write=True)

    assert bundle["coverage_report"]["summary"]["coverage_ratio"] == 1.0
    assert bundle["coverage_report"]["summary"]["graph_complete"] is True
    assert bundle["acceptance_verdict"]["verdict"] == "FAIL"
    assert "review_decision_failed:S4" in bundle["acceptance_verdict"]["reasons"]
