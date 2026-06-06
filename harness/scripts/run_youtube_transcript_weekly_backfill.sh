#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
PYTHON="${PYTHON:-python3}"
DB="${DB:-${HARNESS_DIR}/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
STATE_DIR="${STATE_DIR:-${HARNESS_DIR}/state/tech-hotspot-radar}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
LOG_DIR="${LOG_DIR:-${HARNESS_DIR}/run}"
LOCK_DIR="${LOCK_DIR:-$STATE_DIR/youtube-weekly-db-backfill.lockdir}"

mkdir -p "$LOG_DIR" "$STATE_DIR"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "youtube-weekly-db-backfill"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
trap 'solar_release_lockdir "$LOCK_DIR"' EXIT INT TERM

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"

exec "$PYTHON" "$HARNESS_DIR/scripts/youtube_transcript_weekly_db_backfill.py" \
  --db "$DB" \
  --state-dir "$STATE_DIR" \
  --config "$CONFIG" \
  --start-week "${YOUTUBE_BACKFILL_START_WEEK:-2026-W20}" \
  --end-week "${YOUTUBE_BACKFILL_END_WEEK:-2026-W01}" \
  --enqueue-limit "${YOUTUBE_BACKFILL_ENQUEUE_LIMIT:-12}" \
  --caption-limit "${YOUTUBE_BACKFILL_CAPTION_LIMIT:-12}" \
  --subtitle-limit "${YOUTUBE_BACKFILL_SUBTITLE_LIMIT:-12}" \
  --browser-limit "${YOUTUBE_BACKFILL_BROWSER_LIMIT:-2}" \
  --timeout "${YOUTUBE_BACKFILL_TIMEOUT:-300}" \
  "$@"
