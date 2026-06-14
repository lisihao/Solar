#!/usr/bin/env bash
# test-triface-workflow_guard.sh — triface regression wrapper for lib/workflow_guard.py
#
# Runs the real Python test that imports and exercises workflow_guard.
# Writes a schema-compliant JSON report to reports/s05/regression/workflow_guard.json.
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-$HOME/.solar/harness}"
REPORT_DIR="$HARNESS_DIR/reports/s05/regression"
REPORT_FILE="$REPORT_DIR/workflow_guard.json"
PY_TEST="$HARNESS_DIR/tests/regression/test-triface-workflow_guard.py"
MODULE="workflow_guard"

mkdir -p "$REPORT_DIR"

start_ms=$(python3 -c "import time; print(int(time.time()*1000))")

if [[ ! -f "$PY_TEST" ]]; then
  cat > "$REPORT_FILE" <<EOF
{
  "schema_version": "solar.regression.triface.v1",
  "module": "$MODULE",
  "verdict": "SKIP",
  "real_call": false,
  "command": "python3 $PY_TEST",
  "stdout_tail": "",
  "duration_ms": 0,
  "reason_on_fail": "Python test file not found: $PY_TEST"
}
EOF
  echo "SKIP: $MODULE — test file missing"
  exit 1
fi

tmpout=$(mktemp)
set +e
python3 "$PY_TEST" > "$tmpout" 2>&1
rc=$?
set -e

end_ms=$(python3 -c "import time; print(int(time.time()*1000))")
duration=$(( end_ms - start_ms ))
stdout_tail=$(tail -c 2000 "$tmpout" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')

if [[ $rc -eq 0 ]]; then
  verdict="PASS"
  reason=""
else
  verdict="FAIL"
  reason="python3 exited with rc=$rc"
fi

cat > "$REPORT_FILE" <<ENDJSON
{
  "schema_version": "solar.regression.triface.v1",
  "module": "$MODULE",
  "verdict": "$verdict",
  "real_call": true,
  "command": "python3 $PY_TEST",
  "stdout_tail": $stdout_tail,
  "duration_ms": $duration,
  "reason_on_fail": "$reason"
}
ENDJSON

rm -f "$tmpout"
echo "$verdict: $MODULE (${duration}ms)"
[[ $rc -eq 0 ]]
