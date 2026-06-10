#!/usr/bin/env bash
set -uo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
PYTHON="${PYTHON:-python3}"

exec "$PYTHON" "$HARNESS_DIR/scripts/staleness_sentinel.py" --apply "$@"
