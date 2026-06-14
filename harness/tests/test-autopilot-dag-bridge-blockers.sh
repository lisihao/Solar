#!/usr/bin/env bash
# Regression: autopilot/DAG bridge writes blockers to observable sources.
set -euo pipefail

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/sprints" "$TMP/state" "$TMP/run" "$TMP/events"
REAL_HARNESS_DIR="${REAL_HARNESS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

HARNESS_DIR="$TMP" REAL_HARNESS_DIR="$REAL_HARNESS_DIR" python3 - <<'PY'
import importlib.util
import json
import os
from pathlib import Path

root = Path(os.environ["HARNESS_DIR"])
real = Path(os.environ["REAL_HARNESS_DIR"])
module_path = real / "tools" / "solar-autopilot-monitor.py"
spec = importlib.util.spec_from_file_location("autopilot_monitor", module_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


missing_sid = "sprint-missing-graph"
write_json(root / "sprints" / f"{missing_sid}.status.json", {
    "sprint_id": missing_sid,
    "status": "active",
    "handoff_to": "builder_main",
    "epic_id": "epic-test",
})
write_json(root / "sprints" / "epic-test.traceability.json", {"epic_id": "epic-test"})
missing = mod.dispatch_ready_graph_nodes(missing_sid, lease=False)
assert missing["ok"] is False, missing
assert missing["reason"] == "task_graph_missing", missing
missing_status = read_json(root / "sprints" / f"{missing_sid}.status.json")
assert missing_status["blocked_by"] == ["task_graph"], missing_status
assert missing_status["blocker_reason"] == "task_graph_missing", missing_status
trace = read_json(root / "sprints" / "epic-test.traceability.json")
assert trace["autopilot_bridge_events"][-1]["blocker_reason"] == "task_graph_missing", trace

invalid_sid = "sprint-invalid-graph"
write_json(root / "sprints" / f"{invalid_sid}.status.json", {
    "sprint_id": invalid_sid,
    "status": "active",
    "handoff_to": "builder_main",
})
write_json(root / "sprints" / f"{invalid_sid}.task_graph.json", {
    "sprint_id": invalid_sid,
    "nodes": [
        {
            "id": "N1",
            "depends_on": ["NOPE"],
            "write_scope": ["lib/example.py"],
            "acceptance": ["ok"],
            "required_capabilities": ["python"],
        }
    ],
})
invalid = mod.dispatch_ready_graph_nodes(invalid_sid, lease=False)
assert invalid["ok"] is False, invalid
assert invalid["reason"] == "task_graph_invalid", invalid
invalid_status = read_json(root / "sprints" / f"{invalid_sid}.status.json")
assert invalid_status["blocker_reason"] == "task_graph_invalid", invalid_status
assert any("missing node" in item for item in invalid_status["blocked_by"]), invalid_status

conflict_sid = "sprint-write-scope-conflict"
write_json(root / "sprints" / f"{conflict_sid}.status.json", {
    "sprint_id": conflict_sid,
    "status": "active",
    "handoff_to": "builder_main",
})
write_json(root / "sprints" / f"{conflict_sid}.task_graph.json", {
    "sprint_id": conflict_sid,
    "nodes": [
        {
            "id": "N1",
            "depends_on": [],
            "write_scope": ["lib/shared/"],
            "acceptance": ["ok"],
            "required_capabilities": ["python"],
        },
        {
            "id": "N2",
            "depends_on": [],
            "write_scope": ["lib/shared/file.py"],
            "acceptance": ["ok"],
            "required_capabilities": ["python"],
        },
    ],
})
mod.graph_dispatch_ready = None
mod.graph_dispatch_node_evals = None
mod.graph_workers = lambda: [
    {"pane": "operator-pool:builder-a", "skills": ["python"], "capabilities": ["python"], "models": ["sonnet"], "busy": False},
    {"pane": "operator-pool:builder-b", "skills": ["python"], "capabilities": ["python"], "models": ["sonnet"], "busy": False},
]
conflict = mod.dispatch_ready_graph_nodes(conflict_sid, lease=False)
assert conflict["ok"] is True, conflict
assert conflict["write_scope_conflicts"], conflict
conflict_status = read_json(root / "sprints" / f"{conflict_sid}.status.json")
assert conflict_status["blocker_reason"] == "write_scope_conflict", conflict_status
assert "N1" in conflict_status["blocked_by"], conflict_status

events = (root / "sprints" / f"{conflict_sid}.events.jsonl").read_text(encoding="utf-8")
assert "autopilot_dag_bridge_blocked" in events, events
PY

echo "PASS: autopilot DAG bridge blocker writeback"
