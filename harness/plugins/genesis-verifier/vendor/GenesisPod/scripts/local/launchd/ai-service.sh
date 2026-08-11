#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

cd "$ROOT_DIR/ai-service"

if [[ ! -x .venv/bin/uvicorn ]]; then
  log "ERROR: ai-service/.venv/bin/uvicorn is missing; create the venv before enabling launchd"
  exit 127
fi

log "Starting GenesisPod AI service on 127.0.0.1:${AI_SERVICE_PORT}"
exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$AI_SERVICE_PORT"
