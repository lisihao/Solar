#!/bin/bash
# Railway production health snapshot.
#
# Pulls per-service deployment status + commit + canonical health
# endpoint response so an operator can tell at a glance whether prod is
# matching the latest commit on origin/main.
#
# Usage:
#   ./infra/railway/scripts/monitor.sh

set -e

if ! command -v railway &> /dev/null; then
  echo "Railway CLI not found. Install: npm i -g @railway/cli" >&2
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "jq not found. Install: brew install jq / apt install jq" >&2
  exit 1
fi

PROJECT_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
LATEST_COMMIT=$(cd "$PROJECT_ROOT" && git rev-parse --short=12 origin/main 2>/dev/null || echo "?")

echo "=========================================="
echo "  Railway production snapshot"
echo "  origin/main HEAD: $LATEST_COMMIT"
echo "=========================================="

railway status --json | jq -r '
  .environments.edges[]
  | select(.node.name == "production")
  | .node.serviceInstances.edges[]
  | .node as $s
  | "\($s.serviceName // "unknown")\t\($s.latestDeployment.status // "?")\t\($s.latestDeployment.meta.commitHash[0:12] // "?")"
' | column -t -s$'\t'

echo
echo "Healthcheck endpoints:"
for url in "https://api.gens.team/api/v1/health" "https://genesis-ai-service.up.railway.app/" ; do
  printf "  %-60s " "$url"
  curl -sS --max-time 8 "$url" | head -c 200
  echo
done
