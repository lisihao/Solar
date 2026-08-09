#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

DOMAIN="gui/$(id -u)"
TARGET_DIR="$HOME/Library/LaunchAgents"
INFRA_LABEL="com.lisihao.genesispod.infra"
BACKEND_LABEL="com.lisihao.genesispod.backend"
FRONTEND_LABEL="com.lisihao.genesispod.frontend"
AI_LABEL="com.lisihao.genesispod.ai-service"
WATCHDOG_LABEL="com.lisihao.genesispod.watchdog"

usage() {
  cat <<'EOF'
Usage:
  control.sh start [--with-ai]
  control.sh stop
  control.sh status

GenesisPod starts on demand in this order: infra -> backend -> frontend.
The optional AI service starts only when --with-ai is provided.
EOF
}

job_loaded() {
  launchctl print "$DOMAIN/$1" >/dev/null 2>&1
}

job_running() {
  launchctl print "$DOMAIN/$1" 2>/dev/null | grep -Eq 'pid = [0-9]+'
}

require_plist() {
  local label="$1"
  local plist="$TARGET_DIR/$label.plist"
  if [[ ! -f "$plist" ]]; then
    log "ERROR: $label is not installed: $plist"
    log "Run first: bash $SCRIPT_DIR/install.sh"
    return 1
  fi
}

unload_and_disable() {
  local label="$1"
  if job_loaded "$label"; then
    log "Unloading $label"
    launchctl bootout "$DOMAIN/$label"
  fi
  launchctl disable "$DOMAIN/$label" >/dev/null
}

bootstrap_job() {
  local label="$1"
  local plist="$TARGET_DIR/$label.plist"
  require_plist "$label"

  if job_loaded "$label"; then
    if job_running "$label"; then
      log "$label is already running"
      return 0
    fi
    log "Reloading inactive job $label"
    launchctl bootout "$DOMAIN/$label"
  fi

  log "Enabling and bootstrapping $label"
  launchctl enable "$DOMAIN/$label" >/dev/null
  launchctl bootstrap "$DOMAIN" "$plist"
  log "Starting $label"
  launchctl kickstart "$DOMAIN/$label"
}

wait_for_job_start() {
  local label="$1"
  local attempt
  for attempt in {1..50}; do
    if job_running "$label"; then
      return 0
    fi
    sleep 0.1
  done
  log "ERROR: timed out waiting for $label to start"
  return 1
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local max_attempts="${3:-60}"
  local attempt
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if http_ok "$url"; then
      return 0
    fi
    if ! job_running "$label"; then
      log "ERROR: $label exited before becoming ready: $url"
      return 1
    fi
    sleep 1
  done
  log "ERROR: timed out waiting for $label: $url"
  return 1
}

wait_for_container() {
  local name="$1"
  local attempt status="unknown"
  for attempt in {1..60}; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      return 0
    fi
    sleep 1
  done
  log "ERROR: timed out waiting for container $name (last state: ${status:-missing})"
  return 1
}

ensure_docker_ready() {
  ensure_command docker
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  log "Starting Docker Desktop"
  if ! docker desktop start >/dev/null; then
    log "ERROR: Docker Desktop could not be started"
    return 1
  fi

  local attempt
  for attempt in {1..120}; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  log "ERROR: timed out waiting for Docker Desktop"
  return 1
}

stop_infra() {
  if ! command -v docker >/dev/null 2>&1; then
    log "WARN: docker is unavailable; infrastructure stop was skipped"
    return 0
  fi
  if ! pgrep -f '/Applications/Docker\.app/Contents/MacOS/com\.docker\.backend' >/dev/null 2>&1; then
    log "Docker Desktop is not running; infrastructure is already unavailable"
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    log "Docker daemon is not running; infrastructure is already unavailable"
    return 0
  fi

  cd "$ROOT_DIR"
  log "Stopping GenesisPod containers without deleting volumes"
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file .env stop postgres redis flaresolverr
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --env-file .env stop postgres redis flaresolverr
  else
    log "WARN: docker compose is unavailable; infrastructure stop was skipped"
    return 0
  fi

  local other_containers
  other_containers="$(docker ps --format '{{.Names}}' | grep -Ev '^(genesis-postgres|genesis-redis|genesis-flaresolverr)$' || true)"
  if [[ -z "$other_containers" ]]; then
    log "Stopping Docker Desktop; no other running containers were found"
    docker desktop stop >/dev/null || log "WARN: Docker Desktop did not stop cleanly"
  else
    log "Keeping Docker Desktop running for other containers: ${other_containers//$'\n'/, }"
  fi
}

start_services() {
  local with_ai="$1"

  require_plist "$INFRA_LABEL"
  require_plist "$BACKEND_LABEL"
  require_plist "$FRONTEND_LABEL"
  if [[ "$with_ai" == "1" ]]; then
    require_plist "$AI_LABEL"
  else
    unload_and_disable "$AI_LABEL"
  fi
  unload_and_disable "$WATCHDOG_LABEL"

  log "Starting infrastructure"
  ensure_docker_ready
  bootstrap_job "$INFRA_LABEL"
  wait_for_container genesis-postgres
  wait_for_container genesis-redis
  wait_for_container genesis-flaresolverr

  bootstrap_job "$BACKEND_LABEL"
  wait_for_job_start "$BACKEND_LABEL"
  wait_for_url "$BACKEND_LABEL" "http://localhost:${BACKEND_PORT}/health" 180

  bootstrap_job "$FRONTEND_LABEL"
  wait_for_job_start "$FRONTEND_LABEL"
  wait_for_url "$FRONTEND_LABEL" "http://localhost:${FRONTEND_PORT}/explore?tab=youtube"

  if [[ "$with_ai" == "1" ]]; then
    bootstrap_job "$AI_LABEL"
    wait_for_job_start "$AI_LABEL"
    wait_for_url "$AI_LABEL" "http://localhost:${AI_SERVICE_PORT}/"
  else
    log "Optional AI service is disabled and unloaded; use start --with-ai to enable it"
  fi

  log "GenesisPod start request completed"
  bash "$SCRIPT_DIR/health.sh"
}

stop_services() {
  unload_and_disable "$AI_LABEL"
  unload_and_disable "$FRONTEND_LABEL"
  unload_and_disable "$BACKEND_LABEL"
  unload_and_disable "$INFRA_LABEL"
  unload_and_disable "$WATCHDOG_LABEL"
  stop_infra
  log "GenesisPod stop request completed"
  bash "$SCRIPT_DIR/health.sh" || true
}

action="${1:-}"
case "$action" in
  start)
    shift
    with_ai=0
    if [[ "${1:-}" == "--with-ai" ]]; then
      with_ai=1
      shift
    fi
    if [[ "$#" -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    start_services "$with_ai"
    ;;
  stop)
    shift
    if [[ "$#" -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    stop_services
    ;;
  status)
    shift
    if [[ "$#" -ne 0 ]]; then
      usage >&2
      exit 64
    fi
    exec bash "$SCRIPT_DIR/health.sh"
    ;;
  *)
    usage >&2
    exit 64
    ;;
esac
