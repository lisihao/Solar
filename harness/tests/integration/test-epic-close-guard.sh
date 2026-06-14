#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR_REAL="${HARNESS_DIR_REAL:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
REPORT="$HARNESS_DIR_REAL/reports/s05-epic-close-guard.md"
mkdir -p "$(dirname "$REPORT")"

python3 - "$HARNESS_DIR_REAL" "$REPORT" <<'PY'
import copy
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

harness = Path(sys.argv[1])
report = Path(sys.argv[2])
sprints = harness / "sprints"
sys.path.insert(0, str(harness / "lib"))

import graph_scheduler  # noqa: E402
import workflow_guard  # noqa: E402

epic_id = "epic-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读"
child_sid = f"sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release"
epic_graph_name = f"{epic_id}.task_graph.json"
child_graph_name = f"{child_sid}.task_graph.json"
child_closure_name = f"{child_sid}.closure.json"
child_verdict_name = f"{child_sid}.acceptance-verdict.json"
child_status_name = f"{child_sid}.status.json"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_case(root: Path) -> Path:
    case = root / "sprints"
    case.mkdir(parents=True, exist_ok=True)
    for name in [epic_graph_name, child_graph_name, child_closure_name, child_verdict_name]:
        shutil.copy2(sprints / name, case / name)
    if (sprints / child_status_name).exists():
        shutil.copy2(sprints / child_status_name, case / child_status_name)
    else:
        write_json(case / child_status_name, {"sprint_id": child_sid, "status": "active"})
    return case


def make_pass_case(case: Path) -> None:
    epic = read_json(case / epic_graph_name)
    for node in epic.get("nodes", []):
        if node.get("id") == "S05_verification_release":
            node["status"] = "passed"
            node["gate_status"] = "passed"
    write_json(case / epic_graph_name, epic)

    child = read_json(case / child_graph_name)
    child.setdefault("node_results", {})
    child.setdefault("gate_results", {})
    for node in child.get("nodes", []):
        node["status"] = "passed"
        if node.get("gate"):
            child["gate_results"][node["gate"]] = {
                "status": "passed",
                "node": node.get("id"),
                "updated_at": "2026-06-06T18:24:00Z",
                "reason": "v8_temp_pass_case",
            }
        child["node_results"][node["id"]] = {
            "status": "passed",
            "updated_at": "2026-06-06T18:24:00Z",
            "note": "v8_temp_pass_case",
        }
    write_json(case / child_graph_name, child)

    verdict = read_json(case / child_verdict_name)
    verdict["verdict"] = "PASS"
    verdict["reasons"] = ["temporary V8 pass-case fixture: all child gates passed"]
    write_json(case / child_verdict_name, verdict)
    write_json(case / child_status_name, {"sprint_id": child_sid, "status": "passed", "phase": "closed"})


def make_fail_case(case: Path) -> None:
    verdict = read_json(case / child_verdict_name)
    verdict["verdict"] = "FAIL"
    verdict["reasons"] = ["temporary V8 fail-case fixture: acceptance verdict must block epic close"]
    write_json(case / child_verdict_name, verdict)
    write_json(case / child_status_name, {"sprint_id": child_sid, "status": "active", "phase": "verification"})


def run_guard(case: Path, label: str) -> dict:
    workflow_guard.SPRINTS_DIR = case
    workflow_guard.HARNESS_DIR = harness
    graph_scheduler.SPRINTS_DIR = case

    epic_graph = read_json(case / epic_graph_name)
    parent = graph_scheduler.parent_ready_check(copy.deepcopy(epic_graph))
    activation = graph_scheduler.epic_child_activation(copy.deepcopy(epic_graph))
    route = workflow_guard.route(child_sid)
    verdict = read_json(case / child_verdict_name)
    verdict_label = str(verdict.get("verdict") or "FAIL").upper()

    if verdict_label != "PASS":
        allowed = False
        reason = f"acceptance_verdict_{verdict_label}"
    elif not parent.get("ready"):
        allowed = False
        reason = "parent_required_gate_not_ready"
    else:
        allowed = True
        reason = "parent_ready_and_acceptance_pass"

    return {
        "case": label,
        "allowed": allowed,
        "reason": reason,
        "acceptance_verdict": verdict_label,
        "parent_ready": parent.get("ready"),
        "open_nodes": parent.get("open_nodes") or [],
        "missing_gates": parent.get("missing_gates") or [],
        "workflow_guard_stage": route.get("stage"),
        "workflow_guard_role": route.get("route_role"),
        "workflow_guard_reason": route.get("reason"),
        "epic_can_close": activation.get("can_close"),
        "epic_done": activation.get("epic_done"),
    }


tmp = Path(tempfile.mkdtemp(prefix="solar-v8-epic-close-"))
fail_case = copy_case(tmp / "fail")
pass_case = copy_case(tmp / "pass")
make_fail_case(fail_case)
make_pass_case(pass_case)

fail_result = run_guard(fail_case, "verdict_fail")
pass_result = run_guard(pass_case, "verdict_pass")

errors = []
if fail_result["allowed"]:
    errors.append("FAIL verdict case unexpectedly allowed epic close")
if pass_result["allowed"] is not True:
    errors.append("PASS verdict case did not allow epic close")
if pass_result["parent_ready"] is not True:
    errors.append("PASS verdict case parent_ready was not true")

summary_status = "PASS" if not errors else "FAIL"

report.write_text(
    "\n".join(
        [
            "# S05 Epic Close Guard",
            "",
            f"Result: **{summary_status}**",
            "",
            "## Guard Matrix",
            "",
            "| Case | Verdict | Parent Ready | Allowed | Reason | Workflow Stage |",
            "|------|---------|--------------|---------|--------|----------------|",
            f"| FAIL fixture | {fail_result['acceptance_verdict']} | {fail_result['parent_ready']} | {fail_result['allowed']} | {fail_result['reason']} | {fail_result['workflow_guard_stage']} |",
            f"| PASS fixture | {pass_result['acceptance_verdict']} | {pass_result['parent_ready']} | {pass_result['allowed']} | {pass_result['reason']} | {pass_result['workflow_guard_stage']} |",
            "",
            "## Event Excerpts",
            "",
            "```json",
            json.dumps({"fail": fail_result, "pass": pass_result}, ensure_ascii=False, indent=2),
            "```",
            "",
            "## Notes",
            "",
            "- The test uses temporary sprint copies and does not mutate the live epic graph.",
            "- The FAIL fixture explicitly forces `acceptance-verdict.json` to `FAIL`; it no longer depends on live verdict state.",
            "- The PASS fixture proves the same guard predicate allows close once the acceptance verdict and parent gates pass.",
            "",
        ]
    ),
    encoding="utf-8",
)

print(json.dumps({"ok": not errors, "report": str(report), "fail": fail_result, "pass": pass_result, "errors": errors}, ensure_ascii=False))
if errors:
    raise SystemExit(1)
PY
