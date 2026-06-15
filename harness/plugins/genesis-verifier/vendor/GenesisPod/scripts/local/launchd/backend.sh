#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_command npm
ensure_docker_infra

cd "$ROOT_DIR"
log "Syncing Solar YouTube library before backend start"
node scripts/local/sync-solar-youtube-library.js || log "WARN: Solar YouTube sync failed; backend will still start"

cd "$ROOT_DIR/backend"
log "Building backend before fixed-port start"
npm run build

log "Starting GenesisPod backend on :${BACKEND_PORT}"
exec env PORT="$BACKEND_PORT" BACKEND_PORT="$BACKEND_PORT" node dist/main.js
