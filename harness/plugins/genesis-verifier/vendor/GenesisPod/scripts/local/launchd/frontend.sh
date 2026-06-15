#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_command npm

cd "$ROOT_DIR/frontend"

if [[ "${GENESISPOD_CLEAR_NEXT_ON_START:-0}" == "1" ]]; then
  log "Clearing Next.js build cache before frontend start"
  rm -rf .next
fi

log "Starting GenesisPod frontend on :${FRONTEND_PORT}"
exec npm run dev -- --hostname 0.0.0.0 --port "$FRONTEND_PORT"
