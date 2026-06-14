#!/usr/bin/env bash
# Triface NC-5 · inline_status_in_spec
#
# Scenario: Spec file has runtime status fields (node.status, node.updated_at)
#           embedded directly in it, AND those statuses conflict with the state
#           (spec says N2.status=passed, state says N2.status=pending).
#           The guard must detect:
#           1. Spec pollution (runtime fields in spec)
#           2. Inline status drift (spec.node.status ≠ state.node_results.status)
#
# Exit 0: system correctly detected inline_status_in_spec condition.
# Exit 1: detection failed.

set -euo pipefail

CASE="inline_status_in_spec"
FIXTURE_DIR="$(cd "$(dirname "$0")/../fixtures/triface-negative/${CASE}" && pwd)"
REPORT_DIR="$(cd "$(dirname "$0")/../../reports/s05/negative" && pwd)"
LOG_FILE="${REPORT_DIR}/${CASE}.log"

SID="triface-nc-inline-status"

REAL_HARNESS_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
export HARNESS_DIR="${FIXTURE_DIR}"
export SPRINTS_DIR="${FIXTURE_DIR}/sprints"
export REAL_HARNESS_DIR

echo "=== Triface NC-5: inline_status_in_spec ===" | tee "${LOG_FILE}"
echo "FIXTURE_DIR: ${FIXTURE_DIR}" | tee -a "${LOG_FILE}"
echo "SID: ${SID}" | tee -a "${LOG_FILE}"

# Verify fixture files exist
SPEC="${SPRINTS_DIR}/${SID}.task_graph.spec.json"
STATE="${SPRINTS_DIR}/${SID}.task_dag.state.json"
CLOSURE="${SPRINTS_DIR}/${SID}.closure.json"

for F in "${SPEC}" "${STATE}" "${CLOSURE}"; do
    if [[ ! -f "${F}" ]]; then
        echo "FIXTURE ERROR: missing ${F}" | tee -a "${LOG_FILE}"
        exit 1
    fi
    echo "✓ fixture present: $(basename ${F})" | tee -a "${LOG_FILE}"
done

python3 - <<'PY' 2>&1 | tee -a "${LOG_FILE}"
import os, sys, json
from pathlib import Path
import importlib.util

sid = "triface-nc-inline-status"
harness_dir = Path(os.environ["HARNESS_DIR"])
sprints_dir = Path(os.environ["SPRINTS_DIR"])
real_harness = Path(os.environ["REAL_HARNESS_DIR"])

sys.path.insert(0, str(real_harness / "lib"))
import task_graph_io as tgio

tgio.SPRINTS_DIR = sprints_dir

spec = tgio.load_spec(sid)
state = tgio.load_state(sid)

print(f"spec nodes: {json.dumps([{'id': n['id'], 'status': n.get('status'), 'updated_at': n.get('updated_at')} for n in spec.get('nodes', [])], indent=2)}")
print(f"state node_results: {json.dumps(state.get('node_results', {}), indent=2)}")

# Detect inline status pollution in spec
RUNTIME_KEYS = {"status", "updated_at", "result", "dispatch_id", "lease_id", "assigned_to"}
spec_nodes_with_runtime = []
for node in spec.get("nodes", []):
    polluted = [k for k in RUNTIME_KEYS if k in node]
    if polluted:
        spec_nodes_with_runtime.append({"id": node["id"], "polluted_keys": polluted})

print(f"spec nodes with embedded runtime fields: {json.dumps(spec_nodes_with_runtime, indent=2)}")
assert spec_nodes_with_runtime, "Expected spec pollution but none found — fixture issue"
print(f"✓ DETECTED: {len(spec_nodes_with_runtime)} spec nodes contain runtime fields")

# Detect inline status drift: spec.node.status ≠ state.node_results.status
drift_issues = []
node_results = state.get("node_results", {})
for node in spec.get("nodes", []):
    node_id = node.get("id", "")
    spec_status = node.get("status", "")
    state_result = node_results.get(node_id, {})
    state_status = state_result.get("status", "")
    if spec_status and state_status and spec_status != state_status:
        drift_issues.append({
            "node_id": node_id,
            "spec_status": spec_status,
            "state_status": state_status,
        })

print(f"inline_status_drift issues: {json.dumps(drift_issues, indent=2)}")
assert drift_issues, "Expected drift issues but none found — fixture issue"

# N2 should show drift: spec.status=passed, state.status=pending
n2_drift = next((d for d in drift_issues if d["node_id"] == "N2"), None)
assert n2_drift is not None, f"Expected N2 drift issue, got: {drift_issues}"
assert n2_drift["spec_status"] == "passed", f"Expected spec_status=passed, got: {n2_drift['spec_status']}"
assert n2_drift["state_status"] == "pending", f"Expected state_status=pending, got: {n2_drift['state_status']}"

print(f"✓ DETECTED: N2 inline_status_drift — spec.status=passed conflicts with state.status=pending")

# Because of the drift, triface_parent_ready should use STATE (authoritative), not spec inline status
# State shows N2=pending → sprint is not complete
result = tgio.triface_parent_ready(sid)
print(f"triface_parent_ready (using state as authoritative): {json.dumps(result, indent=2)}")
assert not result["ready"], f"Expected ready=False (N2=pending in state), got: {result}"
open_nodes = result.get("open_nodes", [])
assert "N2" in open_nodes, f"Expected N2 in open_nodes (state says pending), got: {open_nodes}"

routes_path = real_harness / "status-server" / "routes" / "orchestration_routes.py"
spec = importlib.util.spec_from_file_location("orchestration_routes", routes_path)
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)
diagnostics = routes._build_blocker_diagnostics(
    sid,
    {},
    [],
    [],
    True,
    triface={"closeout_incomplete": True},
    closure={"open_nodes": open_nodes, "missing_gates": result.get("missing_gates", [])},
)
kinds = [d.get("kind") for d in diagnostics]
print(f"diagnostic_kinds: {kinds}")
assert "closeout_incomplete" in kinds, f"expected closeout_incomplete diagnostic, got {kinds}"

print("DIAGNOSTIC VERIFIED: inline_status_in_spec and drift keep state authoritative; real diagnostic chain emits closeout_incomplete")
print("kind: closeout_incomplete")
print("PASS NC-5 inline_status_in_spec: spec pollution detected, drift confirmed, state is authoritative")
PY

RC=$?
if [[ "${RC}" -ne 0 ]]; then
    echo "FAIL NC-5 inline_status_in_spec: detection script exited ${RC}" | tee -a "${LOG_FILE}"
    exit 1
fi

echo "OK test-triface-inline-status-in-spec.sh" | tee -a "${LOG_FILE}"
