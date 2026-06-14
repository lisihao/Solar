#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
PYTHON="${PYTHON:-python3}"
LOG_DIR="${AI_INFLUENCE_UNIFIED_LOG_DIR:-$HARNESS_DIR/logs}"
LOCK_DIR="${AI_INFLUENCE_UNIFIED_LOCK_DIR:-/Users/lisihao/.solar/harness/state/ai-influence-unified-report.lockdir}"
LOCAL_TZ="${LOCAL_TZ:-America/Toronto}"
MAIL_TO_CONFIG="${AI_INFLUENCE_MAIL_CONFIG:-/Users/lisihao/.solar/harness/state/ai-influence-mail-config.json}"

mkdir -p "$LOG_DIR" "$(dirname "$LOCK_DIR")"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -f "$LOCK_DIR/pid" ]] && kill -0 "$(cat "$LOCK_DIR/pid" 2>/dev/null)" 2>/dev/null; then
    echo "[ai-influence-unified-report] already running; skip $(date)"
    exit 0
  fi
  echo "[ai-influence-unified-report] stale lock removed $(date)"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi
echo "$$" > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"
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
export GMAIL_USER="${GMAIL_USER:-lisihao@gmail.com}"
export GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE="${GMAIL_APP_PASSWORD_KEYCHAIN_SERVICE:-solar-ai-influence-gmail}"

REPORT_DATE="${AI_INFLUENCE_UNIFIED_DATE:-$("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
print((today - dt.timedelta(days=1)).isoformat())
PY
)}"

ARGS=( "$PYTHON" "$HARNESS_DIR/scripts/ai_influence_unified_report.py" --date "$REPORT_DATE" )
if [[ "${AI_INFLUENCE_UNIFIED_SEND_MAIL:-${AI_INFLUENCE_SEND_MAIL:-true}}" == "true" ]]; then
  ARGS+=( --send )
fi

echo "[ai-influence-unified-report] start $(date) date=${REPORT_DATE}"
echo "CMD: ${ARGS[*]}"
if "${ARGS[@]}" "$@"; then
  echo "[ai-influence-unified-report] ok $(date) date=${REPORT_DATE}"
  exit 0
fi
RC=$?
echo "[ai-influence-unified-report] failed rc=${RC} $(date) date=${REPORT_DATE}" >&2
exit "$RC"
