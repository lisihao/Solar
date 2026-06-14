#!/usr/bin/env bash
# test-orchestration-cutover-canary.sh
# Acceptance shell tests for orchestration_canary_replay.py (S04 N5 acceptance).
#
# Tests:
#   C1 — help/usage shows expected subcommands
#   C2 — replay against a real sprint succeeds (EXIT=0, JSON report written)
#   C3 — replay against missing sprint exits non-zero (EXIT!=0)
#   C4 — summary returns JSON with required fields
#   C5 — report schema validates (schema + required keys present)
#   C6 — SOLAR_ORCHESTRATION_TRIFACE=0 exits 0 with skipped=true (no-op)
#
# Exit: 0 if all tests pass, 1 if any fail.

set -euo pipefail

HARNESS_DIR="${HARNESS_DIR:-$HOME/.solar/harness}"
TOOL="$HARNESS_DIR/tools/orchestration_canary_replay.py"
REAL_SID="sprint-20260531-请为-solar-harness-开一个新的-p0-p1-架构升级单-主题是-把-task-graph-从现网单文件主读-s04-orchestration-ui"

PASS=0
FAIL=0
RESULTS=()

_pass() { echo "  ✅ PASS — $1"; PASS=$((PASS + 1)); RESULTS+=("PASS: $1"); }
_fail() { echo "  ❌ FAIL — $1"; FAIL=$((FAIL + 1)); RESULTS+=("FAIL: $1"); }

echo "=== test-orchestration-cutover-canary.sh ==="
echo "HARNESS_DIR: $HARNESS_DIR"
echo "TOOL: $TOOL"
echo ""

# Guard: tool must exist
if [[ ! -f "$TOOL" ]]; then
  echo "FATAL: tool not found: $TOOL"
  exit 2
fi

# ── C1: help/usage ───────────────────────────────────────────────────────────
echo "C1: help shows subcommands"
if python3 "$TOOL" --help 2>&1 | grep -q "replay\|summary"; then
  _pass "C1: --help shows replay and summary subcommands"
else
  _fail "C1: --help missing expected subcommands"
fi

# ── C2: replay against real sprint ───────────────────────────────────────────
echo "C2: replay against real sprint"
REAL_GRAPH="$HARNESS_DIR/sprints/${REAL_SID}.task_graph.json"
if [[ -f "$REAL_GRAPH" ]]; then
  REPLAY_OUT=$(python3 "$TOOL" replay --sid "$REAL_SID" 2>/dev/null)
  REPLAY_EXIT=$?
  if [[ "$REPLAY_EXIT" -eq 0 ]]; then
    _pass "C2: replay exits 0 against real sprint"
    # Extract report_path from JSON
    REPORT_PATH=$(echo "$REPLAY_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('report_path',''))" 2>/dev/null || true)
    if [[ -n "$REPORT_PATH" && -f "$REPORT_PATH" ]]; then
      _pass "C2b: report file written to $REPORT_PATH"
    else
      _fail "C2b: report file not found or path empty (report_path='$REPORT_PATH')"
    fi
  else
    _fail "C2: replay exited $REPLAY_EXIT against real sprint"
  fi
else
  _fail "C2: real sprint graph not found: $REAL_GRAPH (skipping C2)"
fi

# ── C3: replay against missing sprint ────────────────────────────────────────
echo "C3: replay against missing sprint exits non-zero"
BOGUS_SID="bogus-nonexistent-sprint-test-xyz-$(date +%s)"
python3 "$TOOL" replay --sid "$BOGUS_SID" >/dev/null 2>/dev/null && BOGUS_EXIT=0 || BOGUS_EXIT=$?
if [[ "$BOGUS_EXIT" -ne 0 ]]; then
  _pass "C3: missing sprint gives non-zero exit ($BOGUS_EXIT)"
else
  _fail "C3: missing sprint should exit non-zero, got 0"
fi

# ── C4: summary returns JSON with required fields ─────────────────────────────
echo "C4: summary returns valid JSON"
SUMMARY_OUT=$(python3 "$TOOL" summary --limit 5 2>/dev/null)
SUMMARY_EXIT=$?
if [[ "$SUMMARY_EXIT" -eq 0 ]]; then
  _pass "C4: summary exits 0"
  # Validate JSON has ok, zero_diff_streak, reports
  HAS_OK=$(echo "$SUMMARY_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' in d)" 2>/dev/null || echo "False")
  HAS_STREAK=$(echo "$SUMMARY_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('zero_diff_streak' in d)" 2>/dev/null || echo "False")
  HAS_REPORTS=$(echo "$SUMMARY_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print('reports' in d)" 2>/dev/null || echo "False")
  if [[ "$HAS_OK" == "True" && "$HAS_STREAK" == "True" && "$HAS_REPORTS" == "True" ]]; then
    _pass "C4b: summary JSON has ok+zero_diff_streak+reports fields"
  else
    _fail "C4b: summary JSON missing required fields (ok=$HAS_OK streak=$HAS_STREAK reports=$HAS_REPORTS)"
  fi
else
  _fail "C4: summary exited $SUMMARY_EXIT"
fi

# ── C5: report schema validation ─────────────────────────────────────────────
echo "C5: canary report schema validation"
CANARY_DIR="$HARNESS_DIR/state/orchestration-cutover-canary"
LATEST_REPORT=$(ls -t "$CANARY_DIR"/*.json 2>/dev/null | head -1 || true)
if [[ -n "$LATEST_REPORT" && -f "$LATEST_REPORT" ]]; then
  SCHEMA=$(python3 -c "import sys,json; d=json.load(open('$LATEST_REPORT')); print(d.get('schema',''))" 2>/dev/null || echo "")
  if [[ "$SCHEMA" == "solar.orchestration_canary_replay.v1" ]]; then
    _pass "C5: latest report has correct schema=$SCHEMA"
  else
    _fail "C5: schema mismatch, got '$SCHEMA'"
  fi
  # Validate required keys
  REQUIRED_KEYS="sprint_id ts diff_count drift_detected zero_diff_streak decision_taken"
  MISSING_KEYS=""
  for key in $REQUIRED_KEYS; do
    HAS=$(python3 -c "import json; d=json.load(open('$LATEST_REPORT')); print('$key' in d)" 2>/dev/null || echo "False")
    if [[ "$HAS" != "True" ]]; then
      MISSING_KEYS="$MISSING_KEYS $key"
    fi
  done
  if [[ -z "$MISSING_KEYS" ]]; then
    _pass "C5b: all required report keys present"
  else
    _fail "C5b: missing keys:$MISSING_KEYS"
  fi
else
  _fail "C5: no canary reports found in $CANARY_DIR"
fi

# ── C6: feature flag no-op ────────────────────────────────────────────────────
echo "C6: SOLAR_ORCHESTRATION_TRIFACE=0 no-op"
NOOP_OUT=$(SOLAR_ORCHESTRATION_TRIFACE=0 python3 "$TOOL" replay --sid "$REAL_SID" 2>/dev/null)
NOOP_EXIT=$?
if [[ "$NOOP_EXIT" -eq 0 ]]; then
  NOOP_SKIPPED=$(echo "$NOOP_OUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('skipped', False))" 2>/dev/null || echo "False")
  if [[ "$NOOP_SKIPPED" == "True" ]]; then
    _pass "C6: SOLAR_ORCHESTRATION_TRIFACE=0 exits 0 with skipped=True"
  else
    _fail "C6: SOLAR_ORCHESTRATION_TRIFACE=0 exits 0 but skipped!=True (got: $NOOP_SKIPPED)"
  fi
else
  _fail "C6: SOLAR_ORCHESTRATION_TRIFACE=0 exited $NOOP_EXIT (expected 0)"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Results ==="
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
echo ""
echo "PASS=$PASS FAIL=$FAIL TOTAL=$((PASS + FAIL))"

if [[ "$FAIL" -gt 0 ]]; then
  echo "VERDICT: FAIL"
  exit 1
else
  echo "VERDICT: PASS"
  exit 0
fi
