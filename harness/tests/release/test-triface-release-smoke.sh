#!/usr/bin/env bash
# test-triface-release-smoke.sh — S05 Triface Cutover Release Smoke
# Re-runs V1 regression (>=2 cases) + V3 canary summary replay
set -euo pipefail

HARNESS_DIR="/Users/lisihao/.solar/harness"
FAIL=0

echo "=== S05 Triface Release Smoke ==="
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# ── ACC-1: Collected artifacts JSON exists and has correct schema + sprint_id ──
echo "--- [ACC-1] Checking collected artifacts JSON ---"
ARTIFACTS_JSON="$HARNESS_DIR/tests/s05-collected-artifacts.triface-cutover.json"
if [ ! -f "$ARTIFACTS_JSON" ]; then
  echo "FAIL: $ARTIFACTS_JSON not found"
  FAIL=1
else
  SCHEMA=$(python3 -c "import json; print(json.load(open('$ARTIFACTS_JSON')).get('schema',''))")
  SPRINT=$(python3 -c "import json; print(json.load(open('$ARTIFACTS_JSON')).get('sprint_id',''))")
  EXPECTED_SPRINT="sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s05-verification-release"
  if [ "$SCHEMA" != "solar.s05.collected_artifacts.v2" ]; then
    echo "FAIL: schema=$SCHEMA, expected solar.s05.collected_artifacts.v2"
    FAIL=1
  elif [ "$SPRINT" != "$EXPECTED_SPRINT" ]; then
    echo "FAIL: sprint_id=$SPRINT does not match expected sprint"
    FAIL=1
  else
    echo "PASS: schema=$SCHEMA sprint_id matches"
  fi
fi
echo ""

# ── ACC-2: Re-run at least 2 V1 regression cases ──
echo "--- [ACC-2] Re-running V1 regression: task_graph_io ---"
TG_IO="$HARNESS_DIR/tests/regression/test-triface-task_graph_io.py"
if [ -f "$TG_IO" ]; then
  python3 "$TG_IO" 2>&1 | tail -5
  RC=${PIPESTATUS[0]:-0}
  if [ "$RC" -eq 0 ]; then
    echo "PASS: task_graph_io regression re-run exit 0"
  else
    echo "FAIL: task_graph_io regression re-run exit $RC"
    FAIL=1
  fi
else
  echo "SKIP: $TG_IO not found"
  FAIL=1
fi
echo ""

echo "--- [ACC-2] Re-running V1 regression: graph_scheduler ---"
GS="$HARNESS_DIR/tests/regression/test-triface-graph_scheduler.py"
if [ -f "$GS" ]; then
  python3 "$GS" 2>&1 | tail -5
  RC=${PIPESTATUS[0]:-0}
  if [ "$RC" -eq 0 ]; then
    echo "PASS: graph_scheduler regression re-run exit 0"
  else
    echo "FAIL: graph_scheduler regression re-run exit $RC"
    FAIL=1
  fi
else
  echo "SKIP: $GS not found"
  FAIL=1
fi
echo ""

# ── ACC-3: V3 canary summary still replayable ──
echo "--- [ACC-3] V3 canary summary replay check ---"
CANARY_SUMMARY="$HARNESS_DIR/state/orchestration-cutover-canary/s05/20260606T174321Z-final/summary.json"
if [ ! -f "$CANARY_SUMMARY" ]; then
  echo "FAIL: $CANARY_SUMMARY not found"
  FAIL=1
else
  ALL_ZERO=$(python3 -c "import json; d=json.load(open('$CANARY_SUMMARY')); print(d.get('all_zero_diff', False))")
  DECISION=$(python3 -c "import json; d=json.load(open('$CANARY_SUMMARY')); print(d.get('decision_taken',''))")
  SAMPLED=$(python3 -c "import json; d=json.load(open('$CANARY_SUMMARY')); print(d.get('total_sprints_sampled',0))")

  if [ "$ALL_ZERO" != "True" ]; then
    echo "FAIL: all_zero_diff=$ALL_ZERO, expected True"
    FAIL=1
  elif [ "$DECISION" != "state" ]; then
    echo "FAIL: decision_taken=$DECISION, expected state"
    FAIL=1
  elif [ "$SAMPLED" -lt 3 ]; then
    echo "FAIL: total_sprints_sampled=$SAMPLED, expected >=3"
    FAIL=1
  else
    echo "PASS: canary summary replayable (all_zero_diff=True, decision=state, sampled=$SAMPLED)"
  fi
fi
echo ""

# ── ACC-4: Verification report exists ──
echo "--- [ACC-4] Checking verification report ---"
REPORT="$HARNESS_DIR/reports/s05-triface-cutover-verification.md"
if [ ! -f "$REPORT" ]; then
  echo "FAIL: $REPORT not found"
  FAIL=1
else
  # Check report mentions V0..V4 sections
  for v in V0 V1 V2 V3 V4; do
    if grep -q "## $v " "$REPORT" || grep -q "## $v —" "$REPORT"; then
      echo "  $v section: found"
    else
      echo "FAIL: $REPORT missing $v section"
      FAIL=1
    fi
  done
fi
echo ""

# ── Summary ──
echo "=== Release Smoke Result ==="
if [ "$FAIL" -eq 0 ]; then
  echo "ALL PASS"
  echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exit 0
else
  echo "FAILURES: $FAIL"
  echo "Finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  exit 1
fi
