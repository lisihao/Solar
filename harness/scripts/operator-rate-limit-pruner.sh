#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

LABEL="${SOLAR_RATE_LIMIT_PRUNER_LABEL:-com.solar.harness-rate-limit-pruner}"
INTERVAL="${SOLAR_RATE_LIMIT_PRUNER_INTERVAL:-300}"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HARNESS_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/operator-rate-limit-pruner.out.log"
STDERR_LOG="${LOG_DIR}/operator-rate-limit-pruner.err.log"
LOG_WARN_BYTES="${SOLAR_LOG_WARN_BYTES:-52428800}"
EVENT_LOG_WARN_BYTES="${SOLAR_EVENT_LOG_WARN_BYTES:-268435456}"
WATERMARK_REPEAT_SECONDS="${SOLAR_LOG_WATERMARK_REPEAT_SECONDS:-86400}"
WATERMARK_STATE_DIR="${HARNESS_DIR}/run/log-watermarks"

launchd_domain() {
  printf 'gui/%s\n' "$(id -u)"
}

usage() {
  cat <<EOF
Solar Harness operator rate-limit pruner

Usage:
  $0 install [--interval SECONDS]
  $0 uninstall
  $0 status
  $0 run-once

Environment:
  SOLAR_RATE_LIMIT_PRUNER_INTERVAL  Default: 300
  SOLAR_RATE_LIMIT_PRUNER_LABEL     Default: ${LABEL}
  SOLAR_LOG_WARN_BYTES              Default: ${LOG_WARN_BYTES}
  SOLAR_EVENT_LOG_WARN_BYTES        Default: ${EVENT_LOG_WARN_BYTES}
  SOLAR_LOG_WATERMARK_REPEAT_SECONDS Default: ${WATERMARK_REPEAT_SECONDS}
EOF
}

parse_interval_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval)
        shift
        INTERVAL="${1:-}"
        ;;
      --interval=*)
        INTERVAL="${1#--interval=}"
        ;;
      *)
        echo "unknown argument: $1" >&2
        return 2
        ;;
    esac
    shift || true
  done
  if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [[ "$INTERVAL" -lt 30 ]]; then
    echo "interval must be an integer >= 30 seconds" >&2
    return 2
  fi
}

write_plist() {
  local bash_path="/bin/bash"
  [[ -x /opt/homebrew/bin/bash ]] && bash_path="/opt/homebrew/bin/bash"
  mkdir -p "$(dirname "$PLIST_PATH")" "$LOG_DIR"
  cat > "$PLIST_PATH" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bash_path}</string>
    <string>${HARNESS_DIR}/scripts/operator-rate-limit-pruner.sh</string>
    <string>run-once</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>WorkingDirectory</key>
  <string>${HARNESS_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:${HOME}/.solar/bin:${HOME}/n/bin:${HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PYTHONIOENCODING</key>
    <string>utf-8</string>
    <key>HARNESS_DIR</key>
    <string>${HARNESS_DIR}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
PLIST_EOF
}

warn_if_log_large() {
  local path="$1" threshold="$2" kind="$3"
  [[ -f "$path" ]] || return 0

  local bytes owner open_state="closed" state_key state_path last_notified=0 now
  bytes="$(stat -f '%z' "$path" 2>/dev/null || printf '0')"
  [[ "$bytes" =~ ^[0-9]+$ ]] || bytes=0
  state_key="$(printf '%s' "$path" | cksum | awk '{print $1}')"
  state_path="${WATERMARK_STATE_DIR}/${state_key}.state"
  if (( bytes < threshold )); then
    rm -f "$state_path"
    return 0
  fi

  [[ "$WATERMARK_REPEAT_SECONDS" =~ ^[0-9]+$ ]] || WATERMARK_REPEAT_SECONDS=86400
  if [[ -f "$state_path" ]]; then
    read -r last_notified _ < "$state_path" || last_notified=0
  fi
  [[ "$last_notified" =~ ^[0-9]+$ ]] || last_notified=0
  now="$(date +%s)"
  (( now - last_notified >= WATERMARK_REPEAT_SECONDS )) || return 0

  owner="$(stat -f '%Su:%Sg' "$path" 2>/dev/null || printf 'unknown')"
  if command -v lsof >/dev/null 2>&1 && lsof "$path" >/dev/null 2>&1; then
    open_state="open"
  fi
  printf '[%s] log-watermark warn kind=%s bytes=%s threshold=%s owner=%s fd=%s path=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$kind" "$bytes" "$threshold" "$owner" "$open_state" "$path" >&2
  mkdir -p "$WATERMARK_STATE_DIR"
  local state_tmp="${state_path}.tmp.$$"
  printf '%s %s %s %s\n' "$now" "$bytes" "$threshold" "$path" > "$state_tmp"
  mv "$state_tmp" "$state_path"
}

audit_log_watermarks() {
  warn_if_log_large "${HARNESS_DIR}/.autopilot-launchd.log" "$LOG_WARN_BYTES" "service-log"
  warn_if_log_large "${HARNESS_DIR}/.watchdog-launchd.log" "$LOG_WARN_BYTES" "service-log"
  warn_if_log_large "${HARNESS_DIR}/logs/coordinator.log" "$LOG_WARN_BYTES" "service-log"
  warn_if_log_large "${HARNESS_DIR}/logs/operator-health-watchdog.out.log" "$LOG_WARN_BYTES" "service-log"
  warn_if_log_large "$STDOUT_LOG" "$LOG_WARN_BYTES" "service-log"
  warn_if_log_large "${HARNESS_DIR}/events/all.jsonl" "$EVENT_LOG_WARN_BYTES" "evidence-log"
  warn_if_log_large "${HARNESS_DIR}/run/operator-health-watchdog/history.jsonl" "$EVENT_LOG_WARN_BYTES" "evidence-log"
  warn_if_log_large "${HARNESS_DIR}/run/operator-availability/quota-ledger.jsonl" "$EVENT_LOG_WARN_BYTES" "evidence-log"
  warn_if_log_large "${HARNESS_DIR}/run/dispatch-ledger.jsonl" "$EVENT_LOG_WARN_BYTES" "evidence-log"
}

run_once() {
  mkdir -p "$LOG_DIR"
  printf '[%s] prune-rate-limits start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  "${HARNESS_DIR}/solar-harness.sh" pm-fleet prune-rate-limits
  audit_log_watermarks
  printf '[%s] prune-rate-limits end\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

install_job() {
  parse_interval_args "$@"
  local domain
  domain="$(launchd_domain)"
  write_plist
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$domain" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl bootstrap "$domain" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
    launchctl kickstart -k "${domain}/${LABEL}" 2>/dev/null || true
  fi
  echo "ok installed ${LABEL}"
  echo "plist=${PLIST_PATH}"
  echo "interval=${INTERVAL}s"
  echo "stdout=${STDOUT_LOG}"
  echo "stderr=${STDERR_LOG}"
}

uninstall_job() {
  local domain
  domain="$(launchd_domain)"
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$domain" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
  fi
  rm -f "$PLIST_PATH"
  echo "ok uninstalled ${LABEL}"
}

status_job() {
  local domain
  domain="$(launchd_domain)"
  echo "label=${LABEL}"
  echo "plist=${PLIST_PATH}"
  echo "interval=${INTERVAL}s"
  if [[ -f "$PLIST_PATH" ]]; then
    echo "plist_state=present"
  else
    echo "plist_state=missing"
  fi
  if command -v launchctl >/dev/null 2>&1 && launchctl print "${domain}/${LABEL}" >/dev/null 2>&1; then
    echo "launchd_state=loaded"
  else
    echo "launchd_state=not_loaded"
  fi
  echo "stdout=${STDOUT_LOG}"
  echo "stderr=${STDERR_LOG}"
}

case "${1:-help}" in
  install)
    shift
    install_job "$@"
    ;;
  uninstall)
    uninstall_job
    ;;
  status)
    status_job
    ;;
  run-once)
    run_once
    ;;
  help|--help|-h|"")
    usage
    ;;
  *)
    echo "unknown subcommand: $1" >&2
    usage >&2
    exit 2
    ;;
esac
