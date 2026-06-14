#!/bin/bash
# Facade Boundary Checker
# Ensures ai-app modules only import from ai-engine/facade, never from internal paths.
# Run in CI or locally: bash scripts/devops/check-facade-boundary.sh
#
# Exit code 0 = clean, 1 = violations found

set -euo pipefail

AI_APP_DIR="backend/src/modules/ai-app"
VIOLATIONS=""
COUNT=0

echo "=== Facade Boundary Check ==="
echo "Scanning $AI_APP_DIR for direct ai-engine imports..."

# Find all .ts files in ai-app that import from ai-engine
# Allowed patterns:
#   - ai-engine/facade (the official facade entry point)
#   - ai-engine/ai-engine.module (NestJS module DI wiring - every app module needs this)
while IFS= read -r line; do
  # Skip imports from ai-engine/facade (allowed)
  if echo "$line" | grep -q "ai-engine/facade"; then
    continue
  fi

  # Skip AiEngineModule imports (NestJS DI wiring is legitimate)
  if echo "$line" | grep -q "ai-engine.module"; then
    continue
  fi

  # Skip NestJS module-assembly files (*.module.ts): ai-app modules legitimately
  # import ai-engine sub-modules into their imports[] for DI wiring. This mirrors
  # the authoritative ESLint policy (backend/.eslintrc.js exempts
  # **/modules/ai-app/**/*.module.ts from these import restrictions — "本例外
  # 只针对装配"), and is required because routing some modules through facade /
  # AiEngineModule reintroduces the 2026-05-12 bootstrap crash (see
  # preparse.module.ts ContentFetchModule note). Service-layer access still must
  # go through ai-engine/facade.
  if echo "$line" | grep -qE "\.module\.ts:"; then
    continue
  fi

  # Skip contracts/* backwards-compat tunnels: deliberately-allowlisted shims that
  # re-export engine barrels to preserve original import paths without polluting
  # caller namespaces (matches ESLint + arch-spec allowlist; see
  # ai-app/contracts/report-template/index.ts).
  if echo "$line" | grep -qE "/ai-app/contracts/"; then
    continue
  fi

  # Skip ai-app/byok credential-management surface importing ai-engine/credentials.
  # 2026-06-03: BYOK credentials moved into ai-engine; ai-app/byok is the user-facing
  # BYOK credential UI/API (counterpart of open-api/byok-admin), inherently coupled to
  # credentials. Routing credential *services* through the ai-engine/facade barrel
  # bloats it and triggers circular-load failures in unrelated consumers, so this
  # surface imports credentials from source (mirrors the ESLint excludedFiles
  # exemption for open-api/byok-admin + admin.service).
  if echo "$line" | grep -qE "/ai-app/byok/.*ai-engine/credentials/"; then
    continue
  fi

  VIOLATIONS+="$line"$'\n'
  COUNT=$((COUNT + 1))
done < <(grep -rn "from.*['\"].*ai-engine/" "$AI_APP_DIR" \
  --include="*.ts" \
  --include="*.tsx" \
  2>/dev/null | grep -v "node_modules" | grep -v ".spec.ts" | grep -v "__tests__" || true)

if [ "$COUNT" -gt 0 ]; then
  echo ""
  echo "❌ Found $COUNT facade boundary violation(s):"
  echo ""
  echo "$VIOLATIONS" | head -50
  echo ""
  echo "FIX: Import from 'ai-engine/facade' instead of internal ai-engine paths."
  echo "If the symbol is not exported from facade, add it to backend/src/modules/ai-engine/facade/index.ts first."
  exit 1
else
  echo "✅ No facade boundary violations found."
  exit 0
fi
