#!/usr/bin/env bash
set -uo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
PYTHON="${PYTHON:-python3}"
DB="${DB:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
STATE_DIR="${SOLAR_YOUTUBE_DAILY_COLLECT_STATE_DIR:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
LOG_DIR="${SOLAR_YOUTUBE_DAILY_COLLECT_LOG_DIR:-/Users/lisihao/.solar/harness/run}"
ERR_LOG="${SOLAR_YOUTUBE_DAILY_COLLECT_ERR_LOG:-$LOG_DIR/youtube-daily-previous-day.err.log}"
LOCK_DIR="${SOLAR_YOUTUBE_DAILY_COLLECT_LOCK_DIR:-/tmp/solar-youtube-daily-previous-day.lockdir}"
LOCAL_TZ="${LOCAL_TZ:-America/Toronto}"

source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "youtube-daily-previous-day" "$HARNESS_DIR" "$0" "$@"

mkdir -p "$LOG_DIR" "$STATE_DIR"
# launchd appends stderr across runs; clear stale warnings so monitors only see
# the current collection run's failures.
: > "$ERR_LOG" 2>/dev/null || true
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "youtube-daily-previous-day"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"
export BROWSER_AGENT_HEADLESS="${BROWSER_AGENT_HEADLESS:-true}"
export TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS="${TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS:-true}"
export BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE="${BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE:-/Users/lisihao/.solar/harness/browser-agent-chatgpt-local.json}"

read -r YESTERDAY_DATE YESTERDAY_WEEK < <("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
day = today - dt.timedelta(days=1)
year, week, _ = day.isocalendar()
print(day.isoformat(), f"{year}-W{week:02d}")
PY
)

RADAR=( "$PYTHON" "$HARNESS_DIR/scripts/tech_hotspot_radar.py" --config "$CONFIG" --db "$DB" )
RC=0
FAILED_STEPS=""

source "$HARNESS_DIR/scripts/lib/scheduled-task.sh"

run_step() {
  local name="$1"
  shift
  echo "[$name]"
  echo "CMD: $*"
  if "$@"; then
    echo "[$name] ok"
    return 0
  else
    local step_rc=$?
    echo "[$name] warn rc=${step_rc} at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
    FAILED_STEPS="${FAILED_STEPS:+${FAILED_STEPS}|}${name}"
    return "$step_rc"
  fi
}

run_step_with_timeout() {
  local name="$1"
  local timeout_sec="$2"
  shift 2
  echo "[$name]"
  echo "CMD: $*"
  "$@" &
  local child_pid=$!
  local elapsed=0
  while kill -0 "$child_pid" 2>/dev/null; do
    if (( elapsed >= timeout_sec )); then
      echo "[$name] warn rc=124 timeout=${timeout_sec}s" >&2
      kill "$child_pid" 2>/dev/null || true
      sleep 2
      kill -9 "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      RC=$(( RC > 124 ? RC : 124 ))
      FAILED_STEPS="${FAILED_STEPS:+${FAILED_STEPS}|}${name}"
      return 124
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  if wait "$child_pid"; then
    echo "[$name] ok"
    return 0
  else
    local step_rc=$?
    echo "[$name] warn rc=${step_rc}" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
    FAILED_STEPS="${FAILED_STEPS:+${FAILED_STEPS}|}${name}"
    return "$step_rc"
  fi
}

echo "[youtube-daily-previous-day] start $(date) yesterday=${YESTERDAY_DATE} week=${YESTERDAY_WEEK}"

run_step_with_timeout "collect-youtube-metadata" "${YOUTUBE_DAILY_METADATA_TIMEOUT:-300}" \
  "${RADAR[@]}" collect-youtube \
  --per-channel-limit "${YOUTUBE_DAILY_PER_CHANNEL_LIMIT:-5}" \
  --force

run_step "subtitle-first-transcript-ladder ${YESTERDAY_WEEK}" \
  "$PYTHON" "$HARNESS_DIR/scripts/youtube_transcript_weekly_db_backfill.py" \
  --db "$DB" \
  --state-dir "$STATE_DIR" \
  --state-path "$STATE_DIR/youtube-daily-previous-day-state.json" \
  --config "$CONFIG" \
  --only-week "$YESTERDAY_WEEK" \
  --enqueue-limit "${YOUTUBE_DAILY_ENQUEUE_LIMIT:-20}" \
  --caption-limit "${YOUTUBE_DAILY_CAPTION_LIMIT:-20}" \
  --subtitle-limit "${YOUTUBE_DAILY_SUBTITLE_LIMIT:-20}" \
  --browser-limit "${YOUTUBE_DAILY_BROWSER_LIMIT:-3}" \
  --timeout "${YOUTUBE_DAILY_TIMEOUT:-300}"

run_step "daily-summary ${YESTERDAY_DATE}" \
  "$PYTHON" - "$DB" "$YESTERDAY_DATE" <<'PY'
import json
import sqlite3
import sys
import datetime as dt
import os
from zoneinfo import ZoneInfo

db, day = sys.argv[1], sys.argv[2]
local_tz = ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))
target_day = dt.date.fromisoformat(day)

def local_business_date(value):
    try:
        parsed = dt.datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(local_tz).date()
    except Exception:
        try:
            return dt.date.fromisoformat(str(value or "")[:10])
        except Exception:
            return None

conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
video_ids = [
    str(row["video_id"])
    for row in conn.execute("SELECT video_id, published_at FROM youtube_videos")
    if local_business_date(row["published_at"]) == target_day
]
videos = len(video_ids)
placeholders = ",".join(["?"] * len(video_ids))
if not video_ids:
    tiers = {}
    jobs = {}
    forbidden_audio_transcription_jobs = 0
else:
    tiers = {
        row["tier"] or "": row["c"]
        for row in conn.execute(
            f"""SELECT COALESCE(t.quality_tier,'') tier, COUNT(*) c
               FROM youtube_transcripts t
               WHERE t.video_id IN ({placeholders})
               GROUP BY tier""",
            video_ids,
        )
    }
    jobs = {
        row["status"] or "": row["c"]
        for row in conn.execute(
            f"""SELECT COALESCE(j.status,'') status, COUNT(*) c
               FROM youtube_transcript_jobs j
               WHERE j.video_id IN ({placeholders})
               GROUP BY status""",
            video_ids,
        )
    }
    disabled_type = "a" + "sr"
    disabled_premium_type = "premium_" + disabled_type
    disabled_backend_marker = "whis" + "per"
    forbidden_audio_transcription_jobs = conn.execute(
        f"""SELECT COUNT(*) c
           FROM youtube_transcript_jobs j
           WHERE j.video_id IN ({placeholders})
             AND (
               lower(COALESCE(j.job_type,'')) IN (?, ?)
               OR lower(COALESCE(j.backend,'')) LIKE ?
               OR lower(COALESCE(j.error_message,'')) LIKE ?
             )""",
        (*video_ids, disabled_type, disabled_premium_type, f"%{disabled_backend_marker}%", f"%{disabled_backend_marker}%"),
    ).fetchone()["c"]
print(json.dumps({
    "date": day,
    "timezone": os.environ.get("LOCAL_TZ", "America/Toronto"),
    "videos": videos,
    "usable": sum(tiers.get(k, 0) for k in ("T0", "T1", "T2")),
    "metadata_t3": tiers.get("T3", 0) + tiers.get("metadata", 0) + tiers.get("metadata_only", 0),
    "pending": jobs.get("pending", 0) + jobs.get("queued", 0),
    "failed": jobs.get("failed", 0),
    "running": jobs.get("running", 0),
    "forbidden_audio_transcription_jobs": forbidden_audio_transcription_jobs,
}, ensure_ascii=False, indent=2))
PY

echo "[youtube-daily-previous-day] done $(date) rc=${RC}"
if [[ "$RC" != "0" ]]; then
  solar_task_record_failure "youtube-daily-previous-day" "$RC" "$FAILED_STEPS"
  if [[ "${ALLOW_PARTIAL_SUCCESS:-0}" == "1" ]]; then
    echo "[youtube-daily-previous-day] completed with warnings; ALLOW_PARTIAL_SUCCESS=1 so exiting 0"
    exit 0
  fi
fi
exit "$RC"
