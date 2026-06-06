#!/usr/bin/env bash

# Shared lockdir helper for launchd-style report/collection scripts.
# Return codes:
#   0  lock acquired
#   75 another live process owns the lock; caller should skip cleanly
#   1  lock path/acquire error

solar_lockdir_emit_event() {
  local action="$1"
  local event_status="$2"
  local lock_dir="$3"
  local label="${4:-solar-lockdir}"
  local other_pid="${5:-}"
  local detail="${6:-}"
  local event_log="${SOLAR_LOCK_EVENT_LOG:-${HOME}/.solar/harness/state/report-lock-events.jsonl}"

  SOLAR_LOCK_EVENT_ACTION="$action" \
  SOLAR_LOCK_EVENT_STATUS="$event_status" \
  SOLAR_LOCK_EVENT_LOCK_DIR="$lock_dir" \
  SOLAR_LOCK_EVENT_LABEL="$label" \
  SOLAR_LOCK_EVENT_PID="$$" \
  SOLAR_LOCK_EVENT_OTHER_PID="$other_pid" \
  SOLAR_LOCK_EVENT_DETAIL="$detail" \
  python3 - "$event_log" <<'PY' 2>/dev/null || true
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
    "action": os.environ.get("SOLAR_LOCK_EVENT_ACTION") or "",
    "status": os.environ.get("SOLAR_LOCK_EVENT_STATUS") or "",
    "label": os.environ.get("SOLAR_LOCK_EVENT_LABEL") or "",
    "lock_dir": os.environ.get("SOLAR_LOCK_EVENT_LOCK_DIR") or "",
    "pid": os.environ.get("SOLAR_LOCK_EVENT_PID") or "",
    "other_pid": os.environ.get("SOLAR_LOCK_EVENT_OTHER_PID") or "",
    "detail": os.environ.get("SOLAR_LOCK_EVENT_DETAIL") or "",
}
with path.open("a", encoding="utf-8") as fh:
    fcntl.flock(fh, fcntl.LOCK_EX)
    fh.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")
    fh.flush()
    fcntl.flock(fh, fcntl.LOCK_UN)
PY
}

solar_lockdir_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

solar_acquire_lockdir() {
  local lock_dir="$1"
  local label="${2:-solar-lockdir}"
  local pid_file
  local existing_pid

  if [[ -z "$lock_dir" || "$lock_dir" == "/" ]]; then
    echo "[$label] invalid lock dir: ${lock_dir:-N/A}" >&2
    solar_lockdir_emit_event "acquire" "error" "$lock_dir" "$label" "" "invalid_lock_dir"
    return 1
  fi

  mkdir -p "$(dirname "$lock_dir")"
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    date -u +"%Y-%m-%dT%H:%M:%SZ" > "$lock_dir/acquired_at"
    printf '%s\n' "$label" > "$lock_dir/label"
    solar_lockdir_emit_event "acquire" "acquired" "$lock_dir" "$label" "" "new_lock"
    return 0
  fi

  pid_file="$lock_dir/pid"
  existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if solar_lockdir_pid_alive "$existing_pid"; then
    echo "[$label] already running pid=$existing_pid lock_dir=$lock_dir; skip $(date)"
    solar_lockdir_emit_event "acquire" "busy_skip" "$lock_dir" "$label" "$existing_pid" "existing_pid_alive"
    return 75
  fi

  echo "[$label] stale lock removed pid=${existing_pid:-N/A} lock_dir=$lock_dir $(date)"
  solar_lockdir_emit_event "stale_cleanup" "removed" "$lock_dir" "$label" "$existing_pid" "existing_pid_dead_or_missing"
  rm -rf "$lock_dir"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    echo "[$label] failed to acquire lock after stale cleanup lock_dir=$lock_dir" >&2
    solar_lockdir_emit_event "acquire" "error" "$lock_dir" "$label" "$existing_pid" "mkdir_failed_after_stale_cleanup"
    return 1
  fi
  printf '%s\n' "$$" > "$lock_dir/pid"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$lock_dir/acquired_at"
  printf '%s\n' "$label" > "$lock_dir/label"
  solar_lockdir_emit_event "acquire" "acquired" "$lock_dir" "$label" "$existing_pid" "after_stale_cleanup"
  return 0
}

solar_release_lockdir() {
  local lock_dir="$1"
  local current_pid

  if [[ -z "$lock_dir" || ! -d "$lock_dir" ]]; then
    return 0
  fi
  current_pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
  if [[ "$current_pid" == "$$" ]]; then
    solar_lockdir_emit_event "release" "released" "$lock_dir" "$(cat "$lock_dir/label" 2>/dev/null || echo solar-lockdir)" "" "owner_exit"
    rm -rf "$lock_dir"
  fi
}
