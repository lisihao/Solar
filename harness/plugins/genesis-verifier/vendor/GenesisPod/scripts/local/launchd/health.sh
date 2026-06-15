#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

DOMAIN="gui/$(id -u)"

print_row() {
  printf '%-22s %-8s %s\n' "$1" "$2" "$3"
}

status_for_url() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then
    printf 'ok %s' "$code"
  else
    printf 'error %s' "${code:-N/A}"
  fi
}

print_row "service" "status" "detail"
print_row "frontend:3000" "$(status_for_url "http://localhost:${FRONTEND_PORT}/explore?tab=youtube" | awk '{print $1}')" "http://localhost:${FRONTEND_PORT}/explore?tab=youtube"
print_row "backend:3001" "$(status_for_url "http://localhost:${BACKEND_PORT}/health" | awk '{print $1}')" "http://localhost:${BACKEND_PORT}/health"
print_row "ai-service:5050" "$(status_for_url "http://localhost:${AI_SERVICE_PORT}/" | awk '{print $1}')" "http://localhost:${AI_SERVICE_PORT}/"

echo
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E '(^NAMES|genesis-)' || true

echo
for label in \
  com.lisihao.genesispod.infra \
  com.lisihao.genesispod.backend \
  com.lisihao.genesispod.frontend \
  com.lisihao.genesispod.ai-service \
  com.lisihao.genesispod.watchdog; do
  if launchctl print "$DOMAIN/$label" >/dev/null 2>&1; then
    print_row "$label" "ok" "loaded"
  else
    print_row "$label" "warn" "not loaded"
  fi
done
