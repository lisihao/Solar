#!/usr/bin/env bash

solar_browser_agent_enqueue_or_continue() {
  local job_name="$1"
  local cwd="$2"
  local script_path="$3"
  shift 3
  if [[ "${BROWSER_AGENT_QUEUE_BYPASS:-}" == "1" ]]; then
    return 0
  fi
  local queue_py="${BROWSER_AGENT_QUEUE_SCRIPT:-${HARNESS_DIR:-$HOME/Solar/harness}/scripts/browser_agent_queue.py}"
  if [[ ! -f "$queue_py" ]]; then
    echo "[browser-agent-queue] missing queue script: $queue_py; running inline" >&2
    return 0
  fi
  exec "${PYTHON:-python3}" "$queue_py" enqueue \
    --name "$job_name" \
    --cwd "$cwd" \
    -- /bin/bash "$script_path" "$@"
}
