#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
PYTHON="${PYTHON:-python3}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
DB="${DB:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
LOG_DIR="${SOLAR_HF_WEEKLY_REPORT_LOG_DIR:-$HARNESS_DIR/logs}"
LOCK_DIR="${SOLAR_HF_WEEKLY_REPORT_LOCK_DIR:-/Users/lisihao/.solar/harness/state/tech-hotspot-radar/hf-weekly-report.lockdir}"
DB_WRITER_LOCK_DIR="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_DIR:-$(dirname "$DB")/db-writer.lockdir}"
DB_WRITER_LOCK_WAIT_SECONDS="${SOLAR_TECH_HOTSPOT_DB_WRITER_LOCK_WAIT_SECONDS:-2400}"
LOCAL_TZ="${LOCAL_TZ:-America/Toronto}"
MAIL_TO_CONFIG="${AI_INFLUENCE_MAIL_CONFIG:-/Users/lisihao/.solar/harness/state/ai-influence-mail-config.json}"

mkdir -p "$(dirname "$LOCK_DIR")" "$LOG_DIR" "$(dirname "$DB_WRITER_LOCK_DIR")"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "hf-paper-weekly-report"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
solar_wait_for_lockdir "$DB_WRITER_LOCK_DIR" "hf-paper-weekly-report-db-writer" "$DB_WRITER_LOCK_WAIT_SECONDS" 10
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
export TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS="${TECH_HOTSPOT_BROWSER_CHATGPT_HEADLESS:-true}"
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
export HF_WEEKLY_REPORT_SEND_MAIL="${HF_WEEKLY_REPORT_SEND_MAIL:-true}"

# Run on Monday for the just-finished ISO week. Passing Sunday as date anchors
# the report window to Monday 00:00:00 through Sunday 23:59:59 Eastern.
REPORT_DATE="${HF_WEEKLY_REPORT_DATE:-$("$PYTHON" - <<'PY'
import datetime as dt
import os
from zoneinfo import ZoneInfo

today = dt.datetime.now(ZoneInfo(os.environ.get("LOCAL_TZ", "America/Toronto"))).date()
print((today - dt.timedelta(days=1)).isoformat())
PY
)}"

RADAR=( "$PYTHON" "$HARNESS_DIR/scripts/tech_hotspot_radar.py" --config "$CONFIG" --db "$DB" )

echo "[hf-paper-weekly-report] start $(date) report_date=${REPORT_DATE}"
if ! "${RADAR[@]}" compile-hf-paper-report \
  --date "$REPORT_DATE" \
  --limit "${HF_WEEKLY_REPORT_LIMIT:-12}" \
  --reasoning-mode "${HF_WEEKLY_REPORT_REASONING_MODE:-browser_agent}" "$@"; then
  RC=$?
  echo "[hf-paper-weekly-report] compile failed rc=${RC}" >&2
  exit "$RC"
fi

if [[ "$HF_WEEKLY_REPORT_SEND_MAIL" == "true" ]]; then
  "$PYTHON" - "$HARNESS_DIR" "$REPORT_DATE" <<'PY'
import importlib.util
import json
import pathlib
import sys

harness = pathlib.Path(sys.argv[1])
date_str = sys.argv[2]
report_dir = pathlib.Path("/Users/lisihao/Knowledge/_raw/tech-hotspot-radar") / date_str
html_path = report_dir / "hf-paper-report.html"
result_path = report_dir / "mail-result.json"
if not html_path.exists():
    raise SystemExit(f"missing report html: {html_path}")
spec = importlib.util.spec_from_file_location("tech_hotspot_radar", harness / "scripts" / "tech_hotspot_radar.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
result = mod.send_html_email(
    html_path.read_text(encoding="utf-8"),
    f"Hugging Face 论文周报 — {date_str}",
    [html_path],
)
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, sort_keys=True))
PY
fi

echo "[hf-paper-weekly-report] ok $(date) report_date=${REPORT_DATE}"
