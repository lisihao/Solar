#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
PYTHON="${PYTHON:-python3}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
DB="${DB:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
LOG_DIR="${SOLAR_GITHUB_REPORT_LOG_DIR:-$HARNESS_DIR/logs}"
LOCK_DIR="${SOLAR_GITHUB_REPORT_LOCK_DIR:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/github-report.lockdir}"
DB_WRITER_LOCK_DIR="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_DIR:-$(dirname "$DB")/db-writer.lockdir}"
DB_WRITER_LOCK_WAIT_SECONDS="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_WAIT_SECONDS:-2400}"
COOLDOWN_FILE="${SOLAR_GITHUB_REPORT_COOLDOWN_FILE:-/Users/lisihao/.solar/harness/state/browser-agent/chatgpt-rate-limit-cooldown-until}"
LOCAL_TZ="${LOCAL_TZ:-America/Toronto}"
MAIL_TO_CONFIG="${AI_INFLUENCE_MAIL_CONFIG:-/Users/lisihao/.solar/harness/state/ai-influence-mail-config.json}"

mkdir -p "$(dirname "$LOCK_DIR")" "$LOG_DIR" "$(dirname "$COOLDOWN_FILE")" "$(dirname "$DB_WRITER_LOCK_DIR")"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "github-trend-report-daily"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
solar_wait_for_lockdir "$DB_WRITER_LOCK_DIR" "github-trend-report-db-writer" "$DB_WRITER_LOCK_WAIT_SECONDS" 10
rc=$?
if [[ "$rc" != "0" ]]; then
  solar_release_lockdir "$LOCK_DIR"
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
trap 'solar_release_lockdir "$DB_WRITER_LOCK_DIR"; solar_release_lockdir "$LOCK_DIR"' EXIT INT TERM

export PYTHONPATH="$HARNESS_DIR/lib:${PYTHONPATH:-}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export PYTHONIOENCODING="utf-8"
export BROWSER_AGENT_HEADLESS="${BROWSER_AGENT_HEADLESS:-true}"
export TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS="${TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS:-false}"
export BROWSER_AGENT_ALLOW_HEADED="true"
export TECH_HOTSPOT_BROWSER_CHATGPT_ALLOW_HEADED="true"
export BROWSER_AGENT_CHATGPT_OPEN_PROJECT_FIRST="${BROWSER_AGENT_CHATGPT_OPEN_PROJECT_FIRST:-false}"
export TECH_HOTSPOT_BROWSER_CHATGPT_OPEN_PROJECT_FIRST="${TECH_HOTSPOT_BROWSER_CHATGPT_OPEN_PROJECT_FIRST:-false}"
export BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT="${BROWSER_AGENT_CHATGPT_REQUIRE_PROJECT:-false}"
export TECH_HOTSPOT_BROWSER_CHATGPT_REQUIRE_PROJECT="${TECH_HOTSPOT_BROWSER_CHATGPT_REQUIRE_PROJECT:-false}"
export BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE="${BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE:-/Users/lisihao/.solar/harness/browser-agent-chatgpt-local.json}"
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
export GITHUB_TREND_REPORT_SEND_MAIL="${GITHUB_TREND_REPORT_SEND_MAIL:-true}"
export SOLAR_KNOWLEDGE_DIR="${SOLAR_KNOWLEDGE_DIR:-/Users/lisihao/Knowledge}"

REPORT_DATE="${GITHUB_TREND_REPORT_DATE:-$("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
print((today - dt.timedelta(days=1)).isoformat())
PY
)}"

cooldown_wait_seconds() {
  if [[ ! -s "$COOLDOWN_FILE" ]]; then
    echo 0
    return
  fi
  "$PYTHON" - "$COOLDOWN_FILE" <<'PY'
import datetime as dt
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    text = path.read_text(encoding="utf-8").strip()
    until = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    now = dt.datetime.now(dt.UTC)
    print(max(0, int((until - now).total_seconds())))
except Exception:
    print(0)
PY
}

set_cooldown_10m() {
  "$PYTHON" - "$COOLDOWN_FILE" <<'PY'
import datetime as dt
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
until = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=10)
path.write_text(until.isoformat().replace("+00:00", "Z") + "\n", encoding="utf-8")
print(until.isoformat().replace("+00:00", "Z"))
PY
}

WAIT_SECONDS="$(cooldown_wait_seconds)"
if [[ "$WAIT_SECONDS" =~ ^[0-9]+$ ]] && (( WAIT_SECONDS > 0 )); then
  echo "[github-trend-report-daily] browser-agent cooldown active wait=${WAIT_SECONDS}s until=$(cat "$COOLDOWN_FILE" 2>/dev/null)"
  sleep "$WAIT_SECONDS"
fi

RADAR=( "$PYTHON" "$HARNESS_DIR/scripts/tech_hotspot_radar.py" --config "$CONFIG" --db "$DB" )
TMP_ERR="$(mktemp /tmp/solar-github-trend-report.XXXXXX.err)"
trap 'solar_release_lockdir "$DB_WRITER_LOCK_DIR"; solar_release_lockdir "$LOCK_DIR"; rm -f "$TMP_ERR"' EXIT INT TERM

run_report_once() {
  : > "$TMP_ERR"
  "${RADAR[@]}" github-trend-report \
    --date "$REPORT_DATE" \
    --limit "${GITHUB_TREND_REPORT_LIMIT:-12}" \
    --model "${GITHUB_TREND_REPORT_MODEL:-chatgpt-5.5}" "$@" 2>"$TMP_ERR"
}

send_report_mail() {
  if [[ "${GITHUB_TREND_REPORT_SEND_MAIL}" != "true" ]]; then
    echo "[github-trend-report-daily] mail skipped GITHUB_TREND_REPORT_SEND_MAIL=${GITHUB_TREND_REPORT_SEND_MAIL}"
    return 0
  fi
  "$PYTHON" - "$HARNESS_DIR" "$REPORT_DATE" <<'PY'
import importlib.util
import json
import pathlib
import sys

harness = pathlib.Path(sys.argv[1])
date_str = sys.argv[2]
report_dir = pathlib.Path("/Users/lisihao/Knowledge/_raw/tech-hotspot-radar/github-trend-report") / date_str
html_path = report_dir / "github-trend-report.html"
result_path = report_dir / "mail-result.json"
if not html_path.exists():
    raise SystemExit(f"missing report html: {html_path}")
spec = importlib.util.spec_from_file_location("tech_hotspot_radar", harness / "scripts" / "tech_hotspot_radar.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
result = mod.send_html_email(
    html_path.read_text(encoding="utf-8"),
    f"AI Influence GitHub 开源趋势洞察 — {date_str}",
    [html_path],
)
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, sort_keys=True))
PY
}

lease_wait_seconds() {
  "$PYTHON" - "$TMP_ERR" <<'PY'
import datetime as dt
import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
match = re.search(r"browser_profile_lease_acquire_failed:(\{.*?\})(?:\n|$)", text)
if not match:
    print(0)
    raise SystemExit
try:
    payload = json.loads(match.group(1))
    expires = payload.get("expires_at") or ""
    until = dt.datetime.fromisoformat(expires.replace("Z", "+00:00"))
    wait = int((until - dt.datetime.now(dt.UTC)).total_seconds()) + 5
    print(max(0, wait))
except Exception:
    print(0)
PY
}

MAX_ATTEMPTS="${GITHUB_TREND_REPORT_MAX_ATTEMPTS:-3}"
MAX_LEASE_WAIT="${GITHUB_TREND_REPORT_MAX_LEASE_WAIT_SECONDS:-2400}"
ATTEMPT=1
RC=1

echo "[github-trend-report-daily] start $(date) date=${REPORT_DATE}"
while (( ATTEMPT <= MAX_ATTEMPTS )); do
  echo "[github-trend-report-daily] attempt=${ATTEMPT}/${MAX_ATTEMPTS}"
  run_report_once "$@"
  RC=$?
  cat "$TMP_ERR" >&2
  if [[ "$RC" == "0" ]]; then
    send_report_mail || RC=$?
    if [[ "$RC" != "0" ]]; then
      echo "[github-trend-report-daily] mail failed rc=${RC}" >&2
      exit "$RC"
    fi
    echo "[github-trend-report-daily] ok $(date) date=${REPORT_DATE}"
    exit 0
  fi

  if rg -qi "请求过于频繁|too frequent|rate limit|temporarily restricted|限制你访问对话记录" "$TMP_ERR"; then
    UNTIL="$(set_cooldown_10m)"
    echo "[github-trend-report-daily] browser-agent rate limited; cooldown_until=${UNTIL}; retry_after=600s" >&2
    sleep 600
    ATTEMPT=$((ATTEMPT + 1))
    continue
  fi

  WAIT_FOR_LEASE="$(lease_wait_seconds)"
  if [[ "$WAIT_FOR_LEASE" =~ ^[0-9]+$ ]] && (( WAIT_FOR_LEASE > 0 && WAIT_FOR_LEASE <= MAX_LEASE_WAIT )); then
    echo "[github-trend-report-daily] browser profile busy; retry_after=${WAIT_FOR_LEASE}s" >&2
    sleep "$WAIT_FOR_LEASE"
    ATTEMPT=$((ATTEMPT + 1))
    continue
  fi

  break
done

echo "[github-trend-report-daily] failed rc=${RC} $(date) date=${REPORT_DATE}" >&2
exit "$RC"
