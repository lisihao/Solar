#!/usr/bin/env bash
set -uo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
PYTHON="${PYTHON:-python3}"
DB="${DB:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
STATE_DIR="${STATE_DIR:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
LOG_DIR="${LOG_DIR:-/Users/lisihao/.solar/harness/run}"
LOCK_DIR="${LOCK_DIR:-$STATE_DIR/youtube-weekly-db-backfill.lockdir}"

mkdir -p "$LOG_DIR" "$STATE_DIR"
source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "youtube-transcript-weekly-backfill" "$HARNESS_DIR" "$0" "$@"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -f "$LOCK_DIR/pid" ]] && kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
    echo "[youtube-weekly-db-backfill] already running; skip $(date)"
    exit 0
  fi
  echo "[youtube-weekly-db-backfill] stale lock removed $(date)"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"

CURRENT_WEEK="$("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
year, week, _ = today.isocalendar()
print(f"{year}-W{week:02d}")
PY
)"

exec "$PYTHON" "$HARNESS_DIR/scripts/youtube_transcript_weekly_db_backfill.py" \
  --db "$DB" \
  --state-dir "$STATE_DIR" \
  --state-path "$STATE_DIR/youtube-weekly-db-backfill-state.json" \
  --config "$CONFIG" \
  --start-week "${YOUTUBE_BACKFILL_START_WEEK:-$CURRENT_WEEK}" \
  --end-week "${YOUTUBE_BACKFILL_END_WEEK:-2026-W01}" \
  --enqueue-limit "${YOUTUBE_BACKFILL_ENQUEUE_LIMIT:-12}" \
  --caption-limit "${YOUTUBE_BACKFILL_CAPTION_LIMIT:-12}" \
  --subtitle-limit "${YOUTUBE_BACKFILL_SUBTITLE_LIMIT:-12}" \
  --browser-limit "${YOUTUBE_BACKFILL_BROWSER_LIMIT:-2}" \
  --retry-queue-limit "${YOUTUBE_BACKFILL_RETRY_QUEUE_LIMIT:-12}" \
  --retry-queue-metadata-limit "${YOUTUBE_BACKFILL_RETRY_QUEUE_METADATA_LIMIT:-8}" \
  --metadata-timeout "${YOUTUBE_BACKFILL_METADATA_TIMEOUT:-30}" \
  --timeout "${YOUTUBE_BACKFILL_TIMEOUT:-900}" \
  "$@"
