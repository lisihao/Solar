from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


_LIB = Path(__file__).resolve().parents[1] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

_SPEC = importlib.util.spec_from_file_location("_graph_node_dispatcher_repair", _LIB / "graph_node_dispatcher.py")
graph_node_dispatcher = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(graph_node_dispatcher)


def test_reconcile_skips_accepted_repair_instead_of_replaying_old_failed_eval(tmp_path: Path, monkeypatch) -> None:
    sid = "repair-sprint"
    monkeypatch.setattr(graph_node_dispatcher, "SPRINTS_DIR", tmp_path)
    (tmp_path / f"{sid}.S2-handoff.md").write_text("# old handoff\n", encoding="utf-8")
    (tmp_path / f"{sid}.S2-eval.json").write_text(json.dumps({"node_id": "S2", "verdict": "FAIL"}), encoding="utf-8")

    graph = {
        "sprint_id": sid,
        "nodes": [
            {"id": "S2", "status": "failed", "depends_on": [], "write_scope": ["impl/"]},
            {"id": "S3", "status": "pending", "depends_on": ["S2"], "write_scope": ["verify/"]},
        ],
        "node_repairs": {
            "S2": {
                "status": "accepted",
                "repair_node_id": "S2R-EVAL2",
                "original_status": "failed",
            }
        },
        "node_results": {
            "S2": {
                "status": "failed",
                "repair_status": "accepted",
                "repaired_by": "S2R-EVAL2",
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
    }

    repaired = graph_node_dispatcher._reconcile_existing_dispatches(graph, tmp_path / f"{sid}.task_graph.json")

    assert repaired == []
    assert graph["nodes"][0]["status"] == "failed"
    assert graph["node_results"]["S2"]["repair_status"] == "accepted"
    assert graph["node_results"]["S2"]["repaired_by"] == "S2R-EVAL2"
