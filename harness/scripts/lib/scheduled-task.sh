#!/usr/bin/env bash

# Shared failure-recording helper for launchd-driven run_*.sh scripts.
#
# Usage:
#   source "$HARNESS_DIR/scripts/lib/scheduled-task.sh"
#   solar_task_record_failure "<task-name>" "<rc>" "<failed-steps>"
#
# Appends one JSON line per failed run to
#   ${SOLAR_TASK_FAILURE_LOG:-${SOLAR_HOME:-$HOME/.solar}/harness/state/scheduled-task-failures.jsonl}
# so failures stay queryable even when a task is allowed to exit 0
# (ALLOW_PARTIAL_SUCCESS=1). The staleness sentinel and weekly report
# read this file; recording must never crash the caller.

solar_task_record_failure() {
  local task="$1"
  local rc="$2"
  local steps="${3:-}"
  local log_file="${SOLAR_TASK_FAILURE_LOG:-${SOLAR_HOME:-$HOME/.solar}/harness/state/scheduled-task-failures.jsonl}"

  SOLAR_TASK_FAIL_TASK="$task" \
  SOLAR_TASK_FAIL_RC="$rc" \
  SOLAR_TASK_FAIL_STEPS="$steps" \
  python3 - "$log_file" <<'PY' || echo "[$task] warn: failed to record failure to $log_file" >&2
import datetime as dt
import fcntl
import json
import os
import pathlib
import sys

path = pathlib.Path(sys.argv[1]).expanduser()
path.parent.mkdir(parents=True, exist_ok=True)
payload = {
    "ts": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
    "task": os.environ.get("SOLAR_TASK_FAIL_TASK") or "",
    "rc": int(os.environ.get("SOLAR_TASK_FAIL_RC") or 1),
    "failed_steps": [s for s in (os.environ.get("SOLAR_TASK_FAIL_STEPS") or "").split("|") if s],
    "pid": os.getpid(),
}
with path.open("a", encoding="utf-8") as fh:
    fcntl.flock(fh, fcntl.LOCK_EX)
    fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    fh.flush()
    fcntl.flock(fh, fcntl.LOCK_UN)
PY
}
