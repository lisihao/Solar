"""Tests for evidence_collector module."""

import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from evidence_collector import (
    collect_node_metrics,
    update_status_metrics,
    validate_evidence_artifacts,
)


def test_collect_node_metrics_both_present():
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        handoff = tdp / "s1.N1-handoff.md"
        eval_json = tdp / "s1.N1-eval.json"
        handoff.write_text("# handoff")
        eval_json.write_text(json.dumps({"verdict": "PASS", "checked_at": "2026-06-01T00:00:00Z"}))

        metrics = collect_node_metrics(handoff, eval_json, token_consumed=5000)
        assert metrics["handoff_exists"] is True
        assert metrics["eval_json_exists"] is True
        assert metrics["verdict"] == "PASS"
        assert metrics["token_consumed"] == 5000
        print("PASS: collect_node_metrics_both_present")


def test_collect_node_metrics_missing_eval():
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        handoff = tdp / "s1.N1-handoff.md"
        eval_json = tdp / "s1.N1-eval.json"
        handoff.write_text("# handoff")

        metrics = collect_node_metrics(handoff, eval_json)
        assert metrics["handoff_exists"] is True
        assert metrics["eval_json_exists"] is False
        assert "verdict" not in metrics
        print("PASS: collect_node_metrics_missing_eval")


def test_update_status_metrics():
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        status_path = tdp / "s1.status.json"
        status_path.write_text(json.dumps({"phase": "planning_complete"}))

        metrics = {"handoff_exists": True, "token_consumed": 3000}
        ok = update_status_metrics(status_path, metrics)
        assert ok is True

        updated = json.loads(status_path.read_text())
        assert updated["metrics"]["token_consumed"] == 3000
        assert updated["phase"] == "planning_complete"
        print("PASS: update_status_metrics")


def test_update_status_metrics_missing_file():
    ok = update_status_metrics(Path("/nonexistent/status.json"), {})
    assert ok is False
    print("PASS: update_status_metrics_missing_file")


def test_validate_evidence_artifacts_all_present():
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        sid = "test-sprint"
        for nid in ["N1", "N2"]:
            (tdp / f"{sid}.{nid}-handoff.md").write_text("# handoff")
            (tdp / f"{sid}.{nid}-eval.json").write_text(json.dumps({"verdict": "PASS"}))
            (tdp / f"{sid}.{nid}-eval.md").write_text("# eval")

        report = validate_evidence_artifacts(tdp, sid, ["N1", "N2"])
        assert report["all_present"] is True
        assert report["missing"] == []
        assert report["nodes"]["N1"]["verdict"] == "PASS"
        print("PASS: validate_evidence_artifacts_all_present")


def test_validate_evidence_artifacts_missing():
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        sid = "test-sprint"
        (tdp / f"{sid}.N1-handoff.md").write_text("# handoff")
        # N1 eval_json missing
        (tdp / f"{sid}.N2-handoff.md").write_text("# handoff")
        (tdp / f"{sid}.N2-eval.json").write_text(json.dumps({"verdict": "PASS"}))
        # N2 eval_md missing

        report = validate_evidence_artifacts(tdp, sid, ["N1", "N2"])
        assert report["all_present"] is False
        assert len(report["missing"]) == 2
        print("PASS: validate_evidence_artifacts_missing")


if __name__ == "__main__":
    test_collect_node_metrics_both_present()
    test_collect_node_metrics_missing_eval()
    test_update_status_metrics()
    test_update_status_metrics_missing_file()
    test_validate_evidence_artifacts_all_present()
    test_validate_evidence_artifacts_missing()
    print("\n6/6 passed")
