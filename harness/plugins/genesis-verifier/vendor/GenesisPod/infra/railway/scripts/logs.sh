#!/bin/bash
# Tail Railway service logs.
#
# Usage:
#   ./infra/railway/scripts/logs.sh [service]
#
# Defaults to the linked service. Common services: backend / frontend /
# ai-service / Postgres / Redis. Pass --build for build-phase logs.

set -e

if ! command -v railway &> /dev/null; then
  echo "Railway CLI not found. Install: npm i -g @railway/cli" >&2
  exit 1
fi

EXTRA_ARGS=()
SERVICE=""
for arg in "$@"; do
  case "$arg" in
    --build|--deployment|--json|-d|-j)
      EXTRA_ARGS+=("$arg")
      ;;
    *)
      SERVICE="$arg"
      ;;
  esac
done

if [ -n "$SERVICE" ]; then
  exec railway logs --service "$SERVICE" "${EXTRA_ARGS[@]}"
else
  exec railway logs "${EXTRA_ARGS[@]}"
fi
