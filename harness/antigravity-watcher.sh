#!/bin/bash
# Antigravity Desktop Bridge Watcher
# Scans ~/.solar/antigravity-bridge/from-antigravity for desktop app exports
# and feeds them into the Solar-Harness RawIntent -> intent_consumer chain.
#
# Design: S02 architecture, section 4.2 adapter contract
# Prefixes: req-, conv-, artifact-, review-, ctx-

set -euo pipefail

# D4: mkdir 原子锁防多开
PID_LOCK_DIR="$HOME/.solar/harness/.antigravity-watcher.lock"
mkdir "$PID_LOCK_DIR" 2>/dev/null || { echo "[antigravity-watcher] already running, exit"; exit 0; }
echo $$ > "$PID_LOCK_DIR/pid"
trap 'rm -rf "$PID_LOCK_DIR"' EXIT

HARNESS_DIR="${HARNESS_DIR:-$HOME/.solar/harness}"
BRIDGE_ROOT="${SOLAR_ANTIGRAVITY_BRIDGE_ROOT:-$HOME/.solar/antigravity-bridge}"
INBOX="$BRIDGE_ROOT/from-antigravity"
PROCESSED="$INBOX/.processed"

mkdir -p "$PROCESSED"

# D3: bridge ledger
LEDGER_SH="$HARNESS_DIR/lib/bridge-ledger.sh"
[[ -f "$LEDGER_SH" ]] && . "$LEDGER_SH"

BRIDGE_PY="$HARNESS_DIR/lib/antigravity_bridge.py"

scan_antigravity_once() {
  local out rc
  out=$(python3 "$BRIDGE_PY" scan --json 2>&1)
  rc=$?
  if [ "$rc" != "0" ]; then
    echo "[$(date '+%H:%M:%S')] antigravity scan FAILED: rc=${rc}"
    printf '%s\n' "$out" | tail -5
    return 1
  fi
  echo "[$(date '+%H:%M:%S')] antigravity scan: $out"
  type ledger_emit &>/dev/null && ledger_emit "consumed" "antigravity-bridge-scan" "{\"source\":\"antigravity_watcher\",\"result\":\"ok\"}" 2>/dev/null || true
  return 0
}

# Startup recovery: scan once to clear backlog
echo "[$(date '+%H:%M:%S')] antigravity-watcher starting (inbox=$INBOX)"

if [ ! -d "$INBOX" ]; then
  echo "[antigravity-watcher] inbox directory missing ($INBOX), creating"
  mkdir -p "$INBOX"
fi

scan_antigravity_once

# Main loop
POLL_INTERVAL="${ANTIGRAVITY_WATCHER_POLL:-30}"
while true; do
  scan_antigravity_once || true
  sleep "$POLL_INTERVAL"
done
