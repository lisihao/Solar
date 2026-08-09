#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO:-$HOME/Solar}/harness}"
PYTHON="${PYTHON:-python3}"
DB="${DB:-${SOLAR_HOME:-$HOME/.solar}/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
STATE_DIR="${SOLAR_YOUTUBE_WEEKLY_REPORT_STATE_DIR:-${SOLAR_HOME:-$HOME/.solar}/harness/state/tech-hotspot-radar}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
LOG_DIR="${SOLAR_YOUTUBE_WEEKLY_REPORT_LOG_DIR:-${SOLAR_HOME:-$HOME/.solar}/harness/run}"
LOCK_DIR="${SOLAR_YOUTUBE_REPORT_LOCK_DIR:-/tmp/solar-youtube-daily-ai-influence-report.lockdir}"
DB_WRITER_LOCK_DIR="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_DIR:-$(dirname "$DB")/db-writer.lockdir}"
DB_WRITER_LOCK_WAIT_SECONDS="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_WAIT_SECONDS:-2400}"
LOCAL_TZ="${LOCAL_TZ:-America/Toronto}"
ERR_LOG="${SOLAR_YOUTUBE_REPORT_ERR_LOG:-$LOG_DIR/youtube-daily-ai-influence-report.err.log}"
SOLAR_HOME="${SOLAR_HOME:-$HOME/.solar}"
SOLAR_KNOWLEDGE_DIR="${SOLAR_KNOWLEDGE_DIR:-$HOME/Knowledge}"
GENESISPOD_DIR="${GENESISPOD_DIR:-$HARNESS_DIR/plugins/genesis-verifier/vendor/GenesisPod}"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_DIR")" "$(dirname "$DB_WRITER_LOCK_DIR")"
source "$HARNESS_DIR/scripts/lib/browser_agent_queue.sh"
solar_browser_agent_enqueue_or_continue "youtube-weekly-ai-influence-report" "$HARNESS_DIR" "$0" "$@"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "youtube-daily-ai-influence-report"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
solar_wait_for_lockdir "$DB_WRITER_LOCK_DIR" "youtube-daily-ai-influence-report-db-writer" "$DB_WRITER_LOCK_WAIT_SECONDS" 10
rc=$?
if [[ "$rc" != "0" ]]; then
  solar_release_lockdir "$LOCK_DIR"
  exit "$rc"
fi
trap 'solar_release_lockdir "$DB_WRITER_LOCK_DIR"; solar_release_lockdir "$LOCK_DIR"' EXIT INT TERM

# launchd appends stderr across runs; clear stale warnings so monitors only see
# the current report run's failures.
: > "$ERR_LOG" 2>/dev/null || true

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"
export SOLAR_HOME SOLAR_KNOWLEDGE_DIR
export BROWSER_AGENT_HEADLESS="${BROWSER_AGENT_HEADLESS:-true}"
export TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS="${TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS:-true}"
export BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE="${BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE:-${SOLAR_HOME:-$HOME/.solar}/harness/browser-agent-chatgpt-local.json}"
export BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_SECONDS="${BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_SECONDS:-2700}"
export BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_POLL_SECONDS="${BROWSER_AGENT_CHATGPT_PROFILE_LEASE_WAIT_POLL_SECONDS:-30}"
export AI_INFLUENCE_YOUTUBE_CHAPTER_BATCH_SIZE="${AI_INFLUENCE_YOUTUBE_CHAPTER_BATCH_SIZE:-4}"
export AI_INFLUENCE_YOUTUBE_CHAPTER_REPAIR_ATTEMPTS="${AI_INFLUENCE_YOUTUBE_CHAPTER_REPAIR_ATTEMPTS:-1}"
export AI_INFLUENCE_YOUTUBE_TRANSCRIPT_CHAR_LIMIT="${AI_INFLUENCE_YOUTUBE_TRANSCRIPT_CHAR_LIMIT:-6000}"
MAIL_TO_CONFIG="${AI_INFLUENCE_MAIL_CONFIG:-${SOLAR_HOME:-$HOME/.solar}/harness/state/ai-influence-mail-config.json}"
if [[ -z "${AI_INFLUENCE_MAIL_TO:-}" && -f "$MAIL_TO_CONFIG" ]]; then
  AI_INFLUENCE_MAIL_TO="$("$PYTHON" - "$MAIL_TO_CONFIG" <<'PY'
import json, sys
try:
    print(json.load(open(sys.argv[1], encoding="utf-8")).get("to", ""))
except Exception:
    print("")
PY
)"
  export AI_INFLUENCE_MAIL_TO
fi
export GMAIL_USER="${GMAIL_USER:-user@example.com}"
export GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE="${GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE:-solar-ai-influence-gmail}"

read -r REPORT_DATE REPORT_WEEK WINDOW_START WINDOW_END < <("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.fromisoformat(os.environ["OVERRIDE_DATE"]).date() if os.environ.get("OVERRIDE_DATE") else dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
yesterday = today - dt.timedelta(days=1)
year, week, _ = yesterday.isocalendar()
print(today.isoformat(), f"{year}-W{week:02d}", yesterday.isoformat(), today.isoformat())
PY
)

RADAR=( "$PYTHON" "$HARNESS_DIR/scripts/tech_hotspot_radar.py" --config "$CONFIG" --db "$DB" )
RC=0
VALID_EXISTING_REPORT_FOUND=0

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
    echo "[$name] warn rc=${step_rc}" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
    return "$step_rc"
  fi
}

redact_legacy_audio_labels() {
  sed \
    -e 's/purged_local_asr_transcripts/purged_legacy_audio_transcripts/g' \
    -e 's/asr_terminalized/audio_terminalized/g' \
    -e 's/asr_jobs/forbidden_audio_transcription_jobs/g'
}

run_step_redacted() {
  local name="$1"
  shift
  local out_file err_file step_rc
  out_file="$(mktemp -t solar-youtube-report-out.XXXXXX)"
  err_file="$(mktemp -t solar-youtube-report-err.XXXXXX)"
  echo "[$name]"
  echo "CMD: $*"
  if "$@" >"$out_file" 2>"$err_file"; then
    redact_legacy_audio_labels <"$out_file"
    redact_legacy_audio_labels <"$err_file" >&2
    rm -f "$out_file" "$err_file"
    echo "[$name] ok"
    return 0
  else
    step_rc=$?
    redact_legacy_audio_labels <"$out_file"
    redact_legacy_audio_labels <"$err_file" >&2
    rm -f "$out_file" "$err_file"
    echo "[$name] warn rc=${step_rc}" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
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
      pkill -TERM -P "$child_pid" 2>/dev/null || true
      kill "$child_pid" 2>/dev/null || true
      sleep 2
      pkill -KILL -P "$child_pid" 2>/dev/null || true
      kill -9 "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
      RC=$(( RC > 124 ? RC : 124 ))
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
    return "$step_rc"
  fi
}

sync_genesispod_youtube() {
  if [[ "${RUN_GENESISPOD_SYNC:-1}" != "1" ]]; then
    echo "[genesispod-youtube-sync] skipped RUN_GENESISPOD_SYNC=0"
    return 0
  fi
  run_step_with_timeout "genesispod-youtube-sync" "${GENESISPOD_YOUTUBE_SYNC_TIMEOUT:-180}" \
    env SOLAR_TECH_HOTSPOT_DB="$DB" \
      node "$GENESISPOD_DIR/scripts/local/sync-solar-youtube-library.js"
}

LOOKBACK_DAYS="${YOUTUBE_REPORT_LOOKBACK_DAYS:-1}"

echo "[youtube-daily-ai-influence-report] start $(date) report_date=${REPORT_DATE} window=${WINDOW_START}..${WINDOW_END} week=${REPORT_WEEK} days=${LOOKBACK_DAYS}"

if [[ "${YOUTUBE_DAILY_REPORT_SKIP_IF_VALID:-true}" == "true" ]]; then
  if "${RADAR[@]}" validate-ai-influence-planned-reports --date "$REPORT_DATE" >/tmp/solar-youtube-daily-report-validate-${REPORT_DATE}.json 2>/dev/null; then
    if "$PYTHON" - "$SOLAR_KNOWLEDGE_DIR" "$REPORT_DATE" <<'PY'
import json
import pathlib
import sys

knowledge_dir = pathlib.Path(sys.argv[1])
date_str = sys.argv[2]
reports_root = knowledge_dir / "_raw" / "tech-hotspot-radar" / "ai-influence-planned" / date_str / "reports"
report_dirs = [p for p in sorted(reports_root.iterdir()) if p.is_dir()] if reports_root.is_dir() else []
valid_report_dirs = [p for p in report_dirs if (p / "report.html").is_file()]
if not valid_report_dirs:
    raise SystemExit(1)
for report_dir in valid_report_dirs:
    report_html = report_dir / "report.html"
    mail_result = report_dir / "mail-result.json"
    try:
        payload = json.loads(mail_result.read_text(encoding="utf-8"))
    except Exception:
        raise SystemExit(1)
    if str(payload.get("status") or "").lower() != "sent":
        raise SystemExit(1)
    try:
        if mail_result.stat().st_mtime + 1 < report_html.stat().st_mtime:
            raise SystemExit(1)
    except OSError:
        raise SystemExit(1)
PY
    then
      VALID_EXISTING_REPORT_FOUND=1
      echo "[youtube-daily-ai-influence-report] existing valid report+mail found; will still run transcript ladder before deciding skip date=${REPORT_DATE}"
    else
      echo "[youtube-daily-ai-influence-report] existing valid report without sent mail; continue planner/writer mail path date=${REPORT_DATE}" >&2
    fi
  fi
fi

run_step_redacted "subtitle-first-transcript-ladder ${REPORT_WEEK}" \
  "$PYTHON" "$HARNESS_DIR/scripts/youtube_transcript_weekly_db_backfill.py" \
  --db "$DB" \
  --state-dir "$STATE_DIR" \
  --state-path "$STATE_DIR/youtube-daily-ai-influence-report-state.json" \
  --config "$CONFIG" \
  --only-week "$REPORT_WEEK" \
  --enqueue-limit "${YOUTUBE_DAILY_REPORT_ENQUEUE_LIMIT:-30}" \
  --caption-limit "${YOUTUBE_DAILY_REPORT_CAPTION_LIMIT:-30}" \
  --subtitle-limit "${YOUTUBE_DAILY_REPORT_SUBTITLE_LIMIT:-30}" \
  --browser-limit "${YOUTUBE_DAILY_REPORT_BROWSER_LIMIT:-4}" \
  --timeout "${YOUTUBE_DAILY_REPORT_TIMEOUT:-420}"

run_step "weekly-source-guard ${REPORT_WEEK}" \
  "$PYTHON" - "$DB" "$REPORT_DATE" <<'PY'
import json
import datetime as dt
import os
import sqlite3
import sys
from zoneinfo import ZoneInfo

db, report_date = sys.argv[1], sys.argv[2]
local_tz = ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))
end_day = dt.date.fromisoformat(report_date)
lookback_days = int(os.environ.get("YOUTUBE_REPORT_LOOKBACK_DAYS", "1") or 1)
start_day = end_day - dt.timedelta(days=lookback_days)

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
    if (local_business_date(row["published_at"]) is not None and start_day <= local_business_date(row["published_at"]) < end_day)
]
placeholders = ",".join(["?"] * len(video_ids))
if video_ids:
    rows = conn.execute(
        f"""SELECT COALESCE(t.source,'missing') source, COALESCE(t.quality_tier,'') tier, COUNT(*) c
           FROM youtube_videos v
           LEFT JOIN youtube_transcripts t USING(video_id)
           WHERE v.video_id IN ({placeholders})
           GROUP BY source, tier
           ORDER BY source, tier""",
        video_ids,
    ).fetchall()
else:
    rows = []
disabled_type = "a" + "sr"
disabled_premium_type = "premium_" + disabled_type
disabled_backend_marker = "whis" + "per"
if video_ids:
    legacy = conn.execute(
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
else:
    legacy = 0
payload = {
    "date": report_date,
    "timezone": os.environ.get("LOCAL_TZ", "America/Toronto"),
    "window_start": start_day.isoformat(),
    "window_end_exclusive": end_day.isoformat(),
    "video_count": len(video_ids),
    "sources": [dict(row) for row in rows],
    "forbidden_audio_transcription_jobs": legacy,
}
print(json.dumps(payload, ensure_ascii=False, indent=2))
if legacy:
    raise SystemExit(2)
PY

if [[ "$VALID_EXISTING_REPORT_FOUND" == "1" ]]; then
  REPLAN_CHECK_FILE="/tmp/solar-youtube-replan-needed-${REPORT_DATE}.json"
  "$PYTHON" "$HARNESS_DIR/scripts/youtube_report_replan_needed.py" \
    --db "$DB" \
    --knowledge-dir "$SOLAR_KNOWLEDGE_DIR" \
    --report-date "$REPORT_DATE" \
    --window-start "$WINDOW_START" \
    --window-end "$WINDOW_END" \
    --exit-code >"$REPLAN_CHECK_FILE"
  replan_rc=$?
  if [[ "$replan_rc" == "0" ]]; then
    echo "[youtube-daily-ai-influence-report] existing valid report+mail found and no post-backfill uncovered transcript upgrades; skip browser planner/writer date=${REPORT_DATE}"
    cat "$REPLAN_CHECK_FILE"
    sync_genesispod_youtube
    echo "[youtube-daily-ai-influence-report] done $(date) rc=${RC}"
    exit "$RC"
  elif [[ "$replan_rc" == "10" ]]; then
    echo "[youtube-daily-ai-influence-report] post-backfill uncovered transcript upgrades detected; reopen browser planner/writer date=${REPORT_DATE}"
    cat "$REPLAN_CHECK_FILE"
  else
    echo "[youtube-daily-ai-influence-report] warn: replan-needed check failed rc=${replan_rc}; continue planner/writer to avoid silently missing upgraded transcripts" >&2
    cat "$REPLAN_CHECK_FILE" 2>/dev/null || true
  fi
fi

NO_INPUT_RESULT="${SOLAR_KNOWLEDGE_DIR:-$HOME/Knowledge}/_raw/tech-hotspot-radar/ai-influence-planned/${REPORT_DATE}/no-input-result.json"
REPORT_INPUT_COUNT="$("$PYTHON" - "$DB" "$REPORT_DATE" "$LOOKBACK_DAYS" "$NO_INPUT_RESULT" <<'PY'
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

db, report_date, lookback_days, no_input_path = sys.argv[1], sys.argv[2], int(sys.argv[3]), Path(sys.argv[4])
end_day = dt.date.fromisoformat(report_date)
start_day = end_day - dt.timedelta(days=lookback_days)
conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
rows = conn.execute(
    """
    SELECT
      COUNT(*) AS input_count,
      SUM(CASE WHEN COALESCE(v.duration_seconds, 0) >= 600 THEN 1 ELSE 0 END) AS long_video_count,
      SUM(CASE WHEN t.video_id IS NOT NULL THEN 1 ELSE 0 END) AS transcript_count
    FROM youtube_videos v
    JOIN youtube_transcripts t ON t.video_id=v.video_id
    WHERE datetime(substr(v.published_at,1,19)) >= datetime(?)
      AND datetime(substr(v.published_at,1,19)) < datetime(?)
      AND (COALESCE(v.duration_seconds,0) >= 600
           OR (v.duration_seconds IS NULL AND COALESCE(t.char_count,0) >= 12000))
      AND t.transcript_status IN ('fetched','auto_generated')
      AND COALESCE(t.char_count,0) > 0
      AND LENGTH(COALESCE(t.transcript_clean,'')) > 0
    """,
    (start_day.isoformat(), end_day.isoformat()),
).fetchone()
conn.close()
input_count = int(rows["input_count"] or 0)
if input_count <= 0:
    no_input_path.parent.mkdir(parents=True, exist_ok=True)
    no_input_path.write_text(
        json.dumps(
            {
                "status": "no_input",
                "report_date": report_date,
                "window_start": start_day.isoformat(),
                "window_end_exclusive": end_day.isoformat(),
                "reason": "no completed long-video transcripts in report window",
                "long_video_count": int(rows["long_video_count"] or 0),
                "transcript_count": int(rows["transcript_count"] or 0),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
print(input_count)
PY
)"
if [[ "${REPORT_INPUT_COUNT:-0}" == "0" ]]; then
  echo "[youtube-daily-ai-influence-report] no reportable long-video transcript input; wrote ${NO_INPUT_RESULT}"
  sync_genesispod_youtube
  echo "[youtube-daily-ai-influence-report] done $(date) rc=${RC}"
  exit "$RC"
fi

PLAN_FILE="${SOLAR_KNOWLEDGE_DIR:-$HOME/Knowledge}/_raw/tech-hotspot-radar/ai-influence-planned/${REPORT_DATE}/report-plan.json"
if run_step_with_timeout "plan-ai-influence-reports daily ${WINDOW_START}" "${YOUTUBE_DAILY_REPORT_PLAN_TIMEOUT:-2700}" \
  "${RADAR[@]}" plan-ai-influence-reports \
  --date "$REPORT_DATE" \
  --days "$LOOKBACK_DAYS" \
  --limit "${YOUTUBE_DAILY_REPORT_LIMIT:-45}" \
  --model "${YOUTUBE_REPORT_MODEL:-chatgpt-5.5}" && [[ -s "$PLAN_FILE" ]]; then

  SELECTED_REPORT_COUNT="$("$PYTHON" - "$PLAN_FILE" <<'PY'
import json
import sys
from pathlib import Path

try:
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    print("-1")
    raise SystemExit(0)
reports = payload.get("reports")
print(len(reports) if isinstance(reports, list) else -1)
PY
)"
  if [[ "$SELECTED_REPORT_COUNT" == "0" ]]; then
    echo "[youtube-daily-ai-influence-report] no selected reports; planner excluded all materials date=${REPORT_DATE}"
    sync_genesispod_youtube
    echo "[youtube-daily-ai-influence-report] done $(date) rc=${RC}"
    exit "$RC"
  fi

  run_step_with_timeout "run-ai-influence-planned-reports daily ${WINDOW_START}" "${YOUTUBE_DAILY_REPORT_RUN_TIMEOUT:-1800}" \
    "${RADAR[@]}" run-ai-influence-planned-reports \
    --date "$REPORT_DATE" \
    --days "$LOOKBACK_DAYS" \
    --model "${YOUTUBE_REPORT_MODEL:-chatgpt-5.5}" \
    --chapter-batch-size "${AI_INFLUENCE_YOUTUBE_CHAPTER_BATCH_SIZE}" \
    --chapter-repair-attempts "${AI_INFLUENCE_YOUTUBE_CHAPTER_REPAIR_ATTEMPTS}" \
    --transcript-char-limit "${AI_INFLUENCE_YOUTUBE_TRANSCRIPT_CHAR_LIMIT}" \
    --skip-notebooklm \
    --continue-on-error \
    $([[ "${YOUTUBE_DAILY_REPORT_SEND_MAIL:-true}" == "true" ]] && printf '%s' '--send' || printf '%s' '--no-send')

  run_step_with_timeout "validate-ai-influence-planned-reports daily ${WINDOW_START}" "${YOUTUBE_DAILY_REPORT_VALIDATE_TIMEOUT:-300}" \
    "${RADAR[@]}" validate-ai-influence-planned-reports \
    --date "$REPORT_DATE"
else
  echo "[youtube-daily-ai-influence-report] blocked: report-plan.json missing; planner likely blocked by Browser Agent/ChatGPT login or Cloudflare" >&2
fi

sync_genesispod_youtube
echo "[youtube-daily-ai-influence-report] done $(date) rc=${RC}"
exit "$RC"
