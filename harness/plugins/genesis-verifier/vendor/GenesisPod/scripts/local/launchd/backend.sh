#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_command npm
ensure_docker_infra

cd "$ROOT_DIR"
if [[ "${GENESISPOD_SKIP_STARTUP_YOUTUBE_SYNC:-0}" == "1" ]]; then
  log "Skipping Solar YouTube library sync before backend start"
else
  log "Syncing Solar YouTube library before backend start"
  sync_timeout="${GENESISPOD_STARTUP_SYNC_TIMEOUT_SECONDS:-30}"
  if perl -e 'alarm shift @ARGV; exec @ARGV' "$sync_timeout" node scripts/local/sync-solar-youtube-library.js; then
    :
  else
    sync_rc="$?"
    log "WARN: Solar YouTube sync failed or timed out rc=${sync_rc}; backend will still start"
  fi
fi

cd "$ROOT_DIR/backend"
if [[ "${GENESISPOD_FORCE_BACKEND_BUILD:-0}" != "1" && -f dist/main.js ]]; then
  log "Skipping backend build before fixed-port start (dist/main.js exists)"
else
  log "Building backend before fixed-port start"
  npm run build
fi

log "Starting GenesisPod backend on :${BACKEND_PORT}"
exec env PORT="$BACKEND_PORT" BACKEND_PORT="$BACKEND_PORT" node dist/main.js
