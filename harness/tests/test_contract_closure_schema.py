#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

HARNESS_LIB = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(HARNESS_LIB))


def _write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _make_sprint(root: Path, sid: str, *, complete: bool = True) -> Path:
    sprints = root / "sprints"
    sprints.mkdir(exist_ok=True)
    status = "passed" if complete else "reviewing"
    _write_json(
        sprints / f"{sid}.task_graph.json",
        {"nodes": [{"id": "N1", "status": status}], "required_gates": []},
    )
    _write_json(sprints / f"{sid}.status.json", {"status": status})
    _write_json(
        sprints / f"{sid}.task_dag.state.json",
        {"node_results": {"N1": {"status": status}}, "gate_results": {}},
    )
    _write_json(sprints / f"{sid}.requirement_ir.json", {"id": sid})
    (sprints / f"{sid}.contract.md").write_text("contract\n", encoding="utf-8")
    (sprints / f"{sid}.handoff.md").write_text("handoff\n", encoding="utf-8")
    if complete:
        _write_json(sprints / f"{sid}.V0.eval.json", {"evaluator": "test", "result": "PASS"})
    return sprints


def test_closure_payload_is_schema_compliant(tmp_path):
    import contract_closure as cc

    sid = "closure-schema-pass"
    sprints = _make_sprint(tmp_path, sid, complete=True)

    payload = cc.compute_closure_payload(sid, harness_dir=tmp_path, sprints_dir=sprints)
    cc.validate_closure(payload, Path(__file__).resolve().parent.parent / "schemas" / "closure.schema.json")

    assert payload["schema_version"] == "solar.closure_record.v1"
    assert payload["status"] == "passed"
    assert payload["legacy_status"] == "pass"
    assert payload["acceptance_traceability_coverage"] == 1.0
    assert payload["all_nodes_passed"] is True
    assert payload["all_required_gates_passed"] is True


def test_closure_verify_returns_nonzero_for_incomplete_closeout(tmp_path):
    import contract_closure as cc

    sid = "closure-schema-incomplete"
    sprints = _make_sprint(tmp_path, sid, complete=False)

    code, closure_json, closure_md, payload = cc.run_verify(
        sid,
        tmp_path,
        sprints,
        Path(__file__).resolve().parent.parent / "schemas" / "closure.schema.json",
    )

    assert code == 2
    assert closure_json.exists()
    assert closure_md.exists()
    assert payload["status"] in {"pending", "failed"}


def test_closure_collects_dispatch_eval_sidecar_suffix(tmp_path):
    import contract_closure as cc

    sid = "closure-schema-dispatch-eval"
    sprints = _make_sprint(tmp_path, sid, complete=True)
    (sprints / f"{sid}.V0.eval.json").unlink()
    _write_json(
        sprints / f"{sid}.PARENT-CLOSURE-EVAL-eval.json",
        {"evaluator": "codex-evaluator", "verdict": "PASS"},
    )

    payload = cc.compute_closure_payload(sid, harness_dir=tmp_path, sprints_dir=sprints)

    assert payload["status"] == "passed"
    assert payload["traceability_coverage"] == 100.0
    assert payload["evaluations"][0]["evaluator"] == "codex-evaluator"
    assert payload["evaluations"][0]["result"] == "PASS"


def test_closure_blocks_failed_dispatch_eval_sidecar(tmp_path):
    import contract_closure as cc

    sid = "closure-schema-dispatch-eval-fail"
    sprints = _make_sprint(tmp_path, sid, complete=True)
    (sprints / f"{sid}.V0.eval.json").unlink()
    _write_json(
        sprints / f"{sid}.PARENT-CLOSURE-EVAL-eval.json",
        {"node_id": "PARENT-CLOSURE-EVAL", "verdict": "FAIL"},
    )

    payload = cc.compute_closure_payload(sid, harness_dir=tmp_path, sprints_dir=sprints)

    assert payload["status"] == "pending"
    assert payload["legacy_status"] == "needs_attention"
    assert payload["traceability_coverage"] == 100.0
    assert payload["evaluations"][0]["result"] == "FAIL"
    assert any("eval did not pass" in risk for risk in payload["residual_risks"])
