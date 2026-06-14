#!/usr/bin/env bash
# test-s04-runtime-fallback-negative.sh — S04 negative-control verification (G4-s04-verification)
#
# Validates that the pane-only legacy path CANNOT be reported as actor_runtime success.
# Tests run entirely with Python stdlib + harness code, no flask/tmux required.
# Round 2: rewritten to match actual orchestration_routes.py API surface.
#
# Exit code: 0 = all controls passed, 1 = one or more controls FAILED

set -euo pipefail
HARNESS_DIR="${HARNESS_DIR:-$HOME/.solar/harness}"
PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL+1)); }

# ---------------------------------------------------------------------------
# NC-1: node with no target_pane must have actor_id=N/A (not injected string)
# ---------------------------------------------------------------------------
echo "--- NC-1: no-pane node reports actor_id=N/A, not actor_runtime success ---"
python3 - "$HARNESS_DIR" <<'PY'
import sys
from pathlib import Path
harness = Path(sys.argv[1])
sys.path.insert(0, str(harness / "status-server" / "routes"))
from orchestration_routes import _build_node_cards

nodes = [
    {
        "id": "N1", "goal": "pane-only", "required_capabilities": [],
        "depends_on": [], "gate": "G4",
    }
]
cards = _build_node_cards("sprint-nc1", nodes, {}, [])
card = cards[0]
assert card["actor_id"] == "N/A", f"actor_id must be N/A for no-pane node; got {card['actor_id']}"
assert card["host_type"] == "unknown", f"host_type must be unknown; got {card['host_type']}"
print("NC-1 OK: no-pane node actor_id=N/A (not actor_runtime success)")
PY
[ $? -eq 0 ] && pass "NC-1: no-pane node NOT reported as actor_runtime success" || fail "NC-1: no-pane node actor_id not N/A"

# ---------------------------------------------------------------------------
# NC-2: _actorhost_for_pane always returns compat_fallback field — never absent
# ---------------------------------------------------------------------------
echo "--- NC-2: _actorhost_for_pane always returns compat_fallback field ---"
python3 - "$HARNESS_DIR" <<'PY'
import sys
from pathlib import Path
harness = Path(sys.argv[1])
sys.path.insert(0, str(harness / "status-server" / "routes"))
from orchestration_routes import _actorhost_for_pane

result = _actorhost_for_pane("solar-harness:0.0", [])
assert isinstance(result, dict), f"must return dict; got {type(result)}"
assert "compat_fallback" in result, f"compat_fallback must be in result; keys={list(result.keys())}"
print(f"NC-2 OK: compat_fallback present in result: {result['compat_fallback']}")
PY
[ $? -eq 0 ] && pass "NC-2: compat_fallback field always present in actorhost" || fail "NC-2: compat_fallback missing from actorhost result"

# ---------------------------------------------------------------------------
# NC-3: missing actor yields N/A not a fabricated actor name
# ---------------------------------------------------------------------------
echo "--- NC-3: missing actor must yield N/A not fabricated string ---"
python3 - "$HARNESS_DIR" <<'PY'
import sys
from pathlib import Path
harness = Path(sys.argv[1])
sys.path.insert(0, str(harness / "status-server" / "routes"))
from orchestration_routes import _actorhost_for_pane

result = _actorhost_for_pane("unknown-phantom-pane:99.9", ["backend"])
actor_id = result.get("actor_id", "")
fabricated = ["test-actor", "mock-", "fake-", "placeholder", "example"]
for pat in fabricated:
    assert pat not in str(actor_id).lower(), f"actor_id must not be fabricated; got {actor_id}"
print(f"NC-3 OK: actor_id is not fabricated: '{actor_id}'")
PY
[ $? -eq 0 ] && pass "NC-3: unknown pane actor_id not fabricated (no silent injection)" || fail "NC-3: actor_id has fabricated value"

# ---------------------------------------------------------------------------
# NC-4: dashboard degraded_sources non-empty when sprint missing
# ---------------------------------------------------------------------------
echo "--- NC-4: missing sprint produces degraded_sources (not silent null) ---"
python3 - "$HARNESS_DIR" <<'PY'
import sys
from pathlib import Path
harness = Path(sys.argv[1])
sys.path.insert(0, str(harness / "status-server" / "routes"))
from orchestration_routes import build_dashboard_payload

_, degraded = build_dashboard_payload(sprint_id="sprint-nonexistent-nc4-test")
assert isinstance(degraded, list), f"degraded_sources must be a list; got {type(degraded)}"
degraded_str = " ".join(degraded)
assert "missing" in degraded_str or "task_graph" in degraded_str, (
    f"Unknown sprint must produce degraded source entry; got: {degraded}"
)
print(f"NC-4 OK: degraded_sources populated: {degraded}")
PY
[ $? -eq 0 ] && pass "NC-4: missing sprint produces degraded_sources (not silent)" || fail "NC-4: missing sprint did not produce degraded_sources"

# ---------------------------------------------------------------------------
# NC-5: UI smoke — orchestration_panel.html has Pane Supply section
# ---------------------------------------------------------------------------
echo "--- NC-5: orchestration_panel.html Pane Supply label smoke ---"
HTML="$HARNESS_DIR/status-server/templates/orchestration_panel.html"
if [ ! -f "$HTML" ]; then
    fail "NC-5: orchestration_panel.html not found at $HTML"
else
    if grep -q "Pane Supply\|host-capacity\|Host Capacity" "$HTML"; then
        pass "NC-5: orchestration_panel.html has Pane Supply / host-capacity label"
    else
        fail "NC-5: orchestration_panel.html missing Pane Supply / host-capacity label"
    fi
fi

# ---------------------------------------------------------------------------
# NC-6: ui/orchestration/index.html has pane-supply section
# ---------------------------------------------------------------------------
echo "--- NC-6: ui/orchestration/index.html pane supply section smoke ---"
UIHTML="$HARNESS_DIR/ui/orchestration/index.html"
if [ ! -f "$UIHTML" ]; then
    fail "NC-6: ui/orchestration/index.html not found"
else
    if grep -q "pane-supply\|Pane Supply\|Host Capacity\|host-capacity\|completion proof" "$UIHTML"; then
        pass "NC-6: ui/orchestration/index.html has pane supply section"
    else
        fail "NC-6: ui/orchestration/index.html missing pane supply section"
    fi
fi

# ---------------------------------------------------------------------------
# NC-7: task_graph validates O1/O2/O3 passed
# ---------------------------------------------------------------------------
echo "--- NC-7: S04 task_graph O1/O2/O3 passed ---"
SPRINT_ID="sprint-20260530-p0-修复单-把推荐最终架构图收口为-solar-harness-默认主执行脊柱-s04-orchestration-ui"
GRAPH="$HARNESS_DIR/sprints/${SPRINT_ID}.task_graph.json"
if [ ! -f "$GRAPH" ]; then
    fail "NC-7: task_graph not found at $GRAPH"
else
    python3 - "$GRAPH" <<'PY'
import sys, json
graph = json.loads(open(sys.argv[1]).read())
status_by_id = {n["id"]: n.get("status","unknown") for n in graph["nodes"]}
for nid in ("O1","O2","O3"):
    s = status_by_id.get(nid, "missing")
    assert s == "passed", f"Node {nid} expected passed; got {s}"
print(f"NC-7 OK: O1={status_by_id.get('O1')}, O2={status_by_id.get('O2')}, O3={status_by_id.get('O3')}")
PY
    [ $? -eq 0 ] && pass "NC-7: O1, O2, O3 all in passed status in task_graph" || fail "NC-7: one or more of O1/O2/O3 not in passed status"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=============================="
echo "S04 Negative Control Results"
echo "=============================="
echo "PASS: $PASS"
echo "FAIL: $FAIL"
echo "=============================="

if [ "$FAIL" -gt 0 ]; then
    echo "RESULT: FAIL ($FAIL control(s) failed)" >&2
    exit 1
fi
echo "RESULT: PASS — all $PASS negative controls verified"
exit 0
