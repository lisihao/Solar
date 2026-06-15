#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="${GENESISPOD_LOG_DIR:-$HOME/Library/Logs/GenesisPod}"

export PATH="${GENESISPOD_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
export PORT="${PORT:-3001}"
export BACKEND_PORT="${BACKEND_PORT:-3001}"
export FRONTEND_PORT="${FRONTEND_PORT:-3000}"
export AI_SERVICE_PORT="${AI_SERVICE_PORT:-5050}"
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://localhost:5050}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"

mkdir -p "$LOG_DIR"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "ERROR: missing command: $1"
    exit 127
  fi
}

ensure_docker_infra() {
  ensure_command docker
  cd "$ROOT_DIR"

  log "Ensuring Docker infrastructure: postgres redis flaresolverr"
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file .env up -d postgres redis flaresolverr
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file .env up -d postgres redis flaresolverr
  else
    log "ERROR: docker compose is not available"
    exit 127
  fi
}

http_ok() {
  local url="$1"
  local expected="${2:-200}"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || true)"
  [[ "$code" == "$expected" ]]
}
