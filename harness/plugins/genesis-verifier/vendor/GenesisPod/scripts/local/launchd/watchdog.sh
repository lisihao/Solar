#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

DOMAIN="gui/$(id -u)"

kick() {
  local label="$1"
  log "Restarting $label"
  launchctl kickstart -k "$DOMAIN/$label" >/dev/null 2>&1 || true
}

job_has_pid() {
  local label="$1"
  launchctl print "$DOMAIN/$label" 2>/dev/null | grep -Eq 'pid = [0-9]+'
}

container_names="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
for required_container in genesis-postgres genesis-redis genesis-flaresolverr; do
  if ! grep -qx "$required_container" <<<"$container_names"; then
    kick com.lisihao.genesispod.infra
    break
  fi
done

if ! http_ok "http://localhost:${BACKEND_PORT}/health"; then
  if job_has_pid com.lisihao.genesispod.backend; then
    log "Backend health is not ready yet; process is still running"
  else
    kick com.lisihao.genesispod.backend
  fi
fi

if ! http_ok "http://localhost:${FRONTEND_PORT}/explore?tab=youtube"; then
  if job_has_pid com.lisihao.genesispod.frontend; then
    log "Frontend health is not ready yet; process is still running"
  else
    kick com.lisihao.genesispod.frontend
  fi
fi

if ! http_ok "http://localhost:${AI_SERVICE_PORT}/"; then
  if job_has_pid com.lisihao.genesispod.ai-service; then
    log "AI service health is not ready yet; process is still running"
  else
    kick com.lisihao.genesispod.ai-service
  fi
fi

log "Watchdog check completed"
