#!/usr/bin/env bash
# Triface NC-2 · stale_node_results
#
# Scenario: State has N1=passed, N2=passed but spec has N3 (depends on N2)
#           which is absent from state.  triface_parent_ready must report
#           open_nodes=[N3], ready=False, reason=closure_incomplete.
#
# Exit 0: system correctly detected stale node results.
# Exit 1: detection failed.

set -euo pipefail

CASE="stale_node_results"
FIXTURE_DIR="$(cd "$(dirname "$0")/../fixtures/triface-negative/${CASE}" && pwd)"
REPORT_DIR="$(cd "$(dirname "$0")/../../reports/s05/negative" && pwd)"
LOG_FILE="${REPORT_DIR}/${CASE}.log"

REAL_HARNESS_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
HARNESS_DIR="${FIXTURE_DIR}"
SPRINTS_DIR="${FIXTURE_DIR}/sprints"
SID="triface-nc-stale-nodes"

export HARNESS_DIR SPRINTS_DIR REAL_HARNESS_DIR

echo "=== Triface NC-2: stale_node_results ===" | tee "${LOG_FILE}"
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

sid = "triface-nc-stale-nodes"
harness_dir = Path(os.environ["HARNESS_DIR"])
sprints_dir = Path(os.environ["SPRINTS_DIR"])
real_harness = Path(os.environ["REAL_HARNESS_DIR"])

sys.path.insert(0, str(real_harness / "lib"))
import task_graph_io as tgio

spec = tgio.load_spec(sid)
state = tgio.load_state(sid)
closure = tgio.load_closure(sid)

print(f"spec nodes: {[n['id'] for n in spec.get('nodes', [])]}")
print(f"state node_results keys: {list(state.get('node_results', {}).keys())}")
print(f"closure all_nodes_passed: {closure.get('all_nodes_passed')}")

# Verify fixture setup
spec_node_ids = {n["id"] for n in spec.get("nodes", [])}
state_result_ids = set(state.get("node_results", {}).keys())
stale_nodes = spec_node_ids - state_result_ids
print(f"nodes in spec but absent from state (stale): {stale_nodes}")
assert stale_nodes, f"Expected stale nodes but found none — fixture issue: spec={spec_node_ids} state={state_result_ids}"
assert "N3" in stale_nodes, f"Expected N3 to be stale, got: {stale_nodes}"

# triface_parent_ready should NOT be ready
result = tgio.triface_parent_ready(sid)
print(f"triface_parent_ready: {json.dumps(result, indent=2)}")

assert not result["ready"], f"Expected ready=False (N3 missing from state), got: {result}"
open_nodes = result.get("open_nodes", [])
print(f"open_nodes reported: {open_nodes}")
assert "N3" in open_nodes, f"Expected N3 in open_nodes, got: {open_nodes}"

missing_gates = result.get("missing_gates", [])
print(f"missing_gates: {missing_gates}")
assert "G1" in missing_gates, f"Expected G1 in missing_gates (N3 is G1 gate), got: {missing_gates}"

# Closure also confirms incomplete
assert not closure.get("all_nodes_passed"), "closure.all_nodes_passed should be False"
assert not closure.get("all_required_gates_passed"), "closure.all_required_gates_passed should be False"

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
    closure={"open_nodes": open_nodes, "missing_gates": missing_gates},
)
kinds = [d.get("kind") for d in diagnostics]
print(f"diagnostic_kinds: {kinds}")
assert "closeout_incomplete" in kinds, f"expected closeout_incomplete diagnostic, got {kinds}"

print("DIAGNOSTIC VERIFIED: real _build_blocker_diagnostics emitted closeout_incomplete")
print("kind: closeout_incomplete")
print("PASS NC-2 stale_node_results: triface_parent_ready correctly flagged N3 as open")
PY

RC=$?
if [[ "${RC}" -ne 0 ]]; then
    echo "FAIL NC-2 stale_node_results: detection script exited ${RC}" | tee -a "${LOG_FILE}"
    exit 1
fi

echo "OK test-triface-stale-node-results.sh" | tee -a "${LOG_FILE}"
