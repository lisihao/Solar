#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
export YOUTUBE_DAILY_REPORT_SEND_MAIL="${YOUTUBE_DAILY_REPORT_SEND_MAIL:-true}"

exec "$HARNESS_DIR/scripts/run_youtube_weekly_ai_influence_report.sh" "$@"
