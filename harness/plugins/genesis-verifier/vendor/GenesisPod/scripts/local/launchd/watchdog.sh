#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

failures=0

container_names="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
for required_container in genesis-postgres genesis-redis genesis-flaresolverr; do
  if ! grep -qx "$required_container" <<<"$container_names"; then
    log "WARN: required container is not running: $required_container"
    failures=1
  fi
done

if ! http_ok "http://localhost:${BACKEND_PORT}/health"; then
  log "WARN: backend health check failed: http://localhost:${BACKEND_PORT}/health"
  failures=1
fi

if ! http_ok "http://localhost:${FRONTEND_PORT}/explore?tab=youtube"; then
  log "WARN: frontend health check failed: http://localhost:${FRONTEND_PORT}/explore?tab=youtube"
  failures=1
fi

if ! http_ok "http://localhost:${AI_SERVICE_PORT}/"; then
  log "INFO: optional AI service is not healthy: http://localhost:${AI_SERVICE_PORT}/"
fi

if [[ "$failures" -ne 0 ]]; then
  log "Diagnostic check completed with warnings; no service was restarted"
  exit 1
fi

log "Diagnostic check completed; no service was restarted"
