#!/usr/bin/env bash
# Triface NC-4 · closeout_incomplete
#
# Scenario: closure.json has all_nodes_passed=false and all_required_gates_passed=false.
#           triface_parent_ready must report ready=False with missing_gates and open_nodes.
#           closure_complete() must return False.
#
# Exit 0: system correctly detected closeout_incomplete condition.
# Exit 1: detection failed.

set -euo pipefail

CASE="closeout_incomplete"
FIXTURE_DIR="$(cd "$(dirname "$0")/../fixtures/triface-negative/${CASE}" && pwd)"
REPORT_DIR="$(cd "$(dirname "$0")/../../reports/s05/negative" && pwd)"
LOG_FILE="${REPORT_DIR}/${CASE}.log"

SID="triface-nc-closeout-incomplete"

REAL_HARNESS_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
export HARNESS_DIR="${FIXTURE_DIR}"
export SPRINTS_DIR="${FIXTURE_DIR}/sprints"
export REAL_HARNESS_DIR

echo "=== Triface NC-4: closeout_incomplete ===" | tee "${LOG_FILE}"
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

sid = "triface-nc-closeout-incomplete"
harness_dir = Path(os.environ["HARNESS_DIR"])
sprints_dir = Path(os.environ["SPRINTS_DIR"])
real_harness = Path(os.environ["REAL_HARNESS_DIR"])

sys.path.insert(0, str(real_harness / "lib"))
import task_graph_io as tgio

tgio.SPRINTS_DIR = sprints_dir

spec = tgio.load_spec(sid)
state = tgio.load_state(sid)
closure = tgio.load_closure(sid)

print(f"spec nodes: {[n['id'] for n in spec.get('nodes', [])]}")
print(f"state node_results: {list(state.get('node_results', {}).keys())}")
print(f"closure all_nodes_passed: {closure.get('all_nodes_passed')}")
print(f"closure all_required_gates_passed: {closure.get('all_required_gates_passed')}")
print(f"closure residual_risks: {closure.get('residual_risks', [])}")

# closure_complete must return False
is_complete = tgio.closure_complete(sid)
print(f"closure_complete: {is_complete}")
assert not is_complete, f"closure_complete should return False for incomplete closeout, got True"

# triface_parent_ready must report not ready
result = tgio.triface_parent_ready(sid)
print(f"triface_parent_ready: {json.dumps(result, indent=2)}")

assert not result["ready"], f"Expected ready=False, got: {result}"

open_nodes = result.get("open_nodes", [])
missing_gates = result.get("missing_gates", [])
print(f"open_nodes: {open_nodes}")
print(f"missing_gates: {missing_gates}")

assert "N2" in open_nodes, f"Expected N2 in open_nodes (never passed), got: {open_nodes}"
assert "G1" in missing_gates, f"Expected G1 in missing_gates (N2 never completed), got: {missing_gates}"

# Validate closure shows incomplete fields
assert closure.get("all_nodes_passed") == False, "closure.all_nodes_passed must be False"
assert closure.get("all_required_gates_passed") == False, "closure.all_required_gates_passed must be False"
assert closure.get("closed_at") is None, "closure.closed_at must be None for incomplete sprint"

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
print("PASS NC-4 closeout_incomplete: triface_parent_ready and closure_complete both report incomplete")
PY

RC=$?
if [[ "${RC}" -ne 0 ]]; then
    echo "FAIL NC-4 closeout_incomplete: detection script exited ${RC}" | tee -a "${LOG_FILE}"
    exit 1
fi

echo "OK test-triface-closeout-incomplete.sh" | tee -a "${LOG_FILE}"
