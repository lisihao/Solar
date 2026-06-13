#!/bin/sh
# Single source of truth for backend startup (PR-X43).
#
# Previously two paths existed:
#   1. Dockerfile CMD ["./scripts/devops/docker-entrypoint.sh"]
#   2. railway.toml startCommand (overrode the CMD with a different sequence)
#
# Railway always overrode the CMD, so this file was dead code in production.
# Now (PR-X43) railway.toml drops its startCommand override, this script
# becomes the only entry point on every platform (local docker run, Railway,
# anything else honoring the OCI CMD), and its logic is the merge of what
# the two previous paths did:
#
#   - Set production runtime env (NODE_ENV, NODE_OPTIONS, Chromium path)
#   - Run the diagnostic (best-effort, never blocks startup)
#   - Run the unified deploy script (prisma migrate deploy + seed); fail hard
#     if it errors so we don't boot against a broken schema.
#   - exec node dist/main
#
# Historical "SQL hotfix" stages (fix-enum-values.js, fix-export-tables.js,
# manually-resolved migration markers) have been folded into the regular
# prisma migrations under prisma/migrations/. If a future drift requires a
# one-off SQL patch, write a new migration; do not put procedural fixes here.

set -e

export NODE_ENV="${NODE_ENV:-production}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/usr/bin/chromium}"

echo "=========================================="
echo "Starting ${BRAND_FULL_NAME:-GenesisPod} Backend"
echo "  NODE_ENV=$NODE_ENV"
echo "  NODE_OPTIONS=$NODE_OPTIONS"
echo "=========================================="

echo "🩺 Step 1/3: Database diagnose (best-effort)..."
npm run diagnose || echo "⚠️ diagnose failed, continuing"

echo "🔄 Step 2/3: Database deploy (prisma migrate deploy + seed)..."
npm run deploy || exit 1

echo "🚀 Step 3/3: Starting application..."
exec node dist/main
