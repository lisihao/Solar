#!/usr/bin/env bash
set -euo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
PYTHON="${PYTHON:-python3}"
RUN_ROOT="${SOLAR_GPT_GEMINI_CLEANER_RUN_ROOT:-$HOME/.solar/harness/run/gpt-gemini-cleaner}"
RUN_DATE="${GPT_GEMINI_CLEANER_DATE:-$(date +%F)}"
RUN_STAMP="$(date +%Y%m%dT%H%M%S)"
TASK_DIR="$RUN_ROOT/$RUN_DATE-$RUN_STAMP"
ENVELOPE="$TASK_DIR/envelope.json"

mkdir -p "$TASK_DIR"

cat > "$ENVELOPE" <<JSON
{
  "date": "$RUN_DATE",
  "backends": ["gemini"],
  "dry_run": false,
  "require_all_backends": false,
  "purpose": "gpt-gemini-cleaner-daily-session-hygiene"
}
JSON

cat > "$TASK_DIR/gpt-gemini-cleaner-result.json" <<JSON
{
  "ok": false,
  "operator_type": "GPTGeminiCleaner",
  "status": "deprecated",
  "deprecated": true,
  "reason": "GPTGeminiCleaner is retired; automatic browser session organization is disabled.",
  "run_date": "$RUN_DATE",
  "results": [],
  "skipped_count": 1
}
JSON

cat > "$TASK_DIR/gpt-gemini-cleaner.md" <<MD
# GPTGeminiCleaner Deprecated

- status: deprecated
- run_date: $RUN_DATE
- browser_started: false
- queue_enqueued: false

GPTGeminiCleaner is retired; this scheduled script records an explicit skipped result and exits without opening browser-agent.
MD

cat "$TASK_DIR/gpt-gemini-cleaner-result.json"
exit 0

export HARNESS_DIR
export TASK_DIR
export SOLAR_OPERATOR_ENVELOPE_JSON="$ENVELOPE"
export BROWSER_AGENT_HEADLESS="${BROWSER_AGENT_HEADLESS:-true}"
export TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS="${TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS:-true}"
export BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE="${BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE:-$HOME/.solar/harness/browser-agent-chatgpt-local.json}"

source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "gpt-gemini-cleaner" "$HARNESS_DIR" "$0" "$@"

"$PYTHON" "$HARNESS_DIR/tools/gpt_gemini_cleaner_operator.py"
