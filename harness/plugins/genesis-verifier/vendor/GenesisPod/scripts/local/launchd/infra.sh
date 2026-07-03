#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ensure_docker_infra
log "Docker infrastructure ensure completed"
