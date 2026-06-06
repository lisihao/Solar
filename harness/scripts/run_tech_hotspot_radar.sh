#!/usr/bin/env bash
set -uo pipefail

HARNESS_DIR="${HARNESS_DIR:-/Users/lisihao/Solar/harness}"
PYTHON="${PYTHON:-python3}"
SOLAR_HOME="${SOLAR_HOME:-$HOME/.solar}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
DB="${DB:-${SOLAR_HOME}/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
LOCK_DIR="${LOCK_DIR:-$(dirname "$DB")/collector.lockdir}"
DB_WRITER_LOCK_DIR="${DB_WRITER_LOCK_DIR:-$(dirname "$DB")/db-writer.lockdir}"
DB_WRITER_LOCK_WAIT_SECONDS="${DB_WRITER_LOCK_WAIT_SECONDS:-2400}"
TODAY_UTC="$("$PYTHON" - <<'PY'
import datetime as dt
print(dt.datetime.now(dt.UTC).date().isoformat())
PY
)"
START_UTC="$("$PYTHON" - <<'PY'
import datetime as dt
print((dt.datetime.now(dt.UTC).date() - dt.timedelta(days=2)).isoformat())
PY
)"

RADAR=( "$PYTHON" "$HARNESS_DIR/scripts/tech_hotspot_radar.py" --config "$CONFIG" --db "$DB" )
EXTRA_ARGS=( "$@" )
RC=0

mkdir -p "$(dirname "$LOCK_DIR")" "$(dirname "$DB")" "$HARNESS_DIR/logs"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
solar_acquire_lockdir "$LOCK_DIR" "tech-hotspot-radar"
rc=$?
if [[ "$rc" != "0" ]]; then
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
solar_wait_for_lockdir "$DB_WRITER_LOCK_DIR" "tech-hotspot-radar-db-writer" "$DB_WRITER_LOCK_WAIT_SECONDS" 10
rc=$?
if [[ "$rc" != "0" ]]; then
  solar_release_lockdir "$LOCK_DIR"
  [[ "$rc" == "75" ]] && exit 0
  exit "$rc"
fi
trap 'solar_release_lockdir "$DB_WRITER_LOCK_DIR"; solar_release_lockdir "$LOCK_DIR"' EXIT INT TERM

run_step() {
  local name="$1"
  shift
  echo "[$name]"
  if "$@"; then
    echo "[$name] ok"
  else
    local step_rc=$?
    echo "[$name] warn rc=${step_rc}" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
  fi
}

echo "Running Tech Hotspot Radar collectors at $(date)"

run_step "hf-trending" \
  "${RADAR[@]}" collect-hf-papers --period all --limit 80 --force "${EXTRA_ARGS[@]}"

run_step "hf-daily-baseline ${START_UTC}..${TODAY_UTC}" \
  "${RADAR[@]}" backfill-hf-papers-baseline \
  --start-date "$START_UTC" \
  --end-date "$TODAY_UTC" \
  --limit-per-day 80 \
  --sleep-seconds 1 \
  --max-consecutive-failures 3 \
  --force "${EXTRA_ARGS[@]}"

run_step "hf-paper-insights" \
  "${RADAR[@]}" materialize-hf-paper-insights --limit "${HF_INSIGHT_LIMIT:-160}" "${EXTRA_ARGS[@]}"

run_step "github" \
  "${RADAR[@]}" collect-github --limit-repos "${GITHUB_LIMIT_REPOS:-80}" --force "${EXTRA_ARGS[@]}"

run_step "github-analysis" \
  "${RADAR[@]}" analyze-github-projects --limit-repos "${GITHUB_ANALYZE_LIMIT_REPOS:-80}" --force "${EXTRA_ARGS[@]}"

run_step "social" \
  env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
  "${RADAR[@]}" collect-social \
  --backend "${SOCIAL_BACKEND:-rss}" \
  --limit-accounts "${SOCIAL_LIMIT_ACCOUNTS:-200}" \
  --per-account-limit "${SOCIAL_PER_ACCOUNT_LIMIT:-10}" \
  --force "${EXTRA_ARGS[@]}"

if [[ "${RUN_SOCIAL_BROWSER_FALLBACK:-0}" == "1" ]]; then
  run_step "social-browser-fallback" \
    env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
    "${RADAR[@]}" collect-social \
    --backend browser \
    --limit-accounts "${SOCIAL_BROWSER_FALLBACK_LIMIT:-10}" \
    --per-account-limit "${SOCIAL_BROWSER_FALLBACK_PER_ACCOUNT_LIMIT:-3}" \
    --force "${EXTRA_ARGS[@]}"
else
  echo "[social-browser-fallback] skipped RUN_SOCIAL_BROWSER_FALLBACK=0"
fi

if [[ "${RUN_SOCIAL_REPORT:-0}" == "1" ]]; then
  run_step "social-materialize" \
    env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
    "${RADAR[@]}" social-trend-report \
    --date "$TODAY_UTC" \
    --limit-posts "${SOCIAL_REPORT_LIMIT_POSTS:-80}" \
    --model "${SOCIAL_REPORT_MODEL:-gpt-5.4}" "${EXTRA_ARGS[@]}"
else
  echo "[social-materialize] skipped RUN_SOCIAL_REPORT=0"
fi

echo "Tech Hotspot Radar collectors done at $(date) rc=${RC}"
if [[ "${ALLOW_PARTIAL_SUCCESS:-1}" == "1" && "$RC" != "0" ]]; then
  echo "Tech Hotspot Radar collectors completed with warnings; ALLOW_PARTIAL_SUCCESS=1 so exiting 0"
  exit 0
fi
exit "$RC"
