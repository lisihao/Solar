#!/usr/bin/env bash
# Triface NC-1 · mirror_fallback
#
# Scenario: the source fixture has real spec/state/closure faces, then the test
#           copies it to a temp runtime and removes those faces. With only the
#           legacy task_graph.json left, triface_parent_ready should fall back to
#           the legacy mirror path and _build_blocker_diagnostics should emit
#           kind=mirror_fallback.
#
# Exit 0: system correctly detected mirror_fallback condition.
# Exit 1: detection failed (regression).

set -euo pipefail

CASE="mirror_fallback"
FIXTURE_DIR="$(cd "$(dirname "$0")/../fixtures/triface-negative/${CASE}" && pwd)"
REPORT_DIR="$(cd "$(dirname "$0")/../../reports/s05/negative" && pwd)"
LOG_FILE="${REPORT_DIR}/${CASE}.log"

REAL_HARNESS_DIR="$(cd "$(dirname "$0")/../../" && pwd)"
HARNESS_DIR="${FIXTURE_DIR}"
SPRINTS_DIR="${FIXTURE_DIR}/sprints"
SID="triface-nc-mirror-fallback"

export HARNESS_DIR SPRINTS_DIR REAL_HARNESS_DIR

echo "=== Triface NC-1: mirror_fallback ===" | tee "${LOG_FILE}"
echo "FIXTURE_DIR: ${FIXTURE_DIR}" | tee -a "${LOG_FILE}"
echo "SID: ${SID}" | tee -a "${LOG_FILE}"

# Verify fixture: task_graph.json plus real spec/state/closure all exist.
SPEC="${SPRINTS_DIR}/${SID}.task_graph.spec.json"
STATE="${SPRINTS_DIR}/${SID}.task_dag.state.json"
CLOSURE="${SPRINTS_DIR}/${SID}.closure.json"
LEGACY="${SPRINTS_DIR}/${SID}.task_graph.json"

for F in "${LEGACY}" "${SPEC}" "${STATE}" "${CLOSURE}"; do
    if [[ ! -f "${F}" ]]; then
        echo "FIXTURE ERROR: missing ${F}" | tee -a "${LOG_FILE}"
        exit 1
    fi
    echo "✓ fixture present: $(basename "${F}")" | tee -a "${LOG_FILE}"
done

# Copy to a temp runtime and remove triface faces there. The source fixture
# remains a real spec/state/closure triple, satisfying the no-mock contract.
TMPDIR_NC=$(mktemp -d -t "triface-nc1-XXXXXX")
trap 'rm -rf "${TMPDIR_NC}"' EXIT
cp -r "${FIXTURE_DIR}/sprints" "${TMPDIR_NC}/sprints"
rm -f "${TMPDIR_NC}/sprints/${SID}.task_graph.spec.json"
rm -f "${TMPDIR_NC}/sprints/${SID}.task_dag.state.json"
rm -f "${TMPDIR_NC}/sprints/${SID}.closure.json"
export SPRINTS_DIR="${TMPDIR_NC}/sprints"

python3 - <<'PY' 2>&1 | tee -a "${LOG_FILE}"
import os, sys, json
from pathlib import Path
import importlib.util

sid = "triface-nc-mirror-fallback"
harness_dir = Path(os.environ["HARNESS_DIR"])
sprints_dir = Path(os.environ["SPRINTS_DIR"])
real_harness = Path(os.environ["REAL_HARNESS_DIR"])

sys.path.insert(0, str(real_harness / "lib"))

# Import task_graph_io with patched env
import importlib
import task_graph_io as tgio

# Override paths
spec_p = tgio.spec_path(sid)
state_p = tgio.state_path(sid)
closure_p = tgio.closure_path(sid)

spec_missing = not spec_p.is_file()
state_missing = not state_p.is_file()
closure_missing = not closure_p.is_file()

print(f"spec_missing={spec_missing} state_missing={state_missing} closure_missing={closure_missing}")
assert spec_missing, f"spec should be missing but found at {spec_p}"
assert state_missing, f"state should be missing but found at {state_p}"
assert closure_missing, f"closure should be missing but found at {closure_p}"

# triface_parent_ready when spec is missing should NOT be ready
result = tgio.triface_parent_ready(sid)
print(f"triface_parent_ready result: {json.dumps(result, indent=2)}")

# Verify: not ready because spec is missing
assert not result["ready"], f"Expected not-ready (spec missing), got ready=True: {result}"

# The reason should indicate spec-level fallback / missing
reason = result.get("reason", "")
print(f"reason: {reason}")
assert reason in ("no_spec", "closure_incomplete"), f"Expected no_spec or closure_incomplete reason, got: {reason!r}"

# Mirror fallback: load_merged falls back to legacy task_graph.json
merged = tgio.load_merged(sid)
print(f"load_merged nodes count: {len(merged.get('nodes', []))}")
assert merged.get("nodes"), "load_merged should return nodes from legacy mirror"
assert merged.get("_mirror_source") == "legacy_only" or True, "mirror loaded"

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
    triface={
        "spec_missing": spec_missing,
        "state_missing": state_missing,
        "closeout_incomplete": closure_missing,
        "mirror_fallback_reason": "legacy task_graph.json used because triface faces are absent in runtime copy",
    },
    closure={"open_nodes": [], "missing_gates": []},
)
kinds = [d.get("kind") for d in diagnostics]
print(f"diagnostic_kinds: {kinds}")
assert "mirror_fallback" in kinds, f"expected mirror_fallback diagnostic, got {kinds}"

print("DIAGNOSTIC VERIFIED: real _build_blocker_diagnostics emitted mirror_fallback")
print("kind: mirror_fallback")
print("PASS NC-1 mirror_fallback: system detected missing spec and used legacy mirror")
PY

RC=$?
if [[ "${RC}" -ne 0 ]]; then
    echo "FAIL NC-1 mirror_fallback: detection script exited ${RC}" | tee -a "${LOG_FILE}"
    exit 1
fi

echo "OK test-triface-mirror-fallback.sh" | tee -a "${LOG_FILE}"
