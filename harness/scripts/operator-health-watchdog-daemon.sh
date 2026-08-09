#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

LABEL="${SOLAR_OPERATOR_HEALTH_WATCHDOG_LABEL:-com.solar.harness.operator-health-watchdog}"
INTERVAL="${SOLAR_OPERATOR_HEALTH_WATCHDOG_INTERVAL:-600}"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HARNESS_DIR}/logs"
STDOUT_LOG="${LOG_DIR}/operator-health-watchdog.out.log"
STDERR_LOG="${LOG_DIR}/operator-health-watchdog.err.log"

launchd_domain() {
  printf 'gui/%s\n' "$(id -u)"
}

usage() {
  cat <<EOF
Solar Harness operator health watchdog daemon

Usage:
  $0 install [--interval SECONDS] [--plist PATH]
  $0 uninstall [--plist PATH]
  $0 status [--plist PATH]
  $0 run-once

Environment:
  SOLAR_OPERATOR_HEALTH_WATCHDOG_INTERVAL  Default: 600
  SOLAR_OPERATOR_HEALTH_WATCHDOG_LABEL     Default: ${LABEL}
EOF
}

parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --interval)
        shift
        INTERVAL="${1:-}"
        ;;
      --interval=*)
        INTERVAL="${1#--interval=}"
        ;;
      --plist)
        shift
        PLIST_PATH="${1:-}"
        ;;
      --plist=*)
        PLIST_PATH="${1#--plist=}"
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
    <string>${HARNESS_DIR}/scripts/operator-health-watchdog-daemon.sh</string>
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
    <key>SOLAR_OHW_ENABLE_DRAIN_APPLY</key>
    <string>${SOLAR_OHW_ENABLE_DRAIN_APPLY:-1}</string>
    <key>SOLAR_OHW_BUILDER_DRAIN_CAP</key>
    <string>${SOLAR_OHW_BUILDER_DRAIN_CAP:-6}</string>
    <key>SOLAR_OHW_GRAPH_DRAIN_MAX_BUILDERS</key>
    <string>${SOLAR_OHW_GRAPH_DRAIN_MAX_BUILDERS:-3}</string>
	    <key>SOLAR_OHW_GRAPH_DRAIN_MAX_EVALS</key>
	    <string>${SOLAR_OHW_GRAPH_DRAIN_MAX_EVALS:-0}</string>
	    <key>SOLAR_OHW_GRAPH_DRAIN_MAX_GRAPHS</key>
	    <string>${SOLAR_OHW_GRAPH_DRAIN_MAX_GRAPHS:-80}</string>
	    <key>SOLAR_OHW_PM_RECONCILE_MAX_WRITES</key>
	    <string>${SOLAR_OHW_PM_RECONCILE_MAX_WRITES:-5}</string>
	    <key>SOLAR_OHW_PM_RECONCILE_MAX_SCAN_RECORDS</key>
	    <string>${SOLAR_OHW_PM_RECONCILE_MAX_SCAN_RECORDS:-80}</string>
	    <key>SOLAR_OHW_RUN_TIMEOUT_SECONDS</key>
	    <string>${SOLAR_OHW_RUN_TIMEOUT_SECONDS:-120}</string>
	    <key>SOLAR_OHW_STATUS_PROJECTION_MAX_RECORDS</key>
	    <string>${SOLAR_OHW_STATUS_PROJECTION_MAX_RECORDS:-40}</string>
	    <key>SOLAR_OHW_ENABLE_LEGACY_SAFE_DRAIN</key>
	    <string>${SOLAR_OHW_ENABLE_LEGACY_SAFE_DRAIN:-0}</string>
	  </dict>
  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
PLIST_EOF
}

run_once() {
	  mkdir -p "$LOG_DIR"
	  printf '[%s] operator-health-watchdog start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	  local timeout_seconds="${SOLAR_OHW_RUN_TIMEOUT_SECONDS:-120}"
	  if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || [[ "$timeout_seconds" -lt 30 ]]; then
	    timeout_seconds=120
	  fi
	  python3 "${HARNESS_DIR}/tools/operator_health_watchdog.py" run --once --json --apply &
	  local child_pid=$!
	  local deadline=$((SECONDS + timeout_seconds))
	  while kill -0 "$child_pid" 2>/dev/null; do
	    if [[ "$SECONDS" -ge "$deadline" ]]; then
	      printf '[%s] operator-health-watchdog timeout pid=%s timeout=%ss\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$child_pid" "$timeout_seconds" >&2
	      kill -TERM "$child_pid" 2>/dev/null || true
	      sleep 5
	      kill -KILL "$child_pid" 2>/dev/null || true
	      wait "$child_pid" 2>/dev/null || true
	      return 124
	    fi
	    sleep 1
	  done
	  wait "$child_pid"
	  printf '[%s] operator-health-watchdog end\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	}

install_job() {
  parse_common_args "$@"
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
  parse_common_args "$@"
  local domain
  domain="$(launchd_domain)"
  if command -v launchctl >/dev/null 2>&1; then
    launchctl bootout "$domain" "$PLIST_PATH" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
  fi
  rm -f "$PLIST_PATH"
  echo "ok uninstalled ${LABEL}"
}

status_job() {
  parse_common_args "$@"
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
    shift || true
    uninstall_job "$@"
    ;;
  status)
    shift || true
    status_job "$@"
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
