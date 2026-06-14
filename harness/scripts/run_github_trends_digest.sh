#!/usr/bin/env bash
set -euo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
CONFIG="${GITHUB_TRENDS_CONFIG:-$HARNESS_DIR/config/github-trends.yaml}"
PYTHON="${PYTHON:-python3}"

echo "[github-trends-digest] retired: raw digest report/email generation is disabled; use scripts/run_github_trend_report_daily.sh --date YYYY-MM-DD so report generation and mail-result stay unified" >&2
exec "$PYTHON" "$HARNESS_DIR/scripts/github_trends_digest.py" collect --config "$CONFIG" "$@"
