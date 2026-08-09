#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

DOMAIN="gui/$(id -u)"
TARGET_DIR="$HOME/Library/LaunchAgents"
INFRA_LABEL="com.lisihao.genesispod.infra"

print_row() {
  printf '%-22s %-8s %s\n' "$1" "$2" "$3"
}

job_running() {
  launchctl print "$DOMAIN/$1" 2>/dev/null | grep -Eq 'pid = [0-9]+'
}

job_status() {
  local label="$1"
  local output
  if ! output="$(launchctl print "$DOMAIN/$label" 2>/dev/null)"; then
    if [[ ! -f "$TARGET_DIR/$label.plist" ]]; then
      printf 'warn|not installed'
    elif launchctl print-disabled "$DOMAIN" 2>/dev/null | grep -Fq "\"$label\" => disabled"; then
      printf 'ok|stopped (on demand; unloaded/disabled)'
    else
      printf 'warn|unloaded but enabled'
    fi
  elif grep -Eq 'pid = [0-9]+' <<<"$output"; then
    printf 'ok|running'
  elif [[ "$label" == "$INFRA_LABEL" ]]; then
    printf 'ok|completed (one-shot job loaded)'
  else
    printf 'warn|loaded but inactive'
  fi
}

print_service_status() {
  local name="$1"
  local label="$2"
  local url="$3"
  local launchd_output state
  if ! launchd_output="$(launchctl print "$DOMAIN/$label" 2>/dev/null)"; then
    state="$(job_status "$label")"
    print_row "$name" "${state%%|*}" "${state#*|}"
    return 0
  fi
  if ! grep -Eq 'pid = [0-9]+' <<<"$launchd_output"; then
    print_row "$name" "warn" "loaded but inactive"
    return 0
  fi

  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    print_row "$name" "ok" "$url ($code)"
  else
    print_row "$name" "error" "$url (${code:-N/A})"
  fi
}

print_row "service" "status" "detail"
print_service_status "frontend:3000" "com.lisihao.genesispod.frontend" "http://localhost:${FRONTEND_PORT}/explore?tab=youtube"
print_service_status "backend:3001" "com.lisihao.genesispod.backend" "http://localhost:${BACKEND_PORT}/health"
print_service_status "ai-service:5050" "com.lisihao.genesispod.ai-service" "http://localhost:${AI_SERVICE_PORT}/"

echo
if job_running "com.lisihao.genesispod.backend" ||
  job_running "com.lisihao.genesispod.frontend" ||
  job_running "com.lisihao.genesispod.ai-service"; then
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -E '(^NAMES|genesis-)' || true
fi

echo
for label in \
  com.lisihao.genesispod.infra \
  com.lisihao.genesispod.backend \
  com.lisihao.genesispod.frontend \
  com.lisihao.genesispod.ai-service \
  com.lisihao.genesispod.watchdog; do
  job_result="$(job_status "$label")"
  print_row "$label" "${job_result%%|*}" "${job_result#*|}"
done
