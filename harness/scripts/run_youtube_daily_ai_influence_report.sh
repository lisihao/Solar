#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
export YOUTUBE_DAILY_REPORT_SEND_MAIL="${YOUTUBE_DAILY_REPORT_SEND_MAIL:-true}"
PYTHON="${PYTHON:-python3}"

source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "youtube-daily-ai-influence-report" "$HARNESS_DIR" "$0" "$@"

exec "$HARNESS_DIR/scripts/run_youtube_weekly_ai_influence_report.sh" "$@"
