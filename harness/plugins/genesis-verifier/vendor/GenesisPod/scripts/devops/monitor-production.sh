#!/bin/bash
# Production log monitor - headless Claude mode
# Usage: bash scripts/devops/monitor-production.sh [--lines 100] [--service backend]
#
# This script runs OUTSIDE interactive Claude sessions to avoid
# eating context window. It fetches logs and uses headless Claude
# to analyze them, only surfacing actionable issues.

set -euo pipefail

LINES=100
SERVICE=""
QUIET=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --lines) LINES="$2"; shift 2 ;;
    --service) SERVICE="--service $2"; shift 2 ;;
    --quiet) QUIET=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "=== GenesisPod Production Monitor ==="
echo "Fetching last $LINES log lines..."

LOGS=$(railway logs --num "$LINES" $SERVICE 2>&1) || {
  echo "ERROR: Failed to fetch Railway logs. Is 'railway' CLI installed and linked?"
  echo "Run: railway login && railway link"
  exit 1
}

# Quick pre-filter: if no errors at all, skip Claude analysis
ERROR_COUNT=$(echo "$LOGS" | grep -ciE '(error|exception|fatal|crash|oom|SIGKILL|SIGTERM|unhandled)' || true)

if [ "$ERROR_COUNT" -eq 0 ] && [ "$QUIET" = true ]; then
  echo "No errors detected. All clear."
  exit 0
fi

echo "Found $ERROR_COUNT potential issues. Running analysis..."

# Use headless Claude for analysis - no interactive context consumed
claude -p "Analyze these production logs from a NestJS + Next.js application on Railway.

RULES:
- Only report ERROR/WARN level issues
- For each issue: error message, count, likely source file path
- Rate severity: CRITICAL (service down) / HIGH (data loss risk) / MEDIUM (degraded) / LOW (noise)
- If no real issues, just say 'All clear - no actionable issues'
- Keep response under 300 words

LOGS:
$LOGS" --allowedTools "Read,Grep,Glob" --max-turns 3 2>/dev/null || {
  # Fallback if Claude CLI not available: just show raw error lines
  echo ""
  echo "=== Raw Error Lines (Claude CLI unavailable) ==="
  echo "$LOGS" | grep -iE '(error|exception|fatal|crash)' | head -20
}
