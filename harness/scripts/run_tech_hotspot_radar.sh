#!/usr/bin/env bash
set -uo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
PYTHON="${PYTHON:-python3}"
SOLAR_HOME="${SOLAR_HOME:-$HOME/.solar}"
SOLAR_KNOWLEDGE_DIR="${SOLAR_KNOWLEDGE_DIR:-$HOME/Knowledge}"
CONFIG="${CONFIG:-$HARNESS_DIR/config/tech-hotspot-radar.yaml}"
DB="${DB:-${SOLAR_HOME}/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite}"
LOCK_DIR="${LOCK_DIR:-$(dirname "$DB")/collector.lockdir}"
DB_WRITER_LOCK_DIR="${DB_WRITER_LOCK_DIR:-$(dirname "$DB")/db-writer.lockdir}"
DB_WRITER_LOCK_WAIT_SECONDS="${DB_WRITER_LOCK_WAIT_SECONDS:-2400}"
GENESISPOD_DIR="${GENESISPOD_DIR:-$HARNESS_DIR/plugins/genesis-verifier/vendor/GenesisPod}"
export SOLAR_REPO HARNESS_DIR SOLAR_HOME SOLAR_KNOWLEDGE_DIR
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
EXTRA_ARGS_COUNT="$#"
RC=0
FAILED_STEPS=""

mkdir -p "$(dirname "$LOCK_DIR")" "$(dirname "$DB")" "$HARNESS_DIR/logs"
source "$HARNESS_DIR/scripts/lib/lockdir.sh"
source "$HARNESS_DIR/scripts/lib/scheduled-task.sh"
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
    echo "[$name] warn rc=${step_rc} at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
    RC=$(( RC > step_rc ? RC : step_rc ))
    FAILED_STEPS="${FAILED_STEPS:+${FAILED_STEPS}|}${name}"
  fi
}

run_with_extra_args() {
  if [[ "$EXTRA_ARGS_COUNT" -gt 0 ]]; then
    "$@" "${EXTRA_ARGS[@]}"
  else
    "$@"
  fi
}

echo "Running Tech Hotspot Radar collectors at $(date)"

run_step "hf-trending" \
  run_with_extra_args "${RADAR[@]}" collect-hf-papers --period all --limit 80 --force

run_step "hf-daily-baseline ${START_UTC}..${TODAY_UTC}" \
  run_with_extra_args "${RADAR[@]}" backfill-hf-papers-baseline \
  --start-date "$START_UTC" \
  --end-date "$TODAY_UTC" \
  --limit-per-day 80 \
  --sleep-seconds 1 \
  --max-consecutive-failures 3 \
  --force

run_step "arxiv-daily-baseline ${START_UTC}..${TODAY_UTC}" \
  run_with_extra_args "${RADAR[@]}" backfill-arxiv-papers-baseline \
  --start-date "$START_UTC" \
  --end-date "$TODAY_UTC" \
  --limit-per-day "${ARXIV_LIMIT_PER_DAY:-80}" \
  --sleep-seconds "${ARXIV_SLEEP_SECONDS:-3}" \
  --max-consecutive-failures 3 \
  --force

run_step "hf-paper-insights" \
  run_with_extra_args "${RADAR[@]}" materialize-hf-paper-insights --limit "${HF_INSIGHT_LIMIT:-160}"

run_step "github" \
  run_with_extra_args "${RADAR[@]}" collect-github --limit-repos "${GITHUB_LIMIT_REPOS:-80}" --force

run_step "github-analysis" \
  run_with_extra_args "${RADAR[@]}" analyze-github-projects --limit-repos "${GITHUB_ANALYZE_LIMIT_REPOS:-80}" --force

run_step "social" \
  run_with_extra_args env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
    "${RADAR[@]}" collect-social \
    --backend "${SOCIAL_BACKEND:-rss}" \
    --limit-accounts "${SOCIAL_LIMIT_ACCOUNTS:-200}" \
    --per-account-limit "${SOCIAL_PER_ACCOUNT_LIMIT:-10}" \
    --force

if [[ "${RUN_SOCIAL_BROWSER_FALLBACK:-0}" == "1" ]]; then
  run_step "social-browser-fallback" \
    run_with_extra_args env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
    "${RADAR[@]}" collect-social \
    --backend browser \
    --limit-accounts "${SOCIAL_BROWSER_FALLBACK_LIMIT:-10}" \
    --per-account-limit "${SOCIAL_BROWSER_FALLBACK_PER_ACCOUNT_LIMIT:-3}" \
    --force
else
  echo "[social-browser-fallback] skipped RUN_SOCIAL_BROWSER_FALLBACK=0"
fi

if [[ "${RUN_SOCIAL_REPORT:-0}" == "1" ]]; then
  run_step "social-materialize" \
    run_with_extra_args env SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE="${SOLAR_SOCIAL_BROWSER_BACKEND_DISABLE:-0}" \
    "${RADAR[@]}" social-trend-report \
    --date "$TODAY_UTC" \
    --limit-posts "${SOCIAL_REPORT_LIMIT_POSTS:-80}" \
    --model "${SOCIAL_REPORT_MODEL:-gpt-5.4}"
else
  echo "[social-materialize] skipped RUN_SOCIAL_REPORT=0"
fi

if [[ "${RUN_GENESISPOD_SYNC:-1}" == "1" ]]; then
  run_step "genesispod-sync" \
    env SOLAR_TECH_HOTSPOT_DB="$DB" \
      node "$GENESISPOD_DIR/scripts/local/sync-solar-hf-papers-library.js"
else
  echo "[genesispod-sync] skipped RUN_GENESISPOD_SYNC=0"
fi

echo "Tech Hotspot Radar collectors done at $(date) rc=${RC}"
if [[ "$RC" != "0" ]]; then
  solar_task_record_failure "tech-hotspot-radar" "$RC" "$FAILED_STEPS"
  if [[ "${ALLOW_PARTIAL_SUCCESS:-0}" == "1" ]]; then
    echo "Tech Hotspot Radar collectors completed with warnings; ALLOW_PARTIAL_SUCCESS=1 so exiting 0"
    exit 0
  fi
fi
exit "$RC"
