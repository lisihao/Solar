#!/usr/bin/env bash
set -euo pipefail

SOLAR_REPO="${SOLAR_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
HARNESS_DIR="${HARNESS_DIR:-${SOLAR_REPO}/harness}"
CONFIG="${YOUTUBE_INFLUENCE_DIGEST_CONFIG:-$HARNESS_DIR/config/youtube-influence-digest.yaml}"
PYTHON="${PYTHON:-python3}"

exec "$PYTHON" "$HARNESS_DIR/scripts/youtube_influence_digest.py" --config "$CONFIG" "$@"
