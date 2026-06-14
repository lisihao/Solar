#!/usr/bin/env bash
# test-triface-canary-replay.sh — S05 canary proof smoke on copied real sprints.
set -euo pipefail

LIVE_HARNESS_DIR="${HARNESS_DIR:-$HOME/.solar/harness}"
cd "$LIVE_HARNESS_DIR"

TOOL="$LIVE_HARNESS_DIR/tools/orchestration_canary_replay.py"
AUTOPILOT="$LIVE_HARNESS_DIR/tools/autopilot.py"
CANARY_ID="${S05_CANARY_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
S05_DIR="$LIVE_HARNESS_DIR/state/orchestration-cutover-canary/s05/$CANARY_ID"
PASS=0
FAIL=0

# Real sprint samples are copied into a temporary HARNESS_DIR so replay can write
# reports/events without appending side effects to live sprints/*.events.jsonl.
SIDS=(
  "sprint-20260514-p0-修复-solar-harness-live-work-可见性和自动推进缺口-当没有-active-sprint-队-s03-core-runtime"
  "sprint-20260510-data-plane-storage-access-unification"
  "sprint-20260520-multitask-stale-python-runner"
)

TMP_HARNESS="$(mktemp -d "${TMPDIR:-/tmp}/solar-canary-replay.XXXXXX")"
cleanup() {
  rm -rf "$TMP_HARNESS"
}
trap cleanup EXIT

mkdir -p "$TMP_HARNESS/sprints" "$TMP_HARNESS/state" "$S05_DIR"

for sid in "${SIDS[@]}"; do
  for suffix in task_graph.json task_dag.state.json; do
    src="$LIVE_HARNESS_DIR/sprints/$sid.$suffix"
    if [[ ! -f "$src" ]]; then
      echo "FAIL: missing real sprint artifact: $src"
      FAIL=$((FAIL + 1))
      continue
    fi
    cp "$src" "$TMP_HARNESS/sprints/$sid.$suffix"
  done
done

: > "$S05_DIR/events.jsonl"
: > "$S05_DIR/replay-stdout.jsonl"
: > "$S05_DIR/replay-stderr.log"
: > "$S05_DIR/autopilot-select-ready.jsonl"

for sid in "${SIDS[@]}"; do
  stdout_file="$TMP_HARNESS/$sid.replay.stdout.json"
  stderr_file="$TMP_HARNESS/$sid.replay.stderr.log"
  autopilot_file="$TMP_HARNESS/$sid.autopilot.json"

  if ! HARNESS_DIR="$TMP_HARNESS" python3 "$TOOL" replay --sid "$sid" >"$stdout_file" 2>"$stderr_file"; then
    echo "FAIL: replay failed for $sid"
    cat "$stderr_file"
    FAIL=$((FAIL + 1))
    continue
  fi

  python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1], encoding='utf-8')), ensure_ascii=False))" "$stdout_file" >> "$S05_DIR/replay-stdout.jsonl"
  cat "$stderr_file" >> "$S05_DIR/replay-stderr.log"

  if ! diff_count=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('diff_count', -1))" "$stdout_file" 2>/dev/null); then
    echo "FAIL: could not parse replay stdout for $sid"
    FAIL=$((FAIL + 1))
    continue
  fi
  state_loaded=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('state_loaded', False))" "$stdout_file" 2>/dev/null)
  decision_taken=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('decision_taken', ''))" "$stdout_file" 2>/dev/null)

  if ! HARNESS_DIR="$TMP_HARNESS" python3 "$AUTOPILOT" select-ready --sprint "$sid" >"$autopilot_file" 2>>"$S05_DIR/replay-stderr.log"; then
    echo "FAIL: autopilot select-ready failed for $sid"
    FAIL=$((FAIL + 1))
    continue
  fi
  python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1], encoding='utf-8')), ensure_ascii=False))" "$autopilot_file" >> "$S05_DIR/autopilot-select-ready.jsonl"
  autopilot_decision=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('decision_taken', ''))" "$autopilot_file" 2>/dev/null)

  if [[ "$diff_count" = "0" && "$state_loaded" = "True" && "$decision_taken" = "state" && "$autopilot_decision" = "state" ]]; then
    echo "PASS: $sid (diff_count=0, state_loaded=true, decision_taken=state)"
    python3 - "$stdout_file" "$autopilot_file" >> "$S05_DIR/events.jsonl" <<'PY'
import json
import sys

replay = json.load(open(sys.argv[1], encoding="utf-8"))
autopilot = json.load(open(sys.argv[2], encoding="utf-8"))
event = {
    "event": "autopilot_cutover_diff",
    "sprint_id": replay.get("sprint_id"),
    "decision_taken": replay.get("decision_taken"),
    "autopilot_decision_taken": autopilot.get("decision_taken"),
    "inline_ready": replay.get("inline_ready", []),
    "state_ready": replay.get("state_ready", []),
    "diff_added": replay.get("diff_added", []),
    "diff_removed": replay.get("diff_removed", []),
    "drift_detected": replay.get("drift_detected"),
    "diff_count": replay.get("diff_count"),
    "zero_diff": replay.get("diff_count") == 0,
    "state_loaded": replay.get("state_loaded"),
    "node_count": replay.get("node_count"),
    "node_results_count": replay.get("node_results_count"),
    "report_path": replay.get("report_path"),
    "source_harness_dir": "temp_copied_real_sprints",
}
print(json.dumps(event, ensure_ascii=False))
PY
    PASS=$((PASS + 1))
  else
    echo "FAIL: $sid (diff_count=$diff_count, state_loaded=$state_loaded, decision_taken=$decision_taken, autopilot_decision=$autopilot_decision)"
    FAIL=$((FAIL + 1))
  fi
done

python3 - "$S05_DIR/events.jsonl" "$S05_DIR/summary.json" "$CANARY_ID" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

events_path = Path(sys.argv[1])
summary_path = Path(sys.argv[2])
canary_id = sys.argv[3]
events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
sprints = []
for event in events:
    sprints.append({
        "sprint_id": event.get("sprint_id"),
        "zero_diff": bool(event.get("zero_diff")),
        "diff_count": event.get("diff_count"),
        "diff_added": event.get("diff_added", []),
        "diff_removed": event.get("diff_removed", []),
        "inline_ready": event.get("inline_ready", []),
        "state_ready": event.get("state_ready", []),
        "node_count": event.get("node_count"),
        "node_results_count": event.get("node_results_count"),
        "state_loaded": event.get("state_loaded"),
    })

summary = {
    "schema": "solar.orchestration_canary_summary.v1",
    "canary_id": canary_id,
    "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "decision_taken": "state" if events and all(e.get("decision_taken") == "state" for e in events) else "unknown",
    "autopilot_decision_taken": "state" if events and all(e.get("autopilot_decision_taken") == "state" for e in events) else "unknown",
    "total_sprints_sampled": len(events),
    "all_zero_diff": bool(events) and all(e.get("diff_count") == 0 for e in events),
    "zero_diff_count": sum(1 for e in events if e.get("diff_count") == 0),
    "non_zero_diff_count": sum(1 for e in events if e.get("diff_count") != 0),
    "total_nodes": sum(int(e.get("node_count") or 0) for e in events),
    "total_node_results": sum(int(e.get("node_results_count") or 0) for e in events),
    "sprints": sprints,
    "source": "orchestration_canary_replay.py + autopilot.py select-ready against temp HARNESS_DIR copied from real sprint graph/state artifacts",
}
summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY

echo ""
echo "Results: PASS=$PASS FAIL=$FAIL"
echo "S05 evidence: $S05_DIR"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
echo "All canary replays passed with zero diff."
